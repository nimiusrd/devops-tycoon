/**
 * 基本ステータス表示の導出（SPEC 第4.2）。
 *
 * OrgState とスプリントの現況から、画面上部に出す
 * グレード（開発速度・レビュー耐性・品質）と炎上リスクを導出する純関数。
 */
import type { OrgState, SimState, Task } from '../sim/types';

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'E';
export type RiskLevel = 'LOW' | 'MED' | 'HIGH';

export interface StatusView {
  /** 出荷ポイント。 */
  deliveryScore: number;
  /** 開発速度。 */
  devSpeed: Grade;
  /** レビュー耐性。 */
  reviewCapacity: Grade;
  /** 品質。 */
  quality: Grade;
  /** シニア体力（%）。 */
  seniorHpPct: number;
  /** AI依存度（%）。 */
  aiDependencyPct: number;
  /** 技術的負債。 */
  techDebt: number;
  /** 士気。 */
  morale: number;
  /** 炎上リスク。 */
  risk: RiskLevel;
}

export type HudMetricKey =
  | 'deliveryScore'
  | 'seniorHpPct'
  | 'aiDependencyPct'
  | 'techDebt'
  | 'morale';

export type HudFeedbackTone = 'positive' | 'negative';

export type HudMetricSnapshot = Record<HudMetricKey, number>;

export interface HudMetricDelta {
  key: HudMetricKey;
  label: string;
  delta: number;
  tone: HudFeedbackTone;
}

const HUD_METRIC_LABELS: Record<HudMetricKey, string> = {
  deliveryScore: '出荷ポイント',
  seniorHpPct: 'シニア体力',
  aiDependencyPct: 'AI依存度',
  techDebt: '技術的負債',
  morale: '士気',
};

/** 値が増えるほど悪化する HUD 指標。 */
const INVERSE_HUD_METRICS = new Set<HudMetricKey>(['aiDependencyPct', 'techDebt']);

/** 0..100 の値を閾値でグレード化する（高いほど良い指標向け）。 */
function gradeOf(value: number): Grade {
  if (value >= 85) return 'S';
  if (value >= 70) return 'A';
  if (value >= 55) return 'B';
  if (value >= 40) return 'C';
  if (value >= 20) return 'D';
  return 'E';
}

/** 現在 Review 待ちのタスク数（渋滞の指標）。 */
export function reviewQueueLength(tasks: Task[]): number {
  let n = 0;
  for (const t of tasks) if (t.lane === 'review') n += 1;
  return n;
}

/** 炎上リスクを Review 渋滞とシニア体力から判定する。 */
export function riskLevel(reviewQueue: number, seniorHp: number): RiskLevel {
  if (reviewQueue >= 12 || seniorHp < 25) return 'HIGH';
  if (reviewQueue >= 6 || seniorHp < 50) return 'MED';
  return 'LOW';
}

/** 組織状態と現在のタスク群から表示用ステータスを導出する。 */
export function deriveStatusParts(org: OrgState, tasks: Task[]): StatusView {
  const queue = reviewQueueLength(tasks);
  return {
    deliveryScore: org.deliveryScore,
    // AI 導入で開発速度は上がるが、その分レビューに皺寄せがいく（第2章）。
    devSpeed: org.aiEnabled ? 'S' : 'B',
    reviewCapacity: gradeOf(org.seniorHp),
    quality: gradeOf(org.quality),
    seniorHpPct: Math.round(org.seniorHp),
    aiDependencyPct: Math.round(org.aiDependency),
    techDebt: org.techDebt,
    morale: Math.round(org.morale),
    risk: riskLevel(queue, org.seniorHp),
  };
}

/** HUD の差分検出に使う数値指標だけを抜き出す。 */
export function hudMetricSnapshot(status: StatusView): HudMetricSnapshot {
  return {
    deliveryScore: status.deliveryScore,
    seniorHpPct: status.seniorHpPct,
    aiDependencyPct: status.aiDependencyPct,
    techDebt: status.techDebt,
    morale: status.morale,
  };
}

/** 前回/今回の HUD 数値差分を、改善/悪化 tone 付きで返す。 */
export function diffHudMetricSnapshots(
  previous: HudMetricSnapshot,
  current: HudMetricSnapshot,
): HudMetricDelta[] {
  const deltas: HudMetricDelta[] = [];
  for (const key of Object.keys(current) as HudMetricKey[]) {
    const delta = current[key] - previous[key];
    if (delta === 0) continue;

    const improved = INVERSE_HUD_METRICS.has(key) ? delta < 0 : delta > 0;
    deltas.push({
      key,
      label: HUD_METRIC_LABELS[key],
      delta,
      tone: improved ? 'positive' : 'negative',
    });
  }
  return deltas;
}

/** SimState から表示用ステータスを導出する（Phase 1/2 互換）。 */
export function deriveStatus(state: SimState): StatusView {
  return deriveStatusParts(state.org, state.sprint.tasks);
}
