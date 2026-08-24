import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Instrumenter } from '@stryker-mutator/instrumenter';
import {
  MUTATION_SHARDS,
  OPEN_RANGE_END,
  REPO_ROOT,
  SHARD_MUTANT_BUDGET,
  coverageIncludesLine,
  listConfiguredMutateFiles,
  resolveShardMutate,
  shardIds,
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
  line: number,
): string[] {
  const ids: string[] = [];
  for (const shard of maps) {
    const coverage = shard.files.get(file) as ShardCoverage | undefined;
    if (coverage && coverageIncludesLine(coverage, line)) {
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
      const line = mutant.location.start.line;
      const ids = coveringShards(maps, file, line);
      if (ids.length === 0) {
        unassigned.push(`${file}:${line}:${mutant.mutatorName}`);
      } else if (ids.length > 1) {
        overlapped.push(`${file}:${line} → ${ids.join(',')}`);
      } else {
        perShard.set(ids[0], (perShard.get(ids[0]) ?? 0) + 1);
      }
    }

    expect(unassigned.slice(0, 10), `未割当 ${unassigned.length} 件`).toEqual([]);
    expect(overlapped.slice(0, 10), `重複 ${overlapped.length} 件`).toEqual([]);

    const overBudget = [...perShard.entries()].filter(([, count]) => count > SHARD_MUTANT_BUDGET);
    expect(overBudget, `予算超過: ${JSON.stringify(overBudget)}`).toEqual([]);

    const assigned = [...perShard.values()].reduce((sum, n) => sum + n, 0);
    expect(assigned).toBe(mutants.length);
  });

  it('workflow はシャード定義スクリプトを matrix に使う', () => {
    const yaml = readWorkflow();
    expect(yaml).toContain('scripts/mutation-shards.mjs --matrix');
    expect(yaml).toContain('fromJson(needs.mutation-shard-matrix.outputs.include)');
    expect(yaml).not.toContain('id: sim-run-engine\n');
  });

  it('matrix JSON は id と mutate だけを出す', () => {
    const include = toMatrixInclude();
    expect(include).toHaveLength(MUTATION_SHARDS.length);
    expect(include[0]).toEqual({
      id: MUTATION_SHARDS[0].id,
      mutate: MUTATION_SHARDS[0].mutate,
    });
  });

  it('初期 dry-run が 5 分で死なないよう timeout を上げている', () => {
    const config = readStrykerConfig();
    expect(config.dryRunTimeoutMinutes).toBeGreaterThanOrEqual(20);
  });
});
