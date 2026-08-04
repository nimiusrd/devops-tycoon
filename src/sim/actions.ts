/**
 * 介入アクションの効果本体（SPEC 第6章）。
 *
 * 集中力（⚡）の消費・クールダウン・連携ゲージを一元処理し、各アクションの
 * 効果を `sprint`/`org` に破壊的に適用する純TS。乱数は引数の seed付きPRNG
 * からのみ消費する（決定論。第22.3）。入力はイベント経由で受け取る。
 */
import { getAction } from '../data/actions';
import { applyAssignTaskEffect, resolveSplitPrTarget } from './assignTask';
import type { Rng } from './rng';
import { reviewOne } from './sprint';
import { appendSprintEvent } from './sprintEvents';
import type {
  ActionId,
  ActionTarget,
  InterventionEffect,
  InterventionOutcome,
  SprintState,
  OrgState,
  Task,
} from './types';

export { ASSIGN_MORALE_COST, ASSIGN_PROGRESS } from './assignTask';

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

/** 割り込みレビューで一度に捌く PR 数（UI プレビューと共有）。 */
export const INTERRUPT_REVIEW_COUNT = 4;
/** 割り込みレビューの追加シニアHP消費（UI プレビューと共有）。 */
export const INTERRUPT_HP_COST = 3;
/** 緊急対応の追加シニアHP消費（UI プレビューと共有）。 */
export const FIREFIGHT_HP_COST = 2;
/** ペアレビューで捌く PR 数（UI プレビューと共有）。 */
export const PAIR_REVIEW_COUNT = 2;
/** ペアレビューで上がる AI Literacy（UI プレビューと共有）。 */
export const PAIR_LITERACY_GAIN = 6;
/** PR分割の進捗巻き戻し（UI プレビューと共有）。 */
export const SPLIT_PROGRESS_PENALTY = 0.2;

/** 残業号令の持続 tick・副作用。スループット倍率は model 側（process.ts）に置く。 */
export const OVERTIME_TICKS = 30;
/** 残業号令の Morale 消費（UI プレビューと共有）。 */
export const OVERTIME_MORALE_COST = 8;
/** 残業号令のシニアHP消費（UI プレビューと共有）。 */
export const OVERTIME_HP_COST = 6;
/** アンドンの流入停止 tick。 */
export const ANDON_TICKS = 30;
/** AIスロットルの持続 tick。 */
export const THROTTLE_TICKS = 40;

/** 連携ゲージが満タンになったとき回復する集中力。 */
export const GAUGE_FOCUS_REFUND = 3;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** clamp 適用後の実際の消費量（0..100 境界）。 */
function spendStat(current: number, amount: number): { next: number; spent: number } {
  const next = clamp(current - amount, 0, 100);
  return { next, spent: current - next };
}

/** clamp 適用後の実際の増加量（0..100 境界）。 */
function gainStat(current: number, amount: number): { next: number; gained: number } {
  const next = clamp(current + amount, 0, 100);
  return { next, gained: next - current };
}

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

type EffectPartial = Omit<
  InterventionEffect,
  'actionId' | 'focusCost' | 'gaugeGain' | 'focusRefund'
>;

/**
 * 各アクションの効果。ペイロードを返すと発動成立（コスト消費）、
 * `false`（対象なし）ならコストを消費しない。
 */
const EFFECTS: Record<
  ActionId,
  (
    s: SprintState,
    o: OrgState,
    r: Rng,
    tick: number,
    target?: ActionTarget,
  ) => EffectPartial | false
> = {
  // 割り込みレビュー: Review キュー先頭の数件を即処理してスイープする。
  interruptReview(sprint, org, rng, tick) {
    const queue = tasksInLane(sprint, 'review').slice(0, INTERRUPT_REVIEW_COUNT);
    if (queue.length === 0) return false;
    const affectedTaskIds = queue.map((t) => t.id);
    for (const task of queue) reviewOne(task, sprint, org, rng, tick);
    const hp = spendStat(org.seniorHp, INTERRUPT_HP_COST);
    org.seniorHp = hp.next;
    return { reviewedCount: queue.length, affectedTaskIds, hpCost: hp.spent };
  },

  // PR分割: 巨大PRを割り、以降のレビューを通りやすくする（split 印）。
  // target 指定時はそのタスク、省略時は従来の自動選択（RI-30）。
  splitPr(sprint, _org, _rng, _tick, target) {
    const task = resolveSplitPrTarget(sprint, target);
    if (!task) return false;
    task.split = true;
    task.progress = Math.max(0, task.progress - SPLIT_PROGRESS_PENALTY);
    return { affectedTaskIds: [task.id] };
  },

  // 緊急対応: 最も延焼が近い火を 1 件、タイマーが切れる前に鎮火して Review へ戻す。
  // 自動鎮火（HP 大量消費・コンボ喪失）より遥かに安く、コンボも守られる（第6.3）。
  firefight(sprint, org, _rng, tick) {
    const fire = mostUrgentIncident(sprint);
    if (!fire) return false;
    const containedTaskId = fire.id;
    fire.incident = false;
    delete fire.burnTicksLeft;
    fire.lane = 'review';
    fire.progress = 0;
    sprint.metrics.contained += 1;
    const hp = spendStat(org.seniorHp, FIREFIGHT_HP_COST);
    org.seniorHp = hp.next;
    appendSprintEvent(sprint, {
      tick,
      kind: 'contain',
      taskId: containedTaskId,
      combo: sprint.metrics.combo,
    });
    return { containedTaskId, hpCost: hp.spent };
  },

  // タスク差配: 対象指定 or 自動選択で前進（偏重で士気低下。RI-30）。
  assignTask(sprint, org, _rng, _tick, target) {
    return applyAssignTaskEffect(sprint, org, target);
  },

  // AIスロットル: 一定時間 AI 流入を絞る（Review 渋滞を抑える）。
  aiThrottle(sprint, _org, _rng, tick) {
    const untilTick = tick + THROTTLE_TICKS;
    sprint.modifiers.throttleUntilTick = untilTick;
    return { modifier: { kind: 'throttle', untilTick } };
  },

  // ペアレビュー: 詰まった PR を処理しつつ AI Literacy を底上げ。
  pairReview(sprint, org, rng, tick) {
    const queue = tasksInLane(sprint, 'review').slice(0, PAIR_REVIEW_COUNT);
    const affectedTaskIds = queue.map((t) => t.id);
    for (const task of queue) reviewOne(task, sprint, org, rng, tick);
    const literacy = gainStat(org.aiLiteracy, PAIR_LITERACY_GAIN);
    org.aiLiteracy = literacy.next;
    return { reviewedCount: queue.length, affectedTaskIds, literacyGain: literacy.gained };
  },

  // 残業号令: 一定時間スループットをブースト（Morale・HP を削る）。
  overtime(sprint, org, _rng, tick) {
    const untilTick = tick + OVERTIME_TICKS;
    sprint.modifiers.overtimeUntilTick = untilTick;
    const morale = spendStat(org.morale, OVERTIME_MORALE_COST);
    const hp = spendStat(org.seniorHp, OVERTIME_HP_COST);
    org.morale = morale.next;
    org.seniorHp = hp.next;
    return {
      modifier: { kind: 'overtime', untilTick },
      hpCost: hp.spent,
      moraleCost: morale.spent,
    };
  },

  // アンドン: 一定時間 Backlog からの流入を止め、キューを捌き切る。
  andon(sprint, _org, _rng, tick) {
    const untilTick = tick + ANDON_TICKS;
    sprint.modifiers.andonUntilTick = untilTick;
    return { modifier: { kind: 'andon', untilTick } };
  },
};

/** 連携ゲージを加算し、満タンになったら集中力を一部回復する（第6.2）。 */
function addComboGauge(sprint: SprintState, gain: number): number {
  sprint.comboGauge += gain;
  if (sprint.comboGauge >= 1) {
    sprint.comboGauge -= 1;
    const before = sprint.focus;
    sprint.focus = Math.min(sprint.config.focusMax, sprint.focus + GAUGE_FOCUS_REFUND);
    return sprint.focus - before;
  }
  return 0;
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
  target?: ActionTarget,
): InterventionOutcome {
  if (sprint.complete) return { ok: false, reason: 'complete' };
  const def = getAction(id);
  if (!def) return { ok: false, reason: 'no-target' };
  if ((sprint.cooldowns[id] ?? 0) > 0) return { ok: false, reason: 'cooldown' };
  if (sprint.focus < def.cost) return { ok: false, reason: 'no-focus' };

  const partial = EFFECTS[id](sprint, org, rng, tick, target);
  if (!partial) return { ok: false, reason: 'no-target' };

  sprint.focus -= def.cost;
  sprint.cooldowns[id] = def.cooldownTicks;
  sprint.metrics.interventionsUsed += 1;
  sprint.metrics.focusSpent += def.cost;
  sprint.metrics.actionCounts[id] = (sprint.metrics.actionCounts[id] ?? 0) + 1;
  const focusRefund = addComboGauge(sprint, def.gauge);

  const effect: InterventionEffect = {
    actionId: id,
    focusCost: def.cost,
    gaugeGain: def.gauge,
    ...partial,
    ...(focusRefund > 0 ? { focusRefund } : {}),
  };

  appendSprintEvent(sprint, {
    tick,
    kind: 'intervention',
    effect,
    combo: sprint.metrics.combo,
  });

  return { ok: true, effect };
}
