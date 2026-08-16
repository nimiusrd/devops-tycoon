import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { getDifficulty } from '../../../src/data/difficulties';
import { applyScenarioOrg, getScenario } from '../../../src/sim/scenarios';
import { RunEngine } from '../../../src/sim/run/engine';
import { foldRunEffects, type RunModifierInput } from '../../../src/sim/run/effects';
import type { RunPersistState } from '../../../src/sim/run/persist';
import type { OrgState } from '../../../src/sim/types';
import { DAILY_RUN_DIFFICULTY } from '../../../src/state/meta';

const SEED = 'ri-103-tool-scenario';

function expectOrgMatchesScenario(org: OrgState, difficulty: 'normal', scenarioId: string): void {
  const expected = applyScenarioOrg(getDifficulty(difficulty).org, getScenario(scenarioId));
  expect(org.aiDependency).toBe(expected.aiDependencyBase);
  expect(org.aiLiteracy).toBe(expected.aiLiteracy);
  expect(org.testCoverage).toBe(expected.testCoverage);
  expect(org.documentation).toBe(expected.documentation);
  expect(org.quality).toBe(expected.quality);
  expect(org.securityLevel).toBe(expected.securityLevel);
  expect(org.morale).toBe(expected.morale);
  expect(org.seniorHp).toBe(expected.seniorHp);
}

const foldInput = (overrides: Partial<RunModifierInput> = {}): RunModifierInput => ({
  deck: [],
  relics: [],
  evolution: { points: 0, unlocked: {} },
  difficulty: 'normal',
  trials: [],
  ...overrides,
});

describe('tool scenario run wiring (RI-103)', () => {
  it('default start matches current org and leaves the deck empty', () => {
    const game = createGame({ seed: SEED });
    const run = game.startRun('normal', [], SEED);
    expect(run.scenario).toBe('default');
    expect(run.deck).toEqual([]);
    expectOrgMatchesScenario(run.org, 'normal', 'default');
  });

  it('applies copilot org delta on start without granting the card', () => {
    const game = createGame({ seed: SEED });
    const run = game.startRun('normal', [], SEED, 'copilot');
    expect(run.scenario).toBe('copilot');
    expect(run.deck).toEqual([]);
    expectOrgMatchesScenario(run.org, 'normal', 'copilot');
  });

  it('same seed produces different org and folded effects across scenarios', () => {
    const a = createGame({ seed: SEED }).startRun('normal', [], SEED, 'default');
    const b = createGame({ seed: SEED }).startRun('normal', [], SEED, 'devin');
    expect(a.org).not.toEqual(b.org);
    expect(b.org.aiDependency).toBeGreaterThan(a.org.aiDependency);

    const defaultFx = foldRunEffects(foldInput({ scenario: 'default' })).effects;
    const devinFx = foldRunEffects(foldInput({ scenario: 'devin' })).effects;
    expect(devinFx.codingSpeedMul).toBeGreaterThan(defaultFx.codingSpeedMul);
    expect(devinFx.reworkRateAdd).toBeGreaterThan(defaultFx.reworkRateAdd);
  });

  it('daily run ignores requested scenario', () => {
    const engine = new RunEngine({ seed: SEED, difficulty: 'normal' });
    engine.startRun('normal', [], SEED, {
      kind: 'daily',
      dailyDate: '2026-08-16',
      scenario: 'copilot',
    });
    const run = engine.snapshot();
    expect(run.scenario).toBe('default');
    expectOrgMatchesScenario(run.org, 'normal', 'default');
  });

  it('GameHandle.startDailyRun stays on default', () => {
    const game = createGame({ seed: SEED });
    const run = game.startDailyRun('2026-08-16');
    expect(run.scenario).toBe('default');
    expectOrgMatchesScenario(run.org, DAILY_RUN_DIFFICULTY, 'default');
  });

  it('persists and hydrates scenario', () => {
    const source = new RunEngine({ seed: SEED, difficulty: 'normal' });
    source.startRun('normal', [], SEED, { kind: 'normal', scenario: 'claude-code' });
    const persist = source.exportPersistState();
    expect(persist?.scenario).toBe('claude-code');
    expect(persist?.extras.scenario).toBe('claude-code');

    const restored = new RunEngine();
    restored.hydratePersistState(persist!);
    const run = restored.snapshot();
    expect(run.scenario).toBe('claude-code');
    expectOrgMatchesScenario(run.org, 'normal', 'claude-code');
  });

  it('missing persist extras.scenario hydrates as default', () => {
    const engine = new RunEngine({ seed: SEED, difficulty: 'normal' });
    engine.startRun('normal', [], SEED);
    const persist = engine.exportPersistState();
    if (!persist) throw new Error('setup save was not exportable');
    const legacy = {
      ...persist,
      scenario: undefined,
      extras: { ...persist.extras, scenario: undefined },
    } as RunPersistState;

    const restored = new RunEngine();
    restored.hydratePersistState(legacy);
    expect(restored.snapshot().scenario).toBe('default');
  });
});
