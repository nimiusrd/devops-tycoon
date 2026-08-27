/**
 * 盤面ドラッグ介入の表示・ヒット判定計画（RI-30）。
 *
 * 武装中アクションに対し、ドラッグ可能なタスク集合とドロップ先レーンを純関数で決める。
 * レンダラはこれを読んでハイライトするだけ（第22.2）。
 */
import { assignableTasks, splitPrCandidates } from '../sim/assignTask';
import type { ActionId, Lane, SprintState } from '../sim/types';
import { BOARD_STATION_CENTERS, BOARD_VIEW, planBoardScene } from './boardScene';

/** ドラッグ武装可能なアクション。 */
export type DraggableActionId = 'assignTask' | 'splitPr';

export function isDraggableAction(id: ActionId): id is DraggableActionId {
  return id === 'assignTask' || id === 'splitPr';
}

/** ステーションのドロップゾーン（設計座標の中心＋半径）。 */
const DROP_ZONES: Record<'backlog' | 'coding' | 'review', { x: number; y: number; r: number }> = {
  backlog: { ...BOARD_STATION_CENTERS.backlog, r: 70 },
  coding: { ...BOARD_STATION_CENTERS.coding, r: 70 },
  review: { ...BOARD_STATION_CENTERS.review, r: 80 },
};

export interface BoardDragPlan {
  armed: DraggableActionId;
  /** ドラッグ可能なタスク ID。 */
  draggableTaskIds: number[];
  /** ハイライトするドロップ先レーン。 */
  dropLanes: Array<'backlog' | 'coding' | 'review'>;
  /** タスク差配時に明示する担当（省略時は defaultAssignee）。 */
  assignee?: 'ai' | 'senior';
}

/** 盤面に描画されているタスク ID（overflow +N に隠れた粒は除く）。 */
function visibleTaskIds(sprint: SprintState): Set<number> {
  return new Set(planBoardScene(sprint.tasks).dots.map((d) => d.id));
}

/**
 * 武装中のドラッグ計画。
 * 候補はあるが描画粒が無い（山の overflow）ときは null を返し、
 * ActionBar 側でクリック即・自動対象フォールバックする。
 */
export function planBoardDrag(
  sprint: SprintState,
  armed: DraggableActionId,
  assignee?: 'ai' | 'senior',
): BoardDragPlan | null {
  const visible = visibleTaskIds(sprint);
  if (armed === 'assignTask') {
    const tasks = assignableTasks(sprint).filter((t) => visible.has(t.id));
    if (tasks.length === 0) return null;
    return {
      armed,
      draggableTaskIds: tasks.map((t) => t.id),
      // Backlog ドロップは進捗が消えるため Coding のみ。
      dropLanes: ['coding'],
      ...(assignee ? { assignee } : {}),
    };
  }
  const tasks = splitPrCandidates(sprint).filter((t) => visible.has(t.id));
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
  if (
    !Number.isFinite(boardRect.width) ||
    !Number.isFinite(boardRect.height) ||
    boardRect.width <= 0 ||
    boardRect.height <= 0
  ) {
    return { x: 0, y: 0 };
  }
  const x = ((clientX - boardRect.left) / boardRect.width) * BOARD_VIEW.w;
  const y = ((clientY - boardRect.top) / boardRect.height) * BOARD_VIEW.h;
  return { x, y };
}
