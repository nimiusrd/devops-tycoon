import { describe, expect, it } from 'vitest';
import type { Lane } from '../../../src/sim/types';
import {
  BOARD_CHARACTER_ASSETS,
  DEPT_CHARACTER_ASSETS,
  ORG_CHARACTER_ROSTER,
  deptAssetForLane,
  gameAssetMoodStyle,
  orgAssetForSlot,
  stationAssetForLane,
} from '../../../src/render/gameAssetView';

describe('game asset view mapping (RI-92)', () => {
  it('工程の職能割当を固定する', () => {
    const lanes: Lane[] = ['backlog', 'coding', 'review', 'rework', 'done'];
    expect(lanes.map(stationAssetForLane)).toEqual([
      'product-oracle',
      'platform-architect',
      'qa-alchemist',
      'incident-commander',
      'release-captain',
    ]);
    expect(BOARD_CHARACTER_ASSETS).toEqual({
      backlog: 'product-oracle',
      coding: 'platform-architect',
      review: 'qa-alchemist',
      rework: 'incident-commander',
      done: 'release-captain',
    });
  });

  it('組織ロスターは人数を保ったまま循環する', () => {
    expect(ORG_CHARACTER_ROSTER).toEqual([
      'product-oracle',
      'platform-architect',
      'qa-alchemist',
      'sre-ranger',
    ]);
    expect([0, 1, 2, 3, 4, 5].map(orgAssetForSlot)).toEqual([
      'product-oracle',
      'platform-architect',
      'qa-alchemist',
      'sre-ranger',
      'product-oracle',
      'platform-architect',
    ]);
    expect(DEPT_CHARACTER_ASSETS).toEqual({ coding: 'platform-architect', review: 'qa-alchemist' });
    expect(deptAssetForLane('done')).toBeUndefined();
  });

  it('全気分状態を決定的な静的演出へ変換する', () => {
    const moods = ['neutral', 'happy', 'cheer', 'tired', 'exhausted', 'panic', 'sad'] as const;
    for (const mood of moods) {
      const style = gameAssetMoodStyle(mood);
      expect(style.className).toBe(mood);
      expect(style.alpha).toBeGreaterThan(0);
      expect(style.tint).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(gameAssetMoodStyle('panic').marker).toBe('💢');
    expect(gameAssetMoodStyle('exhausted').alpha).toBeLessThan(gameAssetMoodStyle('neutral').alpha);
  });
});
