/**
 * minCompleteTick 待ち（RI-75）の UI 理由とゲート表示（#972）。
 *
 * sim の拒否理由は従来どおり `complete` のまま。プレイヤー向け文言だけここで分岐する。
 */
import type { SprintState } from '../sim/types';
import { isAwaitingMinCompleteTick, isSprintStalled } from '../sim/sprint';

export type SprintPaddingGateKind = 'stalled' | 'waiting';

export function resolveSprintPaddingGate(sprint: SprintState): SprintPaddingGateKind | null {
  if (sprint.complete) return null;
  if (!isAwaitingMinCompleteTick(sprint)) return null;
  return isSprintStalled(sprint) ? 'stalled' : 'waiting';
}

/** 介入・手札・組織レバーで共用する 1 行文言（#469 / #471 / #972）。 */
export const SPRINT_PADDING_GATE_MESSAGES: Record<SprintPaddingGateKind, string> = {
  stalled: 'コーダー不在で作業停止',
  waiting: 'スプリント時間の待機中',
};

export function sprintPaddingGateMessage(
  sprint: SprintState | null | undefined,
): string | undefined {
  if (!sprint) return undefined;
  const kind = resolveSprintPaddingGate(sprint);
  return kind ? SPRINT_PADDING_GATE_MESSAGES[kind] : undefined;
}
