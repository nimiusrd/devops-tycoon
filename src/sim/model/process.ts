/**
 * 工程モデル（coding / review / rework / incident）の確率・レート計算（SPEC 第2章 / 第22.3）。
 *
 * すべて `OrgState` と `Task` から値を返す純関数で、乱数は呼び出し側から
 * 引数で受け取る（seed付き決定論を壊さない）。本作のコア因果——
 * 「AI を入れると Coding は速くなるが Review が詰まり、雑な AI 利用は Rework を増やす」——
 * をここで一元的に表現する。
 */
import type { OrgState, Task, TaskKind } from '../types';
import type { Rng } from '../rng';

/** タスク規模ごとの所要倍率（複雑なほど時間がかかる）。 */
export const SIZE_FACTOR: Record<TaskKind, number> = {
  routine: 0.7,
  normal: 1,
  complex: 1.7,
};

/** タスク規模ごとの基礎出荷ポイント。 */
export const TASK_BASE_VALUE: Record<TaskKind, number> = {
  routine: 3,
  normal: 5,
  complex: 8,
};

/** 高価値タスクの出荷ポイント倍率。 */
export const HIGH_VALUE_MULTIPLIER = 3;

/** Coding の基礎所要 tick（標準規模・AIなし）。 */
export const CODING_BASE_TICKS = 7;
/** AI 利用時の Coding 高速化倍率（コア因果: AI で実装が速くなる）。 */
export const AI_CODING_SPEEDUP = 2.6;

/** AI 導入時、各タスクが AI を使う確率。 */
export const AI_ADOPTION = 0.85;
/** AI タスク 1 件ごとに上がる AI依存度。 */
export const AI_DEP_PER_TASK = 2.2;

/** Review の満HP時スループット（PR/tick）。 */
export const REVIEW_BASE_PER_TICK = 0.9;
/** Review 1 件で消費するシニア体力。 */
export const REVIEW_HP_COST = 1.6;
/** 1 tick あたりのシニア体力回復。 */
export const REVIEW_HP_REGEN = 0.7;

/** 障害 1 件の鎮火に要するシニア体力。 */
export const INCIDENT_HP_COST = 8;
/** これ未満の体力で障害が起きると鎮火できず延焼する閾値。 */
export const INCIDENT_CONTAIN_HP = 12;
/** 延焼 1 件で増える技術的負債。 */
export const DEBT_PER_SPREAD = 6;

/** Rework の所要 tick。 */
export const REWORK_TICKS = 4;
/** タスク 1 件あたりの手戻り上限（これを超えると強制的に通す）。 */
export const MAX_REWORK = 3;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Coding の所要 tick（規模・AI利用で変化）。 */
export function codingTicks(task: Task): number {
  const base = CODING_BASE_TICKS * SIZE_FACTOR[task.kind];
  return task.aiAssisted ? base / AI_CODING_SPEEDUP : base;
}

/** Coding の 1 tick あたり進捗（0..1）。 */
export function codingProgressPerTick(task: Task): number {
  return 1 / codingTicks(task);
}

/** Rework の 1 tick あたり進捗（0..1）。 */
export function reworkProgressPerTick(): number {
  return 1 / REWORK_TICKS;
}

/**
 * Review の 1 tick あたり処理可能 PR 数。
 * シニア体力が低いほど落ちる（過労 → レビュー渋滞の悪循環。第2章）。
 * 体力 0 でも完全停止はせず、最低限のスループットを残す。
 */
export function reviewPerTick(org: OrgState): number {
  const efficiency = 0.3 + 0.7 * (org.seniorHp / 100);
  return REVIEW_BASE_PER_TICK * efficiency;
}

/**
 * Review 済みタスクが手戻りになる確率。
 * **AI依存度が上がるほど増える**（第22.5 の代表的不変条件）。
 * 品質・AIリテラシーが高いほど下がる。手戻り回数が増えると収束させる。
 */
export function reworkProbability(org: OrgState, task: Task): number {
  const p =
    0.05 +
    0.32 * (org.aiDependency / 100) +
    (task.aiAssisted ? 0.1 : 0) -
    0.18 * (org.aiLiteracy / 100) -
    0.14 * (org.quality / 100);
  // 再修正済みのタスクは通りやすくする（収束保証）。
  const damped = p * Math.pow(0.5, task.reworkAttempts);
  return clamp(damped, 0.02, 0.75);
}

/**
 * Review 済みタスクが障害（Incident）になる確率。
 * テストカバレッジが低いほど増える。AI 利用かつ低リテラシーで上乗せ。
 */
export function incidentProbability(org: OrgState, task: Task): number {
  const p =
    0.02 +
    0.1 * (1 - org.testCoverage / 100) +
    (task.aiAssisted ? 0.05 * (1 - org.aiLiteracy / 100) : 0);
  return clamp(p, 0.01, 0.4);
}

/** タスクの出荷ポイント。 */
export function taskValue(task: Task): number {
  const base = TASK_BASE_VALUE[task.kind];
  return task.highValue ? base * HIGH_VALUE_MULTIPLIER : base;
}

/**
 * Coding に入る際、そのタスクが AI を使うか判定する（要乱数）。
 * AI 未導入なら常に false。
 */
export function decideAiAssisted(org: OrgState, rng: Rng): boolean {
  if (!org.aiEnabled) return false;
  return rng() < AI_ADOPTION;
}
