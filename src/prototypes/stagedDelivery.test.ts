import { describe, expect, it } from 'vitest';
import { applyFeatureWork } from './productGrowth';
import {
  applyStagedDelivery as apply,
  chooseDeliveryAction,
  compareStagedDeliveries,
  compareStagedDeliveryFactors,
  createStagedDelivery as create,
  summarizeStagedDelivery,
  viewStagedDelivery,
} from './stagedDelivery';
import comparison from '../../docs/prototypes/staged-delivery-comparison.json';
import sensitivity from '../../docs/prototypes/staged-delivery-sensitivity.json';

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

  it('可変の核の納品可能時点を示し、期限内に未完成なら核も持ち越す', () => {
    let state = create('RI-238', 'tight', { coreNeed: 9 });
    expect(viewStagedDelivery(state).earliestCoreTick).toBe(3);
    state = apply(state, { type: 'choose', mode: 'staged' });
    for (let i = 0; i < 2; i++) {
      state = apply(state, { type: 'work' });
      expect(apply(state, { type: 'deliver' })).toBe(state);
    }
    expect(state.parts.map(({ done }) => done)).toEqual([8, 0]);
    expect(summarizeStagedDelivery(state)).toMatchObject({ value: 0, reviews: 0, carry: 5 });
    expect(apply(state, { type: 'work' })).toBe(state);
    expect(viewStagedDelivery(create('RI-238', 'short', { coreNeed: 5 })).earliestCoreTick).toBe(2);
  });

  it('比較係数の負値・非整数・非有限値を拒否する', () => {
    for (const reviewCost of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => create('RI-238', 'tight', { reviewCost })).toThrow();
    for (const coreNeed of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => create('RI-238', 'tight', { coreNeed })).toThrow();
    expect(create('RI-238', 'tight', { reviewCost: 0 }).reviewCost).toBe(0);
  });

  it('確認費用・核の必要作業を独立に動かし、同点・赤字・成果成立境界を再計算する', () => {
    const actual = compareStagedDeliveryFactors(sensitivity.seed);
    expect(actual).toEqual(sensitivity);
    expect(compareStagedDeliveryFactors(sensitivity.seed)).toEqual(actual);
    expect(actual).toMatchObject({ humanPlay: false, adaptive: false });
    expect(actual.results).toHaveLength(26);
    for (const row of actual.results) {
      const { coreNeed, reviewCost } = row.coefficients;
      expect(row.coefficients[row.factor]).toBe(row.level);
      expect(row.coefficients[row.factor === 'coreNeed' ? 'reviewCost' : 'coreNeed']).toBe(
        row.factor === 'coreNeed' ? 3 : 4,
      );
      const coreTicks = Math.ceil(coreNeed / 4);
      const coreDone = coreTicks <= row.initial.horizon;
      const extraDone = coreTicks + 1 <= row.initial.horizon;
      const coreCarry = Math.max(0, coreNeed - 4 * row.initial.horizon);
      const extraCarry = extraDone ? 0 : 4;
      for (const outcome of row.outcomes) {
        const staged = outcome.mode === 'staged';
        const reviews = staged ? Number(coreDone) + Number(extraDone) : Number(extraDone);
        const grossValue = staged
          ? Number(coreDone) * 12 + Number(extraDone) * 8
          : Number(extraDone) * 20;
        expect(outcome.result).toMatchObject({
          value: grossValue - reviews * reviewCost,
          reviewSpend: reviews * reviewCost,
          reviews,
          grossValue,
          carry: coreCarry + extraCarry,
          coreCarry,
          extraCarry,
          coreComplete: coreDone,
          extraComplete: extraDone,
          coreDelivered: staged ? coreDone : extraDone,
          extraDelivered: extraDone,
        });
      }
    }
    const find = (factor: 'reviewCost' | 'coreNeed', level: number, board: 'tight' | 'short') =>
      actual.results.find(
        (row) => row.factor === factor && row.level === level && row.board === board,
      )!;
    expect(find('reviewCost', 0, 'tight').comparison).toMatchObject({ winner: 'tie', valueGap: 0 });
    expect(find('reviewCost', 3, 'tight').comparison).toMatchObject({
      winner: 'lump',
      valueGap: -3,
      additionalReviewSpend: 3,
    });
    expect(find('reviewCost', 3, 'short').comparison).toMatchObject({
      winner: 'staged',
      valueGap: 9,
      additionalReviewSpend: 3,
    });
    expect(find('reviewCost', 12, 'short').comparison.winner).toBe('tie');
    expect(find('reviewCost', 13, 'short').comparison.winner).toBe('lump');
    expect(find('reviewCost', 10, 'tight').outcomes[1].result.value).toBe(0);
    expect(find('reviewCost', 20, 'tight').outcomes[0].result.value).toBe(0);
    expect(find('reviewCost', 21, 'tight').outcomes[0].result.value).toBe(-1);
    expect(find('coreNeed', 4, 'tight').comparison.winner).toBe('lump');
    expect(find('coreNeed', 5, 'tight').comparison.winner).toBe('staged');
    expect(find('coreNeed', 8, 'tight').comparison.winner).toBe('staged');
    expect(find('coreNeed', 9, 'tight').comparison.winner).toBe('tie');
    expect(find('coreNeed', 4, 'short').comparison.winner).toBe('staged');
    expect(find('coreNeed', 5, 'short').comparison.winner).toBe('tie');
  });

  it('感度比較の全入力を再生し、毎入力JSON保存再開・閲覧不変・一度だけの納品を確認する', () => {
    for (const row of compareStagedDeliveryFactors(sensitivity.seed).results) {
      expect(row.initial).toEqual(create(sensitivity.seed, row.board, row.coefficients));
      for (const outcome of row.outcomes) {
        let live = row.initial;
        let saved = structuredClone(live);
        for (const input of outcome.inputs) {
          const previous = live;
          const before = structuredClone(previous);
          expect(chooseDeliveryAction(previous, outcome.mode)).toEqual(input);
          viewStagedDelivery(previous);
          expect(apply(previous, { type: 'view' })).toBe(previous);
          live = apply(previous, input);
          saved = apply(JSON.parse(JSON.stringify(saved)), input);
          expect(previous).toEqual(before);
          expect(saved).toEqual(live);
          if (!live.parts[0].delivered) expect(live.value).toBe(0);
        }
        expect(summarizeStagedDelivery(live)).toMatchObject({
          value: outcome.result.value,
          reviews: outcome.result.reviews,
          reviewSpend: outcome.result.reviewSpend,
          carry: outcome.result.carry,
          coreDelivered: outcome.result.coreDelivered,
          extraDelivered: outcome.result.extraDelivered,
        });
        expect(live.reviews).toBeLessThanOrEqual(outcome.mode === 'lump' ? 1 : 2);
        expect(apply(live, { type: 'deliver' })).toBe(live);
        expect(apply(live, { type: 'work' })).toBe(live);
        expect(row.comparison.carryGap).toBe(0);
      }
    }
  });
});
