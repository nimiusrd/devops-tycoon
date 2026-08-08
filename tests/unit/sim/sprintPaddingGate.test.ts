import { describe, expect, it } from 'vitest';
import { applyAction } from '../../../src/sim/actions';
import { createOrgState } from '../../../src/sim/org';
import { RunEngine } from '../../../src/sim/run/engine';
import { createSprint, resolveSprintConfig, stepSprint } from '../../../src/sim/sprint';

describe('minCompleteTick padding gate', () => {
  it('盤面枯渇後の下限待ちでは pairReview を受け付けない', () => {
    const org = createOrgState('default', false);
    org.aiLiteracy = 10;
    const sprint = createSprint(resolveSprintConfig('default'), org, () => 0.5);
    sprint.tasks = [];
    sprint.config.minCompleteTick = 5;
    sprint.focus = 10;

    stepSprint(sprint, org, () => 0.5, 0);
    expect(sprint.complete).toBe(false);

    const beforeLiteracy = org.aiLiteracy;
    const beforeUsed = sprint.metrics.interventionsUsed;
    const outcome = applyAction('pairReview', sprint, org, () => 0.5, 0);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('complete');
    expect(org.aiLiteracy).toBe(beforeLiteracy);
    expect(sprint.metrics.interventionsUsed).toBe(beforeUsed);
  });

  it('盤面枯渇後の下限待ちでは組織レバーも拒否する', () => {
    const engine = new RunEngine({ seed: 'padding-org-lever', difficulty: 'easy' });
    engine.startRun();
    engine.beginSetupSprint();
    const internals = engine as unknown as {
      phase: string;
      sprint: ReturnType<typeof createSprint> | null;
      budget: number;
      org: { techDebt: number };
    };
    // スプリント中・盤面枯渇・minCompleteTick 待ちを合成する。
    const org = createOrgState('default', false);
    const sprint = createSprint(resolveSprintConfig('default'), org, () => 0.5);
    sprint.tasks = [];
    sprint.config.minCompleteTick = 5;
    internals.phase = 'sprint';
    internals.sprint = sprint;
    internals.budget = 80;
    stepSprint(sprint, org, () => 0.5, 0);
    expect(sprint.complete).toBe(false);

    const beforeBudget = internals.budget;
    const beforeDebt = internals.org.techDebt;
    expect(engine.applyOrgLever('standardize')).toBe(false);
    expect(internals.budget).toBe(beforeBudget);
    expect(internals.org.techDebt).toBe(beforeDebt);
  });
});
