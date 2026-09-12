import { describe, expect, it } from 'vitest';
import { ICON_CATALOG } from '../../../src/render/visualIcons';
import { VisualIcon, VisualIconText } from '../../../src/ui/VisualIcon';

describe('VisualIcon', () => {
  it('意味名とサイズを data 属性と mask URL で公開する', () => {
    const icon = VisualIcon({ name: 'fire', size: 'hud' });
    expect(icon.props['data-icon']).toBe('fire');
    expect(icon.props['data-icon-size']).toBe('hud');
    expect(icon.props['aria-hidden']).toBe('true');
    expect(icon.props.className).toContain('visual-icon-hud');
    expect(icon.props.className).toContain(`visual-icon-tone-${ICON_CATALOG.fire.tone}`);
    expect(String(icon.props.style['--visual-icon-mask'])).toContain('assets/icons/fire.svg');
  });

  it('未知キーでも絵文字を描かず fallback アイコンを出す', () => {
    const icon = VisualIcon({ name: '🔥', size: 'card' });
    expect(icon.props['data-icon']).toBe('focus');
    expect(icon.props['data-icon-size']).toBe('card');
  });

  it('ラベル付き表示はアイコンと数値を並べる', () => {
    const labeled = VisualIconText({ name: 'focus', size: 'card', children: 3 });
    expect(labeled.props.className).toBe('visual-icon-text');
    const child = labeled.props.children[0];
    expect(child.props['data-icon']).toBe('focus');
    expect(labeled.props.children[1]).toBe(3);
  });
});
