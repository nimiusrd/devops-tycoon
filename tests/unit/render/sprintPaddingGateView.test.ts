import { describe, expect, it } from 'vitest';
import { createOrgState } from '../../../src/sim/org';
import {
  sprintPaddingGateMessage,
  SPRINT_PADDING_GATE_MESSAGES,
} from '../../../src/render/sprintPaddingGateView';
import {
  createSprint,
  isAwaitingMinCompleteTick,
  resolveSprintConfig,
} from '../../../src/sim/sprint';

function sprintFixture(overrides: { codingSlots?: number; tasks?: [] } = {}) {
  const org = createOrgState('default', false);
  const sprint = createSprint(resolveSprintConfig('default'), org, () => 0.5);
  sprint.config.minCompleteTick = 5;
  if (overrides.codingSlots !== undefined) sprint.config.codingSlots = overrides.codingSlots;
  if (overrides.tasks) sprint.tasks = overrides.tasks;
  return sprint;
}

describe('sprintPaddingGateView', () => {
  it('コーダー不在の停滞ではコーダー理由を返す', () => {
    const sprint = sprintFixture({ codingSlots: 0 });
    expect(isAwaitingMinCompleteTick(sprint)).toBe(true);
    expect(sprintPaddingGateMessage(sprint)).toBe(SPRINT_PADDING_GATE_MESSAGES.stalled);
  });

  it('盤面枯渇後の待機では時間待ち理由を返す', () => {
    const sprint = sprintFixture({ tasks: [] });
    expect(sprintPaddingGateMessage(sprint)).toBe(SPRINT_PADDING_GATE_MESSAGES.waiting);
  });

  it('通常進行中は理由を出さない', () => {
    const sprint = sprintFixture();
    expect(sprintPaddingGateMessage(sprint)).toBeUndefined();
  });
});
