import { describe, expect, it } from 'vitest';
import { speedControlButtonHitRect } from '../../../src/ui/speedControlHitTarget';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';

describe('speedControlButtonHitRect', () => {
  it('レイアウトが小さいとき 44px の中央配置矩形に拡げる', () => {
    const layout = {
      left: 100,
      top: 50,
      width: 30,
      height: 22,
      right: 130,
      bottom: 72,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    } as DOMRect;
    const touch = VISUAL_TOKENS.dimensions.interaction.minTouchTargetCss;
    const hit = speedControlButtonHitRect(layout);
    expect(hit.width).toBe(touch);
    expect(hit.height).toBe(touch);
    expect(hit.x).toBe(100 + 15 - touch / 2);
    expect(hit.y).toBe(50 + 11 - touch / 2);
  });

  it('レイアウトが既に 44px 以上ならそのまま使う', () => {
    const layout = {
      left: 0,
      top: 0,
      width: 48,
      height: 44,
      right: 48,
      bottom: 44,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    expect(speedControlButtonHitRect(layout)).toEqual({ x: 0, y: 0, width: 48, height: 44 });
  });
});
