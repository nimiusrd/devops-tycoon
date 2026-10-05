import { describe, expect, it } from 'vitest';
import comparison from '../../../docs/prototypes/rescue-comparison.json';
import {
  compareRescueStrategies,
  createRescuePrototype,
  summarizeRescue,
  tickRescuePrototype,
} from './rescue';

describe('固定盤面の救済パズル試作', () => {
  it('通常ランの再開と異なる課題で、同じ初期盤面と比較結果を再現する', () => {
    const state = createRescuePrototype();
    expect(state).toEqual(createRescuePrototype());
    expect(state).toMatchObject({
      kind: 'rescue-prototype',
      challengeId: 'review-crisis-1',
      tick: 0,
      limit: 120,
    });
    expect(state.sprint.tasks.filter((task) => task.lane === 'review')).toHaveLength(6);
    expect(state.sprint.tasks.filter((task) => task.incident)).toHaveLength(2);
    expect(compareRescueStrategies()).toEqual(comparison);
    const unattended = comparison.find((result) => result.strategy === 'unattended')!;
    const rescued = comparison.find((result) => result.strategy === 'contain-and-review')!;
    expect(unattended.rescued).toBe(false);
    expect(rescued.rescued).toBe(true);
    expect(rescued.focusSpent).toBeLessThan(comparison[1].focusSpent);
  });

  it('無介入でも開始直後に終わらず、観察する猶予がある', () => {
    let state = createRescuePrototype();
    for (let tick = 0; tick < 10; tick += 1) state = tickRescuePrototype(state);
    expect(summarizeRescue(state).ended).toBe(false);
    expect(state.inputs).toHaveLength(0);
  });

  it('成功介入は3回までで、失敗理由と実際の費用を記録する', () => {
    let state = createRescuePrototype();
    while (state.tick < 61) {
      const action =
        state.tick === 0 || state.tick === 60
          ? 'firefight'
          : state.tick === 20
            ? 'interruptReview'
            : undefined;
      state = tickRescuePrototype(state, action);
    }
    expect(state.inputs.filter((input) => input.outcome.ok)).toHaveLength(3);
    const blocked = tickRescuePrototype(state, 'firefight');
    expect(blocked.inputs[blocked.inputs.length - 1]?.outcome).toEqual({
      ok: false,
      reason: 'intervention-limit',
    });
    expect(blocked.sprint.metrics.focusSpent).toBe(state.sprint.metrics.focusSpent);
  });

  it('元状態を変えず、JSONから乱数の消費位置ごと再開して同じ入力結果を得る', () => {
    const initial = createRescuePrototype();
    const untouched = structuredClone(initial);
    let state = tickRescuePrototype(initial, 'firefight');
    expect(initial).toEqual(untouched);
    while (state.tick < 30)
      state = tickRescuePrototype(state, state.tick === 20 ? 'interruptReview' : undefined);
    let restored = JSON.parse(JSON.stringify(state));
    while (!summarizeRescue(state).ended) {
      const action = state.tick === 60 ? 'firefight' : undefined;
      state = tickRescuePrototype(state, action);
      restored = tickRescuePrototype(restored, action);
    }
    expect(restored).toEqual(state);
    expect(tickRescuePrototype(state, 'andon')).toEqual(state);
  });
});
