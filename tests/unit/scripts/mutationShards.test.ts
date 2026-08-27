import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Instrumenter } from '@stryker-mutator/instrumenter';
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
    expect(coreFiles.length).toBeGreaterThan(20);

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
    expect(mutants.length).toBeGreaterThan(10_000);

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
    const titleBody = {
      start: { line: 644, column: 0 },
      end: { line: 735, column: 1 },
    };
    expect(coverageIncludesLocation([{ start: 585, end: 680 }], titleBody)).toBe(false);
    expect(coverageIncludesLocation([{ start: 681, end: OPEN_RANGE_END }], titleBody)).toBe(false);
    expect(coverageIncludesLocation([{ start: 642, end: OPEN_RANGE_END }], titleBody)).toBe(true);
    expect(coverageIncludesLine([{ start: 585, end: 680 }], 645)).toBe(true);
  });

  it('computeTitleAndDiagnosis を関数の途中で割らない', () => {
    const titleStart = 642;
    const titleEnd = 736;
    const sprintRanges = MUTATION_SHARDS.flatMap((shard) => {
      const resolved = resolveShardMutate(shard.mutate);
      const coverage = resolved.get('src/sim/sprint.ts');
      return coverage === true || coverage === undefined ? [] : coverage;
    });
    const cutInside = sprintRanges.filter(
      (range) => range.start > titleStart && range.start <= titleEnd,
    );
    expect(cutInside).toEqual([]);
  });

  it('sprint 経路の mutant 予算は通常シャードより厳しい', () => {
    expect(SPRINT_SHARD_MUTANT_BUDGET).toBeLessThan(SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-sprint-e')).toBe(SPRINT_SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-sprint-baseline-b')).toBe(SPRINT_SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-engine-e')).toBe(SPRINT_SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-engine-a')).toBe(SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-engine-f')).toBe(SHARD_MUTANT_BUDGET);
    expect(shardMutantBudget('sim-run-support')).toBe(SHARD_MUTANT_BUDGET);
  });

  it('sprint.ts と sprintBaseline.ts は行レンジで細かく割る', () => {
    const sprintShards = MUTATION_SHARDS.filter((shard) =>
      shard.mutate.startsWith('src/sim/sprint.ts'),
    );
    expect(sprintShards.length).toBeGreaterThanOrEqual(6);
    expect(sprintShards.every((shard) => shard.mutate.includes(':'))).toBe(true);

    const baselineShards = MUTATION_SHARDS.filter((shard) =>
      shard.mutate.startsWith('src/sim/run/sprintBaseline.ts'),
    );
    expect(baselineShards.length).toBeGreaterThanOrEqual(2);
    expect(baselineShards.every((shard) => shard.mutate.includes(':'))).toBe(true);
    expect(MUTATION_SHARDS.some((shard) => shard.id === 'sim-sprint-e')).toBe(true);
  });

  it('engine.ts の step / resolveSprint を関数の途中で割らない', () => {
    const methods = [
      { name: 'beginSprint', start: 655, end: 724 },
      { name: 'step', start: 768, end: 777 },
      { name: 'resolveSprint', start: 819, end: 901 },
      { name: 'chooseGoalAdjustment', start: 995, end: 1057 },
    ];
    const engineRanges = MUTATION_SHARDS.flatMap((shard) => {
      const resolved = resolveShardMutate(shard.mutate);
      const coverage = resolved.get('src/sim/run/engine.ts');
      return coverage === true || coverage === undefined ? [] : coverage;
    });
    for (const method of methods) {
      const cutInside = engineRanges.filter(
        (range) => range.start > method.start && range.start <= method.end,
      );
      expect(cutInside, method.name).toEqual([]);
    }
    expect(MUTATION_SHARDS.filter((shard) => shard.id.startsWith('sim-run-engine-')).length).toBe(
      6,
    );
  });

  it('workflow はシャード定義スクリプトを matrix に使い、incremental cache は mutate ハッシュを見る', () => {
    const yaml = readWorkflow();
    expect(yaml).toContain('scripts/mutation-shards.mjs --matrix');
    expect(yaml).toContain('fromJson(needs.mutation-shard-matrix.outputs.include)');
    expect(yaml).not.toContain('id: sim-run-engine\n');
    expect(yaml).toContain('stryker-incremental-${{ matrix.cache }}');
    expect(yaml).not.toContain('stryker-incremental-${{ matrix.id }}-${{ runner.os }}');
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

    const support = include.find((shard) => shard.id === 'sim-run-support');
    expect(support).toBeDefined();
    expect(support?.cache).not.toBe('sim-run-support');
    expect(incrementalCacheKey('sim-run-support', support?.mutate ?? '')).toBe(support?.cache);
    expect(
      incrementalCacheKey(
        'sim-run-support',
        'src/sim/run/whatIf*.ts,src/sim/run/sprintBaseline.ts,src/sim/run/sprintBaselineBuild.ts',
      ),
    ).not.toBe(support?.cache);

    const sprintA = include.find((shard) => shard.id === 'sim-sprint-a');
    expect(sprintA).toBeDefined();
    expect(incrementalCacheKey('sim-sprint-a', 'src/sim/sprint.ts:1-450')).not.toBe(sprintA?.cache);
  });

  it('初期 dry-run が 5 分で死なないよう timeout を上げている', () => {
    const config = readStrykerConfig();
    expect(config.dryRunTimeoutMinutes).toBeGreaterThanOrEqual(20);
  });

  it('mutation vitest は sprintTempo の重い行列を dry-run から外す', () => {
    const mutationVitest = readFileSync(join(REPO_ROOT, 'vitest.mutation.config.ts'), 'utf8');
    expect(mutationVitest).toContain('tests/unit/ui/sprintTempo.test.ts');
    expect(mutationVitest).toContain('exclude');
  });
});
