import { describe, expect, it } from 'vitest';
import {
  COMBO_HUD_SHOW_FROM,
  isComboHudVisible,
  liveComboCount,
  shouldShowLiveComboHint,
} from '../../../src/render/sprintComboView';
import type { SprintEvent } from '../../../src/sim/types';

const breakEvent = (tick: number): SprintEvent => ({
  tick,
  kind: 'combo-break',
  reason: 'auto-contain',
  taskId: 1,
});

describe('liveComboCount（#357）', () => {
  it('進行中は metrics.combo を現在値として返す', () => {
    expect(liveComboCount({ complete: false, metrics: { combo: 12 } })).toBe(12);
    expect(liveComboCount({ complete: false, metrics: { combo: 0 } })).toBe(0);
  });

  it('完了したスプリントはドラフト背景でも現在値 0 にする', () => {
    expect(liveComboCount({ complete: true, metrics: { combo: 12 } })).toBe(0);
    expect(liveComboCount({ complete: true, metrics: { combo: 1 } })).toBe(0);
  });
});

describe('isComboHudVisible', () => {
  it('閾値未満は非表示、以上は表示', () => {
    expect(COMBO_HUD_SHOW_FROM).toBe(2);
    expect(isComboHudVisible(0)).toBe(false);
    expect(isComboHudVisible(1)).toBe(false);
    expect(isComboHudVisible(2)).toBe(true);
    expect(isComboHudVisible(12)).toBe(true);
  });
});

describe('shouldShowLiveComboHint', () => {
  it('直近に途切れがあり現在値が残っているときだけ今の段数を出す', () => {
    expect(shouldShowLiveComboHint(12, [breakEvent(8)])).toBe(true);
    expect(shouldShowLiveComboHint(0, [breakEvent(8)])).toBe(false);
    expect(shouldShowLiveComboHint(1, [breakEvent(8)])).toBe(false);
    expect(shouldShowLiveComboHint(12, [])).toBe(false);
    expect(
      shouldShowLiveComboHint(12, [{ tick: 3, kind: 'ignite', taskId: 0, source: 'review' }]),
    ).toBe(false);
  });

  it('途切れが直近ウィンドウから落ちていれば出さない', () => {
    const events: SprintEvent[] = [
      breakEvent(1),
      ...Array.from(
        { length: 5 },
        (_, i): SprintEvent => ({
          tick: i + 2,
          kind: 'ignite',
          taskId: i,
          source: 'review',
        }),
      ),
    ];
    expect(shouldShowLiveComboHint(12, events, 5)).toBe(false);
  });
});
