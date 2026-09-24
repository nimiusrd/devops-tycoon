/**
 * タスク差配・PR分割の HTML 対象選択表示モデル（RI-146）。
 *
 * 候補集合は sim の `assignableTasks` / `splitPrCandidates` を正本とし、
 * 行ごとの可否は `canApplyAction` に寄せる。盤面の可視粒フィルタは使わない
 * （overflow のタスクもキーボード／タッチで選べるようにする）。
 */
import { canApplyAction } from '../sim/actions';
import { assignableTasks, splitPrCandidates } from '../sim/assignTask';
import type { ActionTarget, Lane, OrgState, SprintState, Task, TaskKind } from '../sim/types';
import type { DraggableActionId } from './boardDragPlan';

const LANE_LABELS: Record<Extract<Lane, 'backlog' | 'coding' | 'review'>, string> = {
  backlog: '待機',
  coding: '実装',
  review: 'レビュー',
};

const KIND_LABELS: Record<TaskKind, string> = {
  routine: '定型',
  normal: '通常',
  complex: '複雑',
};

export interface ActionTargetPickerOption {
  taskId: number;
  label: string;
  detail: string;
  canSelect: boolean;
  blockMessage?: string;
  /** 確定時に `dispatch` へ渡す target（ドラッグ経路と同形）。 */
  target: ActionTarget;
}

export interface ActionTargetPickerView {
  armed: DraggableActionId;
  title: string;
  options: ActionTargetPickerOption[];
}

function laneLabel(lane: Lane): string {
  if (lane === 'backlog' || lane === 'coding' || lane === 'review') return LANE_LABELS[lane];
  return lane;
}

function formatTaskOption(task: Task): Pick<ActionTargetPickerOption, 'label' | 'detail'> {
  const lane = laneLabel(task.lane);
  const kind = KIND_LABELS[task.kind];
  const extras: string[] = [];
  if (task.aiAssisted) extras.push('AI担当');
  if (task.split) extras.push('分割済');
  return {
    label: `タスク #${task.id}`,
    detail: extras.length > 0 ? `${lane}・${kind}（${extras.join('・')}）` : `${lane}・${kind}`,
  };
}

function buildTarget(
  armed: DraggableActionId,
  taskId: number,
  assignee?: 'ai' | 'senior',
): ActionTarget {
  if (armed === 'assignTask') {
    return {
      taskId,
      lane: 'coding',
      ...(assignee ? { assignee } : {}),
    };
  }
  return { taskId };
}

/**
 * 武装中アクションの対象候補一覧。
 * 候補が空なら null（ActionBar は従来どおり自動対象フォールバックへ）。
 */
export function planActionTargetPickerView(
  sprint: SprintState,
  org: OrgState,
  armed: DraggableActionId,
  options?: {
    assignee?: 'ai' | 'senior';
    tick?: number;
    paused?: boolean;
  },
): ActionTargetPickerView | null {
  const tick = options?.tick ?? 0;
  const paused = options?.paused === true;
  const tasks = armed === 'assignTask' ? assignableTasks(sprint) : splitPrCandidates(sprint);
  if (tasks.length === 0) return null;

  const pickerOptions: ActionTargetPickerOption[] = tasks.map((task) => {
    const target = buildTarget(armed, task.id, options?.assignee);
    const copy = formatTaskOption(task);
    if (paused) {
      return {
        taskId: task.id,
        ...copy,
        canSelect: false,
        blockMessage: '一時停止中',
        target,
      };
    }
    const gate = canApplyAction(armed, sprint, org, tick, target);
    if (!gate.ok) {
      const blockMessage =
        gate.reason === 'no-focus'
          ? '集中力不足'
          : gate.reason === 'cooldown'
            ? 'クールダウン中'
            : gate.reason === 'complete'
              ? 'スプリント終了'
              : options?.assignee === 'ai' && !org.aiEnabled
                ? 'AI無効'
                : '対象にできない';
      return {
        taskId: task.id,
        ...copy,
        canSelect: false,
        blockMessage,
        target,
      };
    }
    return {
      taskId: task.id,
      ...copy,
      canSelect: true,
      target,
    };
  });

  return {
    armed,
    title: armed === 'assignTask' ? '差配するタスクを選ぶ' : '分割するPRを選ぶ',
    options: pickerOptions,
  };
}
