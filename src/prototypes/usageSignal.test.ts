import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyUsageSignal as apply,
  chooseUsageAction,
  compareUsageSignals,
  createUsageSignal as create,
  summarizeUsageSignal,
  viewUsageSignal,
} from './usageSignal';
import comparison from '../../docs/prototypes/usage-signal-comparison.json';

describe('RI-233 出荷後の利用状況', () => {
  it('操作前は予測と出荷量だけを示し、実際の利用は出さない', () => {
    const first = create('RI-233', 'star');
    expect(create('RI-233', 'star')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.respondents).toBe(rosterHeadcount('pioneer'));
    const before = structuredClone(first);
    const blank = viewUsageSignal(first);
    for (let i = 0; i < 8; i++) expect(viewUsageSignal(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 4,
      capacity: 4,
      respondents: 4,
      features: ['api', 'screen', 'billing'],
      shipVolume: 15,
      shipped: false,
      forecast: { api: 3, screen: 3, billing: 3 },
      observed: false,
      retireValue: 8,
      polishBonus: 1,
      repaired: null,
      collected: false,
    });
    expect(blank).not.toHaveProperty('usage');
    expect(blank).not.toHaveProperty('actual');
    const sleeper = create('RI-233', 'sleeper');
    const blocked = create('RI-233', 'blocked');
    expect(sleeper.shipVolume).toBe(first.shipVolume);
    expect(blocked.shipVolume).toBe(first.shipVolume);
    expect(viewUsageSignal(sleeper).forecast).toEqual(blank.forecast);
    expect(viewUsageSignal(blocked).forecast).toEqual(blank.forecast);
  });

  it('出荷だけでは利用も価値も付かず、観測前の改善と二度目の操作は拒否する', () => {
    const open = create('RI-233', 'blocked');
    expect(apply(open, { type: 'observe' })).toBe(open);
    expect(apply(open, { type: 'repair', feature: 'billing' })).toBe(open);
    expect(apply(open, { type: 'collect' })).toBe(open);
    const shipped = apply(open, { type: 'ship' });
    expect(shipped.shipped).toBe(true);
    expect(shipped.value).toBe(0);
    expect(viewUsageSignal(shipped)).not.toHaveProperty('usage');
    expect(apply(shipped, { type: 'ship' })).toBe(shipped);
    expect(apply(shipped, { type: 'repair', feature: 'billing' })).toBe(shipped);
    expect(apply(shipped, { type: 'extend', feature: 'billing' })).toBe(shipped);
    const seen = apply(shipped, { type: 'observe' });
    const seenView = viewUsageSignal(seen);
    expect('usage' in seenView).toBe(true);
    if (!('usage' in seenView)) throw new Error('observed');
    expect(seenView.usage).toEqual({ api: 1, screen: 3, billing: 0 });
    expect(apply(seen, { type: 'observe' })).toBe(seen);
    expect(apply(seen, { type: 'view' })).toBe(seen);
    const repaired = apply(seen, { type: 'repair', feature: 'billing' });
    expect(repaired.value).toBe(0);
    expect(apply(repaired, { type: 'repair', feature: 'billing' })).toBe(repaired);
    const paid = apply(repaired, { type: 'collect' });
    expect(paid.value).toBe(8);
    expect(apply(paid, { type: 'collect' })).toBe(paid);
  });

  it('同じ出荷量でも、観測した利用によって次の投資の勝者が変わる', () => {
    const rows = compareUsageSignals(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (situation: string, strategy: string) =>
      rows.find((row) => row.situation === situation && row.strategy === strategy)!.result.score;
    expect([score('star', 'skipRead'), score('star', 'extend'), score('star', 'repair')]).toEqual([
      12, 8, 2,
    ]);
    expect([
      score('sleeper', 'extend'),
      score('sleeper', 'skipRead'),
      score('sleeper', 'repair'),
    ]).toEqual([8, 3, 2]);
    expect([
      score('blocked', 'repair'),
      score('blocked', 'extend'),
      score('blocked', 'skipRead'),
    ]).toEqual([8, 6, 3]);
    const volumes = new Set(rows.map((row) => row.initial.shipVolume));
    expect([...volumes]).toEqual([15]);
    const starRepair = rows.find((row) => row.situation === 'star' && row.strategy === 'repair')!;
    expect(starRepair.inputs).toEqual([
      { type: 'ship' },
      { type: 'observe' },
      { type: 'repair', feature: 'screen' },
      { type: 'collect' },
    ]);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareUsageSignals(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseUsageAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeUsageSignal(live)).toEqual(row.result);
    }
  });
});
