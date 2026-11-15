import { describe, expect, it } from 'vitest';
import {
  createWindowPrototype,
  tickWindowPrototype,
  summarizeWindows,
  compareWindowStrategies,
  compareReleaseFactorReversals,
  type WindowState,
} from './releaseWindows';
import comparison from '../../docs/prototypes/release-windows-comparison.json';
import factors from '../../docs/prototypes/release-windows-factor-comparison.json';
describe('RI-160 リリース便', () => {
  it('レビュー完了を出荷へ加算せず、便のtickで一度だけ公開する', () => {
    const initial = createWindowPrototype('RI-160', 'low');
    const snapshot = structuredClone(initial);
    const one = initial;
    expect(summarizeWindows(one)).toMatchObject({ reviewed: 1, published: 0, value: 0 });
    const two = tickWindowPrototype(one, { holdIds: [] });
    expect(two.tasks[0]).toMatchObject({ publishedTick: 2, value: 10, loss: 2 });
    let state = two;
    while (state.tick < state.horizon) state = tickWindowPrototype(state, { holdIds: [] });
    expect(summarizeWindows(state)).toMatchObject({ published: 1, value: 10 });
    expect(initial).toEqual(snapshot);
  });
  it('最終便を逃した仕事は未出荷の繰越となり、期末以降は無操作', () => {
    let state = createWindowPrototype(1, 'high');
    while (state.tick < state.horizon) state = tickWindowPrototype(state, { holdIds: ['change'] });
    expect(summarizeWindows(state)).toMatchObject({
      published: 0,
      carryover: ['change'],
      value: 0,
    });
    expect(tickWindowPrototype(state, { holdIds: [] })).toBe(state);
  });
  it('無効ID・重複搭載保留・公開済みの確認を無消費で拒否する', () => {
    const state = createWindowPrototype(1, 'high');
    expect(tickWindowPrototype(state, { holdIds: ['unknown'] })).toBe(state);
    expect(tickWindowPrototype(state, { holdIds: ['change', 'change'] })).toBe(state);
    expect(tickWindowPrototype(state, { holdIds: [], verifyId: 'unknown' })).toBe(state);
    const published = tickWindowPrototype(tickWindowPrototype(state, { holdIds: [] }), {
      holdIds: [],
    });
    expect(tickWindowPrototype(published, { holdIds: [], verifyId: 'change' })).toBe(published);
  });
  it('低リスクでは早期便、高リスクでは追加確認が有利となる比較を再現する', () => {
    expect(compareWindowStrategies(comparison.seed)).toEqual(comparison.results);
    const [lowEarly, lowVerify, highEarly, highVerify] = comparison.results;
    expect(lowEarly.result.netValue).toBeGreaterThan(lowVerify.result.netValue);
    expect(highVerify.result.netValue).toBeGreaterThan(highEarly.result.netValue);
    expect(highVerify.result.verificationWork).toBe(2);
  });
  it('便の前後の保存再開・入力再生が一致する', () => {
    for (const row of comparison.results) {
      let live = createWindowPrototype(comparison.seed, row.impact as 'low' | 'high');
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = tickWindowPrototype(live, input);
        restored = tickWindowPrototype(JSON.parse(JSON.stringify(restored)), input);
      }
      expect(restored).toEqual(live);
      expect(summarizeWindows(live)).toEqual(row.result);
    }
  });

  it('要因は初回と同じ資源から一つずつ動き、対照の入力と差引は初回と一致する', () => {
    expect(compareReleaseFactorReversals(factors.seed)).toEqual(factors.results);
    const rows = factors.results;
    const anchor = (
      factor: string,
      parameter: string,
      impact: 'low' | 'high' | null,
      strategy: 'early' | 'verify',
      baseline: 'low' | 'high',
    ) => {
      const row = rows.find(
        (item) =>
          item.factor === factor &&
          item.parameter === parameter &&
          item.impact === impact &&
          item.strategy === strategy,
      );
      const base = comparison.results.find(
        (item) => item.impact === baseline && item.strategy === strategy,
      );
      expect(row?.inputs).toEqual(base?.inputs);
      expect(row?.result).toEqual(base?.result);
      expect(row?.tasks).toEqual(base?.tasks);
    };
    for (const strategy of ['early', 'verify'] as const) {
      anchor('deadline', '2', 'low', strategy, 'low');
      anchor('deadline', '2', 'high', strategy, 'high');
      anchor('riskLoss', '2', null, strategy, 'low');
      anchor('riskLoss', '8', null, strategy, 'high');
      anchor('verificationFailure', '0', 'low', strategy, 'low');
      anchor('verificationFailure', '0', 'high', strategy, 'high');
      anchor('sameDayOrder', 'review1-after', 'low', strategy, 'low');
      anchor('sameDayOrder', 'review1-after', 'high', strategy, 'high');
      anchor('earlyReview', '1', 'low', strategy, 'low');
      anchor('earlyReview', '1', 'high', strategy, 'high');
    }
    const unchanged = rows.find(
      (item) =>
        item.factor === 'deadline' &&
        item.parameter === '2' &&
        item.impact === 'low' &&
        item.strategy === 'early',
    );
    expect(unchanged?.initial).toEqual(comparison.results[0]?.initial);
  });

  it('今出すと次便の優劣が反転する位置を固定戦略で再現する', () => {
    const rows = factors.results;
    const preference = (factor: string, parameter: string, impact: 'low' | 'high' | null) => {
      const early = rows.find(
        (item) =>
          item.factor === factor &&
          item.parameter === parameter &&
          item.impact === impact &&
          item.strategy === 'early',
      );
      const verify = rows.find(
        (item) =>
          item.factor === factor &&
          item.parameter === parameter &&
          item.impact === impact &&
          item.strategy === 'verify',
      );
      expect(early?.result.netValue).toEqual(expect.any(Number));
      expect(verify?.result.netValue).toEqual(expect.any(Number));
      if (early!.result.netValue === verify!.result.netValue) return 'tie';
      return early!.result.netValue > verify!.result.netValue ? 'early' : 'verify';
    };
    const expected = [
      ['deadline', '1', 'low', 'verify'],
      ['deadline', '1', 'high', 'verify'],
      ['deadline', '2', 'low', 'early'],
      ['deadline', '2', 'high', 'verify'],
      ['deadline', '4', 'low', 'early'],
      ['deadline', '4', 'high', 'verify'],
      ['deadline', '5', 'low', 'verify'],
      ['deadline', '5', 'high', 'verify'],
      ['riskLoss', '2', null, 'early'],
      ['riskLoss', '3', null, 'early'],
      ['riskLoss', '4', null, 'tie'],
      ['riskLoss', '5', null, 'verify'],
      ['riskLoss', '8', null, 'verify'],
      ['departure', '2,3', 'low', 'early'],
      ['departure', '2,3', 'high', 'early'],
      ['departure', '2,4', 'low', 'early'],
      ['departure', '2,4', 'high', 'verify'],
      ['departure', '2,6', 'low', 'early'],
      ['departure', '2,6', 'high', 'verify'],
      ['departure', '2,7', 'low', 'early'],
      ['departure', '2,7', 'high', 'early'],
      ['departure', '3,5', 'low', 'verify'],
      ['departure', '3,5', 'high', 'verify'],
      ['departure', '4,5', 'low', 'tie'],
      ['departure', '4,5', 'high', 'tie'],
      ['verificationFailure', '0', 'low', 'early'],
      ['verificationFailure', '2', 'low', 'early'],
      ['verificationFailure', '0', 'high', 'verify'],
      ['verificationFailure', '3', 'high', 'verify'],
      ['verificationFailure', '4', 'high', 'tie'],
      ['verificationFailure', '5', 'high', 'early'],
      ['verificationFailure', '8', 'high', 'early'],
      ['sameDayOrder', 'review1-after', 'low', 'early'],
      ['sameDayOrder', 'review1-after', 'high', 'verify'],
      ['sameDayOrder', 'review2-before', 'low', 'early'],
      ['sameDayOrder', 'review2-before', 'high', 'verify'],
      ['sameDayOrder', 'review2-after', 'low', 'verify'],
      ['sameDayOrder', 'review2-after', 'high', 'verify'],
      ['earlyReview', '1', 'low', 'early'],
      ['earlyReview', '1', 'high', 'verify'],
      ['earlyReview', '0', 'low', 'early'],
      ['earlyReview', '0', 'high', 'early'],
      ['earlyReview', '-1', 'low', 'early'],
      ['earlyReview', '-1', 'high', 'early'],
    ];
    expect(
      [
        ['deadline', '1', 'low'],
        ['deadline', '1', 'high'],
        ['deadline', '2', 'low'],
        ['deadline', '2', 'high'],
        ['deadline', '4', 'low'],
        ['deadline', '4', 'high'],
        ['deadline', '5', 'low'],
        ['deadline', '5', 'high'],
        ['riskLoss', '2', null],
        ['riskLoss', '3', null],
        ['riskLoss', '4', null],
        ['riskLoss', '5', null],
        ['riskLoss', '8', null],
        ['departure', '2,3', 'low'],
        ['departure', '2,3', 'high'],
        ['departure', '2,4', 'low'],
        ['departure', '2,4', 'high'],
        ['departure', '2,6', 'low'],
        ['departure', '2,6', 'high'],
        ['departure', '2,7', 'low'],
        ['departure', '2,7', 'high'],
        ['departure', '3,5', 'low'],
        ['departure', '3,5', 'high'],
        ['departure', '4,5', 'low'],
        ['departure', '4,5', 'high'],
        ['verificationFailure', '0', 'low'],
        ['verificationFailure', '2', 'low'],
        ['verificationFailure', '0', 'high'],
        ['verificationFailure', '3', 'high'],
        ['verificationFailure', '4', 'high'],
        ['verificationFailure', '5', 'high'],
        ['verificationFailure', '8', 'high'],
        ['sameDayOrder', 'review1-after', 'low'],
        ['sameDayOrder', 'review1-after', 'high'],
        ['sameDayOrder', 'review2-before', 'low'],
        ['sameDayOrder', 'review2-before', 'high'],
        ['sameDayOrder', 'review2-after', 'low'],
        ['sameDayOrder', 'review2-after', 'high'],
        ['earlyReview', '1', 'low'],
        ['earlyReview', '1', 'high'],
        ['earlyReview', '0', 'low'],
        ['earlyReview', '0', 'high'],
        ['earlyReview', '-1', 'low'],
        ['earlyReview', '-1', 'high'],
      ].map(([factor, parameter, impact]) => [
        factor,
        parameter,
        impact,
        preference(factor!, parameter!, impact as 'low' | 'high' | null),
      ]),
    ).toEqual(expected);
    const missed = rows.find(
      (item) =>
        item.factor === 'departure' &&
        item.parameter === '2,7' &&
        item.impact === 'high' &&
        item.strategy === 'verify',
    );
    expect(missed?.result).toMatchObject({ netValue: 0, published: 0, carryover: ['change'] });
    for (const impact of ['low', 'high'] as const) {
      const group = rows.filter((item) => item.factor === 'contention' && item.impact === impact);
      const net = (strategy: string) =>
        group.find((item) => item.strategy === strategy)!.result.netValue;
      expect(net('verify-change')).toBe(net('verify-other'));
      expect(net('all-verify')).toBeLessThan(
        Math.max(...group.map((item) => item.result.netValue)),
      );
    }
    expect(
      rows
        .filter((item) => item.factor === 'contention' && item.impact === 'high')
        .map((item) => [item.strategy, item.result.netValue]),
    ).toEqual([
      ['all-early', 4],
      ['verify-change', 8],
      ['verify-other', 8],
      ['all-verify', 4],
      ['split', -4],
    ]);
    expect(
      rows
        .filter((item) => item.factor === 'contention' && item.impact === 'low')
        .map((item) => [item.strategy, item.result.netValue]),
    ).toEqual([
      ['all-early', 16],
      ['verify-change', 14],
      ['verify-other', 14],
      ['all-verify', 10],
      ['split', 8],
    ]);
  });

  it('レビュー完了前の確認を無消費で拒否し、要因行は保存再開と再生が一致する', () => {
    const initial = createWindowPrototype('RI-160', 'low');
    initial.tasks[0]!.reviewCompletedTick = 2;
    expect(tickWindowPrototype(initial, { holdIds: [], verifyId: 'change' })).toBe(initial);
    const ready = tickWindowPrototype(initial, { holdIds: [] });
    expect(ready.tasks[0]).toMatchObject({ publishedTick: 2, value: 10, loss: 2 });
    for (const row of factors.results) {
      let live = structuredClone(row.initial) as WindowState;
      let restored = JSON.parse(JSON.stringify(row.initial)) as WindowState;
      for (const input of row.inputs) {
        live = tickWindowPrototype(live, input);
        restored = tickWindowPrototype(JSON.parse(JSON.stringify(restored)) as WindowState, input);
      }
      expect(restored).toEqual(live);
      expect(summarizeWindows(live)).toEqual(row.result);
      expect(live.tasks).toEqual(row.tasks);
    }
  });
});
