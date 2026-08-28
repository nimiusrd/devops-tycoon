import { describe, expect, it } from 'vitest';
import { isOverlayDismissKey } from '../../../src/ui/overlayDismiss';

describe('overlayDismiss', () => {
  it('Escape だけを閉じるキーとみなす', () => {
    expect(isOverlayDismissKey('Escape')).toBe(true);
    expect(isOverlayDismissKey('Esc')).toBe(false);
    expect(isOverlayDismissKey('Enter')).toBe(false);
    expect(isOverlayDismissKey('Tab')).toBe(false);
  });
});
