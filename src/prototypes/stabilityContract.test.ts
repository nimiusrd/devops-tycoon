import { describe, expect, it } from 'vitest';
import { rosterHeadcount } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyStabilityContract as apply,
  chooseContractAction,
  compareStabilityContracts,
  createStabilityContract as create,
  summarizeStabilityContract,
  viewStabilityContract,
} from './stabilityContract';
import comparison from '../../docs/prototypes/stability-contract-comparison.json';

describe('RI-236 安定運用の契約', () => {
  it('契約前に確保枠、報酬、違反の影響を示し、閲覧では期間が動かない', () => {
    const first = create('RI-236', 'strict');
    expect(create('RI-236', 'strict')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.respondents).toBe(rosterHeadcount('keeper'));
    const before = structuredClone(first);
    const blank = viewStabilityContract(first);
    for (let i = 0; i < 8; i++) expect(viewStabilityContract(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      respondents: 4,
      segment: 'keeper',
      reserve: 2,
      reward: 4,
      penalty: 10,
      featureValue: 12,
      budget: 0,
      features: [
        { id: 'api', remaining: 4, complete: false },
        { id: 'screen', remaining: 4, complete: false },
        { id: 'billing', remaining: 4, complete: false },
      ],
    });
    expect(viewStabilityContract(create('RI-236', 'calm')).penalty).toBe(1);
  });

  it('期間の達成は一度だけ報酬になり、余力を全部守っても報酬は増えない', () => {
    const open = create('RI-236', 'calm');
    expect(apply(open, { type: 'assign', feature: 'api', maintain: 5 })).toBe(open);
    expect(apply(open, { type: 'assign', feature: 'api', maintain: 1.5 })).toBe(open);
    const guarded = apply(open, { type: 'assign', feature: 'api', maintain: 4 });
    expect(guarded.budget).toBe(4);
    expect(guarded.rewards).toBe(1);
    expect(guarded.breaches).toBe(0);
    expect(guarded.features[0].done).toBe(0);
    const missed = apply(open, { type: 'assign', feature: 'api', maintain: 1 });
    expect(missed.budget).toBe(-1);
    expect(missed.rewards).toBe(0);
    expect(missed.breaches).toBe(1);
    expect(missed.features[0].complete).toBe(false);
    expect(missed.features[0].done).toBe(3);
    const done = apply(apply(missed, { type: 'assign', feature: 'screen', maintain: 0 }), {
      type: 'assign',
      feature: 'billing',
      maintain: 0,
    });
    expect(done.rewards).toBe(0);
    expect(apply(done, { type: 'assign', feature: 'api', maintain: 2 })).toBe(done);
  });

  it('違反が軽いときは新機能、重いときは安定枠の確保が予算で上回る', () => {
    const rows = compareStabilityContracts(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('calm', 'steady').result).toMatchObject({
      budget: 24,
      rewards: 3,
      breaches: 0,
      path: [4, 20, 24],
      completed: ['api'],
      score: 24,
    });
    expect(row('calm', 'rush').result).toMatchObject({
      budget: 33,
      rewards: 0,
      breaches: 3,
      path: [11, 22, 33],
      completed: ['api', 'screen', 'billing'],
      score: 33,
    });
    expect(row('strict', 'steady').result.score).toBe(24);
    expect(row('strict', 'rush').result).toMatchObject({
      budget: 6,
      path: [2, 4, 6],
      breaches: 3,
      score: 6,
    });
    expect(row('calm', 'rush').result.score).toBeGreaterThan(row('calm', 'steady').result.score);
    expect(row('strict', 'steady').result.score).toBeGreaterThan(
      row('strict', 'rush').result.score,
    );
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareStabilityContracts(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseContractAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeStabilityContract(live)).toEqual(row.result);
    }
  });
});
