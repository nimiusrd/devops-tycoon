import { describe, expect, it } from 'vitest';
import {
  applySolutionInput as apply,
  chooseSolutionAction,
  compareSolutionStrategies,
  createSolutionPrototype as create,
  summarizeSolution,
  viewSolution,
} from './solutionCompare';
import comparison from '../../docs/prototypes/solution-compare-comparison.json';

describe('RI-195 複数案の比較', () => {
  it('同じseedの二案を再現し、表示を繰り返しても引き直さない', () => {
    const first = create(195, 6, 'launch');
    const again = create(195, 6, 'launch');
    expect(again).toEqual(first);
    expect(create(196, 6, 'launch').generation).not.toBe(first.generation);
    const before = structuredClone(first);
    const seen = viewSolution(first);
    for (let i = 0; i < 10; i++) expect(viewSolution(first)).toEqual(seen);
    expect(first).toEqual(before);
    expect(seen.proposals[0]).toMatchObject({
      id: 'fast',
      work: 2,
      shipValue: 8,
      upkeepPerTick: null,
      safetyLoss: null,
    });
    expect(seen.proposals[1]).toMatchObject({
      id: 'durable',
      revealed: false,
      work: null,
      shipValue: null,
      upkeepPerTick: null,
    });
    expect(viewSolution(create(196, 14, 'maintain')).proposals).toEqual(seen.proposals);
  });
  it('探索は2tickと集中力1を一度だけ払い、選択中は時間を止めて両方を見せる', () => {
    let state = apply(create(195, 14, 'maintain'), { type: 'explore' });
    expect(state).toMatchObject({ phase: 'exploring', focus: 1, focusSpent: 1, tick: 0 });
    expect(apply(state, { type: 'explore' })).toBe(state);
    state = apply(state, { type: 'tick' });
    expect(viewSolution(state).proposals[1]!.revealed).toBe(false);
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({ phase: 'choosing', tick: 2 });
    expect(viewSolution(state).timeStopped).toBe(true);
    expect(viewSolution(state).proposals.map((proposal) => proposal.upkeepPerTick)).toEqual([3, 0]);
    expect(apply(state, { type: 'tick' })).toBe(state);
    const picked = apply(state, { type: 'adopt', proposal: 'durable' });
    expect(picked).toMatchObject({
      phase: 'implementing',
      adopted: 'durable',
      rejected: 'fast',
      tick: 2,
    });
    expect(apply(picked, { type: 'adopt', proposal: 'fast' })).toBe(picked);
  });
  it('未探索では速い案だけ採用でき、不採用案の成果を出荷へ足さない', () => {
    const initial = create(195, 6, 'launch');
    expect(apply(initial, { type: 'adopt', proposal: 'durable' })).toBe(initial);
    let state = apply(initial, { type: 'adopt', proposal: 'fast' });
    expect(state).toMatchObject({ rejected: 'durable', shippedValue: 0 });
    state = apply(apply(state, { type: 'tick' }), { type: 'tick' });
    expect(state).toMatchObject({ phase: 'shipped', shippedValue: 8, safetyLoss: 4, upkeep: 6 });
    const summary = summarizeSolution(state);
    expect(summary.withheldValue).toBe(8);
    expect(summary.netValue).toBe(8 + state.followUp - state.upkeep - state.safetyLoss);
    expect(summary.netValue).not.toBe(summary.shippedValue + summary.withheldValue);
    state = apply(state, { type: 'tick' });
    expect(state.shippedValue).toBe(8);
    expect(state.upkeep).toBe(6);
  });
  it('集中力不足・探索中の採用・期末は無消費で拒否する', () => {
    const poor = { ...create(195, 6, 'launch'), focus: 0 };
    expect(apply(poor, { type: 'explore' })).toBe(poor);
    const busy = apply(create(195, 6, 'launch'), { type: 'explore' });
    expect(apply(busy, { type: 'adopt', proposal: 'fast' })).toBe(busy);
    const ended = { ...create(195, 6, 'launch'), tick: 6 };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'explore' })).toBe(ended);
    expect(apply(ended, { type: 'adopt', proposal: 'fast' })).toBe(ended);
  });
  it('投入期間が短い、または保守負担が軽いときは即採用、長い保守局面だけ比較後の耐久案が有利', () => {
    const rows = compareSolutionStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (posture: string, horizon: number, strategy: string) =>
      rows.find(
        (row) => row.posture === posture && row.horizon === horizon && row.strategy === strategy,
      )!.result.netValue;
    expect([
      net('launch', 6, 'rush'),
      net('launch', 6, 'compare-fast'),
      net('launch', 6, 'compare-durable'),
    ]).toEqual([14, 5, -13]);
    expect([net('launch', 14, 'rush'), net('launch', 14, 'compare-durable')]).toEqual([38, 35]);
    expect(net('maintain', 6, 'rush')).toBeGreaterThan(net('maintain', 6, 'compare-durable'));
    expect([
      net('maintain', 14, 'rush'),
      net('maintain', 14, 'compare-fast'),
      net('maintain', 14, 'compare-durable'),
    ]).toEqual([10, 1, 35]);
    for (const posture of ['launch', 'maintain'] as const) {
      for (const horizon of [6, 14] as const) {
        expect(net(posture, horizon, 'compare-fast')).toBeLessThan(net(posture, horizon, 'rush'));
      }
    }
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareSolutionStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseSolutionAction(previous, row.strategy)).toEqual(input);
      }
      expect(summarizeSolution(live)).toEqual(row.result);
      expect(live.shippedValue === 0 || live.shippedValue === 8).toBe(true);
    }
  });
});
