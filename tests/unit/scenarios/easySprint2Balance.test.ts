/**
 * Issue #359: Easy・seed devops-tycoon の Sprint 2 で
 * AI依存 cap / レビュー D / シニア体力注意が同時に常態化しないこと。
 *
 * #387 の Copilot 単価はシナリオ専用。通常 Easy（Copilot なし）は難易度の
 * `aiDependencyPerTask` 不足分だけをここで固定する。
 */
import { describe, expect, it } from 'vitest';
import { DIFFICULTY_DEFS } from '../../../src/data/difficulties';
import { AI_DEPENDENCY_CAP } from '../../../src/sim/outcome';
import { AI_DEP_PER_TASK } from '../../../src/sim/model/process';
import { RunEngine } from '../../../src/sim/run/engine';
import { DEFAULT_SEED } from '../../../src/sim/seed';
import { getScenario } from '../../../src/sim/scenarios';
import { deriveStatusParts } from '../../../src/render/status';
import { advance, type PlayOptions } from '../helpers/runFlow';

function playToSprintIndex(engine: RunEngine, targetSprint: number, opts: PlayOptions): void {
  let guard = 0;
  while (engine.snapshot().status === 'playing' && guard < 40_000) {
    guard += 1;
    const s = engine.snapshot();
    if (s.phase === 'sprint' && s.sprintIndexInQuarter === targetSprint) return;
    if (!advance(engine, opts)) break;
  }
}

function finishCurrentSprint(engine: RunEngine, opts: PlayOptions): void {
  let guard = 0;
  while (engine.snapshot().phase === 'sprint' && guard < 40_000) {
    guard += 1;
    if (!advance(engine, opts)) break;
  }
}

function startEasyDefault(seed: string): RunEngine {
  const engine = new RunEngine({ seed, difficulty: 'easy' });
  engine.startRun('easy', [], seed, { kind: 'normal', scenario: 'default' });
  return engine;
}

describe('Easy Sprint 2 序盤カーブ (#359)', () => {
  it('Copilot シナリオは単価を持たず、Easy 通常だけ 1.1 に下げる', () => {
    expect(DIFFICULTY_DEFS.easy.aiDependencyPerTask).toBe(1.1);
    expect(DIFFICULTY_DEFS.easy.aiDependencyPerTask).toBeLessThan(AI_DEP_PER_TASK);
    expect(DIFFICULTY_DEFS.normal.aiDependencyPerTask).toBeUndefined();
    expect(DIFFICULTY_DEFS.hard.aiDependencyPerTask).toBeUndefined();
    expect(DIFFICULTY_DEFS.nightmare.aiDependencyPerTask).toBe(0.8);
    expect(getScenario('copilot').sprint.aiDependencyPerTask).toBeUndefined();
    expect(getScenario('default').sprint.aiDependencyPerTask).toBeUndefined();

    const engine = startEasyDefault(DEFAULT_SEED);
    engine.beginSetupSprint();
    expect(engine.snapshot().sprint?.config.aiDependencyPerTask).toBe(1.1);
  });

  it('seed devops-tycoon の無介入・熟練とも Sprint 2 終端で AI依存が cap に張り付かない', () => {
    for (const skilled of [false, true]) {
      const engine = startEasyDefault(DEFAULT_SEED);
      playToSprintIndex(engine, 2, { skilled, unlockEvolution: true });
      expect(engine.snapshot().phase).toBe('sprint');
      expect(engine.snapshot().sprintIndexInQuarter).toBe(2);

      const mid = engine.snapshot();
      expect(mid.org.aiDependency).toBeLessThan(AI_DEPENDENCY_CAP);

      finishCurrentSprint(engine, { skilled, unlockEvolution: true });
      const end = engine.snapshot();
      expect(end.sprintsPlayed).toBe(2);
      // 熟練でもおよそ 87。既定 2.2 ではこの seed で cap に張り付いていた。
      expect(end.org.aiDependency).toBeLessThan(92);
      expect(end.org.aiDependency).toBeGreaterThan(40);

      const hud = deriveStatusParts(end.org, end.sprint?.tasks ?? []);
      const pinned = hud.aiDependencyPct >= AI_DEPENDENCY_CAP;
      const reviewD = hud.reviewCapacity === 'D' || hud.reviewCapacity === 'E';
      const staminaWatch = hud.seniorHpPct < 50;
      expect(pinned && reviewD && staminaWatch).toBe(false);
    }
  });

  it('代表 seed の熟練 Sprint 2 でも cap 張り付きとレビューD・体力注意の同時常態化を避ける', () => {
    const seeds = [DEFAULT_SEED, 'easy-s2-a', 'easy-s2-b'];
    for (const seed of seeds) {
      const engine = startEasyDefault(seed);
      playToSprintIndex(engine, 2, { skilled: true, unlockEvolution: true });
      finishCurrentSprint(engine, { skilled: true, unlockEvolution: true });
      const end = engine.snapshot();
      expect(end.sprintsPlayed, seed).toBe(2);
      expect(end.org.aiDependency, seed).toBeLessThan(AI_DEPENDENCY_CAP);

      const hud = deriveStatusParts(end.org, end.sprint?.tasks ?? []);
      const pinned = hud.aiDependencyPct >= AI_DEPENDENCY_CAP;
      const reviewD = hud.reviewCapacity === 'D' || hud.reviewCapacity === 'E';
      const staminaWatch = hud.seniorHpPct < 50;
      expect(pinned && reviewD && staminaWatch, seed).toBe(false);
    }
  });
});
