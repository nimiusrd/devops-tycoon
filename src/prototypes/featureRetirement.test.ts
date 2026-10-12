import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyFeatureRetirement as apply,
  chooseRetirementAction,
  compareFeatureRetirement,
  createFeatureRetirement as create,
  summarizeFeatureRetirement,
  viewFeatureRetirement,
} from './featureRetirement';
import comparison from '../../docs/prototypes/feature-retirement-comparison.json';

describe('RI-235 機能の廃止', () => {
  it('廃止前に利用者と重要顧客と保守負荷を示し、両観測で出荷条件の負荷は同じ', () => {
    const first = create('RI-235', 'relied');
    expect(create('RI-235', 'relied')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.respondents).toBe(rosterHeadcount('pioneer'));
    const before = structuredClone(first);
    const blank = viewFeatureRetirement(first);
    for (let i = 0; i < 8; i++) expect(viewFeatureRetirement(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      respondents: 4,
      feature: 'billing',
      users: 1,
      important: 2,
      maintenance: 3,
      activeMaintenance: 3,
      userCost: 2,
      importantCost: 6,
      migrationCostRate: 3,
      recoverPer: 4,
      phase: 'live',
      recovered: 0,
    });
    const unused = viewFeatureRetirement(create('RI-235', 'unused'));
    expect(unused.important).toBe(0);
    expect(unused.users).toBe(blank.users);
    expect(unused.maintenance).toBe(blank.maintenance);
  });

  it('予告と移行では保守も回収も動かず、廃止完了の一度だけ減る', () => {
    const open = create('RI-235', 'relied');
    expect(apply(open, { type: 'migrate' })).toBe(open);
    expect(apply(open, { type: 'view' })).toBe(open);
    const announced = apply(open, { type: 'announce' });
    expect(announced.recovered).toBe(0);
    expect(viewFeatureRetirement(announced).activeMaintenance).toBe(3);
    expect(apply(announced, { type: 'announce' })).toBe(announced);
    expect(apply(announced, { type: 'remove' })).toBe(announced);
    const migrated = apply(announced, { type: 'migrate' });
    expect(migrated.migrationCost).toBe(3);
    expect(migrated.recovered).toBe(0);
    expect(viewFeatureRetirement(migrated).activeMaintenance).toBe(3);
    expect(apply(migrated, { type: 'migrate' })).toBe(migrated);
    const removed = apply(migrated, { type: 'remove' });
    expect(removed.recovered).toBe(12);
    expect(removed.customerLoss).toBe(0);
    expect(viewFeatureRetirement(removed).activeMaintenance).toBe(0);
    expect(apply(removed, { type: 'remove' })).toBe(removed);
    const immediate = apply(open, { type: 'remove' });
    expect(immediate.customerLoss).toBe(14);
    expect(immediate.recovered).toBe(12);
    expect(apply(immediate, { type: 'announce' })).toBe(immediate);
  });

  it('重要顧客がいないときは即廃止、見えるときは段階廃止が上回る', () => {
    const rows = compareFeatureRetirement(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('unused', 'now').result).toMatchObject({
      recovered: 12,
      customerLoss: 2,
      migrationCost: 0,
      nextSlack: 4,
      score: 10,
    });
    expect(row('unused', 'staged').result).toMatchObject({
      recovered: 12,
      customerLoss: 0,
      migrationCost: 3,
      score: 9,
    });
    expect(row('unused', 'keep').result).toMatchObject({
      recovered: 0,
      activeMaintenance: 3,
      nextSlack: 1,
      score: 0,
    });
    expect(row('relied', 'staged').result.score).toBe(9);
    expect(row('relied', 'keep').result.score).toBe(0);
    expect(row('relied', 'now').result).toMatchObject({ customerLoss: 14, score: -2 });
    expect(row('unused', 'staged').inputs).toEqual([
      { type: 'announce' },
      { type: 'migrate' },
      { type: 'remove' },
    ]);
    expect(row('relied', 'now').inputs[0]).toEqual({ type: 'remove' });
    for (const item of rows) {
      expect(item.initial.maintenance).toBe(3);
      expect(item.initial.users).toBe(1);
      expect(item.result.lost).toBe(false);
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareFeatureRetirement(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseRetirementAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeFeatureRetirement(live)).toEqual(row.result);
    }
  });
});
