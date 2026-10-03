import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import ts from 'typescript';
import {
  INCREMENTAL_CACHE_HASH_LENGTH,
  MUTATION_SHARDS,
  OPEN_RANGE_END,
  REPO_ROOT,
  SHARD_MUTANT_BUDGET,
  SPRINT_SHARD_MUTANT_BUDGET,
  coverageIncludesLine,
  coverageIncludesLocation,
  incrementalCacheKey,
  listConfiguredMutateFiles,
  resolveShardMutate,
  shardIds,
  shardMutantBudget,
  toMatrixInclude,
} from '../../../scripts/mutation-shards.mjs';

type ShardCoverage = true | Array<{ start: number; end: number }>;

// 従来から関数途中の分割を禁止している対象。関数名・境界は現在の AST に従う。
const FUNCTION_BOUNDARY_FILES = [
  'src/sim/sprint.ts',
  'src/sim/run/engine.ts',
  'src/state/persistFrameShape.ts',
];

function readWorkflow(): string {
  return readFileSync(join(REPO_ROOT, '.github/workflows/mutation.yml'), 'utf8');
}

function readStrykerConfig(): { mutate: string[]; dryRunTimeoutMinutes?: number } {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'stryker.config.json'), 'utf8')) as {
    mutate: string[];
    dryRunTimeoutMinutes?: number;
  };
}

async function instrumentCoreFiles(files: string[]) {
  const logger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    isDebugEnabled() {
      return false;
    },
    isTraceEnabled() {
      return false;
    },
  };
  const instrumenter = new Instrumenter(logger);
  const input = files.map((name) => ({
    name,
    mutate: true as const,
    content: readFileSync(join(REPO_ROOT, name), 'utf8'),
  }));
  const { mutants } = await instrumenter.instrument(input, {
    ignorers: [],
    plugins: null,
    excludedMutations: [],
  });
  return mutants;
}

function lineCount(relPath: string): number {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8').split('\n').length;
}

/** 現在の AST から取得し、関数名・行番号の一覧をテストに複製しない。 */
function functionRanges(file: string, content: string) {
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const functions: Array<{ name: string; start: number; end: number }> = [];
  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isFunctionExpression(node)
    ) {
      if (node.body) {
        functions.push({
          name: ('name' in node && node.name?.getText(source)) || ts.SyntaxKind[node.kind],
          start: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          end: source.getLineAndCharacterOfPosition(node.getEnd() - 1).line + 1,
        });
      }
      // 外側の関数全体を守れば、その中のコールバックも途中で割れない。
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return functions;
}

function splitFunctions(functions: ReturnType<typeof functionRanges>, coverage: ShardCoverage) {
  return functions.filter(
    (fn) =>
      coverage !== true &&
      !coverage.some((range) => range.start <= fn.start && range.end >= fn.end),
  );
}

function shardCoverageMaps() {
  return MUTATION_SHARDS.map((shard) => ({
    id: shard.id,
    files: resolveShardMutate(shard.mutate),
  }));
}

function coveringShards(
  maps: ReturnType<typeof shardCoverageMaps>,
  file: string,
  location: { start: { line: number; column: number }; end: { line: number; column: number } },
): string[] {
  const ids: string[] = [];
  for (const shard of maps) {
    const coverage = shard.files.get(file) as ShardCoverage | undefined;
    if (coverage && coverageIncludesLocation(coverage, location)) {
      ids.push(shard.id);
    }
  }
  return ids;
}

describe('mutation shards', () => {
  const coreFiles = listConfiguredMutateFiles();

  it('id は一意で kebab-case', () => {
    const ids = shardIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);
    }
  });

  it('コア mutate 対象ファイルを漏れなく覆い、行レンジに隙間が無い', () => {
    expect(coreFiles.length).toBeGreaterThan(0);

    const covered = new Set<string>();
    /** 行レンジで割っているファイル → レンジ一覧 */
    const ranged = new Map<string, Array<{ start: number; end: number }>>();

    for (const shard of MUTATION_SHARDS) {
      const resolved = resolveShardMutate(shard.mutate);
      for (const [file, coverage] of resolved) {
        covered.add(file);
        if (coverage !== true) {
          const list = ranged.get(file) ?? [];
          list.push(...coverage);
          ranged.set(file, list);
        }
      }
    }

    const missing = coreFiles.filter((file) => !covered.has(file));
    expect(missing, `未割当: ${missing.join(', ')}`).toEqual([]);

    const extra = [...covered].filter((file) => !coreFiles.includes(file));
    expect(extra, `設定外: ${extra.join(', ')}`).toEqual([]);

    for (const [file, ranges] of ranged) {
      const sorted = [...ranges].sort((a, b) => a.start - b.start);
      expect(sorted[0]?.start, `${file} 先頭`).toBe(1);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i].start, `${file} 隙間 ${sorted[i - 1].end}→${sorted[i].start}`).toBe(
          sorted[i - 1].end + 1,
        );
      }
      const last = sorted[sorted.length - 1];
      expect(last.end).toBeGreaterThanOrEqual(lineCount(file));
      expect(last.end).toBe(OPEN_RANGE_END);
    }
  });

  it('各 mutant はちょうど 1 シャードに入り、1 シャードは予算以内', async () => {
    const mutants = await instrumentCoreFiles(coreFiles);
    expect(mutants.length).toBeGreaterThan(0);

    const maps = shardCoverageMaps();
    const perShard = new Map<string, number>(MUTATION_SHARDS.map((shard) => [shard.id, 0]));
    const unassigned: string[] = [];
    const overlapped: string[] = [];

    for (const mutant of mutants) {
      const file = mutant.fileName.replaceAll('\\', '/');
      const ids = coveringShards(maps, file, mutant.location);
      if (ids.length === 0) {
        unassigned.push(
          `${file}:${mutant.location.start.line}-${mutant.location.end.line}:${mutant.mutatorName}`,
        );
      } else if (ids.length > 1) {
        overlapped.push(
          `${file}:${mutant.location.start.line}-${mutant.location.end.line} → ${ids.join(',')}`,
        );
      } else {
        perShard.set(ids[0], (perShard.get(ids[0]) ?? 0) + 1);
      }
    }

    expect(unassigned.slice(0, 10), `未割当 ${unassigned.length} 件`).toEqual([]);
    expect(overlapped.slice(0, 10), `重複 ${overlapped.length} 件`).toEqual([]);

    const overBudget = [...perShard.entries()].filter(
      ([id, count]) => count > shardMutantBudget(id),
    );
    expect(overBudget, `予算超過: ${JSON.stringify(overBudget)}`).toEqual([]);

    const assigned = [...perShard.values()].reduce((sum, n) => sum + n, 0);
    expect(assigned).toBe(mutants.length);
  });

  it('Stryker と同様、mutant の開始と終了が両方レンジ内のときだけ覆う', () => {
    // 特定の本番関数の行番号ではなく、開始だけ入る・終了だけ入る例を使う。
    const location = {
      start: { line: 2, column: 0 },
      end: { line: 4, column: 1 },
    };
    expect(coverageIncludesLocation([{ start: 1, end: 3 }], location)).toBe(false);
    expect(coverageIncludesLocation([{ start: 4, end: 6 }], location)).toBe(false);
    expect(coverageIncludesLocation([{ start: 3, end: 5 }], location)).toBe(true);
    expect(coverageIncludesLine([{ start: 1, end: 3 }], 3)).toBe(true);
  });

  it('重要なシミュレーション・永続化対象が mutate 設定から漏れない', () => {
    expect(coreFiles).toEqual(
      expect.arrayContaining([...FUNCTION_BOUNDARY_FILES, 'src/sim/run/sprintBaseline.ts']),
    );
  });

  it.each(FUNCTION_BOUNDARY_FILES)('%s の現在の関数・メソッドを途中で割らない', (file) => {
    const maps = shardCoverageMaps();
    const functions = functionRanges(file, readFileSync(join(REPO_ROOT, file), 'utf8'));
    const split = functions.filter(
      (fn) =>
        !maps.some((shard) => {
          const coverage = shard.files.get(file);
          return coverage !== undefined && splitFunctions([fn], coverage).length === 0;
        }),
    );
    expect(split, `${file} の関数途中で分割`).toEqual([]);
  });

  it('AST の関数境界はコメント追加・移動・関数抽出を追跡し、途中分割を検出する', () => {
    const content = `function outer(
  value: number,
): number {
  return value + 1;
}
class Example {
  method() {
    return outer(1);
  }
}
const arrow = () => {
  return outer(2);
};
const expression = function helper() {
  return outer(3);
};`;
    const functions = functionRanges('fixture.ts', content);
    expect(functions.map((fn) => fn.name)).toEqual(['outer', 'method', 'ArrowFunction', 'helper']);
    const moved = functionRanges('fixture.ts', `// コメント\n\n${content}`);
    expect(moved).toEqual(functions.map((fn) => ({ ...fn, start: fn.start + 2, end: fn.end + 2 })));
    const extracted = functionRanges('extracted.ts', content.slice(0, content.indexOf('class')));
    expect(extracted).toEqual([functions[0]]);

    for (const fn of moved) {
      expect(splitFunctions([fn], true)).toEqual([]);
      expect(splitFunctions([fn], [{ start: fn.start, end: fn.end }])).toEqual([]);
      expect(
        splitFunctions(
          [fn],
          [
            { start: 1, end: fn.end - 1 },
            { start: fn.end, end: OPEN_RANGE_END },
          ],
        ),
      ).toEqual([fn]);
      expect(
        splitFunctions(
          [fn],
          [
            { start: 1, end: fn.start - 1 },
            { start: fn.start, end: OPEN_RANGE_END },
          ],
        ),
      ).toEqual([]);
    }
  });

  it('sprint 経路の mutant 予算は通常シャードより厳しい', () => {
    expect(SPRINT_SHARD_MUTANT_BUDGET).toBeLessThan(SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-sprint-e')).toBe(SPRINT_SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-sprint-baseline-b')).toBe(SPRINT_SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-engine-e')).toBe(SPRINT_SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-engine-g')).toBe(SPRINT_SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-engine-a')).toBe(SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-engine-f')).toBe(SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-support')).toBe(SHARD_MUTANT_BUDGET);
  });

  it('workflow はシャード定義スクリプトを matrix に使い、incremental cache は mutate ハッシュを見る', () => {
    const yaml = readWorkflow();
    expect(yaml).toContain('scripts/mutation-shards.mjs --matrix');
    expect(yaml).toContain('fromJson(needs.mutation-shard-matrix.outputs.include)');
    expect(yaml).not.toContain('id: sim-run-engine\n');
    expect(yaml).toContain('stryker-incremental-${{ matrix.cache }}');
    expect(yaml).not.toContain('stryker-incremental-${{ matrix.id }}-${{ runner.os }}');
  });

  it('workflow は土日月早朝の差分targetedと手動のtargeted/fullを分ける', () => {
    const yaml = readWorkflow();
    expect(yaml).toContain("cron: '0 18 * * 5,6,0'");
    expect(yaml).toContain("if: ${{ github.event_name == 'schedule' }}");
    expect(yaml).toContain('scripts/scheduled-mutation-targets.mjs');
    expect(yaml).toContain('timeout-minutes: 60');
    expect(yaml).toContain('stryker-incremental-scheduled-${{ steps.targets.outputs.cache }}');
    expect(yaml).toContain("if: ${{ inputs.mode == 'targeted' }}");
    expect(yaml).toContain("if: ${{ inputs.mode == 'full' }}");
    expect(yaml).toContain('Validate targeted input');
    expect(yaml).toContain('if [ -z "${MUTATE}" ]');
  });

  it('matrix JSON は id / mutate / cache を出し、mutate が変わると cache も変わる', () => {
    const include = toMatrixInclude();
    expect(include).toHaveLength(MUTATION_SHARDS.length);
    expect(include[0]).toEqual({
      id: MUTATION_SHARDS[0].id,
      mutate: MUTATION_SHARDS[0].mutate,
      cache: incrementalCacheKey(MUTATION_SHARDS[0].id, MUTATION_SHARDS[0].mutate),
    });
    expect(include[0].cache).toMatch(
      new RegExp(`^${MUTATION_SHARDS[0].id}-[0-9a-f]{${INCREMENTAL_CACHE_HASH_LENGTH}}$`),
    );

    for (const shard of include) {
      expect(shard.cache).not.toBe(shard.id);
      expect(incrementalCacheKey(shard.id, shard.mutate)).toBe(shard.cache);
      expect(incrementalCacheKey(shard.id, `${shard.mutate},src/fixture.ts`)).not.toBe(shard.cache);
    }
  });

  it('初期 dry-run が 5 分で死なないよう timeout を上げている', () => {
    const config = readStrykerConfig();
    expect(config.dryRunTimeoutMinutes).toBeGreaterThanOrEqual(20);
  });

  it('mutation vitest は F-4/F-5 行列だけ dry-run から外し、sprintTempo の軽量テストは残す', () => {
    const mutationVitest = readFileSync(join(REPO_ROOT, 'vitest.mutation.config.ts'), 'utf8');
    expect(mutationVitest).toContain('tests/unit/ui/sprintTempoPacing.test.ts');
    expect(mutationVitest).toContain('exclude');
    expect(mutationVitest).not.toContain("exclude: ['tests/unit/ui/sprintTempo.test.ts']");
  });
});
