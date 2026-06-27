import { describe, expect, it } from 'vitest';
import { eventDirectGrantIds, metaUnlockContentIds } from '../../src/data/unlocks';

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
