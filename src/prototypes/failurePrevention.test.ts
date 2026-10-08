import { describe, expect, it } from 'vitest';
import {
  createPreventionPrototype,
  tickPreventionPrototype,
  describePrevention,
  comparePreventionStrategies,
  summarizePrevention,
} from './failurePrevention';
import comparison from '../../docs/prototypes/failure-prevention-comparison.json';

function firstIncident() {
  let state = createPreventionPrototype(1, 'spec-omission');
  for (let i = 0; i < 4; i++) state = tickPreventionPrototype(state, 'work');
  return state;
}
describe('RI-164 原因別再発防止', () => {
  it('実際の失敗前には対策できず、原因を仕事データから記録する', () => {
    const initial = createPreventionPrototype(1, 'migration-failure');
    expect(tickPreventionPrototype(initial, 'checklist')).toBe(initial);
    const progress = tickPreventionPrototype(initial, 'work');
    expect(progress.incidents).toEqual([]);
    const failed = tickPreventionPrototype(progress, 'work');
    expect(failed.incidents).toEqual([
      { jobId: 'job-0', cause: 'spec-omission', loss: 4, induced: false },
    ]);
    expect(tickPreventionPrototype(failed, 'checklist')).toBe(failed);
    expect(initial.incidents).toEqual([]);
  });
  it('同種だけ損失・修復が減り、異種と残存損失を隠さない', () => {
    expect(describePrevention('spec-omission', 1)).toEqual({ loss: 1, repairTicks: 1 });
    expect(describePrevention('migration-failure', 1)).toEqual(
      describePrevention('migration-failure', 0),
    );
    const initial = firstIncident();
    const protectedState = tickPreventionPrototype(initial, 'checklist');
    expect(protectedState.tick - initial.tick).toBe(2);
    expect(protectedState.investment).toBe(2);
    let state = tickPreventionPrototype(tickPreventionPrototype(protectedState, 'work'), 'work');
    expect(state.incidents[state.incidents.length - 1]).toMatchObject({
      jobId: 'job-1',
      cause: 'spec-omission',
      loss: 1,
    });
    expect(state.jobs[1]).toMatchObject({ stage: 'repair', remaining: 1 });
    state = tickPreventionPrototype(state, 'work');
    expect(state.jobs[1].stage).toBe('done');
  });
  it('上限1で再投資を拒否し、事故を増やしても対策効果を稼げない', () => {
    const initial = firstIncident();
    const protectedState = tickPreventionPrototype(initial, 'checklist');
    expect(tickPreventionPrototype(protectedState, 'checklist')).toBe(protectedState);
    const induced = tickPreventionPrototype(protectedState, 'induce-failure');
    expect(induced.prevention).toBe(1);
    expect(induced.loss - protectedState.loss).toBe(4);
    expect(induced.tick - protectedState.tick).toBe(2);
    expect(summarizePrevention(induced).value).toBe(summarizePrevention(protectedState).value);
  });
  it('仕事構成で投資の優劣が変わり、事故稼ぎは両構成で劣る', () => {
    expect(comparePreventionStrategies(comparison.seed)).toEqual(comparison.results);
    const [sameShip, samePrevent, sameFarm, otherShip, otherPrevent, otherFarm] =
      comparison.results;
    expect(samePrevent.result.netValue).toBeGreaterThan(sameShip.result.netValue);
    expect(otherShip.result.netValue).toBeGreaterThan(otherPrevent.result.netValue);
    expect(sameFarm.result.netValue).toBeLessThan(samePrevent.result.netValue);
    expect(otherFarm.result.netValue).toBeLessThan(otherShip.result.netValue);
  });
  it('初回の事故を故意に作って資格を先取りしても自然な学習を上回らない', () => {
    let state = createPreventionPrototype(1, 'spec-omission');
    state = tickPreventionPrototype(state, 'induce-failure');
    state = tickPreventionPrototype(state, 'checklist');
    while (state.tick < state.horizon) state = tickPreventionPrototype(state, 'work');
    const natural = comparePreventionStrategies(1).find(
      (row) => row.nextCause === 'spec-omission' && row.strategy === 'prevent',
    )!;
    expect(summarizePrevention(state).netValue).toBeLessThan(natural.result.netValue);
  });
  it('資源不足・進行中・期末の操作を無消費で拒否する', () => {
    const initial = firstIncident();
    const short = { ...initial, horizon: initial.tick + 1 };
    expect(tickPreventionPrototype(short, 'checklist')).toBe(short);
    expect(tickPreventionPrototype(short, 'induce-failure')).toBe(short);
    const progress = tickPreventionPrototype(initial, 'work');
    expect(tickPreventionPrototype(progress, 'induce-failure')).toBe(progress);
    const ended = { ...initial, tick: initial.horizon };
    expect(tickPreventionPrototype(ended, 'work')).toBe(ended);
  });
  it('原因確定前後・対策後の保存再開と入力再生が一致する', () => {
    for (const row of comparePreventionStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = tickPreventionPrototype(live, input);
        restored = tickPreventionPrototype(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
      }
      expect(summarizePrevention(live)).toEqual(row.result);
    }
  });
});
