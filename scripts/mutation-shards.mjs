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
import { createHash } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(SCRIPT_DIR, '..');

/**
 * 1 ジョブあたりの instrumented mutant 上限（通常シャード）。
 * engine.ts 約 2,000 mutant が 180 分で打ち切られた実測から、
 * 余裕を見て 700 以下に収める（同じ速度なら 1 時間前後）。
 */
export const SHARD_MUTANT_BUDGET = 700;

/**
 * sprint シミュレーション経路向けのより厳しい上限。
 *
 * Mutation #10（203251e）では sim-sprint-a（286 mutant）/ sim-sprint-b（328）が
 * いずれも 180 分タイムアウト。残り見積は a が約 40 分・b が約 21 分で、
 * mutant 数 700 の予算では壁時計を説明できない。
 * `src/sim/sprint.ts` の mutant はテストがスプリント完走まで回るため
 * 1 体あたり約 35–45 秒（engine シャードの約 2.5 倍）。160 以下なら
 * 同じ速度でも 2 時間前後に収まる。
 *
 * Mutation #11 の sim-run-engine-a（466 mutant / engine.ts:1-1057）も 180 分で打ち切られた。
 * 件数は 700 以内だが、`step` の while と `resolveSprint` の baseline 完走が
 * sprint.ts 並みに遅い。該当ホットパスも同じ 160 上限で切り離す。
 */
export const SPRINT_SHARD_MUTANT_BUDGET = 160;

/**
 * @param {string} id
 * @returns {number}
 */
export function shardMutantBudget(id) {
  if (
    id.startsWith('sim-sprint-') ||
    id.startsWith('sim-run-sprint-baseline-') ||
    id === 'sim-run-engine-e' ||
    id === 'sim-run-engine-g'
  ) {
    return SPRINT_SHARD_MUTANT_BUDGET;
  }
  return SHARD_MUTANT_BUDGET;
}

/**
 * incremental cache キーに載せる mutate ハッシュ長。
 * 同じ id のまま行レンジや glob を変えても、旧レポートを restore しないために使う。
 */
export const INCREMENTAL_CACHE_HASH_LENGTH = 12;

/**
 * GHA cache / Stryker incrementalFile 用の名前空間。
 * `id` だけだと範囲変更後も旧キャッシュが復元され、mutate 範囲外の sticky mutant が残る。
 *
 * @param {string} id
 * @param {string} mutate
 */
export function incrementalCacheKey(id, mutate) {
  const digest = createHash('sha256')
    .update(mutate)
    .digest('hex')
    .slice(0, INCREMENTAL_CACHE_HASH_LENGTH);
  return `${id}-${digest}`;
}

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
  // Mutation #11 の sim-run-engine-a（1-1057 / 466 mutant）も 180 分超過。
  // 件数ではなく step / resolveSprint の完走コストが原因なので、ホットパスを切り離す。
  {
    id: 'sim-run-engine-a',
    mutate: 'src/sim/run/engine.ts:1-765',
    note: 'engine 初期化（beginSprint / buildSprintBaselineInput まで）',
  },
  {
    id: 'sim-run-engine-e',
    mutate: 'src/sim/run/engine.ts:766-816',
    note: 'engine ホットパス（step / dispatch / playCard）',
  },
  {
    id: 'sim-run-engine-g',
    mutate: 'src/sim/run/engine.ts:817-901',
    note: 'engine resolveSprint（baseline 完走を含む）',
  },
  {
    id: 'sim-run-engine-f',
    mutate: 'src/sim/run/engine.ts:902-1057',
    note: 'engine 四半期接続（accumulateTotals 〜 chooseGoalAdjustment）',
  },
  {
    id: 'sim-run-engine-b',
    mutate: 'src/sim/run/engine.ts:1058-1509',
    note: 'engine 中盤（再編〜 recruitChoose）',
  },
  {
    id: 'sim-run-engine-c',
    mutate: 'src/sim/run/engine.ts:1510-2048',
    note: 'engine 後半（採用ペナルティ〜ズーム手前）',
  },
  {
    id: 'sim-run-engine-d',
    mutate: `src/sim/run/engine.ts:2049-${OPEN_RANGE_END}`,
    note: 'engine 末尾（buildOrgScale・永続化。以降の追記もここ）',
  },

  // src/sim/run/counterfactual.ts — 約 2,170 mutant。旧 sim-run-rest 肥大の主因。
  {
    id: 'sim-run-counterfactual-a',
    mutate: 'src/sim/run/counterfactual.ts:1-505',
    note: 'counterfactual 前半（recordAcquiredCards まで）',
  },
  {
    id: 'sim-run-counterfactual-b',
    mutate: 'src/sim/run/counterfactual.ts:506-1020',
    note: 'counterfactual 中盤前（collectStrategicAtCore まで）',
  },
  {
    id: 'sim-run-counterfactual-c',
    mutate: 'src/sim/run/counterfactual.ts:1021-1400',
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
    mutate: 'src/sim/run/quarterReview.ts:1-451',
    note: 'quarterReview 前半（orgAfterAdjustment まで）',
  },
  {
    id: 'sim-run-quarter-review-b',
    mutate: `src/sim/run/quarterReview.ts:452-${OPEN_RANGE_END}`,
    note: 'quarterReview 後半',
  },

  {
    id: 'sim-run-danger-zone',
    mutate: 'src/sim/run/dangerZone.ts',
    note: 'dangerZone（約 320 mutant）',
  },
  // src/sim/run/sprintBaseline.ts — mutant 数は少ないが while 完走経路。
  // Mutation #10 の sim-run-support（what-if + baseline まとめて 366）は 56 分で完走。
  // ループ本体を切り離し、sprint.ts 側の遅延と混ざらないようにする。
  {
    id: 'sim-run-sprint-baseline-a',
    mutate: 'src/sim/run/sprintBaseline.ts:1-117',
    note: 'sprintBaseline 初期化（withTeamBoardPressure / createSprintFromBaselineInput）',
  },
  {
    id: 'sim-run-sprint-baseline-b',
    mutate: `src/sim/run/sprintBaseline.ts:118-${OPEN_RANGE_END}`,
    note: 'sprintBaseline 完走ループ（runSprintSimulationFull 以降）',
  },
  {
    id: 'sim-run-support',
    mutate: 'src/sim/run/whatIf*.ts,src/sim/run/sprintBaselineBuild.ts',
    note: 'what-if とスプリント baseline 組み立て',
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

  // src/sim/sprint.ts — 約 630 mutant。Mutation #10 で 2 分割でも 180 分超過。
  // 完走ループ（stepSprint / drain）とレビュー炎上経路を関数境界で分ける。
  {
    id: 'sim-sprint-a',
    mutate: 'src/sim/sprint.ts:1-211',
    note: 'sprint 初期化（createSprint・ヘルパー。intake 手前）',
  },
  {
    id: 'sim-sprint-b',
    mutate: 'src/sim/sprint.ts:212-345',
    note: 'sprint 流入・実装・レビュー 1 件（intake / ignite / reviewOne）',
  },
  {
    id: 'sim-sprint-c',
    mutate: 'src/sim/sprint.ts:346-456',
    note: 'sprint Review 消化と炎上（forceShip / advanceReview / advanceBurning）',
  },
  {
    id: 'sim-sprint-d',
    mutate: 'src/sim/sprint.ts:457-530',
    note: 'sprint 完了判定（rework / drain / stall / abandon）',
  },
  {
    id: 'sim-sprint-e',
    mutate: 'src/sim/sprint.ts:531-588',
    note: 'sprint 1 tick 本体（stepSprint。無限ループ mutant の主因）',
  },
  {
    id: 'sim-sprint-f',
    mutate: 'src/sim/sprint.ts:589-645',
    note: 'sprint 評価（tickCooldowns / computeGrade）',
  },
  {
    id: 'sim-sprint-g',
    mutate: `src/sim/sprint.ts:646-${OPEN_RANGE_END}`,
    note: 'sprint 称号と summarizeSprint（computeTitleAndDiagnosis 全体。以降の追記もここ）',
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
    mutate: 'src/state/persistFrameShape.ts:1-164',
    note: 'persistFrameShape 前半（isShopCardOfferShape まで）',
  },
  {
    id: 'state-persist-shape-b',
    mutate: 'src/state/persistFrameShape.ts:165-331',
    note: 'persistFrameShape 中盤（isMemberShape まで）',
  },
  {
    id: 'state-persist-shape-c',
    mutate: `src/state/persistFrameShape.ts:332-${OPEN_RANGE_END}`,
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
 * `file:start-end` を Stryker 内部の Location に変換する（行は 0-origin、終端列は inclusive）。
 *
 * @param {{ start: number, end: number }} range 1-origin inclusive
 * @returns {{ start: { line: number, column: number }, end: { line: number, column: number } }}
 */
export function shardRangeToLocation(range) {
  return {
    start: { line: range.start - 1, column: 0 },
    end: { line: range.end - 1, column: Number.MAX_SAFE_INTEGER },
  };
}

/**
 * Stryker の `locationIncluded` と同じ（haystack が needle の開始・終了を両方含む）。
 *
 * @param {{ start: { line: number, column: number }, end: { line: number, column: number } }} haystack
 * @param {{ start: { line: number, column: number }, end: { line: number, column: number } }} needle
 */
export function locationIncluded(haystack, needle) {
  const startIncluded =
    haystack.start.line < needle.start.line ||
    (haystack.start.line === needle.start.line && haystack.start.column <= needle.start.column);
  const endIncluded =
    haystack.end.line > needle.end.line ||
    (haystack.end.line === needle.end.line && haystack.end.column >= needle.end.column);
  return startIncluded && endIncluded;
}

/**
 * Stryker が実際に mutant を採る条件。開始行だけだと関数全体の BlockStatement などが欠ける。
 *
 * @param {true | Array<{ start: number, end: number }>} coverage
 * @param {{ start: { line: number, column: number }, end: { line: number, column: number } }} location
 */
export function coverageIncludesLocation(coverage, location) {
  if (coverage === true) {
    return true;
  }
  return coverage.some((range) => locationIncluded(shardRangeToLocation(range), location));
}

/**
 * @returns {{ id: string, mutate: string, cache: string }[]}
 */
export function toMatrixInclude() {
  return MUTATION_SHARDS.map(({ id, mutate }) => ({
    id,
    mutate,
    cache: incrementalCacheKey(id, mutate),
  }));
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
