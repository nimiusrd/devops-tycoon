import { describe, expect, it } from 'vitest';
import {
  MATURE_BASELINE,
  applyMatureInput as apply,
  compareMatureSensitivity,
  compareMatureStrategies,
  createMaturePrototype as create,
  summarizeMature,
  viewMature,
  type MatureFactorName,
  type MatureHorizon,
} from './maturingPolicy';
import comparison from '../../docs/prototypes/maturing-policy-comparison.json';
import sensitivity from '../../docs/prototypes/maturing-policy-factor-comparison.json';

describe('RI-185 使って育つ施策', () => {
  it('成熟前は速度1で、3件の新しい完了の次tickから速度3になる', () => {
    let state = apply(create(1, 10), { type: 'adopt', card: 'growing' });
    expect(viewMature(state)).toMatchObject({
      card: 'growing',
      cardLevel: 0,
      stage: 0,
      progress: 0,
      nextAt: 3,
      throughput: 1,
    });
    for (let i = 0; i < 3; i++) state = apply(state, { type: 'tick' });
    expect(viewMature(state)).toMatchObject({
      stage: 1,
      progress: 3,
      cardLevel: 0,
      nextAt: null,
      throughput: 3,
      completed: 3,
    });
    state = apply(state, { type: 'tick' });
    expect(state.earnedValue).toBe(6);
    expect(state.progress).toBe(3);
    expect(state.cardLevel).toBe(0);
  });
  it('手戻りは同じ完了を進捗にも価値にも数えない', () => {
    let state = apply(apply(create(1, 6), { type: 'adopt', card: 'growing' }), { type: 'tick' });
    const before = structuredClone(state);
    state = apply(state, { type: 'rework' });
    expect(state.progress).toBe(before.progress);
    expect(state.earnedValue).toBe(before.earnedValue);
    expect(state.completedIds).toEqual(before.completedIds);
    expect(state.reworks).toBe(1);
    expect(state.stage).toBe(0);
    const fresh = create(1, 6);
    expect(apply(fresh, { type: 'rework' })).toBe(fresh);
  });
  it('即効カードは成熟せず、二重の採用と期末の操作は無消費で拒否する', () => {
    const steady = apply(create(1, 4), { type: 'adopt', card: 'steady' });
    expect(viewMature(steady)).toMatchObject({
      stage: 0,
      progress: 0,
      nextAt: null,
      throughput: 2,
    });
    expect(apply(steady, { type: 'adopt', card: 'growing' })).toBe(steady);
    const ended = { ...create(1, 4), tick: 4 };
    expect(apply(ended, { type: 'adopt', card: 'steady' })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'rework' })).toBe(ended);
  });
  it('短い期末は即効、長い期末は育成が有力で、育成は常に最善ではない', () => {
    const rows = compareMatureStrategies();
    expect(rows).toEqual(comparison.results);
    const net = (horizon: number, strategy: string) =>
      rows.find((row) => row.horizon === horizon && row.strategy === strategy)!.result.netValue;
    expect(net(4, 'steady')).toBe(7);
    expect(net(4, 'growing')).toBe(5);
    expect(net(4, 'none')).toBe(4);
    expect(net(10, 'growing')).toBe(23);
    expect(net(10, 'steady')).toBe(19);
    expect(net(10, 'none')).toBe(10);
    const grown = rows.find((row) => row.horizon === 10 && row.strategy === 'growing')!;
    expect(grown.result.cardLevel).toBe(0);
    expect(grown.result.stage).toBe(1);
    expect(grown.result.progress).toBe(3);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareMatureStrategies()) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeMature(live)).toEqual(row.result);
    }
  });
});

const FACTOR_NAMES = ['matureAt', 'stage1Throughput', 'steadyThroughput'] as const;
const HORIZONS = [4, 10] as const;

function ticks(horizon: number, card: 'steady' | 'growing') {
  return [
    { type: 'adopt' as const, card },
    ...Array.from({ length: horizon }, () => ({ type: 'tick' as const })),
  ];
}

/** 段階0の速度が1で、必要件数が1以上のときの完了数。到達tickは速度1のまま。 */
function growingCompleted(horizon: number, matureAt: number, stage1Throughput: number) {
  const slow = Math.min(horizon, matureAt);
  return slow + (horizon - slow) * stage1Throughput;
}

describe('RI-185 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareMatureSensitivity();
    expect(data).toEqual(sensitivity);
    expect(data.conditions).toMatchObject({
      seed: 1,
      horizons: [4, 10],
      focus: 1,
      adoptCost: 1,
      adoptAdvancesTime: false,
      valuePerCompletion: 1,
      stage0Throughput: 1,
      noneThroughput: 1,
      plan: 'adopt-then-tick',
      score: 'netValue',
      baseline: { matureAt: 3, stage1Throughput: 3, steadyThroughput: 2 },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
    });
    const nets = (axis: MatureFactorName, horizon: MatureHorizon) =>
      data.sweeps[axis][horizon].map((row) => [
        row.parameter,
        row.runs.steady.result.netValue,
        row.runs.growing.result.netValue,
        row.preference,
      ]);
    expect(nets('matureAt', 4)).toEqual([
      [1, 7, 9, 'growing'],
      [2, 7, 7, 'tie'],
      [3, 7, 5, 'steady'],
      [4, 7, 3, 'steady'],
      [5, 7, 3, 'steady'],
      [6, 7, 3, 'steady'],
      [7, 7, 3, 'steady'],
    ]);
    expect(nets('matureAt', 10)).toEqual([
      [1, 19, 27, 'growing'],
      [2, 19, 25, 'growing'],
      [3, 19, 23, 'growing'],
      [4, 19, 21, 'growing'],
      [5, 19, 19, 'tie'],
      [6, 19, 17, 'steady'],
      [7, 19, 15, 'steady'],
    ]);
    expect(nets('stage1Throughput', 4)).toEqual([
      [1, 7, 3, 'steady'],
      [2, 7, 4, 'steady'],
      [3, 7, 5, 'steady'],
      [4, 7, 6, 'steady'],
      [5, 7, 7, 'tie'],
      [6, 7, 8, 'growing'],
    ]);
    expect(nets('stage1Throughput', 10)).toEqual([
      [1, 19, 9, 'steady'],
      [2, 19, 16, 'steady'],
      [3, 19, 23, 'growing'],
      [4, 19, 30, 'growing'],
      [5, 19, 37, 'growing'],
      [6, 19, 44, 'growing'],
    ]);
    expect(nets('steadyThroughput', 4)).toEqual([
      [1, 3, 5, 'growing'],
      [2, 7, 5, 'steady'],
      [3, 11, 5, 'steady'],
    ]);
    expect(nets('steadyThroughput', 10)).toEqual([
      [1, 9, 23, 'growing'],
      [2, 19, 23, 'growing'],
      [3, 29, 23, 'steady'],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.horizon,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['matureAt', 4, 1, 'growing', 2, 'tie'],
      ['matureAt', 4, 2, 'tie', 3, 'steady'],
      ['matureAt', 10, 4, 'growing', 5, 'tie'],
      ['matureAt', 10, 5, 'tie', 6, 'steady'],
      ['stage1Throughput', 4, 4, 'steady', 5, 'tie'],
      ['stage1Throughput', 4, 5, 'tie', 6, 'growing'],
      ['stage1Throughput', 10, 2, 'steady', 3, 'growing'],
      ['steadyThroughput', 4, 1, 'growing', 2, 'steady'],
      ['steadyThroughput', 10, 2, 'growing', 3, 'steady'],
    ]);
  });

  it('基準行は初回JSONと一致し、動かした係数は一つで、閉形式と段階が一致する', () => {
    const data = compareMatureSensitivity();
    const original = (horizon: number, strategy: string) =>
      comparison.results.find((row) => row.horizon === horizon && row.strategy === strategy);
    for (const axis of FACTOR_NAMES) {
      for (const horizon of HORIZONS) {
        const baseline = data.sweeps[axis][horizon].find(
          (row) => row.parameter === MATURE_BASELINE[axis],
        );
        const steady = original(horizon, 'steady');
        const growing = original(horizon, 'growing');
        if (!baseline || !steady || !growing) throw new Error(`${axis}:${horizon}`);
        expect(baseline.runs.steady.result).toEqual(steady.result);
        expect(baseline.runs.growing.result).toEqual(growing.result);
        expect(baseline.runs.steady.inputs).toEqual(steady.inputs);
        expect(baseline.runs.growing.inputs).toEqual(growing.inputs);
        for (const row of data.sweeps[axis][horizon]) {
          const changed = FACTOR_NAMES.filter(
            (name) => row.factors[name] !== MATURE_BASELINE[name],
          );
          expect(changed).toEqual(row.parameter === MATURE_BASELINE[axis] ? [] : [axis]);
          expect(row.runs.steady.inputs).toEqual(ticks(horizon, 'steady'));
          expect(row.runs.growing.inputs).toEqual(ticks(horizon, 'growing'));
          const steadyEarned = row.factors.steadyThroughput * horizon;
          const growingEarned = growingCompleted(
            horizon,
            row.factors.matureAt,
            row.factors.stage1Throughput,
          );
          expect(row.runs.steady.result).toMatchObject({
            card: 'steady',
            cardLevel: 0,
            stage: 0,
            progress: 0,
            reworks: 0,
            focusSpent: 1,
            completed: steadyEarned,
            earnedValue: steadyEarned,
            netValue: steadyEarned - 1,
          });
          expect(row.runs.growing.result).toMatchObject({
            card: 'growing',
            cardLevel: 0,
            stage: horizon >= row.factors.matureAt ? 1 : 0,
            progress: Math.min(horizon, row.factors.matureAt),
            reworks: 0,
            focusSpent: 1,
            completed: growingEarned,
            earnedValue: growingEarned,
            netValue: growingEarned - 1,
          });
          expect(row.margin).toBe(
            row.runs.growing.result.netValue - row.runs.steady.result.netValue,
          );
        }
      }
    }
    const reached = data.sweeps.matureAt[4].find((row) => row.parameter === 4);
    expect(reached?.runs.growing.result).toMatchObject({ stage: 1, progress: 4, netValue: 3 });
    const unmet = data.sweeps.matureAt[4].find((row) => row.parameter === 5);
    expect(unmet?.runs.growing.result).toMatchObject({ stage: 0, progress: 4, netValue: 3 });
    expect(create(1, 4).factors).toBeUndefined();
  });

  it('必要件数を変えても到達tickは段階0の速度で、手戻りは進捗にも価値にも数えない', () => {
    const factors = { matureAt: 2, stage1Throughput: 5, steadyThroughput: 9 };
    let state = apply(create(1, 4, factors), { type: 'adopt', card: 'growing' });
    state = apply(state, { type: 'tick' });
    expect(viewMature(state)).toMatchObject({
      stage: 0,
      progress: 1,
      throughput: 1,
      cardLevel: 0,
      nextAt: 2,
      completed: 1,
    });
    state = apply(state, { type: 'tick' });
    expect(viewMature(state)).toMatchObject({
      stage: 1,
      progress: 2,
      throughput: 5,
      cardLevel: 0,
      nextAt: null,
      completed: 2,
    });
    expect(state.earnedValue).toBe(2);
    state = apply(state, { type: 'tick' });
    expect(state.earnedValue).toBe(7);
    expect(state.cardLevel).toBe(0);
    const reworkFactors = { matureAt: 5, stage1Throughput: 3, steadyThroughput: 2 };
    let reworked = apply(create(1, 6, reworkFactors), { type: 'adopt', card: 'growing' });
    reworked = apply(reworked, { type: 'tick' });
    const before = structuredClone(reworked);
    reworked = apply(reworked, { type: 'rework' });
    expect(reworked.progress).toBe(before.progress);
    expect(reworked.earnedValue).toBe(before.earnedValue);
    expect(reworked.completedIds).toEqual(before.completedIds);
    expect(reworked.stage).toBe(0);
    expect(reworked.cardLevel).toBe(0);
    expect(reworked.reworks).toBe(1);
  });

  it('要因比較の入力を再生すると差引が一致し、元状態を変えない', () => {
    const data = compareMatureSensitivity();
    for (const axis of FACTOR_NAMES) {
      for (const horizon of HORIZONS) {
        for (const row of data.sweeps[axis][horizon]) {
          for (const strategy of ['steady', 'growing'] as const) {
            let live = create(data.conditions.seed, horizon, row.factors);
            let saved = structuredClone(live);
            expect(live.factors).toEqual(row.factors);
            expect(live.cardLevel).toBe(0);
            for (const input of row.runs[strategy].inputs) {
              const previous = live;
              const before = structuredClone(live);
              live = apply(live, input);
              saved = apply(JSON.parse(JSON.stringify(saved)), input);
              expect(previous).toEqual(before);
              expect(saved).toEqual(live);
            }
            expect(summarizeMature(live)).toEqual(row.runs[strategy].result);
            expect(live.cardLevel).toBe(0);
          }
        }
      }
    }
  });
});
