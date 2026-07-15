/**
 * 全社マップ島アクターの個体集約ヘルパー（RI-27）。
 */
import { describe, expect, it } from 'vitest';
import {
  islandAiBadgeLabel,
  islandAiBotCount,
  islandWorkerCount,
} from '../../src/render/orgBoardScene';

describe('islandWorkerCount (RI-27)', () => {
  it('1〜4 にクランプする', () => {
    expect(islandWorkerCount(0)).toBe(1);
    expect(islandWorkerCount(1)).toBe(1);
    expect(islandWorkerCount(2)).toBe(2);
    expect(islandWorkerCount(3)).toBe(3);
    expect(islandWorkerCount(4)).toBe(4);
    expect(islandWorkerCount(9)).toBe(4);
  });
});

describe('islandAiBotCount (RI-27)', () => {
  it('0 なら描画せず、1〜3 にクランプする', () => {
    expect(islandAiBotCount(0)).toBe(0);
    expect(islandAiBotCount(1)).toBe(1);
    expect(islandAiBotCount(2)).toBe(2);
    expect(islandAiBotCount(3)).toBe(3);
    expect(islandAiBotCount(8)).toBe(3);
  });
});

describe('islandAiBadgeLabel (RI-27)', () => {
  it('配布中は人数を併記し、未配布は依存度のみ', () => {
    expect(islandAiBadgeLabel(55, 0)).toBe('AI 55%');
    expect(islandAiBadgeLabel(55, 2)).toBe('AI 55% · 配布2');
  });
});
