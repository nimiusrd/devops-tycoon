import { describe, expect, it } from 'vitest';
import { ACTION_DEFS } from '../../src/data/actions';
import { ANDON_TICKS, applyAction, OVERTIME_TICKS, THROTTLE_TICKS } from '../../src/sim/actions';
import { BURN_TICKS } from '../../src/sim/model';
import { createOrgState } from '../../src/sim/org';
import { createSprint, resolveSprintConfig } from '../../src/sim/sprint';
import { createEngine, type Engine } from '../../src/sim/engine';
import type { ActionId, OrgState, SimState, SprintState, Task } from '../../src/sim/types';

const TICK = 42;
const rng = () => 0.99;

const makeTask = (id: number, overrides: Partial<Task> = {}): Task => ({
  id,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane: 'review',
  progress: 0,
  reworkAttempts: 0,
  wasReworked: false,
  incident: false,
  debt: false,
  ...overrides,
});

const burningTask = (id: number, burnTicksLeft = BURN_TICKS): Task =>
  makeTask(id, { lane: 'rework', incident: true, burnTicksLeft, reworkAttempts: 1 });

function makeSprint(org: OrgState, tasks: Task[]): SprintState {
  const sprint = createSprint(resolveSprintConfig('default'), org, rng);
  sprint.tasks = tasks;
  return sprint;
}

const reviewCount = (s: SimState): number =>
  s.sprint.tasks.filter((t) => t.lane === 'review').length;

/** 述語が満たされるまで（または上限まで）1 tick ずつ前進させる。 */
function stepUntil(e: Engine, pred: (s: SimState) => boolean, maxTicks = 4000): SimState {
  let s = e.snapshot();
  let guard = 0;
  while (!pred(s) && !e.isComplete() && guard < maxTicks) {
    e.step(100);
    s = e.snapshot();
    guard += 1;
  }
  return s;
}

/** アクション別の成功用 fixture（tasks + 発動前の観測用スナップショット）。 */
interface ActionFixture {
  tasks: Task[];
  /** 副作用検証用。apply 前に呼ばれる。 */
  before?: (ctx: { sprint: SprintState; org: OrgState }) => void;
  /** 副作用検証。apply 後に呼ばれる。 */
  assertEffect: (ctx: {
    sprint: SprintState;
    org: OrgState;
    before: { sprint: SprintState; org: OrgState };
  }) => void;
}

const ACTION_FIXTURES: Record<ActionId, ActionFixture> = {
  interruptReview: {
    tasks: Array.from({ length: 5 }, (_, i) => makeTask(i)),
    assertEffect: ({ sprint, before }) => {
      const beforeReview = before.sprint.tasks.filter((t) => t.lane === 'review').length;
      const afterReview = sprint.tasks.filter((t) => t.lane === 'review').length;
      expect(afterReview).toBeLessThan(beforeReview);
    },
  },
  splitPr: {
    tasks: [makeTask(0, { kind: 'complex', lane: 'coding', progress: 0.5 })],
    assertEffect: ({ sprint, before }) => {
      const target = sprint.tasks[0];
      expect(target.split).toBe(true);
      expect(target.progress).toBeLessThan(before.sprint.tasks[0].progress);
    },
  },
  firefight: {
    tasks: [burningTask(0), makeTask(1)],
    assertEffect: ({ sprint }) => {
      const t = sprint.tasks[0];
      expect(t.incident).toBe(false);
      expect(t.burnTicksLeft).toBeUndefined();
      expect(t.lane).toBe('review');
      expect(sprint.metrics.contained).toBe(1);
    },
  },
  assignTask: {
    tasks: [makeTask(0, { lane: 'coding', progress: 0.2 })],
    assertEffect: ({ sprint, org, before }) => {
      expect(sprint.tasks[0].progress).toBeGreaterThan(before.sprint.tasks[0].progress);
      expect(sprint.tasks[0].split).toBe(true);
      expect(org.morale).toBeLessThan(before.org.morale);
    },
  },
  aiThrottle: {
    tasks: [],
    assertEffect: ({ sprint }) => {
      expect(sprint.modifiers.throttleUntilTick).toBe(TICK + THROTTLE_TICKS);
    },
  },
  pairReview: {
    tasks: [makeTask(0), makeTask(1), makeTask(2)],
    assertEffect: ({ sprint, org, before }) => {
      const beforeReview = before.sprint.tasks.filter((t) => t.lane === 'review').length;
      const afterReview = sprint.tasks.filter((t) => t.lane === 'review').length;
      expect(afterReview).toBeLessThan(beforeReview);
      expect(org.aiLiteracy).toBeGreaterThan(before.org.aiLiteracy);
    },
  },
  overtime: {
    tasks: [],
    assertEffect: ({ sprint, org, before }) => {
      expect(sprint.modifiers.overtimeUntilTick).toBe(TICK + OVERTIME_TICKS);
      expect(org.morale).toBeLessThan(before.org.morale);
      expect(org.seniorHp).toBeLessThan(before.org.seniorHp);
    },
  },
  andon: {
    tasks: [],
    assertEffect: ({ sprint }) => {
      expect(sprint.modifiers.andonUntilTick).toBe(TICK + ANDON_TICKS);
    },
  },
};

/** 対象なしで no-target になるアクションと空 fixture。 */
const NO_TARGET_CASES: { id: ActionId; tasks: Task[] }[] = [
  { id: 'interruptReview', tasks: [] },
  { id: 'splitPr', tasks: [makeTask(0, { split: true, lane: 'coding' })] },
  { id: 'firefight', tasks: [makeTask(0, { lane: 'review' })] },
  { id: 'assignTask', tasks: [makeTask(0, { lane: 'review' })] },
];

describe('介入アクション: テーブル駆動（RI-35 / 第6.1）', () => {
  describe.each(ACTION_DEFS.map((def) => [def.id, def] as const))('%s', (id, def) => {
    it('成功時は集中力・クールダウン・集計・連携ゲージの共通契約を満たす', () => {
      const org = createOrgState('default', true);
      const fixture = ACTION_FIXTURES[id];
      const sprint = makeSprint(org, fixture.tasks);
      fixture.before?.({ sprint, org });
      const before = {
        sprint: structuredClone(sprint),
        org: structuredClone(org),
      };
      const focus0 = sprint.focus;
      const gauge0 = sprint.comboGauge;
      const interventions0 = sprint.metrics.interventionsUsed;
      const focusSpent0 = sprint.metrics.focusSpent;
      const actionCount0 = sprint.metrics.actionCounts[id] ?? 0;

      const outcome = applyAction(id, sprint, org, rng, TICK);

      expect(outcome).toEqual({ ok: true });
      expect(sprint.focus).toBe(focus0 - def.cost);
      expect(sprint.cooldowns[id]).toBe(def.cooldownTicks);
      expect(sprint.metrics.interventionsUsed).toBe(interventions0 + 1);
      expect(sprint.metrics.focusSpent).toBe(focusSpent0 + def.cost);
      expect(sprint.metrics.actionCounts[id]).toBe(actionCount0 + 1);
      expect(sprint.comboGauge).toBeCloseTo(gauge0 + def.gauge, 5);
      fixture.assertEffect({ sprint, org, before });
    });
  });

  describe('失敗理由の共通契約', () => {
    it.each(NO_TARGET_CASES)('$id は対象なしで no-target（コスト不消費）', ({ id, tasks }) => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, tasks);
      const focus0 = sprint.focus;

      const outcome = applyAction(id, sprint, org, rng, TICK);

      expect(outcome).toEqual({ ok: false, reason: 'no-target' });
      expect(sprint.focus).toBe(focus0);
      expect(sprint.metrics.interventionsUsed).toBe(0);
    });

    it('クールダウン中は cooldown で失敗し集中力は減らない', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, ACTION_FIXTURES.interruptReview.tasks);
      expect(applyAction('interruptReview', sprint, org, rng, TICK).ok).toBe(true);
      const focusMid = sprint.focus;

      const retry = applyAction('interruptReview', sprint, org, rng, TICK + 1);

      expect(retry).toEqual({ ok: false, reason: 'cooldown' });
      expect(sprint.focus).toBe(focusMid);
    });

    it('集中力不足は no-focus で失敗する', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, []);
      sprint.focus = 1;

      const outcome = applyAction('splitPr', sprint, org, rng, TICK);

      expect(outcome).toEqual({ ok: false, reason: 'no-focus' });
      expect(sprint.focus).toBe(1);
    });

    it('完了済みスプリントは complete で失敗する', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, []);
      sprint.complete = true;

      const outcome = applyAction('andon', sprint, org, rng, TICK);

      expect(outcome).toEqual({ ok: false, reason: 'complete' });
    });
  });
});

describe('介入で結果が変わる（DoD: 操作で結果が変わる）', () => {
  /** 指定 tick で 1 度だけ overtime を撃ち、最後までまわした結果を返す。 */
  function runWithIntervention(dispatchAt: number | null) {
    const e = createEngine({ seed: 'intervene', aiEnabled: true });
    let guard = 0;
    while (!e.isComplete() && guard < 100_000) {
      if (dispatchAt !== null && e.snapshot().tick === dispatchAt) {
        e.dispatch('overtime');
      }
      e.step(100);
      guard += 1;
    }
    return e.result();
  }

  it('介入の有無でリザルトが変わる', () => {
    const base = runWithIntervention(null);
    const intervened = runWithIntervention(20);
    const differs =
      base.delivered !== intervened.delivered ||
      base.reviewQueueMax !== intervened.reviewQueueMax ||
      base.rework !== intervened.rework ||
      base.seniorHpDelta !== intervened.seniorHpDelta;
    expect(differs).toBe(true);
  });

  it('リザルトに介入内訳が種類別に集計される', () => {
    const e = createEngine({ seed: 'result-interventions', aiEnabled: true });
    stepUntil(e, (s) => reviewCount(s) >= 4);
    expect(e.dispatch('interruptReview').ok).toBe(true);
    expect(e.dispatch('overtime').ok).toBe(true);

    let guard = 0;
    while (!e.isComplete() && guard < 100_000) {
      e.step(100);
      guard += 1;
    }
    expect(e.isComplete()).toBe(true);

    const result = e.result();
    expect(result.actionCounts.interruptReview).toBe(1);
    expect(result.actionCounts.overtime).toBe(1);
  });
});
