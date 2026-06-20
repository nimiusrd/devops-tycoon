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

/** SimState から表示用ステータスを導出する（Phase 1/2 互換）。 */
export function deriveStatus(state: SimState): StatusView {
  return deriveStatusParts(state.org, state.sprint.tasks);
}
