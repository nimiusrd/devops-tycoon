/**
 * 盤面ドラッグ介入の表示・ヒット判定計画（RI-30）。
 *
 * 武装中アクションに対し、ドラッグ可能なタスク集合とドロップ先レーンを純関数で決める。
 * レンダラはこれを読んでハイライトするだけ（第22.2）。
 */
import { assignableTasks, splitPrCandidates } from '../sim/assignTask';
import type { ActionId, Lane, SprintState } from '../sim/types';
import { BOARD_VIEW } from './boardScene';

/** ドラッグ武装可能なアクション。 */
export type DraggableActionId = 'assignTask' | 'splitPr';

export function isDraggableAction(id: ActionId): id is DraggableActionId {
  return id === 'assignTask' || id === 'splitPr';
}

/** ステーションのドロップゾーン（設計座標の中心＋半径）。 */
const DROP_ZONES: Record<'backlog' | 'coding' | 'review', { x: number; y: number; r: number }> = {
  backlog: { x: 526, y: 203, r: 70 },
  coding: { x: 622, y: 251, r: 70 },
  review: { x: 742, y: 285, r: 80 },
};

export interface BoardDragPlan {
  armed: DraggableActionId;
  /** ドラッグ可能なタスク ID。 */
  draggableTaskIds: number[];
  /** ハイライトするドロップ先レーン。 */
  dropLanes: Array<'backlog' | 'coding' | 'review'>;
}

/** 武装中のドラッグ計画。対象が無ければ null。 */
export function planBoardDrag(sprint: SprintState, armed: DraggableActionId): BoardDragPlan | null {
  if (armed === 'assignTask') {
    const tasks = assignableTasks(sprint);
    if (tasks.length === 0) return null;
    return {
      armed,
      draggableTaskIds: tasks.map((t) => t.id),
      dropLanes: ['backlog', 'coding'],
    };
  }
  const tasks = splitPrCandidates(sprint);
  if (tasks.length === 0) return null;
  return {
    armed,
    draggableTaskIds: tasks.map((t) => t.id),
    // splitPr はタスク上で完了（レーン移動なし）。候補レーンをハイライト。
    dropLanes: ['coding', 'review'],
  };
}

/**
 * 設計座標 (x,y) がどのドロップレーンに当たるか。
 * 最も近いゾーン内ならそのレーン、どれにも入らなければ null。
 */
export function hitTestDropLane(
  x: number,
  y: number,
  allowed: ReadonlyArray<'backlog' | 'coding' | 'review'>,
): Extract<Lane, 'backlog' | 'coding' | 'review'> | null {
  let best: Extract<Lane, 'backlog' | 'coding' | 'review'> | null = null;
  let bestDist = Infinity;
  for (const lane of allowed) {
    const z = DROP_ZONES[lane];
    const dx = x - z.x;
    const dy = y - z.y;
    const d = Math.hypot(dx, dy);
    if (d <= z.r && d < bestDist) {
      bestDist = d;
      best = lane;
    }
  }
  return best;
}

/** クライアント座標を盤面の設計座標へ変換する。 */
export function clientToBoardPoint(
  clientX: number,
  clientY: number,
  boardRect: DOMRect,
): { x: number; y: number } {
  const x = ((clientX - boardRect.left) / boardRect.width) * BOARD_VIEW.w;
  const y = ((clientY - boardRect.top) / boardRect.height) * BOARD_VIEW.h;
  return { x, y };
}
