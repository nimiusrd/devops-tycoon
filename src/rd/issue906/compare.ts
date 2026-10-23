/**
 * Issue #906 Phase 1 比較ランナー。
 *
 * 難易度 Easy・fresh meta・方針は `POLICY_DEFS.naive` のみ。
 * 生存 = ラン勝利、または quarter >= 2（Q1 S6 ボスを越え Q1 レビューを通過）。
 * 判定用 seed（rd-ez-1〜5）は Phase 1 では回さない。呼び出し側が seed を渡す。
 */
import { POLICY_DEFS, runOnce, type RunLog } from './harness906';
import {
  applyCondition,
  restoreCondition,
  type ConditionId,
  type InjectedCondition,
} from './variants';

export const POLICY_ID = 'naive';
export const DIFFICULTY_ID = 'easy';
export const META_PROFILE = 'fresh' as const;

/** PREREG の研究者 seed（26本）。判定用 rd-ez-1〜5 とは別。 */
export const RESEARCHER_SEEDS: readonly string[] = [
  'devops-tycoon',
  'qa-seed-1022',
  'qa-seed-1022b',
  'qa-seed-1022c',
  'qa-seed-1022d',
  'qa-seed-1023b',
  ...Array.from({ length: 20 }, (_, i) => `pt-${i + 1}`),
];

/** Phase 2 判定用。Phase 1 では回さない。 */
export const JUDGMENT_SEEDS = ['rd-ez-1', 'rd-ez-2', 'rd-ez-3', 'rd-ez-4', 'rd-ez-5'] as const;

export interface SprintCompare {
  quarter: number;
  index: number;
  completed: boolean;
  seniorHpAfter: number;
  done: number;
  delivered: number;
  reviewers: { id: string; name: string; rank: string }[];
  seniorHpCostMul: number;
  reviewHpCostMul: number;
  reviewCapacityMul: number;
}

export interface CompareRow {
  seed: string;
  cond: ConditionId;
  policy: typeof POLICY_ID;
  status: string;
  loseReason?: string;
  quarter: number;
  sprintsPlayed: number;
  seniorHpAfterSprints: number[];
  survive: boolean;
  injected: InjectedCondition;
  difficultySeniorHpCostMul: number;
  startRoster: RunLog['startRoster'];
  sprints: SprintCompare[];
}

export interface CompareSummary {
  cond: ConditionId;
  n: number;
  survived: number;
  lost: number;
  won: number;
}

export interface CompareResult {
  policy: typeof POLICY_ID;
  difficulty: typeof DIFFICULTY_ID;
  meta: typeof META_PROFILE;
  rows: CompareRow[];
  summary: CompareSummary[];
}

function assertNaivePolicy(): void {
  if (!POLICY_DEFS[POLICY_ID]) throw new Error(`POLICY_DEFS.${POLICY_ID} が無い`);
}

export function survived(log: Pick<RunLog, 'status' | 'quarterNumber'>): boolean {
  return log.status === 'won' || log.quarterNumber >= 2;
}

function toRow(
  seed: string,
  cond: ConditionId,
  log: RunLog,
  injected: InjectedCondition,
): CompareRow {
  return {
    seed,
    cond,
    policy: POLICY_ID,
    status: log.status,
    loseReason: log.loseReason,
    quarter: log.quarterNumber,
    sprintsPlayed: log.sprintsPlayed,
    seniorHpAfterSprints: log.sprints.map((sprint) => sprint.seniorHpAfter),
    survive: survived(log),
    injected,
    difficultySeniorHpCostMul: log.difficultySeniorHpCostMul,
    startRoster: log.startRoster,
    sprints: log.sprints.map((sprint) => ({
      quarter: sprint.quarter,
      index: sprint.index,
      completed: sprint.completed,
      seniorHpAfter: sprint.seniorHpAfter,
      done: sprint.done,
      delivered: sprint.delivered,
      reviewers: sprint.reviewers,
      seniorHpCostMul: sprint.seniorHpCostMul,
      reviewHpCostMul: sprint.reviewHpCostMul,
      reviewCapacityMul: sprint.reviewCapacityMul,
    })),
  };
}

export function runOne(seed: string, cond: ConditionId): CompareRow {
  assertNaivePolicy();
  const injected = applyCondition(cond);
  try {
    const log = runOnce(seed, DIFFICULTY_ID, POLICY_ID, META_PROFILE);
    return toRow(seed, cond, log, injected);
  } finally {
    restoreCondition();
  }
}

export function summarize(rows: readonly CompareRow[]): CompareSummary[] {
  const byCond = new Map<ConditionId, CompareRow[]>();
  for (const row of rows) {
    const list = byCond.get(row.cond) ?? [];
    list.push(row);
    byCond.set(row.cond, list);
  }
  return [...byCond.entries()].map(([cond, list]) => ({
    cond,
    n: list.length,
    survived: list.filter((row) => row.survive).length,
    lost: list.filter((row) => row.status === 'lost').length,
    won: list.filter((row) => row.status === 'won').length,
  }));
}

export function runCompare(seeds: readonly string[], conds: readonly ConditionId[]): CompareResult {
  const rows: CompareRow[] = [];
  for (const seed of seeds) {
    for (const cond of conds) rows.push(runOne(seed, cond));
  }
  return {
    policy: POLICY_ID,
    difficulty: DIFFICULTY_ID,
    meta: META_PROFILE,
    rows,
    summary: summarize(rows),
  };
}

/** 同一 seed・同一条件を 2 回回した決定論スナップショット。 */
export function comparableSnapshot(row: CompareRow): unknown {
  return {
    seed: row.seed,
    cond: row.cond,
    status: row.status,
    loseReason: row.loseReason ?? null,
    quarter: row.quarter,
    sprintsPlayed: row.sprintsPlayed,
    survive: row.survive,
    seniorHpAfterSprints: row.seniorHpAfterSprints,
    difficultySeniorHpCostMul: row.difficultySeniorHpCostMul,
    startRoster: row.startRoster,
    sprints: row.sprints,
  };
}

export function sameDraw(a: CompareRow, b: CompareRow): boolean {
  return JSON.stringify(comparableSnapshot(a)) === JSON.stringify(comparableSnapshot(b));
}

export interface C3Usage {
  startHasRecruitDoc: boolean;
  startFourthOnReview: boolean;
  sprintsWithFourthOnReview: number;
  sprintsWithReviewDone: number;
  used: boolean;
}

/** naive が recruit-doc をレビューレーンに置き、レビューが実際に進んだか。 */
export function inspectC3Usage(row: CompareRow): C3Usage {
  const fourth = row.startRoster[3];
  const startHasRecruitDoc = Boolean(
    fourth &&
    fourth.stats.review === 44 &&
    fourth.stats.implementation === 40 &&
    fourth.traits.includes('docMaster'),
  );
  const startFourthOnReview = Boolean(fourth && fourth.assignment === 'review');
  const fourthId = fourth?.id;
  const sprintsWithFourthOnReview = row.sprints.filter((sprint) =>
    sprint.reviewers.some((member) => member.id === fourthId),
  ).length;
  const sprintsWithReviewDone = row.sprints.filter(
    (sprint) => sprint.done > 0 && sprint.reviewers.some((member) => member.id === fourthId),
  ).length;
  return {
    startHasRecruitDoc,
    startFourthOnReview,
    sprintsWithFourthOnReview,
    sprintsWithReviewDone,
    used: startHasRecruitDoc && startFourthOnReview && sprintsWithReviewDone > 0,
  };
}

export function formatTable(result: CompareResult): string {
  const header = [
    'seed',
    'cond',
    'status',
    'loseReason',
    'quarter',
    'sprints',
    'survive',
    'seniorHpAfter',
  ];
  const lines = [header.join('\t')];
  for (const row of result.rows) {
    lines.push(
      [
        row.seed,
        row.cond,
        row.status,
        row.loseReason ?? '',
        String(row.quarter),
        String(row.sprintsPlayed),
        row.survive ? 'true' : 'false',
        row.seniorHpAfterSprints.join(','),
      ].join('\t'),
    );
  }
  lines.push('');
  lines.push('summary');
  for (const s of result.summary) {
    lines.push(`${s.cond}\tsurvive ${s.survived}/${s.n}\twon ${s.won}\tlost ${s.lost}`);
  }
  return lines.join('\n');
}
