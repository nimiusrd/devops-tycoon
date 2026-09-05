import { describe, expect, it } from 'vitest';
import { evaluateCounterfactual } from '../../../src/sim/run/counterfactual';
import { RunEngine } from '../../../src/sim/run/engine';
import type { CounterfactualFrame } from '../../../src/sim/run/persist';

function sprintFrame(): CounterfactualFrame {
  const engine = new RunEngine({ seed: 'counterfactual-limits', difficulty: 'normal' });
  engine.startRun();
  engine.beginSetupSprint();
  engine.step(200);
  return engine.exportCounterfactualFrame()!;
}

describe('反実仮想の介入と戦略の複合探索上限', () => {
  it('複合予算が 0 でも単独介入を評価し、残った複合手を未評価として返す', () => {
    const frame = sprintFrame();
    const before = structuredClone(frame);
    const evaluation = evaluateCounterfactual(frame, {
      maxSprints: 1,
      maxActionBranches: 1,
      maxComboBranches: 0,
      maxStrategicBranches: 0,
    });
    expect(evaluation.branches).toHaveLength(1);
    expect(evaluation.branches[0]?.actionId).toBe('aiThrottle');
    expect(evaluation.skippedActions).toContain('sameTickCombo');
    expect(evaluation.skippedActions).toContain('actionStrategicCombo');
    expect(frame).toEqual(before);
  });

  it('同 tick と戦略の複合予算を別々に使い、各 1 枝の後は未評価印を残す', () => {
    const frame = sprintFrame();
    const before = structuredClone(frame);
    const evaluation = evaluateCounterfactual(frame, {
      maxSprints: 1,
      maxActionBranches: 1,
      maxComboBranches: 1,
      maxStrategicBranches: 0,
    });
    expect(evaluation.branches.map((branch) => branch.actionId)).toEqual([
      'aiThrottle',
      'aiThrottle+pairReview',
      'aiThrottle+beat:ai-test-gen:0',
    ]);
    expect(evaluation.skippedActions).toContain('sameTickCombo');
    expect(evaluation.skippedActions).toContain('actionStrategicCombo');
    expect(frame).toEqual(before);
  });
});
