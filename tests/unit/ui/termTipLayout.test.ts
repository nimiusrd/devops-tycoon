import { describe, expect, it } from 'vitest';
import {
  isTermPanelFullyVisible,
  termPanelReserve,
  SETUP_TERM_PANEL_GAP_PX,
} from '../../../src/ui/termTipLayout';

describe('termTipLayout', () => {
  it('パネルの高さに間隔を足して、端数は切り上げる', () => {
    expect(termPanelReserve(48)).toBe(`${48 + SETUP_TERM_PANEL_GAP_PX}px`);
    expect(termPanelReserve(47.2)).toBe(`${Math.ceil(47.2 + SETUP_TERM_PANEL_GAP_PX)}px`);
  });

  it('ビューポートとスクロール枠の両方に収まっているときだけ見える', () => {
    const viewport = { top: 0, right: 390, bottom: 844, left: 0 };
    const scroller = { top: 200, right: 380, bottom: 800, left: 10 };
    const visible = { top: 720, right: 360, bottom: 790, left: 20 };
    expect(isTermPanelFullyVisible(visible, [viewport, scroller])).toBe(true);
    expect(isTermPanelFullyVisible({ ...visible, bottom: 866 }, [viewport, scroller])).toBe(false);
    expect(isTermPanelFullyVisible({ ...visible, bottom: 820 }, [viewport, scroller])).toBe(false);
  });
});
