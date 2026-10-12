import { describe, expect, it } from 'vitest';
import { applyFeatureWork } from './productGrowth';
import {
  applyStagedDelivery as apply,
  chooseDeliveryAction,
  compareStagedDeliveries,
  createStagedDelivery as create,
  summarizeStagedDelivery,
  viewStagedDelivery,
} from './stagedDelivery';
import comparison from '../../docs/prototypes/staged-delivery-comparison.json';

describe('RI-238 段階納品', () => {
  it('核と追加の完成条件と確認費用を示し、閲覧では納品しない', () => {
    const first = create('RI-238', 'tight');
    expect(create('RI-238', 'tight')).toEqual(first);
    expect(applyFeatureWork(0, 4, 4)).toMatchObject({ done: 4, completed: true, accepted: 4 });
    const before = structuredClone(first);
    const blank = viewStagedDelivery(first);
    for (let i = 0; i < 8; i++) expect(viewStagedDelivery(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(blank).toMatchObject({
      tick: 0,
      horizon: 2,
      capacity: 4,
      mode: null,
      reviewCost: 3,
      earliestCoreTick: 1,
      value: 0,
      reviews: 0,
      core: { remaining: 4, complete: false, delivered: false, value: 12 },
      extra: { remaining: 4, complete: false, delivered: false, value: 8 },
    });
    expect(viewStagedDelivery(create('RI-238', 'short')).horizon).toBe(1);
  });

  it('未完成の核からは報酬が出ず、先行した核は最終納品で再び足さない', () => {
    const open = create('RI-238', 'tight');
    expect(apply(open, { type: 'work' })).toBe(open);
    expect(apply(open, { type: 'deliver' })).toBe(open);
    const staged = apply(open, { type: 'choose', mode: 'staged' });
    expect(apply(staged, { type: 'choose', mode: 'lump' })).toBe(staged);
    expect(apply(staged, { type: 'deliver' })).toBe(staged);
    const coreDone = apply(staged, { type: 'work' });
    expect(coreDone.parts[0]).toMatchObject({ done: 4, delivered: false });
    expect(coreDone.parts[1].done).toBe(0);
    const coreShipped = apply(coreDone, { type: 'deliver' });
    expect(coreShipped.value).toBe(9);
    expect(coreShipped.reviews).toBe(1);
    expect(apply(coreShipped, { type: 'deliver' })).toBe(coreShipped);
    const both = apply(apply(coreShipped, { type: 'work' }), { type: 'deliver' });
    expect(both.value).toBe(14);
    expect(both.parts[0].delivered).toBe(true);
    expect(both.parts[1]).toMatchObject({ done: 4, delivered: true });
    expect(apply(both, { type: 'deliver' })).toBe(both);
    expect(apply(both, { type: 'work' })).toBe(both);
    const lump = apply(
      apply(apply(apply(open, { type: 'choose', mode: 'lump' }), { type: 'work' }), {
        type: 'work',
      }),
      { type: 'deliver' },
    );
    expect(lump.value).toBe(17);
    expect(lump.reviews).toBe(1);
    expect(apply(lump, { type: 'deliver' })).toBe(lump);
  });

  it('期限内に両方終わるときは一括、1期間では核だけの先行納品が成果で上回る', () => {
    const rows = compareStagedDeliveries(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, mode: string) =>
      rows.find((item) => item.board === board && item.mode === mode)!;
    expect(row('tight', 'lump').result).toMatchObject({
      value: 17,
      reviews: 1,
      reviewSpend: 3,
      carry: 0,
      coreDelivered: true,
      extraDelivered: true,
      score: 17,
    });
    expect(row('tight', 'staged').result).toMatchObject({
      value: 14,
      reviews: 2,
      reviewSpend: 6,
      carry: 0,
      score: 14,
    });
    expect(row('short', 'lump').result).toMatchObject({
      value: 0,
      reviews: 0,
      carry: 4,
      coreDelivered: false,
      extraDelivered: false,
      score: 0,
    });
    expect(row('short', 'staged').result).toMatchObject({
      value: 9,
      reviews: 1,
      reviewSpend: 3,
      carry: 4,
      coreDelivered: true,
      extraDelivered: false,
      score: 9,
    });
    expect(row('tight', 'lump').result.score).toBeGreaterThan(row('tight', 'staged').result.score);
    expect(row('short', 'staged').result.score).toBeGreaterThan(row('short', 'lump').result.score);
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareStagedDeliveries(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseDeliveryAction(previous, row.mode)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeStagedDelivery(live)).toEqual(row.result);
    }
  });
});
