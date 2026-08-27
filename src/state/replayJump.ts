/**
 * リプレイ閲覧中のキーフレーム間ジャンプ（カードドラフトへ、など）。
 *
 * 記録済みキーフレームだけを対象にする。無いフェーズへは進めない。
 */
import type { ReplayFramePhase } from '../sim/run/persist';
import type { ReplayKeyframe } from './replay';

/** ドラフトキーフレームが無いときに結果画面へ出す説明。 */
export const REPLAY_DRAFT_MISSING_HINT = 'このリプレイにはカードドラフトの記録がありません。';

/**
 * 現在のキーフレームより後で、指定 phase の最初の index。無ければ null。
 * `currentIndex` が範囲外でも、後ろ方向の探索だけ行う。
 */
export function findNextReplayKeyframeIndex(
  keyframes: readonly Pick<ReplayKeyframe, 'phase'>[],
  currentIndex: number,
  phase: ReplayFramePhase,
): number | null {
  const start = Number.isFinite(currentIndex) ? Math.floor(currentIndex) + 1 : 0;
  for (let i = Math.max(0, start); i < keyframes.length; i += 1) {
    if (keyframes[i]?.phase === phase) return i;
  }
  return null;
}
