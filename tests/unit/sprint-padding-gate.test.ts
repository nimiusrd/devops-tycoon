import { describe, expect, it } from 'vitest';
import { applyAction } from '../../src/sim/actions';
import { createOrgState } from '../../src/sim/org';
import { createSprint, resolveSprintConfig, stepSprint } from '../../src/sim/sprint';

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
});
