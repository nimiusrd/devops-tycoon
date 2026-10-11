import { describe, expect, it } from 'vitest';
import {
  applyFeatureWork,
  applyProductGrowth as apply,
  applyProductSpend,
  chooseProductSpend,
  compareProductGrowth,
  createProductGrowth as create,
  summarizeProductGrowth,
  viewProductGrowth,
} from './productGrowth';
import comparison from '../../docs/prototypes/product-growth-comparison.json';

describe('RI-228 製品が育つ機能', () => {
  it('未完了の残量と、運用を空けたときの事故を操作前に示す', () => {
    const first = create('RI-228', 'blocked');
    expect(create('RI-228', 'blocked')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewProductGrowth(first);
    for (let i = 0; i < 8; i++) expect(viewProductGrowth(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      incidentIfSkipOps: 6,
      features: [
        { id: 'api', remaining: 5, complete: false },
        { id: 'screen', remaining: 5, complete: false },
        { id: 'billing', remaining: 5, complete: false },
      ],
      ready: [],
    });
    expect(viewProductGrowth(create('RI-228', 'open')).incidentIfSkipOps).toBe(0);
  });

  it('閾値を跨いだ一度だけ完成し、端数と余力の横流しでは機能が増えない', () => {
    const fresh = create('RI-228', 'open');
    expect(applyFeatureWork(5, 5, 4)).toEqual({ done: 5, completed: false, accepted: 0 });
    expect(applyProductSpend(fresh, { api: 3, screen: 0, billing: 0, ops: 0 })).toBe(fresh);
    const partial = apply(fresh, {
      type: 'spend',
      spend: { api: 4, screen: 0, billing: 0, ops: 0 },
    });
    expect(partial.features[0]).toMatchObject({ done: 4, complete: false });
    expect(summarizeProductGrowth(partial).completed).toEqual([]);
    const done = apply(partial, {
      type: 'spend',
      spend: { api: 3, screen: 1, billing: 0, ops: 0 },
    });
    expect(done.features[0]).toMatchObject({ done: 5, complete: true });
    expect(done.features[1]).toMatchObject({ done: 1, complete: false });
    expect(done.completedValue).toBe(8);
    expect(done.shippedWork).toBe(6);
    const again = apply(done, { type: 'spend', spend: { api: 4, screen: 0, billing: 0, ops: 0 } });
    expect(again.completedValue).toBe(8);
    expect(again.shippedWork).toBe(6);
    const blocked = apply(create('RI-228', 'blocked'), {
      type: 'spend',
      spend: { api: 4, screen: 0, billing: 0, ops: 0 },
    });
    expect(blocked.incident).toBe(6);
    expect(apply(blocked, { type: 'view' })).toBe(blocked);
  });

  it('余力がある盤面は機能集中、障害対応が要る盤面は運用枠が上回る', () => {
    const rows = compareProductGrowth(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('open', 'focus'), score('open', 'spread'), score('open', 'ops')]).toEqual([
      16, 8, 8,
    ]);
    expect([
      score('blocked', 'ops'),
      score('blocked', 'focus'),
      score('blocked', 'spread'),
    ]).toEqual([8, -2, -10]);
    const focus = rows.find((row) => row.board === 'open' && row.strategy === 'focus')!;
    const spread = rows.find((row) => row.board === 'open' && row.strategy === 'spread')!;
    expect(focus.result.shippedWork).toBe(spread.result.shippedWork);
    expect(focus.result.completed).toEqual(['api', 'screen']);
    expect(spread.result.completed).toEqual(['api']);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareProductGrowth(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseProductSpend(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeProductGrowth(live)).toEqual(row.result);
    }
  });
});
