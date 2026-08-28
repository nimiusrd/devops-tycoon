import { describe, expect, it } from 'vitest';
import type { ReplayFramePhase } from '../../../src/sim/run/persist';
import type { ReplayKeyframe } from '../../../src/state/replay';
import {
  findNextReplayKeyframeIndex,
  REPLAY_DRAFT_MISSING_HINT,
} from '../../../src/state/replayJump';

function kf(phase: ReplayFramePhase, framePhase: ReplayFramePhase = phase) {
  return { phase, frame: { phase: framePhase } as ReplayKeyframe['frame'] };
}

describe('findNextReplayKeyframeIndex', () => {
  const keyframes = [kf('setup'), kf('result'), kf('draft'), kf('result'), kf('draft'), kf('won')];

  it('現在の result に続く対応 draft を返す', () => {
    expect(findNextReplayKeyframeIndex(keyframes, 1, 'draft')).toBe(2);
    expect(findNextReplayKeyframeIndex(keyframes, 3, 'draft')).toBe(4);
  });

  it('次の result／終端を越えた draft は返さない', () => {
    expect(findNextReplayKeyframeIndex(keyframes, 0, 'draft')).toBeNull();
    expect(findNextReplayKeyframeIndex(keyframes, 2, 'draft')).toBeNull();
    expect(findNextReplayKeyframeIndex(keyframes, 4, 'draft')).toBeNull();
    expect(findNextReplayKeyframeIndex([kf('result'), kf('result'), kf('draft')], 0, 'draft')).toBe(
      null,
    );
  });

  it('後ろに対象が無ければ null', () => {
    expect(findNextReplayKeyframeIndex(keyframes, 1, 'quarterReview')).toBeNull();
    expect(findNextReplayKeyframeIndex([kf('result')], 0, 'draft')).toBeNull();
  });

  it('hydrate される frame.phase で判定し、ラッパーとの不一致は draft とみなさない', () => {
    const mismatched = [kf('result'), kf('draft', 'result'), kf('draft')];
    expect(findNextReplayKeyframeIndex(mismatched, 0, 'draft')).toBeNull();
    const hydratedDraft = [kf('result'), kf('result', 'draft')];
    expect(findNextReplayKeyframeIndex(hydratedDraft, 0, 'draft')).toBe(1);
  });
});

describe('REPLAY_DRAFT_MISSING_HINT', () => {
  it('現在の結果に対応するドラフトが無いことを説明する', () => {
    expect(REPLAY_DRAFT_MISSING_HINT).toBe(
      'この結果に対応するカードドラフトは記録されていません。',
    );
  });
});
