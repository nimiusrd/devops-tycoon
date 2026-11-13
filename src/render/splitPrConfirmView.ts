/**
 * PR 分割成功時の短い強調と読み上げ文（#1020）。
 */
import type { InterventionEffect } from '../sim/types';
import type { TaskSize } from './taskView';
import { TASK_DIAMETER } from './taskView';
import { VISUAL_TOKENS } from './visualTokens';

export interface SplitPrConfirmCue {
  taskId: number;
  nonce: number;
}

export function splitPrConfirmDurationMs(): number {
  return VISUAL_TOKENS.dimensions.sprint.dotSplitConfirm.durationMs;
}

/** 読み上げは 1 回だけ。nonce で同一スプリント内の再分割も区別する。 */
export function splitPrConfirmAnnouncementKey(cue: SplitPrConfirmCue): string {
  return `${cue.taskId}:${cue.nonce}`;
}

export function formatSplitPrConfirmAnnouncement(taskId: number): string {
  return `PR #${taskId} を分割しました`;
}

export function planSplitPrConfirmFromEffect(
  actionId: string,
  effect: InterventionEffect | undefined,
  nonce: number,
): SplitPrConfirmCue | null {
  const taskId = effect?.affectedTaskIds?.[0];
  if (actionId !== 'splitPr' || taskId == null) return null;
  return { taskId, nonce };
}

export function shouldAnnounceSplitPrConfirm(
  lastSpokenKey: string | null,
  nextKey: string,
): boolean {
  return lastSpokenKey !== nextKey;
}

export function publishSplitPrConfirmAnnouncement(
  lastSpokenKey: string | null,
  cue: SplitPrConfirmCue | null,
): { lastSpokenKey: string; text: string } | null {
  if (!cue) return null;
  const nextKey = splitPrConfirmAnnouncementKey(cue);
  if (!shouldAnnounceSplitPrConfirm(lastSpokenKey, nextKey)) return null;
  return { lastSpokenKey: nextKey, text: formatSplitPrConfirmAnnouncement(cue.taskId) };
}

/** 分割直後の粒リング。レイアウトは変えず inset の輪郭だけ足す。 */
export function boardDotSplitConfirmRing(size: TaskSize, scale: number) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const tokens = VISUAL_TOKENS.dimensions.sprint.dotSplitConfirm;
  const strokeWidth = tokens.strokeCssWidth / safeScale;
  const inset = tokens.insetCssWidth / safeScale;
  const radius = Math.max(TASK_DIAMETER[size] / 2 - inset, TASK_DIAMETER[size] / 4);
  return {
    radius,
    strokeWidth,
    outlineWidth: strokeWidth + (2 * tokens.outlineCssWidth) / safeScale,
  };
}
