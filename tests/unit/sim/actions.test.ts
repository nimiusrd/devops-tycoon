import { describe, expect, it } from 'vitest';
import { ACTION_DEFS } from '../../../src/data/actions';
import {
  ANDON_THIN_MORALE_COST,
  ANDON_TICKS,
  applyAction,
  ASSIGN_MORALE_COST,
  canApplyAction,
  FIREFIGHT_HP_COST,
  FIREFIGHT_STABILITY_BURN_TICKS,
  firefightHpCost,
  INTERRUPT_HP_COST,
  OVERTIME_HP_COST,
  OVERTIME_MORALE_COST,
  OVERTIME_TICKS,
  PAIR_LITERACY_GAIN,
  PAIR_REVIEW_COUNT,
  STABILITY_TICKS,
  THROTTLE_TICKS,
} from '../../../src/sim/actions';
import {
  deliveryComboMultiplier,
  STABILITY_HIGH_VALUE_COMBO_THRESHOLD,
  STABILITY_HIGH_VALUE_MUL,
  taskValue,
} from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import { createSprint, resolveSprintConfig, reviewOne, stepSprint } from '../../../src/sim/sprint';
import { createEngine, type Engine } from '../../../src/sim/engine';
import type {
  ActionId,
  InterventionEffect,
  OrgState,
  SimState,
  SprintState,
  Task,
} from '../../../src/sim/types';
import { burningTask, makeSprint as makeSprintWith, makeTask } from '../helpers/sprintFixtures';

const TICK = 42;
const rng = () => 0.99;

/** このファイルの固定 rng を束ねた共通フィクスチャの別名。 */
const makeSprint = (org: OrgState, tasks: Task[]): SprintState => makeSprintWith(org, tasks, rng);

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
  /** 期待する効果ペイロード（RI-49）。 */
  expectedEffect: (def: { cost: number; gauge: number }) => InterventionEffect;
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
    expectedEffect: (def) => ({
      actionId: 'interruptReview',
      reviewedCount: 4,
      affectedTaskIds: [0, 1, 2, 3],
      hpCost: INTERRUPT_HP_COST,
      focusCost: def.cost,
      gaugeGain: def.gauge,
    }),
    assertEffect: ({ sprint, before }) => {
      const beforeReview = before.sprint.tasks.filter((t) => t.lane === 'review').length;
      const afterReview = sprint.tasks.filter((t) => t.lane === 'review').length;
      expect(afterReview).toBeLessThan(beforeReview);
    },
  },
  splitPr: {
    tasks: [makeTask(0, { kind: 'complex', lane: 'coding', progress: 0.5 })],
    expectedEffect: (def) => ({
      actionId: 'splitPr',
      affectedTaskIds: [0],
      focusCost: def.cost,
      gaugeGain: def.gauge,
    }),
    assertEffect: ({ sprint, before }) => {
      const target = sprint.tasks[0];
      expect(target.split).toBe(true);
      expect(target.progress).toBeLessThan(before.sprint.tasks[0].progress);
    },
  },
  firefight: {
    tasks: [burningTask(0), makeTask(1)],
    expectedEffect: (def) => ({
      actionId: 'firefight',
      containedTaskId: 0,
      hpCost: FIREFIGHT_HP_COST,
      focusCost: def.cost,
      gaugeGain: def.gauge,
    }),
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
    expectedEffect: (def) => ({
      actionId: 'assignTask',
      affectedTaskIds: [0],
      // normal は理想差配扱い → 士気コスト半減（RI-30）。
      moraleCost: Math.max(1, Math.floor(ASSIGN_MORALE_COST / 2)),
      focusCost: def.cost,
      gaugeGain: def.gauge,
    }),
    assertEffect: ({ sprint, org, before }) => {
      expect(sprint.tasks[0].progress).toBeGreaterThan(before.sprint.tasks[0].progress);
      expect(sprint.tasks[0].split).toBe(true);
      expect(org.morale).toBeLessThan(before.org.morale);
    },
  },
  aiThrottle: {
    tasks: [],
    expectedEffect: (def) => ({
      actionId: 'aiThrottle',
      modifier: { kind: 'throttle', untilTick: TICK + THROTTLE_TICKS },
      focusCost: def.cost,
      gaugeGain: def.gauge,
    }),
    assertEffect: ({ sprint }) => {
      expect(sprint.modifiers.throttleUntilTick).toBe(TICK + THROTTLE_TICKS);
    },
  },
  pairReview: {
    tasks: [makeTask(0), makeTask(1), makeTask(2)],
    expectedEffect: (def) => ({
      actionId: 'pairReview',
      reviewedCount: PAIR_REVIEW_COUNT,
      affectedTaskIds: [0, 1],
      literacyGain: PAIR_LITERACY_GAIN,
      focusCost: def.cost,
      gaugeGain: def.gauge,
    }),
    assertEffect: ({ sprint, org, before }) => {
      const beforeReview = before.sprint.tasks.filter((t) => t.lane === 'review').length;
      const afterReview = sprint.tasks.filter((t) => t.lane === 'review').length;
      expect(afterReview).toBeLessThan(beforeReview);
      expect(org.aiLiteracy).toBeGreaterThan(before.org.aiLiteracy);
    },
  },
  overtime: {
    tasks: [],
    expectedEffect: (def) => ({
      actionId: 'overtime',
      modifier: { kind: 'overtime', untilTick: TICK + OVERTIME_TICKS },
      hpCost: OVERTIME_HP_COST,
      moraleCost: OVERTIME_MORALE_COST,
      focusCost: def.cost,
      gaugeGain: def.gauge,
    }),
    assertEffect: ({ sprint, org, before }) => {
      expect(sprint.modifiers.overtimeUntilTick).toBe(TICK + OVERTIME_TICKS);
      expect(org.morale).toBeLessThan(before.org.morale);
      expect(org.seniorHp).toBeLessThan(before.org.seniorHp);
    },
  },
  andon: {
    // 薄キュー（Review 0）→ 安定なし＋士気ペナ（RI-73 / F-1）。
    tasks: [],
    expectedEffect: (def) => ({
      actionId: 'andon',
      modifier: { kind: 'andon', untilTick: TICK + ANDON_TICKS },
      moraleCost: ANDON_THIN_MORALE_COST,
      focusCost: def.cost,
      gaugeGain: def.gauge,
    }),
    assertEffect: ({ sprint, org, before }) => {
      expect(sprint.modifiers.andonUntilTick).toBe(TICK + ANDON_TICKS);
      expect(org.morale).toBe(before.org.morale - ANDON_THIN_MORALE_COST);
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

      expect(outcome.ok).toBe(true);
      expect(outcome.effect).toEqual(fixture.expectedEffect(def));
      expect(sprint.focus).toBe(focus0 - def.cost);
      expect(sprint.cooldowns[id]).toBe(def.cooldownTicks);
      expect(sprint.metrics.interventionsUsed).toBe(interventions0 + 1);
      expect(sprint.metrics.focusSpent).toBe(focusSpent0 + def.cost);
      expect(sprint.metrics.actionCounts[id]).toBe(actionCount0 + 1);
      expect(sprint.comboGauge).toBeCloseTo(gauge0 + def.gauge, 5);
      // RI-73 / F-1: firefight（軽い炎上）と andon（薄キュー）は stabilizesFlow でも安定を付けない。
      const expectStability =
        def.stabilizesFlow && id !== 'firefight' && id !== 'andon' ? TICK + STABILITY_TICKS : 0;
      expect(sprint.modifiers.stabilityUntilTick).toBe(expectStability);
      fixture.assertEffect({ sprint, org, before });
    });
  });

  describe('RI-73 / F-1: 緊急対応・アンドンの状況依存', () => {
    it('軽い炎上の緊急対応は運用安定を付けない', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, [burningTask(0)]);
      const outcome = applyAction('firefight', sprint, org, rng, TICK);
      expect(outcome.ok).toBe(true);
      expect(sprint.modifiers.stabilityUntilTick).toBe(0);
      expect(outcome.effect?.hpCost).toBe(FIREFIGHT_HP_COST);
    });

    it('猶予が短い炎上の緊急対応は運用安定を付ける', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, [burningTask(0, FIREFIGHT_STABILITY_BURN_TICKS)]);
      const outcome = applyAction('firefight', sprint, org, rng, TICK);
      expect(outcome.ok).toBe(true);
      expect(sprint.modifiers.stabilityUntilTick).toBe(TICK + STABILITY_TICKS);
    });

    it('炎上が複数ある緊急対応は運用安定を付ける', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, [burningTask(0), burningTask(1)]);
      const outcome = applyAction('firefight', sprint, org, rng, TICK);
      expect(outcome.ok).toBe(true);
      expect(sprint.modifiers.stabilityUntilTick).toBe(TICK + STABILITY_TICKS);
    });

    it('同一スプリントの緊急対応連打は HP コストが逓増する', () => {
      const org = createOrgState('default', true);
      org.seniorHp = 80;
      const sprint = makeSprint(org, [burningTask(0), burningTask(1), burningTask(2)]);
      const first = applyAction('firefight', sprint, org, rng, TICK);
      expect(first.ok).toBe(true);
      expect(first.effect?.hpCost).toBe(firefightHpCost(0));
      sprint.cooldowns.firefight = 0;
      sprint.focus = sprint.config.focusMax;
      const hpAfterFirst = org.seniorHp;
      const second = applyAction('firefight', sprint, org, rng, TICK + 1);
      expect(second.ok).toBe(true);
      expect(second.effect?.hpCost).toBe(firefightHpCost(1));
      expect(hpAfterFirst - org.seniorHp).toBe(firefightHpCost(1));
    });

    it('Review が詰まっているアンドンは運用安定を付け士気を削らない', () => {
      const org = createOrgState('default', true);
      const tasks = Array.from({ length: 10 }, (_, i) => makeTask(i));
      const sprint = makeSprint(org, tasks);
      const morale0 = org.morale;
      const outcome = applyAction('andon', sprint, org, rng, TICK);
      expect(outcome.ok).toBe(true);
      expect(outcome.effect?.moraleCost).toBeUndefined();
      expect(org.morale).toBe(morale0);
      expect(sprint.modifiers.stabilityUntilTick).toBe(TICK + STABILITY_TICKS);
    });
  });

  it('安全側の介入で作る運用安定は、Review の手戻りを抑える', () => {
    const riskyOrg = () => ({
      ...createOrgState('default', true),
      aiDependency: 90,
      aiLiteracy: 10,
      quality: 20,
    });
    const riskyTask = () => makeTask(0, { aiAssisted: true });
    // 1回目は炎上を外す。2回目の 0.165 は素の手戻り率（0.392）では発生し、
    // 安定時の0.4倍（0.1568）では通過する。0.45倍以上へ戻すと回帰する境界値。
    const boundaryRng = (() => {
      const values = [0.99, 0.165];
      return () => values.shift() ?? 0.99;
    })();

    const unstableOrg = riskyOrg();
    const unstable = makeSprint(unstableOrg, [riskyTask()]);
    reviewOne(unstable.tasks[0], unstable, unstableOrg, boundaryRng, TICK);
    expect(unstable.tasks[0].lane).toBe('rework');

    const stableOrg = riskyOrg();
    const stable = makeSprint(stableOrg, [riskyTask()]);
    stable.modifiers.stabilityUntilTick = TICK + 1;
    reviewOne(
      stable.tasks[0],
      stable,
      stableOrg,
      (() => {
        const values = [0.99, 0.165];
        return () => values.shift() ?? 0.99;
      })(),
      TICK,
    );
    expect(stable.tasks[0].lane).toBe('done');
    expect(stable.tasks[0].incident).toBe(false);
  });

  it('安全側の介入で作る運用安定は、燃え尽き時の延焼を防ぐ', () => {
    const org = createOrgState('default', true);
    org.seniorHp = 0;
    const sprint = makeSprint(org, [burningTask(0, 1)]);
    sprint.modifiers.stabilityUntilTick = TICK + 1;

    stepSprint(sprint, org, rng, TICK);

    expect(sprint.tasks[0].incident).toBe(false);
    expect(sprint.tasks[0].lane).toBe('rework');
    expect(sprint.metrics.contained).toBe(1);
    expect(sprint.metrics.autoContainCount).toBe(1);
    expect(sprint.metrics.spread).toBe(0);
  });

  it('安全側の介入で作る運用安定は、連続出荷ボーナスの計上を抑える', () => {
    const stableOrg = createOrgState('default', true);
    const stable = makeSprint(stableOrg, [makeTask(0, { kind: 'complex', highValue: true })]);
    stable.metrics.combo = STABILITY_HIGH_VALUE_COMBO_THRESHOLD;
    stable.metrics.maxCombo = STABILITY_HIGH_VALUE_COMBO_THRESHOLD;
    stable.modifiers.stabilityUntilTick = TICK + 1;

    const unstableOrg = createOrgState('default', true);
    const unstable = makeSprint(unstableOrg, [makeTask(0, { kind: 'complex', highValue: true })]);
    unstable.metrics.combo = STABILITY_HIGH_VALUE_COMBO_THRESHOLD;
    unstable.metrics.maxCombo = STABILITY_HIGH_VALUE_COMBO_THRESHOLD;

    reviewOne(stable.tasks[0], stable, stableOrg, rng, TICK);
    reviewOne(unstable.tasks[0], unstable, unstableOrg, rng, TICK);

    expect(stable.metrics.combo).toBe(STABILITY_HIGH_VALUE_COMBO_THRESHOLD + 1);
    expect(stable.metrics.maxCombo).toBe(STABILITY_HIGH_VALUE_COMBO_THRESHOLD + 1);
    expect(stable.metrics.delivered).toBe(
      Math.round(
        taskValue(stable.tasks[0]) *
          STABILITY_HIGH_VALUE_MUL *
          deliveryComboMultiplier(stable.metrics.combo, true),
      ),
    );
    expect(stable.metrics.delivered).toBeLessThan(unstable.metrics.delivered);
  });

  it.each(['interruptReview', 'pairReview'] as const)(
    '%s の即時 Review にも運用安定を適用する',
    (actionId) => {
      const org = {
        ...createOrgState('default', true),
        aiDependency: 90,
        aiLiteracy: 10,
        quality: 20,
      };
      const sprint = makeSprint(org, [makeTask(0, { aiAssisted: true })]);
      const boundaryRng = (() => {
        const values = [0.99, 0.35];
        return () => values.shift() ?? 0.99;
      })();

      const outcome = applyAction(actionId, sprint, org, boundaryRng, TICK);

      expect(outcome.ok).toBe(true);
      expect(sprint.modifiers.stabilityUntilTick).toBe(TICK + STABILITY_TICKS);
      expect(sprint.tasks[0].lane).toBe('done');
      expect(sprint.tasks[0].incident).toBe(false);
    },
  );

  it('運用安定は完了時に出荷を直接加算しない', () => {
    const org = createOrgState('default', true);
    const sprint = createSprint(
      resolveSprintConfig('default', { taskCount: 4, minCompleteTick: 2 }),
      org,
      rng,
    );
    sprint.tasks = Array.from({ length: 4 }, (_, id) => makeTask(id, { lane: 'done' }));
    sprint.metrics.delivered = 20;
    sprint.modifiers.stabilityUntilTick = 3;
    const deliveryBefore = org.deliveryScore;

    stepSprint(sprint, org, rng, 1);
    expect(sprint.complete).toBe(false);
    expect(sprint.metrics.delivered).toBe(20);

    stepSprint(sprint, org, rng, 2);
    expect(sprint.complete).toBe(true);
    expect(sprint.metrics.delivered).toBe(20);
    expect(org.deliveryScore).toBe(deliveryBefore);
  });

  describe('失敗理由の共通契約', () => {
    it.each(NO_TARGET_CASES)('$id は対象なしで no-target（コスト不消費）', ({ id, tasks }) => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, tasks);
      sprint.modifiers.stabilityUntilTick = TICK + 7;
      const focus0 = sprint.focus;

      const outcome = applyAction(id, sprint, org, rng, TICK);

      expect(outcome).toEqual({ ok: false, reason: 'no-target' });
      expect(outcome.effect).toBeUndefined();
      expect(sprint.focus).toBe(focus0);
      expect(sprint.metrics.interventionsUsed).toBe(0);
      expect(sprint.modifiers.stabilityUntilTick).toBe(TICK + 7);
    });

    it('クールダウン中は cooldown で失敗し集中力は減らない', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, ACTION_FIXTURES.interruptReview.tasks);
      expect(applyAction('interruptReview', sprint, org, rng, TICK).ok).toBe(true);
      const focusMid = sprint.focus;

      const retry = applyAction('interruptReview', sprint, org, rng, TICK + 1);

      expect(retry).toEqual({ ok: false, reason: 'cooldown' });
      expect(retry.effect).toBeUndefined();
      expect(sprint.focus).toBe(focusMid);
    });

    it('集中力不足は no-focus で失敗する', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, []);
      sprint.focus = 1;

      const outcome = applyAction('splitPr', sprint, org, rng, TICK);

      expect(outcome).toEqual({ ok: false, reason: 'no-focus' });
      expect(outcome.effect).toBeUndefined();
      expect(sprint.focus).toBe(1);
    });

    it('完了済みスプリントは complete で失敗する', () => {
      const org = createOrgState('default', true);
      const sprint = makeSprint(org, []);
      sprint.complete = true;

      const outcome = applyAction('andon', sprint, org, rng, TICK);

      expect(outcome).toEqual({ ok: false, reason: 'complete' });
      expect(outcome.effect).toBeUndefined();
    });
  });
});

describe('介入アクション: 効果ペイロード（RI-49）', () => {
  it('連携ゲージ満タン時は focusRefund を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0)]);
    sprint.comboGauge = 0.9;
    sprint.focus = 5;

    const outcome = applyAction('firefight', sprint, org, rng, TICK);

    expect(outcome.ok).toBe(true);
    expect(outcome.effect?.focusRefund).toBe(3);
    expect(sprint.focus).toBe(7);
  });

  it('集中力上限付近では focusRefund は clamp 後の実増分を返す', () => {
    const org = createOrgState('default', true);
    const sprint = makeSprint(org, [burningTask(0)]);
    sprint.comboGauge = 0.9;
    sprint.focus = sprint.config.focusMax;

    const outcome = applyAction('firefight', sprint, org, rng, TICK);

    expect(outcome.ok).toBe(true);
    expect(outcome.effect?.focusRefund).toBe(1);
    expect(sprint.focus).toBe(sprint.config.focusMax);
  });

  it('ステータス境界では hpCost / moraleCost / literacyGain は実際の差分を返す', () => {
    const org = createOrgState('default', true);
    org.morale = 5;
    org.seniorHp = 3;

    const overtime = applyAction('overtime', makeSprint(org, []), org, rng, TICK);
    expect(overtime.effect?.moraleCost).toBe(5);
    expect(overtime.effect?.hpCost).toBe(3);

    const org2 = createOrgState('default', true);
    org2.aiLiteracy = 98;
    const pair = applyAction(
      'pairReview',
      makeSprint(org2, [makeTask(0), makeTask(1)]),
      org2,
      rng,
      TICK,
    );
    expect(pair.effect?.literacyGain).toBe(2);
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

describe('canApplyAction（RI-89 読み取り専用）', () => {
  it('盤面を変更せずに対象不足を検知する', () => {
    const org = createOrgState();
    const sprint = makeSprint(org, []);
    const before = structuredClone(sprint);
    expect(canApplyAction('interruptReview', sprint, org, TICK)).toEqual({
      ok: false,
      reason: 'no-target',
    });
    expect(canApplyAction('firefight', sprint, org, TICK)).toEqual({
      ok: false,
      reason: 'no-target',
    });
    expect(sprint).toEqual(before);
    expect(org).toEqual(createOrgState());
  });

  it('applyAction と同じゲート順で complete / cooldown / focus を返す', () => {
    const org = createOrgState();
    const sprint = makeSprint(org, [makeTask(1)]);
    sprint.complete = true;
    expect(canApplyAction('overtime', sprint, org, TICK).ok).toBe(false);
    expect(canApplyAction('overtime', sprint, org, TICK)).toMatchObject({ reason: 'complete' });

    sprint.complete = false;
    sprint.cooldowns.overtime = 3;
    expect(canApplyAction('overtime', sprint, org, TICK)).toEqual({
      ok: false,
      reason: 'cooldown',
    });

    sprint.cooldowns.overtime = 0;
    sprint.focus = 0;
    expect(canApplyAction('overtime', sprint, org, TICK)).toEqual({
      ok: false,
      reason: 'no-focus',
    });
  });

  it('可なときは applyAction も成功し、否なときは失敗理由が一致する', () => {
    const org = createOrgState();
    const sprint = makeSprint(org, [makeTask(1), burningTask(2)]);
    sprint.focus = 10;
    expect(canApplyAction('firefight', sprint, org, TICK)).toEqual({ ok: true });
    const ok = applyAction('firefight', sprint, org, rng, TICK);
    expect(ok.ok).toBe(true);

    const empty = makeSprint(createOrgState(), []);
    empty.focus = 10;
    const gate = canApplyAction('firefight', empty, createOrgState(), TICK);
    const applied = applyAction('firefight', empty, createOrgState(), rng, TICK);
    expect(gate).toEqual({ ok: false, reason: 'no-target' });
    expect(applied).toMatchObject({ ok: false, reason: 'no-target' });
  });

  it('指定 target が無効なら assignTask は no-target（他候補があっても）', () => {
    const org = createOrgState();
    const sprint = makeSprint(org, [
      makeTask(1, { lane: 'coding' }),
      makeTask(2, { lane: 'review' }),
    ]);
    sprint.focus = 10;
    const bad = { taskId: 2 };
    const gate = canApplyAction('assignTask', sprint, org, TICK, bad);
    const applied = applyAction('assignTask', sprint, org, rng, TICK, bad);
    expect(gate).toEqual({ ok: false, reason: 'no-target' });
    expect(applied).toMatchObject({ ok: false, reason: 'no-target' });
    // target 省略時は Coding 候補があれば可
    expect(canApplyAction('assignTask', sprint, org, TICK)).toEqual({ ok: true });
  });
});
