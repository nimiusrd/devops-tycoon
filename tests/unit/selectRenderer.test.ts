/**
 * レンダラ選択フラグの検証（SPEC 第22.4）。
 * 既定は Pixi（WebGL）、`?renderer=dom` のときだけ DOM/SVG フォールバック。
 * CI の既定 E2E は renderer=dom を明示して実 WebGL を回さない（§4.2）。
 */
import { describe, expect, it } from 'vitest';
import { getRendererKind } from '../../src/render/adapters/selectRenderer';

describe('getRendererKind', () => {
  it('未指定・空文字は pixi（既定）', () => {
    expect(getRendererKind()).toBe('pixi');
    expect(getRendererKind('')).toBe('pixi');
    expect(getRendererKind('?seed=42')).toBe('pixi');
  });

  it('?renderer=dom のときだけ dom フォールバック', () => {
    expect(getRendererKind('?renderer=dom')).toBe('dom');
    expect(getRendererKind('?seed=42&renderer=dom')).toBe('dom');
  });

  it('?renderer=pixi の明示も引き続き有効', () => {
    expect(getRendererKind('?renderer=pixi')).toBe('pixi');
  });

  it('不明値は pixi にフォールバックする', () => {
    expect(getRendererKind('?renderer=webgpu')).toBe('pixi');
    expect(getRendererKind('?renderer=')).toBe('pixi');
  });
});
