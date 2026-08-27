import { describe, expect, it } from 'vitest';
import { isOverlayBackdropTarget, isOverlayDismissKey } from '../../../src/ui/overlayDismiss';

describe('overlayDismiss', () => {
  it('Escape だけを閉じるキーとみなす', () => {
    expect(isOverlayDismissKey('Escape')).toBe(true);
    expect(isOverlayDismissKey('Esc')).toBe(false);
    expect(isOverlayDismissKey('Enter')).toBe(false);
    expect(isOverlayDismissKey('Tab')).toBe(false);
  });

  it('背景クリックは overlay 自身へのヒットだけを対象にする', () => {
    const overlay = { id: 'overlay' };
    const panel = { id: 'panel' };
    expect(isOverlayBackdropTarget(overlay, overlay)).toBe(true);
    expect(isOverlayBackdropTarget(panel, overlay)).toBe(false);
    expect(isOverlayBackdropTarget(null, overlay)).toBe(false);
  });
});
