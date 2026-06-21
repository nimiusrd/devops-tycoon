/**
 * レンダラ選択フラグの検証（SPEC 第22.4）。
 * 既定は DOM、`?renderer=pixi` のときだけ Pixi。CI/通常プレイは DOM のまま。
 */
import { describe, expect, it } from 'vitest';
import { getRendererKind } from '../../src/render/adapters/selectRenderer';

describe('getRendererKind', () => {
  it('未指定・空文字は dom（既定）', () => {
    expect(getRendererKind()).toBe('dom');
    expect(getRendererKind('')).toBe('dom');
    expect(getRendererKind('?seed=42')).toBe('dom');
  });

  it('?renderer=pixi のときだけ pixi', () => {
    expect(getRendererKind('?renderer=pixi')).toBe('pixi');
    expect(getRendererKind('?seed=42&renderer=pixi')).toBe('pixi');
  });

  it('不明値は dom にフォールバックする', () => {
    expect(getRendererKind('?renderer=webgpu')).toBe('dom');
    expect(getRendererKind('?renderer=')).toBe('dom');
  });
});
