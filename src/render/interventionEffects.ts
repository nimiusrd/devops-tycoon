/**
 * 介入アクション成功時の盤面リアクション plan（SPEC 第6 / 第18.2 / RI-50）。
 *
 * RI-49 の `InterventionEffect` ペイロードから演出イベントを純関数で導出する。
 * シミュレーション層は触らず、描画専用（第22.2）。座標は fireEffects と同様に
 * 設計空間 1404×573 を使う。
 */
import { ANDON_TICKS, OVERTIME_TICKS, THROTTLE_TICKS } from '../sim/actions';
import type {
  InterventionEffect,
  InterventionModifierKind,
  SprintModifiers,
  Task,
} from '../sim/types';
import { findBoardFlow, flowPointAt, planBoardScene, BOARD_VIEW } from './boardScene';

/** 盤面上で再生する介入リアクション。 */
export type InterventionReaction =
  | { kind: 'reviewSweep'; taskIds: number[] }
  | { kind: 'split'; taskId: number }
  | { kind: 'firefight'; taskId: number }
  | { kind: 'assignDash'; taskId: number }
  | { kind: 'boardAura'; modifierKind: InterventionModifierKind; durationTicks: number };

/** 座標付きの介入リアクション（レンダラ向け）。 */
export type PositionedInterventionReaction =
  | {
      kind: 'reviewSweep';
      taskId: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      staggerIndex: number;
    }
  | { kind: 'split'; taskId: number; x: number; y: number }
  | { kind: 'firefight'; taskId: number; x: number; y: number }
  | {
      kind: 'assignDash';
      taskId: number;
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      angleDeg: number;
    }
  | { kind: 'boardAura'; modifierKind: InterventionModifierKind; durationTicks: number };

const MODIFIER_TOTALS: Record<InterventionModifierKind, number> = {
  throttle: THROTTLE_TICKS,
  overtime: OVERTIME_TICKS,
  andon: ANDON_TICKS,
};

/** 設計 px → 盤面内の % 文字列。Board / FireEffects と同式。 */
export function interventionPct(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

export const INTERVENTION_VIEW = { w: BOARD_VIEW.w, h: BOARD_VIEW.h } as const;

function dotPosition(tasks: readonly Task[], taskId: number): { x: number; y: number } | null {
  const dot = planBoardScene(tasks).dots.find((d) => d.id === taskId);
  if (dot) return { x: dot.x, y: dot.y };

  const task = tasks.find((t) => t.id === taskId);
  if (!task) return null;
  const station = planBoardScene(tasks).stations.find((s) => s.lane === task.lane);
  if (!station) return null;
  return { x: station.overflowX, y: station.overflowY };
}

function reviewToDoneSweep(
  taskId: number,
  prevTasks: readonly Task[],
  staggerIndex: number,
): PositionedInterventionReaction | null {
  const flow = findBoardFlow('review', 'done');
  if (!flow) return null;
  const from = dotPosition(prevTasks, taskId) ?? flowPointAt(flow, 0);
  const to = flowPointAt(flow, 1);
  return {
    kind: 'reviewSweep',
    taskId,
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
    staggerIndex,
  };
}

/**
 * 介入ペイロードから演出 plan を導出する。
 * `currentTick` はモディファイア持続 tick の算出に使う（省略時は定数 total を使う）。
 */
export function planInterventionReactions(
  effect: InterventionEffect,
  currentTick = 0,
): InterventionReaction[] {
  switch (effect.actionId) {
    case 'interruptReview':
    case 'pairReview':
      if (effect.affectedTaskIds && effect.affectedTaskIds.length > 0) {
        return [{ kind: 'reviewSweep', taskIds: effect.affectedTaskIds }];
      }
      return [];
    case 'splitPr':
      if (effect.affectedTaskIds?.[0] != null) {
        return [{ kind: 'split', taskId: effect.affectedTaskIds[0] }];
      }
      return [];
    case 'firefight':
      if (effect.containedTaskId != null) {
        return [{ kind: 'firefight', taskId: effect.containedTaskId }];
      }
      return [];
    case 'assignTask':
      if (effect.affectedTaskIds?.[0] != null) {
        return [{ kind: 'assignDash', taskId: effect.affectedTaskIds[0] }];
      }
      return [];
    case 'aiThrottle':
    case 'overtime':
    case 'andon':
      if (effect.modifier) {
        const total = MODIFIER_TOTALS[effect.modifier.kind];
        const durationTicks = Math.max(1, effect.modifier.untilTick - currentTick || total);
        return [{ kind: 'boardAura', modifierKind: effect.modifier.kind, durationTicks }];
      }
      return [];
    default:
      return [];
  }
}

/** 演出 plan に盤面座標を付与する。 */
export function positionInterventionReactions(
  reactions: readonly InterventionReaction[],
  tasks: readonly Task[],
  prevTasks: readonly Task[] = tasks,
): PositionedInterventionReaction[] {
  return reactions.flatMap((reaction): PositionedInterventionReaction[] => {
    switch (reaction.kind) {
      case 'reviewSweep':
        return reaction.taskIds.flatMap((taskId, staggerIndex) => {
          const positioned = reviewToDoneSweep(taskId, prevTasks, staggerIndex);
          return positioned ? [positioned] : [];
        });
      case 'split': {
        const pos = dotPosition(prevTasks, reaction.taskId) ?? dotPosition(tasks, reaction.taskId);
        if (!pos) return [];
        return [{ kind: 'split', taskId: reaction.taskId, x: pos.x, y: pos.y }];
      }
      case 'firefight': {
        const pos = dotPosition(prevTasks, reaction.taskId) ?? dotPosition(tasks, reaction.taskId);
        if (!pos) return [];
        return [{ kind: 'firefight', taskId: reaction.taskId, x: pos.x, y: pos.y }];
      }
      case 'assignDash': {
        const flow = findBoardFlow('coding', 'review');
        if (!flow) return [];
        const from =
          dotPosition(prevTasks, reaction.taskId) ??
          dotPosition(tasks, reaction.taskId) ??
          flowPointAt(flow, 0);
        const mid = flowPointAt(flow, 0.65);
        return [
          {
            kind: 'assignDash',
            taskId: reaction.taskId,
            fromX: from.x,
            fromY: from.y,
            toX: mid.x,
            toY: mid.y,
            angleDeg: mid.angleDeg,
          },
        ];
      }
      case 'boardAura':
        return [reaction];
      default:
        return [];
    }
  });
}

/** ペイロードから座標付き plan まで一括導出。 */
export function planPositionedInterventionReactions(
  effect: InterventionEffect,
  tasks: readonly Task[],
  prevTasks: readonly Task[],
  currentTick = 0,
): PositionedInterventionReaction[] {
  return positionInterventionReactions(
    planInterventionReactions(effect, currentTick),
    tasks,
    prevTasks,
  );
}

/** 進行中の時限モディファイアを盤面オーラ用に列挙する。 */
export function deriveActiveBoardAuras(
  modifiers: SprintModifiers,
  sprintTick: number,
): { kind: InterventionModifierKind; remainingTicks: number; totalTicks: number }[] {
  const entries: { kind: InterventionModifierKind; until: number; total: number }[] = [
    { kind: 'throttle', until: modifiers.throttleUntilTick, total: THROTTLE_TICKS },
    { kind: 'overtime', until: modifiers.overtimeUntilTick, total: OVERTIME_TICKS },
    { kind: 'andon', until: modifiers.andonUntilTick, total: ANDON_TICKS },
  ];
  return entries.flatMap(({ kind, until, total }) => {
    const remainingTicks = Math.max(0, until - sprintTick);
    if (remainingTicks <= 0) return [];
    return [{ kind, remainingTicks, totalTicks: total }];
  });
}
