/**
 * リプレイ閲覧中のキーフレーム間ジャンプ（カードドラフトへ、など）。
 *
 * 記録済みキーフレームだけを対象にする。無いフェーズへは進めない。
 * 判定は hydrate される `frame.phase` を使い、次のスプリント境界を越えない。
 */
import type { ReplayFramePhase } from '../sim/run/persist';
import type { ReplayKeyframe } from './replay';

/** ドラフトキーフレームが無いときに結果画面へ出す説明。 */
export const REPLAY_DRAFT_MISSING_HINT = 'このリプレイにはカードドラフトの記録がありません。';

/** これを越えると別スプリント／終端なので、対応する draft ではない。 */
const JUMP_BOUNDARY_PHASES = new Set<ReplayFramePhase>([
  'setup',
  'result',
  'quarterReview',
  'won',
  'lost',
]);

function hydratedPhase(
  keyframe: Pick<ReplayKeyframe, 'frame'> | undefined,
): ReplayFramePhase | undefined {
  return keyframe?.frame.phase;
}

/**
 * 現在のキーフレームより後で、指定 phase の最初の index。無ければ null。
 * hydrate される `frame.phase` で判定し、次の result／編成／四半期／終端は越えない。
 */
export function findNextReplayKeyframeIndex(
  keyframes: readonly Pick<ReplayKeyframe, 'phase' | 'frame'>[],
  currentIndex: number,
  phase: ReplayFramePhase,
): number | null {
  const start = Number.isFinite(currentIndex) ? Math.floor(currentIndex) + 1 : 0;
  for (let i = Math.max(0, start); i < keyframes.length; i += 1) {
    const actual = hydratedPhase(keyframes[i]);
    if (actual === phase) return i;
    if (actual && JUMP_BOUNDARY_PHASES.has(actual)) return null;
  }
  return null;
}
