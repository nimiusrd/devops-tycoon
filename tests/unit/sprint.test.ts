import { describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '../../src/sim/engine';
import type { SprintResult } from '../../src/sim/types';

/** スプリントを最後まで自動進行させ、リザルトを返す。 */
function runSprint(seed: string, aiEnabled: boolean): { engine: Engine; result: SprintResult } {
  const engine = createEngine({ seed, aiEnabled, scenario: 'default' });
  let guard = 0;
  while (!engine.isComplete() && guard < 100_000) {
    engine.step(1000); // 10 tick ずつ前進
    guard += 1;
  }
  expect(engine.isComplete()).toBe(true);
  return { engine, result: engine.result() };
}

describe('スプリントの終了保証', () => {
  it('AIあり/なしいずれも有限ステップで完了し、全タスクが Done になる', () => {
    for (const aiEnabled of [false, true]) {
      const { engine, result } = runSprint('finish', aiEnabled);
      const snap = engine.snapshot();
      expect(snap.sprint.tasks.every((t) => t.lane === 'done')).toBe(true);
      expect(result.done).toBe(snap.sprint.config.taskCount);
    }
  });
});

describe('seed 再現性（同一 seed なら同一リザルト）', () => {
  it('同一 seed・同一 AI 設定で完全一致する', () => {
    const a = runSprint('repro-seed', true).result;
    const b = runSprint('repro-seed', true).result;
    expect(a).toEqual(b);
  });

  it('異なる seed では結果が変わりうる', () => {
    const a = runSprint('seed-a', true).result;
    const b = runSprint('seed-b', true).result;
    // 主要指標のいずれかは異なるはず。
    const differs =
      a.delivered !== b.delivered ||
      a.rework !== b.rework ||
      a.reviewQueueMax !== b.reviewQueueMax ||
      a.incidents !== b.incidents;
    expect(differs).toBe(true);
  });
});

describe('AIあり/なしの結果差（DoD: コア因果が成立する）', () => {
  it('AIありは Review 渋滞が増え、Rework も増える（第2章）', () => {
    const seeds = ['s1', 's2', 's3', 's4', 's5'];
    let queueWins = 0;
    let reworkWins = 0;
    for (const seed of seeds) {
      const off = runSprint(seed, false).result;
      const on = runSprint(seed, true).result;
      if (on.reviewQueueMax > off.reviewQueueMax) queueWins += 1;
      if (on.rework > off.rework) reworkWins += 1;
    }
    // 多数の seed で一貫して AI あり > AI なし になること。
    expect(queueWins).toBeGreaterThanOrEqual(4);
    expect(reworkWins).toBeGreaterThanOrEqual(4);
  });

  it('AIありは AI 利用率が高く、AIなしは 0%', () => {
    expect(runSprint('pct', false).result.aiAssistedPct).toBe(0);
    expect(runSprint('pct', true).result.aiAssistedPct).toBeGreaterThan(0);
  });
});

describe('リザルトの整合性', () => {
  it('鎮火 + 延焼 = 障害総数、シニア体力は消耗する', () => {
    const { result } = runSprint('coherent', true);
    expect(result.contained + result.spread).toBe(result.incidents);
    expect(result.seniorHpDelta).toBeLessThanOrEqual(0);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(result.grade);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.diagnosis.length).toBeGreaterThan(0);
  });
});
