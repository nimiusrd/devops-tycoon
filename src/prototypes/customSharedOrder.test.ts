import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyCustomSharedOrder as apply,
  applyOrderSpend,
  chooseOrderSpend,
  compareCustomSharedOrders,
  createCustomSharedOrder as create,
  summarizeCustomSharedOrder,
  viewCustomSharedOrder,
} from './customSharedOrder';
import comparison from '../../docs/prototypes/custom-shared-order-comparison.json';

describe('RI-230 個別受注と共通機能', () => {
  it('対象人数、報酬、必要作業、初期の支払と保守余力を操作前に示す', () => {
    const first = create('RI-230', 'cash');
    expect(create('RI-230', 'cash')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.sharedReach).toBe(rosterHeadcount('pioneer'));
    const before = structuredClone(first);
    const blank = viewCustomSharedOrder(first);
    for (let i = 0; i < 8; i++) expect(viewCustomSharedOrder(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      custom: { remaining: 4, reward: 12, reach: 1, upkeep: 3, paid: false },
      shared: { remaining: 6, reward: 4, reach: 4, upkeep: 1, paid: false },
      earlyBill: 10,
      missPenalty: 8,
      slack: 1,
      upkeepWeight: 0,
    });
    expect(viewCustomSharedOrder(create('RI-230', 'upkeep'))).toMatchObject({
      earlyBill: 0,
      upkeepWeight: 4,
    });
  });

  it('同じ機能の報酬と到達は一度だけ、余った作業はもう一方へ移らない', () => {
    const fresh = create('RI-230', 'cash');
    expect(applyOrderSpend(fresh, { custom: 3, shared: 0 })).toBe(fresh);
    const custom = apply(fresh, { type: 'spend', spend: { custom: 4, shared: 0 } });
    expect(custom.cash).toBe(12);
    expect(custom.servedCustom).toBe(1);
    expect(custom.missedBill).toBe(false);
    const again = apply(custom, { type: 'spend', spend: { custom: 4, shared: 0 } });
    expect(again.cash).toBe(12);
    expect(again.servedCustom).toBe(1);
    const shared = apply(create('RI-230', 'upkeep'), {
      type: 'spend',
      spend: { custom: 0, shared: 4 },
    });
    const sharedDone = apply(shared, { type: 'spend', spend: { custom: 0, shared: 4 } });
    expect(sharedDone.cash).toBe(4);
    expect(sharedDone.servedShared).toBe(4);
    const sharedAgain = apply(sharedDone, { type: 'spend', spend: { custom: 0, shared: 4 } });
    expect(sharedAgain.cash).toBe(4);
    expect(sharedAgain.servedShared).toBe(4);
    expect(apply(sharedAgain, { type: 'view' })).toBe(sharedAgain);
  });

  it('資金が乏しい盤面は個別先行、保守余力が少ない盤面は共通先行が上回る', () => {
    const rows = compareCustomSharedOrders(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([
      score('cash', 'customFirst'),
      score('cash', 'customOnly'),
      score('cash', 'sharedFirst'),
    ]).toEqual([16, 12, 8]);
    expect([
      score('upkeep', 'sharedFirst'),
      score('upkeep', 'customFirst'),
      score('upkeep', 'customOnly'),
    ]).toEqual([4, -12, -12]);
    const early = rows.find((row) => row.board === 'cash' && row.strategy === 'customFirst')!;
    const late = rows.find((row) => row.board === 'cash' && row.strategy === 'sharedFirst')!;
    expect(early.result.cash).toBe(late.result.cash);
    expect(early.result.servedCustom).toBe(1);
    expect(early.result.servedShared).toBe(4);
    expect(late.result.miss).toBe(8);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareCustomSharedOrders(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseOrderSpend(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeCustomSharedOrder(live)).toEqual(row.result);
    }
  });
});
