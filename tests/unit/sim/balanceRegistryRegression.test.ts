import { describe, expect, it } from 'vitest';
import { createOrgState } from '../../../src/sim/org';
import { createRng, getRngState } from '../../../src/sim/rng';
import { createSprint, resolveSprintConfig, stepSprint } from '../../../src/sim/sprint';

// RI-106の移行時goldenを恒久契約から分離した理由は
// docs/legacy-engine-test-migration.md を参照。工程単体の統制条件であり、
// RunEngineの難易度・メンバー編成を再現するfixtureではない。
const SEEDS = ['ri-106-balance-registry', 's1', 's2', 's3', 's4', 's5'];
const OBSERVATION_TICKS = 50;

function simulate(seed: string, aiEnabled: boolean) {
  const org = createOrgState('default', aiEnabled);
  const initialOrg = { ...org };
  const rng = createRng(seed);
  const sprint = createSprint(resolveSprintConfig('default'), org, rng);
  for (let tick = 0; tick < OBSERVATION_TICKS; tick += 1) {
    stepSprint(sprint, org, rng, tick);
  }
  return { initialOrg, org, sprint, rngState: getRngState(rng) };
}

describe('工程レジストリの再現性とAI因果（旧RI-106 fixtureの移行先）', () => {
  it.each(SEEDS)('%s は同じseed・AI設定・tick列でorgとsprintと乱数消費位置が一致する', (seed) => {
    for (const aiEnabled of [false, true]) {
      expect(simulate(seed, aiEnabled)).toEqual(simulate(seed, aiEnabled));
    }
  });

  it.each(SEEDS)('%s はAIなしで依存が増えず、AIありでは利用と依存増加が発生する', (seed) => {
    const off = simulate(seed, false);
    const on = simulate(seed, true);
    // AIフラグ以外の初期工程・タスク抽選条件を揃えたペア。
    expect(off.sprint.config).toEqual(on.sprint.config);
    expect(off.sprint.tasks.map(({ kind, highValue }) => ({ kind, highValue }))).toEqual(
      on.sprint.tasks.map(({ kind, highValue }) => ({ kind, highValue })),
    );
    expect(off.sprint.metrics.completedCount).toBeGreaterThan(0);
    expect(on.sprint.metrics.completedCount).toBeGreaterThan(0);
    expect(off.sprint.metrics.aiAssistedCompleted).toBe(0);
    expect(off.sprint.tasks.every((task) => !task.aiAssisted)).toBe(true);
    expect(off.org.aiDependency).toBe(off.initialOrg.aiDependency);
    expect(on.sprint.metrics.aiAssistedCompleted).toBeGreaterThan(0);
    expect(on.org.aiDependency - on.initialOrg.aiDependency).toBeGreaterThanOrEqual(30);

    for (const { initialOrg, org, sprint } of [off, on]) {
      for (const value of [org.aiDependency, org.morale, org.seniorHp]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
      expect(sprint.metrics.aiAssistedCompleted).toBeLessThanOrEqual(sprint.metrics.completedCount);
      expect(sprint.metrics.doneCount).toBe(
        sprint.tasks.filter((task) => task.lane === 'done').length,
      );
      expect(org.deliveryScore - initialOrg.deliveryScore).toBe(sprint.metrics.delivered);
      expect(sprint.reviewAccumulator).toBeGreaterThanOrEqual(0);
      expect(sprint.reviewAccumulator).toBeLessThan(1);
    }
  });

  it('複数seedのペアでAIによるReview渋滞とRework増加の効果量を保つ', () => {
    const pairs = SEEDS.map((seed) => ({ off: simulate(seed, false), on: simulate(seed, true) }));
    const queueWins = pairs.filter(
      ({ off, on }) => on.sprint.metrics.reviewQueueMax > off.sprint.metrics.reviewQueueMax,
    ).length;
    const reworkWins = pairs.filter(
      ({ off, on }) => on.sprint.metrics.reworkCount > off.sprint.metrics.reworkCount,
    ).length;
    const queueOff = pairs.reduce((sum, { off }) => sum + off.sprint.metrics.reviewQueueMax, 0);
    const queueOn = pairs.reduce((sum, { on }) => sum + on.sprint.metrics.reviewQueueMax, 0);
    const reworkOff = pairs.reduce((sum, { off }) => sum + off.sprint.metrics.reworkCount, 0);
    const reworkOn = pairs.reduce((sum, { on }) => sum + on.sprint.metrics.reworkCount, 0);

    // 現行6seed・50tickの移行前集計はqueue 98/45、Rework 35/10。
    // 最終桁や単一seedの配置ではなく、多数のペアと最低効果量を守る。
    expect(queueWins).toBeGreaterThanOrEqual(5);
    expect(reworkWins).toBeGreaterThanOrEqual(5);
    expect(queueOff).toBeGreaterThan(0);
    expect(reworkOff).toBeGreaterThan(0);
    expect(queueOn).toBeGreaterThanOrEqual(queueOff * 1.5);
    expect(reworkOn).toBeGreaterThanOrEqual(reworkOff * 2);
  });

  it.each([false, true])('AI=%s の完了後stepは組織・工程・乱数を変更しない', (aiEnabled) => {
    const org = createOrgState('default', aiEnabled);
    const rng = createRng('ri-106-balance-registry');
    const sprint = createSprint(resolveSprintConfig('default'), org, rng);
    let tick = 0;
    while (!sprint.complete && tick <= sprint.config.maxTicks) {
      stepSprint(sprint, org, rng, tick);
      tick += 1;
    }
    expect(sprint.complete).toBe(true);
    const before = structuredClone({ org, sprint, rngState: getRngState(rng) });
    stepSprint(sprint, org, rng, tick);
    expect({ org, sprint, rngState: getRngState(rng) }).toEqual(before);
  });
});
