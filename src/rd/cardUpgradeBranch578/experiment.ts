/**
 * #578 カード強化分岐の隔離試作（R&D throwaway）。
 *
 * 本番のカード強化・バランス・出荷 UI は参照も変更もしない。
 * 休息で同じカードへ分岐を選ぶ案を、固定 seed の 2 状況 × 2 分岐で測る。
 */

export const ISSUE_NUMBER = 578;
export const FIXED_SEED = 'ri182-578';
export const CARD_ID = 'field-playbook';
export const CARD_NAME = '現場支援プレイブック';

export type BranchId = 'A' | 'B';
export type SituationId = 'volume' | 'bottleneck';
export type JobKind = 'everyday' | 'special';
export type PrimaryMetric = 'shippedCount' | 'specialShippedCount';

export interface BranchDef {
  id: BranchId;
  label: string;
  playCost: number;
  everydayBonus: number;
  specialBonus: number;
  opsBurdenPerPlay: number;
}

export interface SituationDef {
  id: SituationId;
  label: string;
  specialProbability: number;
  primaryMetric: PrimaryMetric;
}

export interface Constraints {
  ticks: number;
  focus: number;
  capacity: number;
  jobCount: number;
}

export interface Job {
  id: number;
  kind: JobKind;
  effort: number;
}

export interface CellMetrics {
  branch: BranchId;
  situation: SituationId;
  seed: string;
  shippedCount: number;
  everydayShippedCount: number;
  specialShippedCount: number;
  leftoverJobs: number;
  leftoverEffort: number;
  focusSpent: number;
  unusedFocus: number;
  plays: number;
  opsBurden: number;
  primary: number;
  primaryMetric: PrimaryMetric;
}

export interface SituationComparison {
  situation: SituationId;
  primaryMetric: PrimaryMetric;
  A: CellMetrics;
  B: CellMetrics;
  primaryDeltaBMinusA: number;
  foregoneIfPickA: number;
  foregoneIfPickB: number;
}

export interface ExperimentReport {
  issue: number;
  cardId: string;
  cardName: string;
  seed: string;
  constraints: Constraints;
  branches: Record<BranchId, BranchDef>;
  situations: Record<SituationId, SituationDef>;
  comparisons: Record<SituationId, SituationComparison>;
}

/** 同じ初期資源。A/B で変えない。 */
export const CONSTRAINTS: Constraints = {
  ticks: 30,
  focus: 12,
  capacity: 1,
  jobCount: 20,
};

/**
 * 初手の分岐定義。仮説を通すための後付け調整はしない。
 * A = 普段使いを安くする / B = 特定仕事へ強くする。
 */
export const BRANCHES: Record<BranchId, BranchDef> = {
  A: {
    id: 'A',
    label: '普段使いを安くする',
    playCost: 2,
    everydayBonus: 0.4,
    specialBonus: 0.08,
    opsBurdenPerPlay: 1,
  },
  B: {
    id: 'B',
    label: '特定仕事へ強くする',
    playCost: 4,
    everydayBonus: 0.04,
    specialBonus: 0.85,
    opsBurdenPerPlay: 3,
  },
};

export const SITUATIONS: Record<SituationId, SituationDef> = {
  volume: {
    id: 'volume',
    label: '日常の量',
    specialProbability: 0.15,
    primaryMetric: 'shippedCount',
  },
  bottleneck: {
    id: 'bottleneck',
    label: '特定仕事がボトルネック',
    specialProbability: 0.85,
    primaryMetric: 'specialShippedCount',
  },
};

const SITUATION_ORDER: SituationId[] = ['volume', 'bottleneck'];
const BRANCH_ORDER: BranchId[] = ['A', 'B'];

/** 本番 rng を使わず、試作内で閉じた mulberry32。 */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(seed: string): () => number {
  let a = hashSeed(seed);
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function situationSeed(seed: string, situation: SituationId): string {
  return `${seed}:${situation}`;
}

/** 状況ごとの仕事列。同じ seed なら A/B で同一。 */
export function generateJobs(situation: SituationId, seed: string = FIXED_SEED): Job[] {
  const def = SITUATIONS[situation];
  const rng = createRng(situationSeed(seed, situation));
  const jobs: Job[] = [];
  for (let i = 0; i < CONSTRAINTS.jobCount; i += 1) {
    jobs.push({
      id: i,
      kind: rng() < def.specialProbability ? 'special' : 'everyday',
      effort: 3 + Math.floor(rng() * 3),
    });
  }
  return jobs;
}

function primaryValue(
  metrics: Omit<CellMetrics, 'primary' | 'primaryMetric'>,
  metric: PrimaryMetric,
): number {
  return metrics[metric];
}

/** 分岐を 1 回発動し、残り tick は同じ係数で仕事を消化する。 */
export function runCell(
  branch: BranchId,
  situation: SituationId,
  seed: string = FIXED_SEED,
): CellMetrics {
  const branchDef = BRANCHES[branch];
  const situationDef = SITUATIONS[situation];
  const jobs = generateJobs(situation, seed).map((job) => ({
    ...job,
    remaining: job.effort,
  }));

  let unusedFocus = CONSTRAINTS.focus;
  let plays = 0;
  let opsBurden = 0;
  const canPlay = unusedFocus >= branchDef.playCost;
  if (canPlay) {
    unusedFocus -= branchDef.playCost;
    plays = 1;
    opsBurden = branchDef.opsBurdenPerPlay;
  }

  for (let tick = 0; tick < CONSTRAINTS.ticks; tick += 1) {
    const job = jobs.find((item) => item.remaining > 0);
    if (!job) break;
    const bonus = canPlay
      ? job.kind === 'special'
        ? branchDef.specialBonus
        : branchDef.everydayBonus
      : 0;
    job.remaining -= CONSTRAINTS.capacity * (1 + bonus);
  }

  let shippedCount = 0;
  let everydayShippedCount = 0;
  let specialShippedCount = 0;
  let leftoverJobs = 0;
  let leftoverEffort = 0;
  for (const job of jobs) {
    if (job.remaining <= 1e-9) {
      shippedCount += 1;
      if (job.kind === 'everyday') everydayShippedCount += 1;
      else specialShippedCount += 1;
    } else {
      leftoverJobs += 1;
      leftoverEffort += Math.max(0, job.remaining);
    }
  }

  const raw = {
    branch,
    situation,
    seed,
    shippedCount,
    everydayShippedCount,
    specialShippedCount,
    leftoverJobs,
    leftoverEffort: roundMetric(leftoverEffort),
    focusSpent: CONSTRAINTS.focus - unusedFocus,
    unusedFocus,
    plays,
    opsBurden,
  };

  return {
    ...raw,
    primaryMetric: situationDef.primaryMetric,
    primary: primaryValue(raw, situationDef.primaryMetric),
  };
}

export function compareSituation(
  situation: SituationId,
  seed: string = FIXED_SEED,
): SituationComparison {
  const A = runCell('A', situation, seed);
  const B = runCell('B', situation, seed);
  return {
    situation,
    primaryMetric: SITUATIONS[situation].primaryMetric,
    A,
    B,
    primaryDeltaBMinusA: B.primary - A.primary,
    foregoneIfPickA: B.primary - A.primary,
    foregoneIfPickB: A.primary - B.primary,
  };
}

export function runMatrix(seed: string = FIXED_SEED): ExperimentReport {
  return {
    issue: ISSUE_NUMBER,
    cardId: CARD_ID,
    cardName: CARD_NAME,
    seed,
    constraints: CONSTRAINTS,
    branches: BRANCHES,
    situations: SITUATIONS,
    comparisons: {
      volume: compareSituation('volume', seed),
      bottleneck: compareSituation('bottleneck', seed),
    },
  };
}

export function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function lineCell(metrics: CellMetrics): string {
  return [
    `branch=${metrics.branch}`,
    `primary(${metrics.primaryMetric})=${metrics.primary}`,
    `shippedCount=${metrics.shippedCount}`,
    `everydayShippedCount=${metrics.everydayShippedCount}`,
    `specialShippedCount=${metrics.specialShippedCount}`,
    `leftoverJobs=${metrics.leftoverJobs}`,
    `leftoverEffort=${metrics.leftoverEffort}`,
    `focusSpent=${metrics.focusSpent}`,
    `unusedFocus=${metrics.unusedFocus}`,
    `plays=${metrics.plays}`,
    `opsBurden=${metrics.opsBurden}`,
  ].join(' ');
}

/** 選ばなかった分岐の数値を消さず、4 セルと機会費用を出す。 */
export function formatReport(report: ExperimentReport): string {
  const lines: string[] = [
    `#578 R&D card-upgrade-branch experiment (not for production merge)`,
    `card: ${report.cardId} / ${report.cardName}`,
    `seed: ${report.seed}`,
    `constraints: ticks=${report.constraints.ticks} focus=${report.constraints.focus} capacity=${report.constraints.capacity} jobs=${report.constraints.jobCount}`,
    `branch A ${report.branches.A.label}: playCost=${report.branches.A.playCost} everydayBonus=${report.branches.A.everydayBonus} specialBonus=${report.branches.A.specialBonus} opsBurdenPerPlay=${report.branches.A.opsBurdenPerPlay}`,
    `branch B ${report.branches.B.label}: playCost=${report.branches.B.playCost} everydayBonus=${report.branches.B.everydayBonus} specialBonus=${report.branches.B.specialBonus} opsBurdenPerPlay=${report.branches.B.opsBurdenPerPlay}`,
    '',
  ];

  for (const situation of SITUATION_ORDER) {
    const cmp = report.comparisons[situation];
    const def = report.situations[situation];
    lines.push(`## ${situation} / ${def.label}  primary=${cmp.primaryMetric}`);
    lines.push(`A ${lineCell(cmp.A)}`);
    lines.push(`B ${lineCell(cmp.B)}`);
    lines.push(
      `opportunity: primaryDelta B-A=${cmp.primaryDeltaBMinusA}  foregoneIfPickA=${cmp.foregoneIfPickA}  foregoneIfPickB=${cmp.foregoneIfPickB}`,
    );
    lines.push('');
  }

  lines.push('cells:');
  for (const situation of SITUATION_ORDER) {
    for (const branch of BRANCH_ORDER) {
      lines.push(`  ${branch} ${situation}: ${lineCell(report.comparisons[situation][branch])}`);
    }
  }

  return lines.join('\n');
}
