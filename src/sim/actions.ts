/**
 * 介入アクションの効果本体（SPEC 第6章）。
 *
 * 集中力（⚡）の消費・クールダウン・連携ゲージを一元処理し、各アクションの
 * 効果を `sprint`/`org` に破壊的に適用する純TS。乱数は引数の seed付きPRNG
 * からのみ消費する（決定論。第22.3）。介入が無ければスプリントは Phase 1 と
 * 完全に同一挙動になる（入力＝イベント経由。architecture §2）。
 */
import { getAction } from '../data/actions';
import type { Rng } from './rng';
import { reviewOne } from './sprint';
import type { ActionId, InterventionOutcome, SprintState, OrgState, Task } from './types';

/** アクション定義（データは `src/data/actions.ts`）。 */
export interface ActionDef {
  id: ActionId;
  label: string;
  icon: string;
  /** 集中力コスト（⚡）。 */
  cost: number;
  /** 発動後のクールダウン tick 数。 */
  cooldownTicks: number;
  /** 成功時に得る連携ゲージ量（0..1）。 */
  gauge: number;
  description: string;
  sideEffect: string;
  /** 見た目分類（危険＝赤 / 重い）。 */
  tone?: 'danger' | 'heavy';
}

/** 割り込みレビューで一度に捌く PR 数。 */
const INTERRUPT_REVIEW_COUNT = 4;
/** 割り込みレビューの追加シニアHP消費。 */
const INTERRUPT_HP_COST = 3;
/** 緊急対応の追加シニアHP消費。 */
const FIREFIGHT_HP_COST = 2;
/** タスク差配で進める Coding 進捗量。 */
const ASSIGN_PROGRESS = 0.5;
/** タスク差配の士気低下。 */
const ASSIGN_MORALE_COST = 3;
/** ペアレビューで捌く PR 数。 */
const PAIR_REVIEW_COUNT = 2;
/** ペアレビューで上がる AI Literacy。 */
const PAIR_LITERACY_GAIN = 4;
/** PR分割の進捗巻き戻し。 */
const SPLIT_PROGRESS_PENALTY = 0.2;

/** 残業号令の持続 tick・副作用。スループット倍率は model 側（process.ts）に置く。 */
export const OVERTIME_TICKS = 30;
const OVERTIME_MORALE_COST = 8;
const OVERTIME_HP_COST = 6;
/** アンドンの流入停止 tick。 */
export const ANDON_TICKS = 30;
/** AIスロットルの持続 tick。 */
export const THROTTLE_TICKS = 40;

/** 連携ゲージが満タンになったとき回復する集中力。 */
const GAUGE_FOCUS_REFUND = 3;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

function tasksInLane(sprint: SprintState, lane: Task['lane']): Task[] {
  return sprint.tasks.filter((t) => t.lane === lane);
}

/** 現在「燃えている」タスク（Rework 中で incident フラグ）。炎上タイマーの母数。 */
export function activeIncidents(sprint: SprintState): Task[] {
  return sprint.tasks.filter((t) => t.lane === 'rework' && t.incident);
}

/** 最も猶予が短い（延焼が近い）燃焼中タスク。緊急対応のターゲット。 */
export function mostUrgentIncident(sprint: SprintState): Task | undefined {
  let urgent: Task | undefined;
  for (const t of activeIncidents(sprint)) {
    if (!urgent || (t.burnTicksLeft ?? Infinity) < (urgent.burnTicksLeft ?? Infinity)) {
      urgent = t;
    }
  }
  return urgent;
}

/**
 * 各アクションの効果。`true` を返すと発動成立（コスト消費）、
 * `false`（対象なし）ならコストを消費しない。
 */
const EFFECTS: Record<ActionId, (s: SprintState, o: OrgState, r: Rng, tick: number) => boolean> = {
  // 割り込みレビュー: Review キュー先頭の数件を即処理してスイープする。
  interruptReview(sprint, org, rng) {
    const queue = tasksInLane(sprint, 'review').slice(0, INTERRUPT_REVIEW_COUNT);
    if (queue.length === 0) return false;
    for (const task of queue) reviewOne(task, sprint, org, rng);
    org.seniorHp = clamp(org.seniorHp - INTERRUPT_HP_COST, 0, 100);
    return true;
  },

  // PR分割: 巨大PRを割り、以降のレビューを通りやすくする（split 印）。
  splitPr(sprint) {
    const candidates = [...tasksInLane(sprint, 'review'), ...tasksInLane(sprint, 'coding')];
    const target =
      candidates.find((t) => t.kind === 'complex' && !t.split) ?? candidates.find((t) => !t.split);
    if (!target) return false;
    target.split = true;
    target.progress = Math.max(0, target.progress - SPLIT_PROGRESS_PENALTY);
    return true;
  },

  // 緊急対応: 最も延焼が近い火を 1 件、タイマーが切れる前に鎮火して Review へ戻す。
  // 自動鎮火（HP 大量消費・コンボ喪失）より遥かに安く、コンボも守られる（第6.3）。
  firefight(sprint, org) {
    const fire = mostUrgentIncident(sprint);
    if (!fire) return false;
    fire.incident = false;
    delete fire.burnTicksLeft;
    fire.lane = 'review';
    fire.progress = 0;
    sprint.metrics.contained += 1;
    org.seniorHp = clamp(org.seniorHp - FIREFIGHT_HP_COST, 0, 100);
    return true;
  },

  // タスク差配: 着手中タスクを一気に前進させる（偏重で士気低下）。
  assignTask(sprint, org) {
    const target =
      tasksInLane(sprint, 'coding').find((t) => t.kind === 'complex') ??
      tasksInLane(sprint, 'coding')[0];
    if (!target) return false;
    target.progress = clamp(target.progress + ASSIGN_PROGRESS, 0, 0.999);
    target.split = true;
    org.morale = clamp(org.morale - ASSIGN_MORALE_COST, 0, 100);
    return true;
  },

  // AIスロットル: 一定時間 AI 流入を絞る（Review 渋滞を抑える）。
  aiThrottle(sprint, _org, _rng, tick) {
    sprint.modifiers.throttleUntilTick = tick + THROTTLE_TICKS;
    return true;
  },

  // ペアレビュー: 詰まった PR を処理しつつ AI Literacy を底上げ。
  pairReview(sprint, org, rng) {
    const queue = tasksInLane(sprint, 'review').slice(0, PAIR_REVIEW_COUNT);
    for (const task of queue) reviewOne(task, sprint, org, rng);
    org.aiLiteracy = clamp(org.aiLiteracy + PAIR_LITERACY_GAIN, 0, 100);
    return true;
  },

  // 残業号令: 一定時間スループットをブースト（Morale・HP を削る）。
  overtime(sprint, org, _rng, tick) {
    sprint.modifiers.overtimeUntilTick = tick + OVERTIME_TICKS;
    org.morale = clamp(org.morale - OVERTIME_MORALE_COST, 0, 100);
    org.seniorHp = clamp(org.seniorHp - OVERTIME_HP_COST, 0, 100);
    return true;
  },

  // アンドン: 一定時間 Backlog からの流入を止め、キューを捌き切る。
  andon(sprint, _org, _rng, tick) {
    sprint.modifiers.andonUntilTick = tick + ANDON_TICKS;
    return true;
  },
};

/** 連携ゲージを加算し、満タンになったら集中力を一部回復する（第6.2）。 */
function addComboGauge(sprint: SprintState, gain: number): void {
  sprint.comboGauge += gain;
  if (sprint.comboGauge >= 1) {
    sprint.comboGauge -= 1;
    sprint.focus = Math.min(sprint.config.focusMax, sprint.focus + GAUGE_FOCUS_REFUND);
  }
}

/**
 * 介入アクションを発動する。集中力・クールダウン・対象の有無を検査し、
 * 成立時のみコストを消費して効果を適用する。`sprint`/`org` を破壊的に更新する。
 */
export function applyAction(
  id: ActionId,
  sprint: SprintState,
  org: OrgState,
  rng: Rng,
  tick: number,
): InterventionOutcome {
  if (sprint.complete) return { ok: false, reason: 'complete' };
  const def = getAction(id);
  if (!def) return { ok: false, reason: 'no-target' };
  if ((sprint.cooldowns[id] ?? 0) > 0) return { ok: false, reason: 'cooldown' };
  if (sprint.focus < def.cost) return { ok: false, reason: 'no-focus' };

  const applied = EFFECTS[id](sprint, org, rng, tick);
  if (!applied) return { ok: false, reason: 'no-target' };

  sprint.focus -= def.cost;
  sprint.cooldowns[id] = def.cooldownTicks;
  sprint.metrics.interventionsUsed += 1;
  sprint.metrics.focusSpent += def.cost;
  sprint.metrics.actionCounts[id] = (sprint.metrics.actionCounts[id] ?? 0) + 1;
  addComboGauge(sprint, def.gauge);
  return { ok: true };
}
