import { describe, expect, it } from 'vitest';
import { getDifficulty } from '../../../src/data/difficulties';
import {
  applyScenarioOrg,
  getScenario,
  resolveAiDependencyPerTask,
  resolveScenarioId,
  SCENARIO_ORDER,
  type ScenarioOrg,
} from '../../../src/sim/scenarios';
import { foldRunEffects, type RunModifierInput } from '../../../src/sim/run/effects';

const SAMPLE_ORG: ScenarioOrg = {
  aiDependencyBase: 20,
  aiLiteracy: 50,
  testCoverage: 55,
  documentation: 60,
  quality: 55,
  securityLevel: 50,
  morale: 70,
  seniorHp: 100,
};

const foldInput = (overrides: Partial<RunModifierInput> = {}): RunModifierInput => ({
  deck: [],
  relics: [],
  evolution: { points: 0, unlocked: {} },
  difficulty: 'normal',
  trials: [],
  ...overrides,
});

describe('tool scenarios (RI-103)', () => {
  it('lists default plus three tool scenarios', () => {
    expect(SCENARIO_ORDER).toEqual(['default', 'copilot', 'claude-code', 'devin']);
    expect(getScenario('copilot').label).toBe('Copilot');
    expect(getScenario('claude-code').label).toBe('Claude Code');
    expect(getScenario('devin').label).toBe('Devin');
  });

  it('falls back unknown ids to default', () => {
    expect(resolveScenarioId('unknown')).toBe('default');
    expect(getScenario('nope').id).toBe('default');
  });

  it('applyScenarioOrg is identity for default', () => {
    expect(applyScenarioOrg(SAMPLE_ORG, getScenario('default'))).toEqual(SAMPLE_ORG);
    expect(applyScenarioOrg(SAMPLE_ORG, getScenario('missing'))).toEqual(SAMPLE_ORG);
  });

  it('applies and clamps org deltas', () => {
    const copilot = applyScenarioOrg(SAMPLE_ORG, getScenario('copilot'));
    expect(copilot.aiDependencyBase).toBe(28);
    expect(copilot.securityLevel).toBe(45);
    expect(copilot.aiLiteracy).toBe(50);

    const claude = applyScenarioOrg(SAMPLE_ORG, getScenario('claude-code'));
    expect(claude.aiLiteracy).toBe(58);
    expect(claude.quality).toBe(60);
    expect(claude.securityLevel).toBe(47);

    const devin = applyScenarioOrg(SAMPLE_ORG, getScenario('devin'));
    expect(devin.aiDependencyBase).toBe(30);
    expect(devin.documentation).toBe(52);
    expect(devin.securityLevel).toBe(44);

    const clamped = applyScenarioOrg(
      { ...SAMPLE_ORG, aiDependencyBase: 95, securityLevel: 2 },
      getScenario('copilot'),
    );
    expect(clamped.aiDependencyBase).toBe(100);
    expect(clamped.securityLevel).toBe(0);
  });

  it('default org matches difficulty.org bit-for-bit', () => {
    const normal = getDifficulty('normal');
    expect(applyScenarioOrg(normal.org, getScenario('default'))).toEqual(normal.org);
  });

  it('Copilot は初期依存に加え、タスク単価を 1.4 に抑える（#387）', () => {
    expect(getScenario('copilot').aiDependencyPerTask).toBe(1.4);
    expect(getScenario('default').aiDependencyPerTask).toBeUndefined();
    expect(getScenario('devin').aiDependencyPerTask).toBeUndefined();
    expect(resolveAiDependencyPerTask(undefined, 1.4)).toBe(1.4);
    expect(resolveAiDependencyPerTask(0.8, 1.4)).toBe(0.8);
  });

  it('foldRunEffects includes scenario globalEffects after difficulty', () => {
    const without = foldRunEffects(foldInput()).effects;
    const withCopilot = foldRunEffects(foldInput({ scenario: 'copilot' })).effects;
    expect(withCopilot.codingSpeedMul).toBeCloseTo(without.codingSpeedMul * 1.06, 8);
    expect(withCopilot.routineSpeedMul).toBeCloseTo(without.routineSpeedMul * 1.12, 8);

    const withClaude = foldRunEffects(foldInput({ scenario: 'claude-code' })).effects;
    expect(withClaude.reviewEfficiencyMul).toBeCloseTo(without.reviewEfficiencyMul * 0.94, 8);
    expect(withClaude.reworkRateAdd).toBeCloseTo(without.reworkRateAdd - 0.02, 8);
  });
});
