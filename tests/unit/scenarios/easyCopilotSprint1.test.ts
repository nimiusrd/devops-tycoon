/**
 * Issue #387: Easy + Copilot + seed devops-tycoon の Sprint 1 で
 * AI依存が 88% まで跳ねて Review Hell と重ならないこと。
 */
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
    expect(getScenario('copilot').aiDependencyPerTask).toBe(1.4);
    expect(AI_DEP_PER_TASK).toBe(2.2);
  });

  it('resolveAiDependencyPerTask は低い方を採り Nightmare を崩さない', () => {
    expect(resolveAiDependencyPerTask(undefined, undefined)).toBeUndefined();
    expect(resolveAiDependencyPerTask(undefined, 1.4)).toBe(1.4);
    expect(resolveAiDependencyPerTask(0.8, undefined)).toBe(0.8);
    expect(resolveAiDependencyPerTask(0.8, 1.4)).toBe(0.8);
    expect(resolveAiDependencyPerTask(2.2, 1.4)).toBe(1.4);
  });

  it('seed devops-tycoon の無介入 S1 は 88% まで跳ねない', () => {
    const copilot = sprint1('copilot');
    const plain = sprint1('default');
    expect(copilot.startAi).toBe(33);
    expect(copilot.endAi).toBeCloseTo(68, 5);
    expect(copilot.endAi).toBeLessThan(75);
    // 速度ボーナスは残すので、同一 seed の標準よりレビューピークは高い（Copilot の代償）。
    expect(copilot.qMax).toBeGreaterThan(plain.qMax);
    expect(plain.startAi).toBe(25);
    expect(plain.endAi).toBeGreaterThan(copilot.endAi);
  });

  it('熟練介入でも S1 の AI依存は崩壊域まで跳ねない', () => {
    const copilot = sprint1('copilot', { skilled: true });
    expect(copilot.startAi).toBe(33);
    expect(copilot.endAi).toBeLessThan(80);
  });

  it('単体 Engine の Copilot も resolveSprintConfig 経由で単価 1.4 を載せる', () => {
    expect(resolveSprintConfig('copilot').aiDependencyPerTask).toBe(1.4);
    expect(resolveSprintConfig('default').aiDependencyPerTask).toBeUndefined();
    const engine = createEngine({ scenario: 'copilot', aiEnabled: true, seed: SEED });
    expect(engine.snapshot().sprint.config.aiDependencyPerTask).toBe(1.4);
  });

  it('Easy+Copilot のタスク単価は 1.4、Nightmare+Copilot は 0.8 のまま', () => {
    const easy = new RunEngine({ seed: SEED, difficulty: 'easy' });
    easy.startRun('easy', [], SEED, { kind: 'normal', scenario: 'copilot' });
    expect((easy as unknown as EngineConfig).baseConfig.aiDependencyPerTask).toBe(1.4);

    const nightmare = new RunEngine({ seed: SEED, difficulty: 'nightmare' });
    nightmare.startRun('nightmare', [], SEED, { kind: 'normal', scenario: 'copilot' });
    expect((nightmare as unknown as EngineConfig).baseConfig.aiDependencyPerTask).toBe(0.8);

    const plain = new RunEngine({ seed: SEED, difficulty: 'easy' });
    plain.startRun('easy', [], SEED, { kind: 'normal', scenario: 'default' });
    expect((plain as unknown as EngineConfig).baseConfig.aiDependencyPerTask).toBeUndefined();
  });

  it('Copilot のタスク単価は persist / hydrate で残る', () => {
    const source = new RunEngine({ seed: SEED, difficulty: 'easy' });
    source.startRun('easy', [], SEED, { kind: 'normal', scenario: 'copilot' });
    const persist = source.exportPersistState();
    expect(persist?.extras.baseConfig.aiDependencyPerTask).toBe(1.4);

    const restored = new RunEngine({ seed: 'other', difficulty: 'normal' });
    restored.hydratePersistState(persist!);
    expect(restored.snapshot().scenario).toBe('copilot');
    expect((restored as unknown as EngineConfig).baseConfig.aiDependencyPerTask).toBe(1.4);
  });
});
