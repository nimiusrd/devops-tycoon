import { describe, expect, it } from 'vitest';
import {
  getIconUrl,
  ICON_CATALOG,
  ICON_KEYS,
  isIconKey,
  resolveIconKey,
} from '../../../src/render/visualIcons';

describe('visualIcons', () => {
  it('意味キーごとに SVG 実体と既存トーンを持つ', () => {
    expect(ICON_KEYS.length).toBeGreaterThan(0);
    for (const key of ICON_KEYS) {
      const entry = ICON_CATALOG[key];
      expect(entry.file).toMatch(/^[a-z0-9-]+\.svg$/);
      expect(getIconUrl(key)).toContain(`assets/icons/${entry.file}`);
    }
    expect(ICON_CATALOG.pace).toEqual({ file: 'pace.svg', tone: 'sky' });
    expect(ICON_CATALOG.focus.file).not.toBe(ICON_CATALOG.pace.file);
  });

  it('未知キーは集中力へ寄せ、絵文字フォールバックを出さない', () => {
    expect(isIconKey('fire')).toBe(true);
    expect(isIconKey('🔥')).toBe(false);
    expect(resolveIconKey('🔥')).toBe('focus');
    expect(resolveIconKey(undefined, 'delivery')).toBe('delivery');
    expect(resolveIconKey('interruptReview')).toBe('interruptReview');
  });
});
