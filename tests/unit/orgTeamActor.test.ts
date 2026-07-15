/**
 * 全社マップ島アクターの個体集約ヘルパー（RI-27）。
 */
import { describe, expect, it } from 'vitest';
import { islandWorkerCount } from '../../src/render/orgBoardScene';

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
