/**
 * 介入アクションバーの表示計画（RI-51 / RI-89）。
 *
 * 発動可否は sim 公開の `canApplyAction` を正とし、対象数バッジだけ UI 側で導出する。
 */
import {
  activeIncidents,
  ALL_ACTION_IDS,
  ANDON_TICKS,
  canApplyAction,
  INTERRUPT_REVIEW_COUNT,
  OVERTIME_TICKS,
  PAIR_REVIEW_COUNT,
  STABILITY_TICKS,
  tasksInLane,
  THROTTLE_TICKS,
} from '../sim/actions';
import { assignableTasks, splitPrCandidates } from '../sim/assignTask';
import type { ActionId, OrgState, SprintState } from '../sim/types';

export type ActionBlockReason = 'cooldown' | 'no-focus' | 'no-target' | 'complete' | 'paused';
export type ActionBarDisabledReason = Extract<ActionBlockReason, 'complete' | 'paused'>;

/** 1 アクションの利用可否と表示メタデータ。 */
export interface ActionAvailability {
  actionId: ActionId;
  canActivate: boolean;
  blockReason?: ActionBlockReason;
  blockMessage?: string;
  targetCount: number;
  targetBadge?: string;
}

/** アクション別の対象数（常時発動系は 0）。 */
export function countActionTargets(sprint: SprintState, id: ActionId): number {
  switch (id) {
    case 'interruptReview':
      return Math.min(tasksInLane(sprint, 'review').length, INTERRUPT_REVIEW_COUNT);
    case 'firefight':
      return activeIncidents(sprint).length;
    case 'splitPr':
      return splitPrCandidates(sprint).length;
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
  paused: '一時停止中',
};

/** 1 アクションの利用可否を導出する。 */
export function deriveActionAvailability(
  sprint: SprintState,
  id: ActionId,
  disabledReason?: ActionBarDisabledReason,
  org?: OrgState,
  tick = 0,
): ActionAvailability {
  const targetCount = countActionTargets(sprint, id);
  const badge = formatTargetBadge(id, targetCount);

  if (disabledReason) {
    return {
      actionId: id,
      canActivate: false,
      blockReason: disabledReason,
      blockMessage: BLOCK_MESSAGES[disabledReason],
      targetCount,
      targetBadge: badge,
    };
  }

  // org 省略時は対象判定に org を使わない（canApplyAction は org 非依存）。
  const gate = canApplyAction(id, sprint, org ?? ({} as OrgState), tick);
  if (!gate.ok) {
    // assignTask: canApplyAction は Coding に自動選択対象がある場合のみ ok を返すが、
    // アクションバーの武装表示は Backlog から昇格可能なタスクがあれば有効とする。
    // apply 時（target なし）は依然として Coding 自動選択に従うため、厳密性は保たれる。
    if (id === 'assignTask' && gate.reason === 'no-target' && assignableTasks(sprint).length > 0) {
      return {
        actionId: id,
        canActivate: true,
        targetCount,
        targetBadge: badge,
      };
    }
    return {
      actionId: id,
      canActivate: false,
      blockReason: gate.reason,
      blockMessage:
        gate.reason === 'no-target'
          ? (NO_TARGET_MESSAGES[id] ?? BLOCK_MESSAGES['no-target'])
          : BLOCK_MESSAGES[gate.reason],
      targetCount,
      targetBadge: badge,
    };
  }

  return {
    actionId: id,
    canActivate: true,
    targetCount,
    targetBadge: badge,
  };
}

/** 全アクションの利用可否一覧。 */
export function planActionBarView(
  sprint: SprintState,
  disabledReason?: ActionBarDisabledReason,
  org?: OrgState,
  tick = 0,
): ActionAvailability[] {
  return ALL_ACTION_IDS.map((id) =>
    deriveActionAvailability(sprint, id, disabledReason, org, tick),
  );
}

/** 失敗理由の表示用短文（トースト等）。 */
export function formatInterventionFailure(reason: ActionBlockReason, actionId?: ActionId): string {
  if (reason === 'no-target' && actionId) {
    return NO_TARGET_MESSAGES[actionId] ?? BLOCK_MESSAGES['no-target'];
  }
  return BLOCK_MESSAGES[reason];
}

/** 時限モディファイアの残り tick（ActionBar のリング／共通ステータス表示用）。 */
export interface ModifierRingState {
  active: boolean;
  remaining: number;
  total: number;
}

/** ActionButton と共通ステータスで表示する時限効果。 */
export type ModifierRingTarget = ActionId | 'stability';

const MODIFIER_RING_BY_ACTION: Partial<
  Record<
    ModifierRingTarget,
    {
      untilKey: 'throttleUntilTick' | 'overtimeUntilTick' | 'andonUntilTick' | 'stabilityUntilTick';
      total: number;
    }
  >
> = {
  aiThrottle: { untilKey: 'throttleUntilTick', total: THROTTLE_TICKS },
  overtime: { untilKey: 'overtimeUntilTick', total: OVERTIME_TICKS },
  andon: { untilKey: 'andonUntilTick', total: ANDON_TICKS },
  stability: { untilKey: 'stabilityUntilTick', total: STABILITY_TICKS },
};

export function deriveModifierRing(
  sprint: SprintState,
  sprintTick: number,
  target: ModifierRingTarget,
): ModifierRingState {
  const entry = MODIFIER_RING_BY_ACTION[target];
  if (!entry) return { active: false, remaining: 0, total: 0 };
  const until = sprint.modifiers[entry.untilKey] ?? 0;
  const remaining = Math.max(0, until - sprintTick);
  if (remaining <= 0) return { active: false, remaining: 0, total: entry.total };
  return { active: true, remaining, total: entry.total };
}
