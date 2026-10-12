import { describe, expect, it } from 'vitest';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyFeatureUpkeep as apply,
  chooseUpkeepAction,
  compareFeatureUpkeep,
  createFeatureUpkeep as create,
  summarizeFeatureUpkeep,
  viewFeatureUpkeep,
} from './featureUpkeep';
import comparison from '../../docs/prototypes/feature-upkeep-comparison.json';

describe('RI-234 機能が生む保守', () => {
  it('完成前の保守は0で、負荷の単価と罰則を操作前に示す', () => {
    const first = create('RI-234', 'light');
    expect(create('RI-234', 'light')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    const before = structuredClone(first);
    const blank = viewFeatureUpkeep(first);
    for (let i = 0; i < 8; i++) expect(viewFeatureUpkeep(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      board: 'light',
      upkeepRate: 1,
      shortfallPenalty: 1,
      featureValue: 6,
      obligation: 0,
      features: [
        { id: 'api', remaining: 4, complete: false, maintenance: 0 },
        { id: 'screen', remaining: 4, complete: false, maintenance: 0 },
        { id: 'billing', remaining: 4, complete: false, maintenance: 0 },
      ],
    });
    expect(blank).not.toHaveProperty('incident');
    expect(blank).not.toHaveProperty('debt');
    expect(viewFeatureUpkeep(create('RI-234', 'heavy'))).toMatchObject({
      upkeepRate: 2,
      shortfallPenalty: 4,
      obligation: 0,
    });
  });

  it('完成した次の期間から保守が増え、同じ機能の再投入では増えない', () => {
    const open = create('RI-234', 'heavy');
    expect(apply(open, { type: 'view' })).toBe(open);
    expect(apply(open, { type: 'assign', feature: 'api', maintain: 5 })).toBe(open);
    expect(apply(open, { type: 'assign', feature: 'api', maintain: 1.5 })).toBe(open);
    const completed = apply(open, { type: 'assign', feature: 'api', maintain: 0 });
    expect(completed.completedValue).toBe(6);
    expect(completed.shortfall).toBe(0);
    expect(completed.periods[0]).toEqual({
      tick: 0,
      feature: 'api',
      maintain: 0,
      built: 4,
      completed: true,
      shortfall: 0,
    });
    expect(viewFeatureUpkeep(completed).features[0]).toEqual({
      id: 'api',
      remaining: 0,
      complete: true,
      maintenance: 2,
    });
    const again = apply(completed, { type: 'assign', feature: 'api', maintain: 0 });
    expect(again.completedValue).toBe(6);
    expect(again.shortfall).toBe(2);
    expect(viewFeatureUpkeep(again).features.filter((feature) => feature.maintenance > 0)).toEqual([
      { id: 'api', remaining: 0, complete: true, maintenance: 2 },
    ]);
    expect(again).not.toHaveProperty('incident');
    expect(again).not.toHaveProperty('debt');
    const done = apply(again, { type: 'assign', feature: 'screen', maintain: 0 });
    expect(apply(done, { type: 'assign', feature: 'billing', maintain: 0 })).toBe(done);
  });

  it('成長を急ぐと短期成果が伸び、体制を先にすると次期の余力が残る', () => {
    const rows = compareFeatureUpkeep(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('light', 'rush').result).toMatchObject({
      completedValue: 18,
      shortfall: 3,
      nextSlack: 1,
      score: 15,
      lost: false,
    });
    expect(row('light', 'staff').result).toMatchObject({
      completedValue: 12,
      shortfall: 0,
      nextSlack: 2,
      score: 12,
    });
    expect(row('heavy', 'rush').result).toMatchObject({
      completedValue: 18,
      maintenance: 6,
      nextSlack: -2,
      score: -6,
    });
    expect(row('heavy', 'staff').result).toMatchObject({
      completedValue: 12,
      maintenance: 4,
      nextSlack: 0,
      score: 12,
    });
    expect(row('heavy', 'staff').result.score).toBeGreaterThan(row('heavy', 'rush').result.score);
    expect(row('light', 'rush').result.score).toBeGreaterThan(row('light', 'staff').result.score);
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareFeatureUpkeep(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseUpkeepAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeFeatureUpkeep(live)).toEqual(row.result);
    }
  });
});
