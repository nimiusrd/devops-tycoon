/**
 * Mutation ワークフローのシャード定義。
 *
 * GitHub Actions の matrix と、フルシャード baseline の artifact 名の正本。
 * コア対象（`stryker.config.json` の mutate）を分割するが、mutant 集合は減らさない。
 *
 * 使い方:
 *   node scripts/mutation-shards.mjs --matrix   # GHA matrix include JSON
 *   node scripts/mutation-shards.mjs --ids      # シャード id の JSON 配列
 *   node scripts/mutation-shards.mjs --list     # 人間向け一覧
 */
import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(SCRIPT_DIR, '..');

/**
 * 1 ジョブあたりの instrumented mutant 上限。
 * engine.ts 約 2,000 mutant が 180 分で打ち切られた実測から、
 * 余裕を見て 700 以下に収める（同じ速度なら 1 時間前後）。
 */
export const SHARD_MUTANT_BUDGET = 700;

/**
 * 最終行レンジの終端。ファイルが伸びても最後のシャードが拾う。
 * 実ファイル行数より十分大きく、Stryker の `file:start-end` 構文で使う。
 */
export const OPEN_RANGE_END = 99999;

const MUTATION_RANGE_RE = /^(.*?):(\d+)(?::\d+)?-(\d+)(?::\d+)?$/;

/**
 * @typedef {{ id: string, mutate: string, note: string }} MutationShard
 */

/** @type {readonly MutationShard[]} */
export const MUTATION_SHARDS = Object.freeze([
  // src/sim/run/engine.ts — 約 1,960 mutant。旧 1 ジョブが 180 分タイムアウト。
  {
    id: 'sim-run-engine-a',
    mutate: 'src/sim/run/engine.ts:1-1050',
    note: 'engine 前半（初期化・スプリント開始）',
  },
  {
    id: 'sim-run-engine-b',
    mutate: 'src/sim/run/engine.ts:1051-1500',
    note: 'engine 中盤（解決・四半期レビュー・ショップ手前）',
  },
  {
    id: 'sim-run-engine-c',
    mutate: 'src/sim/run/engine.ts:1501-2050',
    note: 'engine 後半（ズーム・組織レバー・what-if）',
  },
  {
    id: 'sim-run-engine-d',
    mutate: `src/sim/run/engine.ts:2051-${OPEN_RANGE_END}`,
    note: 'engine 末尾（永続化・hydrate・snapshot。以降の追記もここ）',
  },

  // src/sim/run/counterfactual.ts — 約 2,170 mutant。旧 sim-run-rest 肥大の主因。
  {
    id: 'sim-run-counterfactual-a',
    mutate: 'src/sim/run/counterfactual.ts:1-500',
    note: 'counterfactual 前半',
  },
  {
    id: 'sim-run-counterfactual-b',
    mutate: 'src/sim/run/counterfactual.ts:501-900',
    note: 'counterfactual 中盤前',
  },
  {
    id: 'sim-run-counterfactual-c',
    mutate: 'src/sim/run/counterfactual.ts:901-1400',
    note: 'counterfactual 中盤後',
  },
  {
    id: 'sim-run-counterfactual-d',
    mutate: `src/sim/run/counterfactual.ts:1401-${OPEN_RANGE_END}`,
    note: 'counterfactual 末尾（以降の追記もここ）',
  },

  // src/sim/run/quarterReview.ts — 約 830 mutant。
  {
    id: 'sim-run-quarter-review-a',
    mutate: 'src/sim/run/quarterReview.ts:1-450',
    note: 'quarterReview 前半',
  },
  {
    id: 'sim-run-quarter-review-b',
    mutate: `src/sim/run/quarterReview.ts:451-${OPEN_RANGE_END}`,
    note: 'quarterReview 後半',
  },

  {
    id: 'sim-run-danger-zone',
    mutate: 'src/sim/run/dangerZone.ts',
    note: 'dangerZone（約 320 mutant）',
  },
  {
    id: 'sim-run-support',
    mutate:
      'src/sim/run/whatIf*.ts,src/sim/run/sprintBaseline.ts,src/sim/run/sprintBaselineBuild.ts',
    note: 'what-if とスプリント baseline',
  },
  {
    id: 'sim-run-rest',
    mutate: [
      'src/sim/run/**/*.ts',
      '!src/sim/run/engine.ts',
      '!src/sim/run/counterfactual.ts',
      '!src/sim/run/quarterReview.ts',
      '!src/sim/run/dangerZone.ts',
      '!src/sim/run/whatIf*.ts',
      '!src/sim/run/sprintBaseline.ts',
      '!src/sim/run/sprintBaselineBuild.ts',
      '!src/sim/run/**/index.ts',
      '!src/sim/run/**/types.ts',
    ].join(','),
    note: 'run 配下の残り（新規ファイルの受け皿）',
  },

  // src/sim/sprint.ts — 約 630 mutant。
  {
    id: 'sim-sprint-a',
    mutate: 'src/sim/sprint.ts:1-450',
    note: 'sprint 前半',
  },
  {
    id: 'sim-sprint-b',
    mutate: `src/sim/sprint.ts:451-${OPEN_RANGE_END}`,
    note: 'sprint 後半',
  },
  {
    id: 'sim-assign-cards',
    mutate: 'src/sim/assignTask.ts,src/sim/cards.ts',
    note: 'assignTask + cards',
  },
  {
    id: 'sim-actions-outcome',
    mutate: 'src/sim/actions.ts,src/sim/outcome.ts',
    note: 'actions + outcome',
  },
  {
    id: 'sim-root-rest',
    mutate: [
      'src/sim/*.ts',
      '!src/sim/sprint.ts',
      '!src/sim/assignTask.ts',
      '!src/sim/cards.ts',
      '!src/sim/actions.ts',
      '!src/sim/outcome.ts',
      '!src/sim/index.ts',
      '!src/sim/types.ts',
    ].join(','),
    note: 'src/sim 直下の残り（新規ファイルの受け皿）',
  },

  // src/sim/orgscale/teamState.ts — 約 640 mutant。旧 orgscale ジョブは 2h46m。
  {
    id: 'sim-orgscale-team-a',
    mutate: 'src/sim/orgscale/teamState.ts:1-650',
    note: 'teamState 前半',
  },
  {
    id: 'sim-orgscale-team-b',
    mutate: `src/sim/orgscale/teamState.ts:651-${OPEN_RANGE_END}`,
    note: 'teamState 後半',
  },
  {
    id: 'sim-orgscale-rest',
    mutate: [
      'src/sim/orgscale/**/*.ts',
      '!src/sim/orgscale/teamState.ts',
      '!src/sim/orgscale/**/index.ts',
      '!src/sim/orgscale/**/types.ts',
    ].join(','),
    note: 'orgscale の残り（新規ファイルの受け皿）',
  },

  {
    id: 'sim-member-model',
    mutate: [
      'src/sim/member/**/*.ts',
      'src/sim/model/**/*.ts',
      '!src/sim/**/index.ts',
      '!src/sim/**/types.ts',
    ].join(','),
    note: 'member + model',
  },

  // src/state/persistFrameShape.ts — 約 1,400 mutant / 479 行。
  {
    id: 'state-persist-shape-a',
    mutate: 'src/state/persistFrameShape.ts:1-160',
    note: 'persistFrameShape 前半',
  },
  {
    id: 'state-persist-shape-b',
    mutate: 'src/state/persistFrameShape.ts:161-320',
    note: 'persistFrameShape 中盤',
  },
  {
    id: 'state-persist-shape-c',
    mutate: `src/state/persistFrameShape.ts:321-${OPEN_RANGE_END}`,
    note: 'persistFrameShape 後半',
  },
  {
    id: 'state-run-persistence',
    mutate: 'src/state/runPersistence.ts',
    note: 'runPersistence',
  },
  {
    id: 'state-replay',
    mutate: 'src/state/replay.ts',
    note: 'replay',
  },
  {
    id: 'state-meta',
    mutate: 'src/state/meta.ts',
    note: 'meta',
  },
  {
    id: 'state-rest',
    mutate: [
      'src/state/**/*.ts',
      '!src/state/persistFrameShape.ts',
      '!src/state/runPersistence.ts',
      '!src/state/replay.ts',
      '!src/state/meta.ts',
      '!src/state/**/index.ts',
      '!src/state/**/types.ts',
    ].join(','),
    note: 'state の残り（新規ファイルの受け皿）',
  },
]);

/**
 * @param {string} spec
 * @returns {{ glob: string, range: { start: number, end: number } | null }}
 */
export function parseMutatePart(spec) {
  const trimmed = spec.trim();
  const match = MUTATION_RANGE_RE.exec(trimmed);
  if (!match) {
    return { glob: trimmed, range: null };
  }
  return {
    glob: match[1],
    range: { start: Number(match[2]), end: Number(match[3]) },
  };
}

/**
 * @param {string} cwd
 * @param {string} globPat
 * @returns {string[]}
 */
function expandGlob(cwd, globPat) {
  return globSync(globPat, { cwd, nodir: true }).map((file) => file.replaceAll('\\', '/'));
}

/**
 * Stryker の mutate 配列と同じ順で、対象ファイルと任意の行レンジを解決する。
 * `!` はファイル単位の除外（Stryker と同様、行レンジ付き除外はファイル全体を外す）。
 *
 * @param {readonly string[]} patterns
 * @param {string} [cwd]
 * @returns {Map<string, true | Array<{ start: number, end: number }>>}
 */
export function resolveMutatePatterns(patterns, cwd = REPO_ROOT) {
  /** @type {Map<string, true | Array<{ start: number, end: number }>>} */
  const files = new Map();
  for (const raw of patterns) {
    const negated = raw.startsWith('!');
    const { glob, range } = parseMutatePart(negated ? raw.slice(1) : raw);
    const matched = expandGlob(cwd, glob);
    if (negated) {
      for (const file of matched) {
        files.delete(file);
      }
      continue;
    }
    for (const file of matched) {
      if (!range) {
        files.set(file, true);
        continue;
      }
      const existing = files.get(file);
      if (existing === true) {
        continue;
      }
      files.set(file, [...(existing ?? []), range]);
    }
  }
  return files;
}

/**
 * @param {string} mutate
 * @param {string} [cwd]
 */
export function resolveShardMutate(mutate, cwd = REPO_ROOT) {
  return resolveMutatePatterns(
    mutate
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean),
    cwd,
  );
}

/**
 * `stryker.config.json` の mutate が指すコア対象ファイル。
 *
 * @param {string} [cwd]
 * @returns {string[]}
 */
export function listConfiguredMutateFiles(cwd = REPO_ROOT) {
  const configPath = join(cwd, 'stryker.config.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const resolved = resolveMutatePatterns(config.mutate, cwd);
  return [...resolved.keys()].sort();
}

/**
 * @param {true | Array<{ start: number, end: number }>} coverage
 * @param {number} line 1-origin
 */
export function coverageIncludesLine(coverage, line) {
  if (coverage === true) {
    return true;
  }
  return coverage.some((range) => line >= range.start && line <= range.end);
}

/**
 * @returns {{ id: string, mutate: string }[]}
 */
export function toMatrixInclude() {
  return MUTATION_SHARDS.map(({ id, mutate }) => ({ id, mutate }));
}

/**
 * @returns {string[]}
 */
export function shardIds() {
  return MUTATION_SHARDS.map((shard) => shard.id);
}

function printList() {
  for (const shard of MUTATION_SHARDS) {
    process.stdout.write(`${shard.id}\t${shard.mutate}\t${shard.note}\n`);
  }
}

function main(argv) {
  if (argv.includes('--matrix')) {
    process.stdout.write(`${JSON.stringify(toMatrixInclude())}\n`);
    return;
  }
  if (argv.includes('--ids')) {
    process.stdout.write(`${JSON.stringify(shardIds())}\n`);
    return;
  }
  if (argv.includes('--list') || argv.length === 0) {
    printList();
    return;
  }
  process.stderr.write(`Usage: node scripts/mutation-shards.mjs --matrix | --ids | --list\n`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
