/**
 * 介入アクションの効果本体（SPEC 第6章）。
 *
 * 集中力（⚡）の消費・クールダウン・連携ゲージを一元処理し、各アクションの
 * 効果を `sprint`/`org` に破壊的に適用する純TS。乱数は引数の seed付きPRNG
 * からのみ消費する（決定論。第22.3）。入力はイベント経由で受け取る。
 */
import { getAction } from '../data/actions';
import { ACTION_BALANCE } from '../data/balance';
import { STABILITY_TICKS } from './model';
import {
  applyAssignTaskEffect,
  canApplyAssignTaskTarget,
  resolveAssignTaskTarget,
  resolveSplitPrTarget,
  TASK_PROGRESS_MIN,
} from './assignTask';
import type { Rng } from './rng';
import { isAwaitingMinCompleteTick, reviewOne } from './sprint';
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
import { ORG_STAT_MAX, ORG_STAT_MIN, spendStat } from './orgStat';
import { clamp } from './clamp';

export {
  ASSIGN_IDEAL_MORALE_MIN,
  ASSIGN_MISMATCH_STREAK_MAX,
  ASSIGN_MORALE_COST,
  ASSIGN_PROGRESS,
  TASK_PROGRESS_MAX,
  TASK_PROGRESS_MIN,
} from './assignTask';
export { STABILITY_TICKS } from './model';

/** `canApplyAction` / `applyAction` が共有する失敗理由。 */
export type ActionGateReason = 'complete' | 'cooldown' | 'no-focus' | 'no-target';

/** 介入バー／playtest 観測で列挙する全 ActionId（表示順）。 */
export const ALL_ACTION_IDS: readonly ActionId[] = [
  'interruptReview',
  'splitPr',
  'firefight',
  'assignTask',
  'aiThrottle',
  'pairReview',
  'overtime',
  'andon',
] as const;

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
  /** 安全側の介入なら、短時間の運用安定を作る（RI-84 / F-5）。 */
  stabilizesFlow?: boolean;
  description: string;
  sideEffect: string;
  /** 見た目分類（危険＝赤 / 重い）。 */
  tone?: 'danger' | 'heavy';
}

/** 割り込みレビューで一度に捌く PR 数（UI プレビューと共有）。 */
export const INTERRUPT_REVIEW_COUNT = ACTION_BALANCE.interruptReviewCount.value;
/**
 * 割り込みレビューの追加シニアHP消費（UI プレビューと共有）。
 * RI-73 / F-1: 複合運用の割り込みを単一緊急対応より相対的に安くする。
 */
export const INTERRUPT_HP_COST = ACTION_BALANCE.interruptReviewHpCost.value;
/** 緊急対応の追加シニアHP消費（UI プレビューと共有）。 */
export const FIREFIGHT_HP_COST = ACTION_BALANCE.firefightHpCost.value;
/**
 * 同一スプリントで緊急対応を重ねるたびに増える HP コスト（RI-73 / F-1）。
 * 1 回目は `FIREFIGHT_HP_COST`、以降 +1（上限 `FIREFIGHT_HP_COST_MAX`）。
 */
export const FIREFIGHT_HP_ESCALATION = ACTION_BALANCE.firefightHpEscalation.value;
/** 緊急対応の同一スプリント連打 HP 上限（残業号令と同帯）。 */
export const FIREFIGHT_HP_COST_MAX = ACTION_BALANCE.firefightHpCostMaximum.value;
/**
 * 単発の軽い炎上を消したときの士気コスト（打つべきでない盤面。RI-73 / F-1）。
 * 複数炎上の制圧では払わない。
 */
export const FIREFIGHT_LIGHT_MORALE_COST = ACTION_BALANCE.firefightLightMoraleCost.value;
/**
 * 単発先消しのシニアHPコスト（自動鎮火に近い。RI-73 / F-1）。
 * 複数炎上の緊急鎮火だけ `firefightHpCost` の安い帯を使う。
 */
export const FIREFIGHT_LIGHT_HP_COST = ACTION_BALANCE.firefightLightHpCost.value;
/**
 * 互換・表示用の猶予閾値（安定付与条件自体は複数炎上のみ）。
 */
export const FIREFIGHT_STABILITY_BURN_TICKS = ACTION_BALANCE.firefightStabilityBurnTicks.value;
/** 炎上がこの件数以上なら緊急対応でも運用安定を付与する（RI-73 / F-1）。 */
export const FIREFIGHT_STABILITY_MIN_BURNING =
  ACTION_BALANCE.firefightStabilityMinimumBurning.value;
/** ペアレビューで捌く PR 数（UI プレビューと共有）。 */
export const PAIR_REVIEW_COUNT = ACTION_BALANCE.pairReviewCount.value;
/** ペアレビューで上がる AI Literacy（UI プレビューと共有）。 */
export const PAIR_LITERACY_GAIN = ACTION_BALANCE.pairReviewLiteracyGain.value;
/** PR分割の進捗巻き戻し（UI プレビューと共有）。 */
export const SPLIT_PROGRESS_PENALTY = ACTION_BALANCE.splitPrProgressPenalty.value;
/** PR分割の士気コスト（単体乱打が固定強手にならないよう。RI-73 / F-1）。 */
export const SPLIT_MORALE_COST = ACTION_BALANCE.splitPrMoraleCost.value;
/** PR分割のシニアHPコスト（分割作業にシニアが割かれる。RI-73 / F-1）。 */
export const SPLIT_HP_COST = ACTION_BALANCE.splitPrHpCost.value;

/** 残業号令の持続 tick・副作用。スループット倍率は model 側（process.ts）に置く。 */
export const OVERTIME_TICKS = ACTION_BALANCE.overtimeTicks.value;
/** 残業号令の Morale 消費（UI プレビューと共有）。 */
export const OVERTIME_MORALE_COST = ACTION_BALANCE.overtimeMoraleCost.value;
/** 残業号令のシニアHP消費（UI プレビューと共有）。 */
export const OVERTIME_HP_COST = ACTION_BALANCE.overtimeHpCost.value;
/** アンドンの流入停止 tick（RI-73 / F-1: 単体乱打が固定強手にならないよう短め）。 */
export const ANDON_TICKS = ACTION_BALANCE.andonTicks.value;
/**
 * アンドンが「渋滞対応」とみなす Review 件数の下限（熟練方針の使用条件に揃える。RI-73 / F-1）。
 * 未満なら追加の薄キュー罰。
 */
export const ANDON_STABILITY_REVIEW_MIN = ACTION_BALANCE.andonStabilityReviewMinimum.value;
/** アンドンの基本士気コスト（ライン停止の現場負荷。RI-73 / F-1）。 */
export const ANDON_BASE_MORALE_COST = ACTION_BALANCE.andonBaseMoraleCost.value;
/** 薄キューでアンドンを打ったときの追加士気ペナルティ（RI-73 / F-1）。 */
export const ANDON_THIN_MORALE_COST = ACTION_BALANCE.andonThinMoraleCost.value;
/** アンドンのシニアHPコスト（薄キューの先止めにシニアが割かれる。RI-73 / F-1）。 */
export const ANDON_HP_COST = ACTION_BALANCE.andonHpCost.value;
/** AIスロットルの持続 tick。 */
export const THROTTLE_TICKS = ACTION_BALANCE.aiThrottleTicks.value;

/** 連携ゲージが満タンになったとき回復する集中力。 */
export const GAUGE_FOCUS_REFUND = ACTION_BALANCE.comboGaugeFocusRefund.value;

/** clamp 適用後の実際の増加量（0..100 境界）。 */
function gainStat(current: number, amount: number): { next: number; gained: number } {
  const next = clamp(current + amount, ORG_STAT_MIN, ORG_STAT_MAX);
  return { next, gained: next - current };
}

/** 指定レーンのタスク（介入の対象数バッジと効果本体で共有）。 */
export function tasksInLane(sprint: SprintState, lane: Task['lane']): Task[] {
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
 * 緊急対応が運用安定を付与し、軽い先消しペナを免除する「緊急」盤面か（RI-73 / F-1）。
 * 猶予に余裕がある単発先消しは高コスト。複数炎上／延焼寸前だけ安く鎮火できる。
 */
export function isFirefightUrgent(sprint: SprintState): boolean {
  const fires = activeIncidents(sprint);
  if (fires.length >= FIREFIGHT_STABILITY_MIN_BURNING) return true;
  const urgent = mostUrgentIncident(sprint);
  if (!urgent) return false;
  return (urgent.burnTicksLeft ?? Infinity) <= FIREFIGHT_STABILITY_BURN_TICKS;
}

/** 同一スプリント内の緊急対応成功回数から HP コストを求める（RI-73 / F-1）。 */
export function firefightHpCost(priorUses: number): number {
  const n = Math.max(0, Math.floor(priorUses));
  return Math.min(FIREFIGHT_HP_COST_MAX, FIREFIGHT_HP_COST + n * FIREFIGHT_HP_ESCALATION);
}

/** アンドンが運用安定を付与できるほど Review が詰まっているか（RI-73 / F-1）。 */
export function isAndonReviewCongested(sprint: SprintState): boolean {
  return tasksInLane(sprint, 'review').length >= ANDON_STABILITY_REVIEW_MIN;
}

/**
 * 安全側介入が今回の盤面で運用安定を付与するか（RI-73 / F-1）。
 * - 緊急対応: 猶予が短い／複数炎上のときだけ（軽い先消しスパムを防ぐ）
 * - アンドン / PR分割: 付けない（単体乱打の固定強手化を防ぐ。複合は他介入で安定を得る）
 */
export function grantsStabilityOnApply(id: ActionId, sprint: SprintState): boolean {
  const def = getAction(id);
  if (!def?.stabilizesFlow) return false;
  if (id === 'firefight') return isFirefightUrgent(sprint);
  if (id === 'andon' || id === 'splitPr') return false;
  return true;
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
  // RI-73 / F-1: 士気・シニアHPを払い、運用安定は付けない（単体乱打の固定強手化を防ぐ）。
  splitPr(sprint, org, _rng, _tick, target) {
    const task = resolveSplitPrTarget(sprint, target);
    if (!task) return false;
    task.split = true;
    task.progress = Math.max(TASK_PROGRESS_MIN, task.progress - SPLIT_PROGRESS_PENALTY);
    const morale = spendStat(org.morale, SPLIT_MORALE_COST);
    const hp = spendStat(org.seniorHp, SPLIT_HP_COST);
    org.morale = morale.next;
    org.seniorHp = hp.next;
    return {
      affectedTaskIds: [task.id],
      moraleCost: morale.spent,
      hpCost: hp.spent,
    };
  },

  // 緊急対応: 最も延焼が近い火を 1 件、タイマーが切れる前に鎮火して Review へ戻す。
  // 緊急時は自動鎮火より安くコンボも守れる（第6.3）。
  // RI-73 / F-1: 連打は HP 逓増。単発先消しは士気ペナ＋安定なし＋コンボ切断。
  firefight(sprint, org, _rng, tick) {
    const fire = mostUrgentIncident(sprint);
    if (!fire) return false;
    const lightTouch = !isFirefightUrgent(sprint);
    const containedTaskId = fire.id;
    fire.incident = false;
    delete fire.burnTicksLeft;
    fire.lane = 'review';
    fire.progress = 0;
    sprint.metrics.contained += 1;
    const priorUses = sprint.metrics.actionCounts.firefight ?? 0;
    const hpCost = lightTouch ? FIREFIGHT_LIGHT_HP_COST : firefightHpCost(priorUses);
    const hp = spendStat(org.seniorHp, hpCost);
    org.seniorHp = hp.next;
    let moraleSpent = 0;
    if (lightTouch) {
      // 余裕のある先消しは「毎回ヒーロー」になり、連続出荷の流れを切る（RI-73 / F-1）。
      sprint.metrics.combo = 0;
      const morale = spendStat(org.morale, FIREFIGHT_LIGHT_MORALE_COST);
      org.morale = morale.next;
      moraleSpent = morale.spent;
    }
    appendSprintEvent(sprint, {
      tick,
      kind: 'contain',
      taskId: containedTaskId,
      combo: sprint.metrics.combo,
      ...(lightTouch ? { brokeCombo: true as const } : {}),
    });
    if (lightTouch) {
      appendSprintEvent(sprint, {
        tick,
        kind: 'combo-break',
        reason: 'light-firefight',
        taskId: containedTaskId,
      });
    }
    return {
      containedTaskId,
      hpCost: hp.spent,
      ...(moraleSpent > 0 ? { moraleCost: moraleSpent } : {}),
      ...(lightTouch ? { brokeCombo: true as const } : {}),
    };
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
  // RI-73 / F-1: 渋滞時は軽い士気コストのみ。薄いキューでは士気追加＋シニアHP。運用安定なし。
  andon(sprint, org, _rng, tick) {
    const untilTick = tick + ANDON_TICKS;
    sprint.modifiers.andonUntilTick = untilTick;
    const congested = isAndonReviewCongested(sprint);
    const moraleCost = congested
      ? ANDON_BASE_MORALE_COST
      : ANDON_BASE_MORALE_COST + ANDON_THIN_MORALE_COST;
    const morale = spendStat(org.morale, moraleCost);
    org.morale = morale.next;
    if (!congested) {
      const hp = spendStat(org.seniorHp, ANDON_HP_COST);
      org.seniorHp = hp.next;
      return {
        modifier: { kind: 'andon', untilTick },
        moraleCost: morale.spent,
        hpCost: hp.spent,
      };
    }
    return {
      modifier: { kind: 'andon', untilTick },
      moraleCost: morale.spent,
    };
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
 * 対象の有無だけを読む（盤面非破壊 / RI-89）。
 * `applyAction` の EFFECTS と同じ条件。pairReview と modifier 系は常に true。
 * `assignTask` で target 指定時は移動先・担当条件まで見るため `org` が必要。
 */
export function hasActionTarget(
  id: ActionId,
  sprint: SprintState,
  target?: ActionTarget,
  org?: OrgState,
): boolean {
  switch (id) {
    case 'interruptReview':
      return tasksInLane(sprint, 'review').length > 0;
    case 'splitPr':
      return resolveSplitPrTarget(sprint, target) !== undefined;
    case 'firefight':
      return mostUrgentIncident(sprint) !== undefined;
    case 'assignTask':
      // 武装時（target なし）は apply と同じ自動選択対象（空き枠の Backlog を含む）の有無で判定する。
      if (!target) return resolveAssignTaskTarget(sprint) !== undefined;
      if (!org) return false;
      return canApplyAssignTaskTarget(sprint, org, target);
    case 'pairReview':
    case 'aiThrottle':
    case 'overtime':
    case 'andon':
      return true;
    default:
      return false;
  }
}

/**
 * 盤面を変更せずに発動可否を判定する（RI-89）。
 * 判定順・意味は `applyAction` と同じ（complete → cooldown → focus → target）。
 */
export function canApplyAction(
  id: ActionId,
  sprint: SprintState,
  org: OrgState,
  _tick: number,
  target?: ActionTarget,
): { ok: true } | { ok: false; reason: ActionGateReason } {
  if (sprint.complete) return { ok: false, reason: 'complete' };
  // RI-75: minCompleteTick 待ち（盤面枯渇後のパディング）では介入を受け付けない。
  if (isAwaitingMinCompleteTick(sprint)) return { ok: false, reason: 'complete' };
  const def = getAction(id);
  if (!def) return { ok: false, reason: 'no-target' };
  if ((sprint.cooldowns[id] ?? 0) > 0) return { ok: false, reason: 'cooldown' };
  if (sprint.focus < def.cost) return { ok: false, reason: 'no-focus' };
  if (!hasActionTarget(id, sprint, target, org)) return { ok: false, reason: 'no-target' };
  return { ok: true };
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
  const gate = canApplyAction(id, sprint, org, tick, target);
  if (!gate.ok) return { ok: false, reason: gate.reason };

  const def = getAction(id)!;
  const stabilityUntilTick = sprint.modifiers.stabilityUntilTick;
  // 割り込み／ペアレビューがこの場で reviewOne を呼んでも安定化を適用する。
  // 緊急対応・アンドン・PR分割は盤面条件付き（RI-73 / F-1）。判定は効果適用前の盤面で行う。
  const grantStability = grantsStabilityOnApply(id, sprint);
  if (grantStability) {
    sprint.modifiers.stabilityUntilTick = tick + STABILITY_TICKS;
  }
  const partial = EFFECTS[id](sprint, org, rng, tick, target);
  if (!partial) {
    sprint.modifiers.stabilityUntilTick = stabilityUntilTick;
    return { ok: false, reason: 'no-target' };
  }

  sprint.focus -= def.cost;
  sprint.cooldowns[id] = def.cooldownTicks;
  sprint.metrics.interventionsUsed += 1;
  sprint.metrics.focusSpent += def.cost;
  sprint.metrics.actionCounts[id] = (sprint.metrics.actionCounts[id] ?? 0) + 1;
  // 評価加点は「安定を実際に付与した回数」だけを数える（RI-73 / Codex P2）。
  if (grantStability) {
    sprint.metrics.stabilizingGrants += 1;
  }
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
