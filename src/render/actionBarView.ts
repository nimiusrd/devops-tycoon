/**
 * 介入アクションバーの表示計画（RI-51）。
 *
 * `src/sim/actions.ts` の EFFECTS と同じ対象判定を純関数で再現し、
 * 対象数バッジ・発動不能理由を UI に供給する（描画専用。第22.2）。
 */
import { getAction } from '../data/actions';
import {
  activeIncidents,
  ANDON_TICKS,
  INTERRUPT_REVIEW_COUNT,
  OVERTIME_TICKS,
  PAIR_REVIEW_COUNT,
  THROTTLE_TICKS,
} from '../sim/actions';
import { assignableTasks, splitPrCandidates } from '../sim/assignTask';
import type { ActionId, SprintState, Task } from '../sim/types';

export type ActionBlockReason = 'cooldown' | 'no-focus' | 'no-target' | 'complete';

/** 1 アクションの利用可否と表示メタデータ。 */
export interface ActionAvailability {
  actionId: ActionId;
  canActivate: boolean;
  blockReason?: ActionBlockReason;
  blockMessage?: string;
  targetCount: number;
  targetBadge?: string;
}

function tasksInLane(sprint: SprintState, lane: Task['lane']): Task[] {
  return sprint.tasks.filter((t) => t.lane === lane);
}

/** splitPr の分割候補数（EFFECTS と同じ優先順位の母数）。 */
function splitPrCandidateCount(sprint: SprintState): number {
  return splitPrCandidates(sprint).length;
}

/** splitPr が 1 件でも発動可能か（EFFECTS と同じ選択ロジック）。 */
function hasSplitPrTarget(sprint: SprintState): boolean {
  return splitPrCandidates(sprint).length > 0;
}

/** アクション別の対象数（常時発動系は 0）。 */
export function countActionTargets(sprint: SprintState, id: ActionId): number {
  switch (id) {
    case 'interruptReview':
      return Math.min(tasksInLane(sprint, 'review').length, INTERRUPT_REVIEW_COUNT);
    case 'firefight':
      return activeIncidents(sprint).length;
    case 'splitPr':
      return splitPrCandidateCount(sprint);
    case 'assignTask':
      return assignableTasks(sprint).length;
    case 'pairReview':
      return Math.min(tasksInLane(sprint, 'review').length, PAIR_REVIEW_COUNT);
    case 'aiThrottle':
    case 'overtime':
    case 'andon':
      return 0;
    default:
      return 0;
  }
}

/** 対象不要アクションか（modifier 系）。 */
function isAlwaysAvailable(id: ActionId): boolean {
  return id === 'aiThrottle' || id === 'overtime' || id === 'andon';
}

/** 対象が無いと no-target になるアクションか。 */
function requiresTarget(id: ActionId): boolean {
  return !isAlwaysAvailable(id) && id !== 'pairReview';
}

function formatTargetBadge(id: ActionId, count: number): string | undefined {
  if (isAlwaysAvailable(id)) return undefined;
  switch (id) {
    case 'interruptReview':
    case 'pairReview':
      return `PR ${count}`;
    case 'firefight':
      return `🔥${count}`;
    case 'splitPr':
      return count > 0 ? `${count}` : undefined;
    case 'assignTask':
      return count > 0 ? `${count}` : undefined;
    default:
      return undefined;
  }
}

const NO_TARGET_MESSAGES: Partial<Record<ActionId, string>> = {
  interruptReview: 'Review が空',
  firefight: '炎上なし',
  splitPr: '分割対象なし',
  assignTask: '差配対象なし',
};

const BLOCK_MESSAGES: Record<ActionBlockReason, string> = {
  cooldown: 'クールダウン中',
  'no-focus': '集中力不足',
  'no-target': '対象なし',
  complete: 'スプリント終了',
};

function hasNoTarget(sprint: SprintState, id: ActionId): boolean {
  if (!requiresTarget(id)) return false;
  switch (id) {
    case 'interruptReview':
      return tasksInLane(sprint, 'review').length === 0;
    case 'firefight':
      return activeIncidents(sprint).length === 0;
    case 'splitPr':
      return !hasSplitPrTarget(sprint);
    case 'assignTask':
      return assignableTasks(sprint).length === 0;
    default:
      return false;
  }
}

/** 1 アクションの利用可否を導出する。 */
export function deriveActionAvailability(
  sprint: SprintState,
  id: ActionId,
  disabled = false,
): ActionAvailability {
  const def = getAction(id);
  const targetCount = countActionTargets(sprint, id);

  if (disabled || sprint.complete) {
    return {
      actionId: id,
      canActivate: false,
      blockReason: 'complete',
      blockMessage: BLOCK_MESSAGES.complete,
      targetCount,
      targetBadge: formatTargetBadge(id, targetCount),
    };
  }

  const remaining = sprint.cooldowns[id] ?? 0;
  if (remaining > 0) {
    return {
      actionId: id,
      canActivate: false,
      blockReason: 'cooldown',
      blockMessage: BLOCK_MESSAGES.cooldown,
      targetCount,
      targetBadge: formatTargetBadge(id, targetCount),
    };
  }

  if (!def || sprint.focus < def.cost) {
    return {
      actionId: id,
      canActivate: false,
      blockReason: 'no-focus',
      blockMessage: BLOCK_MESSAGES['no-focus'],
      targetCount,
      targetBadge: formatTargetBadge(id, targetCount),
    };
  }

  if (hasNoTarget(sprint, id)) {
    return {
      actionId: id,
      canActivate: false,
      blockReason: 'no-target',
      blockMessage: NO_TARGET_MESSAGES[id] ?? BLOCK_MESSAGES['no-target'],
      targetCount,
      targetBadge: formatTargetBadge(id, targetCount),
    };
  }

  return {
    actionId: id,
    canActivate: true,
    targetCount,
    targetBadge: formatTargetBadge(id, targetCount),
  };
}

/** 全アクションの利用可否一覧。 */
export function planActionBarView(sprint: SprintState, disabled = false): ActionAvailability[] {
  const ids: ActionId[] = [
    'interruptReview',
    'splitPr',
    'firefight',
    'assignTask',
    'aiThrottle',
    'pairReview',
    'overtime',
    'andon',
  ];
  return ids.map((id) => deriveActionAvailability(sprint, id, disabled));
}

/** 失敗理由の表示用短文（トースト等）。 */
export function formatInterventionFailure(reason: ActionBlockReason, actionId?: ActionId): string {
  if (reason === 'no-target' && actionId) {
    return NO_TARGET_MESSAGES[actionId] ?? BLOCK_MESSAGES['no-target'];
  }
  return BLOCK_MESSAGES[reason];
}

/** 時限モディファイアの残り tick（ActionBar リング表示用 / RI-50）。 */
export interface ModifierRingState {
  active: boolean;
  remaining: number;
  total: number;
}

const MODIFIER_RING_BY_ACTION: Partial<
  Record<
    ActionId,
    { untilKey: 'throttleUntilTick' | 'overtimeUntilTick' | 'andonUntilTick'; total: number }
  >
> = {
  aiThrottle: { untilKey: 'throttleUntilTick', total: THROTTLE_TICKS },
  overtime: { untilKey: 'overtimeUntilTick', total: OVERTIME_TICKS },
  andon: { untilKey: 'andonUntilTick', total: ANDON_TICKS },
};

export function deriveModifierRing(
  sprint: SprintState,
  sprintTick: number,
  actionId: ActionId,
): ModifierRingState {
  const entry = MODIFIER_RING_BY_ACTION[actionId];
  if (!entry) return { active: false, remaining: 0, total: 0 };
  const until = sprint.modifiers[entry.untilKey];
  const remaining = Math.max(0, until - sprintTick);
  if (remaining <= 0) return { active: false, remaining: 0, total: entry.total };
  return { active: true, remaining, total: entry.total };
}
