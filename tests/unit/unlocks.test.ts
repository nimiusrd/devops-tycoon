import { describe, expect, it } from 'vitest';
import {
  eventDirectGrantIds,
  getUnlock,
  metaUnlockContentIds,
  UNLOCK_DEFS,
} from '../../src/data/unlocks';
import { UNLOCK_COST_RANGE } from './helpers/metaRewardRanges';

describe('メタ解放とイベント直接付与の整合（spec-mapping §2 M7）', () => {
  it('メタ解放対象 ID がイベント直接付与 ID と重複しない', () => {
    const grants = eventDirectGrantIds();
    const locked = metaUnlockContentIds();
    for (const id of locked.cards) {
      expect(grants.cards).not.toContain(id);
    }
    for (const id of locked.relics) {
      expect(grants.relics).not.toContain(id);
    }
  });
});

describe('UNLOCK_DEFS 整合（RI-18）', () => {
  it('解放 ID と contentId が重複しない', () => {
    const ids = UNLOCK_DEFS.map((u) => u.id);
    const contentIds = UNLOCK_DEFS.map((u) => u.contentId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(contentIds).size).toBe(contentIds.length);
  });

  it('コストが許容レンジ内', () => {
    for (const unlock of UNLOCK_DEFS) {
      expect(unlock.cost).toBeGreaterThanOrEqual(UNLOCK_COST_RANGE.min);
      expect(unlock.cost).toBeLessThanOrEqual(UNLOCK_COST_RANGE.max);
    }
  });

  it('card と relic の両方が存在する', () => {
    expect(UNLOCK_DEFS.some((u) => u.kind === 'card')).toBe(true);
    expect(UNLOCK_DEFS.some((u) => u.kind === 'relic')).toBe(true);
  });

  it('getUnlock で全 ID が引ける', () => {
    for (const unlock of UNLOCK_DEFS) {
      expect(getUnlock(unlock.id)).toEqual(unlock);
    }
  });

  it('RI-28″: 高コスト解放にレビュー実績の前提が付いている', () => {
    expect(getUnlock('unlock-devin')?.requires).toBe('review-exceeded');
    expect(getUnlock('unlock-hire-senior')?.requires).toBe('review-survivor');
  });
});
