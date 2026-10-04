import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../../src/data/balance/pacing';
import { RunEngine } from '../../../src/sim/run/engine';

function startSprint(seed: string): RunEngine {
  const engine = new RunEngine({ seed, difficulty: 'normal' });
  engine.startRun();
  engine.beginSetupSprint();
  expect(engine.currentPhase()).toBe('sprint');
  return engine;
}

describe('RunEngineの固定stepと入力再現性', () => {
  it('step未満では進めず、端数を次の入力へ持ち越す', () => {
    const engine = startSprint('run-timing-boundary');
    const before = engine.snapshot();
    engine.step(FIXED_STEP_MS - 1);
    expect(engine.snapshot()).toEqual(before);
    engine.step(1);
    expect(engine.snapshot().sprintTick).toBe(1);
    engine.step(FIXED_STEP_MS * 2 + FIXED_STEP_MS / 2);
    expect(engine.snapshot().sprintTick).toBe(3);
    engine.step(FIXED_STEP_MS / 2 - 1);
    expect(engine.snapshot().sprintTick).toBe(3);
    engine.step(1);
    expect(engine.snapshot().sprintTick).toBe(4);

    const reference = startSprint('run-timing-boundary');
    reference.step(FIXED_STEP_MS * 4);
    expect(engine.snapshot()).toEqual(reference.snapshot());
  });

  it.each(['run-timing-a', 'run-timing-b', 'run-timing-c'])(
    '%s は同じtickでdispatchするとstep入力の分割によらず同じ状態になる',
    (seed) => {
      const split = startSprint(seed);
      const whole = startSprint(seed);
      split.step(FIXED_STEP_MS / 4);
      split.step((FIXED_STEP_MS * 3) / 4);
      whole.step(FIXED_STEP_MS);
      const action = split.dispatch('overtime');
      expect(action.ok).toBe(true);
      expect(whole.dispatch('overtime')).toEqual(action);
      split.step(FIXED_STEP_MS * 1.25);
      split.step(FIXED_STEP_MS * 1.25);
      whole.step(FIXED_STEP_MS * 2.5);
      expect(split.snapshot().sprintTick).toBe(3);
      expect(split.snapshot()).toEqual(whole.snapshot());
      // 次のstepで残った半tickが消費されることも同じ状態で確認する。
      split.step(FIXED_STEP_MS / 2);
      whole.step(FIXED_STEP_MS / 2);
      expect(split.snapshot().sprintTick).toBe(4);
      expect(split.snapshot()).toEqual(whole.snapshot());
    },
  );
});
