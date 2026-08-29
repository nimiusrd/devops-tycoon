/** Issue #359: Easy の単価調整は default シナリオに限定し、Copilot は既定値へ戻す。 */
import { describe, expect, it } from 'vitest';
import { getDifficulty } from '../../../src/data/difficulties';
import { AI_DEP_PER_TASK } from '../../../src/sim/model/process';
import { createEngine } from '../../../src/sim/engine';
import { RunEngine } from '../../../src/sim/run/engine';
import {
  applyScenarioOrg,
  getScenario,
  resolveAiDependencyPerTask,
} from '../../../src/sim/scenarios';
import { resolveSprintConfig } from '../../../src/sim/sprint';
import { playUntil, type PlayOptions } from '../helpers/runFlow';
import type { ScenarioId } from '../../../src/sim/types';

const SEED = 'devops-tycoon';

type EngineConfig = { baseConfig: { aiDependencyPerTask?: number } };

function sprint1(scenario: ScenarioId, opts: PlayOptions = {}) {
  const engine = new RunEngine({ seed: SEED, difficulty: 'easy' });
  engine.startRun('easy', [], SEED, { kind: 'normal', scenario });
  const start = engine.snapshot();
  const after = playUntil(engine, 'result', opts, 8_000);
  return {
    startAi: start.org.aiDependency,
    endAi: after.org.aiDependency,
    qMax: after.lastResult?.reviewQueueMax ?? 0,
  };
}

describe('Easy + Copilot Sprint 1 (#387)', () => {
  it('開始時 AI依存は Easy 25 + Copilot +8 = 33', () => {
    const org = applyScenarioOrg(getDifficulty('easy').org, getScenario('copilot'));
    expect(org.aiDependencyBase).toBe(33);
    expect(getScenario('copilot').sprint.aiDependencyPerTask).toBeUndefined();
    expect(AI_DEP_PER_TASK).toBe(2.2);
  });

  it('resolveAiDependencyPerTask は Easy の 1.1 を default にだけ載せる', () => {
    expect(resolveAiDependencyPerTask('easy', 'default')).toBe(1.1);
    expect(resolveAiDependencyPerTask('easy', 'copilot')).toBeUndefined();
    expect(resolveAiDependencyPerTask('normal', 'copilot')).toBeUndefined();
    expect(resolveAiDependencyPerTask('nightmare', 'copilot')).toBe(0.8);
  });

  it('seed devops-tycoon の無介入 S1 は Copilot の既定単価で依存が上がる', () => {
    const copilot = sprint1('copilot');
    const plain = sprint1('default');
    expect(copilot.startAi).toBe(33);
    expect(copilot.endAi).toBeGreaterThan(80);
    expect(plain.startAi).toBe(25);
    expect(plain.endAi).toBeLessThan(70);
  });

  it('熟練介入でも Copilot は既定単価を使う', () => {
    const copilot = sprint1('copilot', { skilled: true });
    expect(copilot.startAi).toBe(33);
    expect(copilot.endAi).toBeGreaterThan(80);
  });

  it('単体 Engine の Copilot はグローバル既定へフォールバックする', () => {
    expect(resolveSprintConfig('copilot').aiDependencyPerTask).toBeUndefined();
    expect(resolveSprintConfig('default').aiDependencyPerTask).toBeUndefined();
    const engine = createEngine({ scenario: 'copilot', aiEnabled: true, seed: SEED });
    expect(engine.snapshot().sprint.config.aiDependencyPerTask).toBeUndefined();
  });

  it('Easy+Copilot は既定単価、Nightmare+Copilot は 0.8 のまま', () => {
    const easy = new RunEngine({ seed: SEED, difficulty: 'easy' });
    easy.startRun('easy', [], SEED, { kind: 'normal', scenario: 'copilot' });
    expect((easy as unknown as EngineConfig).baseConfig.aiDependencyPerTask).toBeUndefined();

    const nightmare = new RunEngine({ seed: SEED, difficulty: 'nightmare' });
    nightmare.startRun('nightmare', [], SEED, { kind: 'normal', scenario: 'copilot' });
    expect((nightmare as unknown as EngineConfig).baseConfig.aiDependencyPerTask).toBe(0.8);

    const plain = new RunEngine({ seed: SEED, difficulty: 'easy' });
    plain.startRun('easy', [], SEED, { kind: 'normal', scenario: 'default' });
    expect((plain as unknown as EngineConfig).baseConfig.aiDependencyPerTask).toBe(1.1);
  });

  it('Copilot の既定単価フォールバックは persist / hydrate 後も維持する', () => {
    const source = new RunEngine({ seed: SEED, difficulty: 'easy' });
    source.startRun('easy', [], SEED, { kind: 'normal', scenario: 'copilot' });
    const persist = source.exportPersistState();
    expect(persist?.extras.baseConfig.aiDependencyPerTask).toBeUndefined();

    const restored = new RunEngine({ seed: 'other', difficulty: 'normal' });
    restored.hydratePersistState(persist!);
    expect(restored.snapshot().scenario).toBe('copilot');
    expect((restored as unknown as EngineConfig).baseConfig.aiDependencyPerTask).toBeUndefined();
  });
});
