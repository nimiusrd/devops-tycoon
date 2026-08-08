import { describe, expect, it } from 'vitest';
import { IDENTITY_CARD_EFFECTS } from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import {
  createSprintFromBaselineInput,
  runNoInterventionBaseline,
  runSprintSimulation,
  runSprintSimulationFull,
  type SprintBaselineInput,
} from '../../../src/sim/run/sprintBaseline';
import { resolveSprintConfig } from '../../../src/sim/sprint';

function makeInput(overrides: Partial<SprintBaselineInput> = {}): SprintBaselineInput {
  return {
    seed: 'ri55-baseline',
    config: resolveSprintConfig('default'),
    org: createOrgState('default', true),
    cardEffects: { ...IDENTITY_CARD_EFFECTS },
    aiAdoptionShare: 1,
    ...overrides,
  };
}

describe('無介入ベースライン（RI-55）', () => {
  it('同一入力から同一結果を決定論的に再実行する', () => {
    const input = makeInput();
    expect(runNoInterventionBaseline(input)).toEqual(runNoInterventionBaseline(input));
  });

  it('再実行しても入力の組織状態を変更しない', () => {
    const input = makeInput();
    const before = structuredClone(input.org);
    runNoInterventionBaseline(input);
    expect(input.org).toEqual(before);
  });

  it('次スプリント限定の初期 Review 負荷を本番と同じように反映する', () => {
    const input = makeInput({ reviewLoadAdd: 4 });
    const org = structuredClone(input.org);
    const { sprint } = createSprintFromBaselineInput(input, org);
    expect(sprint.tasks.filter((task) => task.lane === 'review')).toHaveLength(4);
  });

  it('介入ポリシーを tick ごとに実行しても入力の組織状態を変更しない', () => {
    const input = makeInput();
    const before = structuredClone(input.org);
    let policyCalls = 0;

    runSprintSimulation(input, ({ org }) => {
      policyCalls += 1;
      org.morale = 0;
    });

    expect(policyCalls).toBeGreaterThan(0);
    expect(input.org).toEqual(before);
  });

  it('runSprintSimulationFull はフルリザルトを返し、薄いラッパと整合する', () => {
    const input = makeInput({ seed: 'ri55-full' });
    const full = runSprintSimulationFull(input);
    const thin = runSprintSimulation(input);
    expect(full.delivered).toBe(thin.delivered);
    expect(full.spread).toBe(thin.spread);
    expect(full.maxCombo).toBe(thin.maxCombo);
    expect(full.aiAssistedPct).toBeGreaterThan(0);
    expect(full.reviewQueueMax).toBeGreaterThanOrEqual(0);
  });
});
