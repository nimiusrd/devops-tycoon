import { describe, expect, it } from 'vitest';
import { BOSS_DEFS, getBoss } from '../../src/data/bosses';
import type { BossDef } from '../../src/data/bosses';
import { getDifficulty } from '../../src/data/difficulties';
import { getGoalAdjustment } from '../../src/data/goalAdjustments';
import { createOrgState } from '../../src/sim/org';
import { RunEngine } from '../../src/sim/run/engine';
import {
  OUTCOME_LABELS,
  BASELINE_SPRINT_DELIVERY_FLOOR,
  NORMAL_SPRINTS_PER_QUARTER,
  QUARTER_DELIVERY_GOAL_MUL,
  QUARTER_DELIVERY_SCALE,
  QUARTER_DELIVERY_THROUGHPUT_MUL,
  MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
  MIN_PRIOR_QUARTER_DELIVERY_TARGET,
  MIN_QUARTER_DELIVERY_TARGET,
  applyGoalAdjustment,
  applyGoalOrgEffectsToTeam,
  availableAdjustments,
  canAcknowledgeWin,
  canChooseAdjustment,
  buildInitialTrust,
  buildQuarterGoal,
  buildQuarterReview,
  diagnoseMissedReasons,
  evaluateQuarterOutcome,
  isTerminalFailure,
  loseReasonForOutcome,
  measureGoalProgress,
} from '../../src/sim/run/quarterReview';
import { playUntil } from './helpers/runFlow';
import type { OrgState } from '../../src/sim/types';
import type { TeamRunState } from '../../src/sim/orgscale/types';
import type {
  DifficultyId,
  GoalKpiProgress,
  GoalAdjustmentId,
  QuarterGoal,
  QuarterOutcome,
  RunTotals,
  StakeholderTrust,
} from '../../src/sim/run/types';

const org = (o: Partial<OrgState> = {}): OrgState => ({ ...createOrgState('default', true), ...o });

const team = (t: Partial<TeamRunState> = {}): TeamRunState => ({
  id: 'product-t0',
  deptId: 'product',
  name: 'チームA',
  engineers: 5,
  headcount: 5,
  aiLiteracy: 50,
  aiDependency: 40,
  morale: 50,
  techDebt: 40,
  shipping: 100,
  reviewQueue: 2,
  incidents: 1,
  reviewCapacity: 60,
  incidentBias: 0.1,
  seniorHp: 50,
  aiEnabled: true,
  testCoverage: 50,
  documentation: 50,
  quality: 60,
  ...t,
});

const totals = (t: Partial<RunTotals> = {}): RunTotals => ({
  delivered: 0,
  done: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 0,
  aiAssisted: 0,
  completed: 0,
  reviewQueuePeak: 0,
  maxCombo: 0,
  ...t,
});

const goal: QuarterGoal = {
  deliveryTarget: 60,
  qualityTarget: 45,
  techDebtLimit: 55,
  moraleTarget: 40,
  incidentLimit: 6,
};

function progressWithMisses(missedCount: number): GoalKpiProgress[] {
  return ['delivery', 'quality', 'techDebt', 'morale'].map((id, index) => ({
    id,
    label: id,
    target: 10,
    actual: index < missedCount ? 1 : 12,
    status: index < missedCount ? 'missed' : 'met',
  }));
}

function evaluateBoundary(input: {
  missedCount: number;
  trust?: StakeholderTrust;
  budget?: number;
  quarterNumber?: number;
  org?: Partial<OrgState>;
}): QuarterOutcome {
  return evaluateQuarterOutcome({
    bossCleared: false,
    progress: progressWithMisses(input.missedCount),
    trust: input.trust ?? { management: 60, customers: 60, team: 60 },
    org: org({ morale: 60, seniorHp: 60, ...(input.org ?? {}) }),
    budget: input.budget ?? 30,
    quarterNumber: input.quarterNumber ?? 1,
  });
}

describe('四半期レビュー（Phase 8）', () => {
  it('目標達成時は met または exceeded になる', () => {
    const progress = measureGoalProgress({
      goal,
      org: org({ quality: 50, morale: 50, techDebt: 30 }),
      totals: totals({ delivered: 80, incidents: 2, completed: 40, aiAssisted: 10 }),
    });
    const outcome = evaluateQuarterOutcome({
      bossCleared: true,
      progress,
      trust: buildInitialTrust('normal'),
      org: org({ quality: 50, morale: 50 }),
      budget: 30,
      quarterNumber: 1,
    });
    expect(['met', 'exceeded']).toContain(outcome);
  });

  it('軽微な未達は missed_adjustable になり修正選択肢が出る', () => {
    const trust = buildInitialTrust('normal');
    const progress = measureGoalProgress({
      goal,
      org: org({ quality: 50, morale: 45, techDebt: 40 }),
      totals: totals({ delivered: 50, incidents: 3, completed: 30, aiAssisted: 5 }),
    });
    const outcome = evaluateQuarterOutcome({
      bossCleared: false,
      progress,
      trust,
      org: org({ quality: 50, morale: 45, seniorHp: 40 }),
      budget: 20,
      quarterNumber: 1,
    });
    expect(outcome).toBe('missed_adjustable');
    const adjustments = availableAdjustments(
      outcome,
      trust,
      20,
      org({ quality: 50, morale: 45 }),
      totals({ delivered: 50, incidents: 3, completed: 30 }),
    );
    expect(adjustments.length).toBeGreaterThan(0);
    expect(adjustments).toContain('cut_scope');
  });

  it('信頼枯渇時は shutdown になる', () => {
    const trust: StakeholderTrust = { management: 8, customers: 50, team: 50 };
    const progress = measureGoalProgress({
      goal,
      org: org({ quality: 30, morale: 10, techDebt: 70 }),
      totals: totals({ delivered: 10, incidents: 12 }),
    });
    const outcome = evaluateQuarterOutcome({
      bossCleared: false,
      progress,
      trust,
      org: org({ morale: 10, seniorHp: 3 }),
      budget: 0,
      quarterNumber: 1,
    });
    expect(outcome).toBe('shutdown');
    expect(
      availableAdjustments(
        outcome,
        trust,
        0,
        org({ morale: 10 }),
        totals({ delivered: 10, incidents: 12 }),
      ),
    ).toEqual([]);
  });

  it('2四半期目の深刻未達は reorg_required になりうる', () => {
    const trust: StakeholderTrust = { management: 18, customers: 18, team: 18 };
    const progress = measureGoalProgress({
      goal,
      org: org({ quality: 20, morale: 25, techDebt: 80 }),
      totals: totals({ delivered: 5, incidents: 15, completed: 10 }),
    });
    const outcome = evaluateQuarterOutcome({
      bossCleared: false,
      progress,
      trust,
      org: org({ quality: 20, morale: 25 }),
      budget: 10,
      quarterNumber: 2,
    });
    expect(outcome).toBe('reorg_required');
  });

  it('各目標修正アクションの効果と代償が決定論で反映される', () => {
    const input = {
      goal: { ...goal, deliveryTarget: 60 * QUARTER_DELIVERY_SCALE },
      trust: buildInitialTrust('normal'),
      org: org({ deliveryScore: 100, morale: 50, techDebt: 40 }),
      budget: 30,
      goalAdjustmentsTaken: [] as const,
      nextBudgetCap: null as number | null,
    };
    const cut = applyGoalAdjustment(input, 'cut_scope');
    expect(cut.trust.customers).toBeLessThan(input.trust.customers);
    expect(cut.goal.deliveryTarget).toBeLessThan(input.goal.deliveryTarget);

    const budget = applyGoalAdjustment(input, 'request_budget');
    expect(budget.budget).toBeGreaterThan(input.budget);
    expect(budget.trust.management).toBeLessThan(input.trust.management);
    expect(budget.nextBudgetCap).toBe(15);

    const extend = applyGoalAdjustment(input, 'extend_deadline');
    expect(extend.budget).toBe(input.budget - 10);
    expect(extend.goal.qualityTarget).toBeGreaterThan(input.goal.qualityTarget);
  });

  it('同一入力では同一レビュー結果になる（決定論）', () => {
    const boss = getBoss('big-release')!;
    const build = () =>
      buildQuarterReview({
        goal: buildQuarterGoal(boss, 'normal', 1),
        org: org({ quality: 35, morale: 38, techDebt: 50 }),
        totals: totals({ delivered: 30, incidents: 8, completed: 25 }),
        trust: buildInitialTrust('normal'),
        budget: 25,
        quarterNumber: 1,
        bossSprintCleared: false,
      });
    expect(build()).toEqual(build());
  });

  it('ボス突破でも KPI 未達なら missed_adjustable になる', () => {
    const progress = measureGoalProgress({
      goal,
      org: org({ quality: 30, morale: 50, techDebt: 60 }),
      totals: totals({ delivered: 80, incidents: 2, completed: 40 }),
    });
    const outcome = evaluateQuarterOutcome({
      bossCleared: true,
      progress,
      trust: buildInitialTrust('normal'),
      org: org({ quality: 30, morale: 50 }),
      budget: 30,
      quarterNumber: 1,
    });
    expect(outcome).toBe('missed_adjustable');
  });

  it('RI-17: outcome 閾値の境界と優先順位が許容レンジ内', () => {
    const cases: Array<{
      name: string;
      input: Parameters<typeof evaluateBoundary>[0];
      expected: QuarterOutcome;
    }> = [
      {
        name: 'minTrust=10 は shutdown',
        input: { missedCount: 1, trust: { management: 10, customers: 60, team: 60 } },
        expected: 'shutdown',
      },
      {
        name: 'minTrust=11 は shutdown ではなく missed_crisis',
        input: { missedCount: 1, trust: { management: 11, customers: 60, team: 60 } },
        expected: 'missed_crisis',
      },
      {
        name: '予算0かつ士気15は shutdown',
        input: { missedCount: 1, budget: 0, org: { morale: 15 } },
        expected: 'shutdown',
      },
      {
        name: '予算0でも士気16なら crisis に留まる',
        input: { missedCount: 1, budget: 0, org: { morale: 16 } },
        expected: 'missed_crisis',
      },
      {
        name: 'Senior HP 5 かつ未達2件は shutdown',
        input: { missedCount: 2, org: { seniorHp: 5 } },
        expected: 'shutdown',
      },
      {
        name: 'Senior HP 6 かつ未達2件は調整可能',
        input: { missedCount: 2, org: { seniorHp: 6 } },
        expected: 'missed_adjustable',
      },
      {
        name: '2四半期目の未達3件は reorg_required',
        input: { missedCount: 3, quarterNumber: 2 },
        expected: 'reorg_required',
      },
      {
        name: '1四半期目の未達3件は調整可能',
        input: { missedCount: 3, quarterNumber: 1 },
        expected: 'missed_adjustable',
      },
      {
        name: 'minTrust=20 かつ未達2件は reorg_required',
        input: { missedCount: 2, trust: { management: 20, customers: 60, team: 60 } },
        expected: 'reorg_required',
      },
      {
        name: 'minTrust=21 かつ未達2件は調整可能',
        input: { missedCount: 2, trust: { management: 21, customers: 60, team: 60 } },
        expected: 'missed_adjustable',
      },
      {
        name: 'minTrust=15 は missed_crisis',
        input: { missedCount: 1, trust: { management: 15, customers: 60, team: 60 } },
        expected: 'missed_crisis',
      },
      {
        name: 'minTrust=16 かつ軽微未達は調整可能',
        input: { missedCount: 1, trust: { management: 16, customers: 60, team: 60 } },
        expected: 'missed_adjustable',
      },
      {
        name: '予算5は missed_crisis',
        input: { missedCount: 1, budget: 5 },
        expected: 'missed_crisis',
      },
      {
        name: '未達4件は missed_crisis',
        input: { missedCount: 4 },
        expected: 'missed_crisis',
      },
    ];

    for (const c of cases) {
      expect(evaluateBoundary(c.input), c.name).toBe(c.expected);
    }
  });

  it('目標修正後の priorGoal は次四半期目標へ引き継がれる', () => {
    const boss = getBoss('big-release')!;
    const adjusted = applyGoalAdjustment(
      {
        goal: buildQuarterGoal(boss, 'normal', 1),
        trust: buildInitialTrust('normal'),
        org: org(),
        budget: 30,
        goalAdjustmentsTaken: [],
        nextBudgetCap: null,
      },
      'quality_pivot',
    );
    const next = buildQuarterGoal(boss, 'normal', 1, adjusted.goal);
    expect(next.techDebtLimit).toBe(adjusted.goal.techDebtLimit);
    expect(next.incidentLimit).toBe(adjusted.goal.incidentLimit);
  });

  it('RI-17: 目標修正の代償と補正が安全なレンジに収まる', () => {
    const input = {
      goal: {
        ...goal,
        // RI-68: 四半期累計スケールの代表値（旧 sprint 床 60 × SCALE）。
        deliveryTarget: 60 * QUARTER_DELIVERY_SCALE,
        aiAdoptionTarget: 40,
      },
      trust: buildInitialTrust('normal'),
      org: org({ deliveryScore: 100, morale: 50, seniorHp: 50, techDebt: 40, quality: 60 }),
      budget: 40,
      goalAdjustmentsTaken: [] as const,
      nextBudgetCap: null as number | null,
    };
    const ids = [
      'cut_scope',
      'extend_deadline',
      'quality_pivot',
      'request_budget',
      'pause_ai_rollout',
      'reorg_teams',
    ] as const;

    for (const id of ids) {
      const result = applyGoalAdjustment(input, id);
      expect(
        Math.min(result.trust.management, result.trust.customers, result.trust.team),
        id,
      ).toBeGreaterThanOrEqual(40);
      expect(result.budget, id).toBeGreaterThanOrEqual(30);
      expect(result.budget, id).toBeLessThanOrEqual(60);
      expect(result.goal.deliveryTarget, id).toBeGreaterThanOrEqual(
        MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
      );
      expect(result.goal.deliveryTarget, id).toBeLessThanOrEqual(2500);
      expect(result.goal.qualityTarget, id).toBeGreaterThanOrEqual(45);
      expect(result.goal.qualityTarget, id).toBeLessThanOrEqual(55);
      expect(result.goal.moraleTarget, id).toBeGreaterThanOrEqual(35);
      expect(result.goal.moraleTarget, id).toBeLessThanOrEqual(45);
      expect(result.goal.techDebtLimit, id).toBeGreaterThanOrEqual(55);
      expect(result.goal.techDebtLimit, id).toBeLessThanOrEqual(70);
      expect(result.goal.incidentLimit, id).toBeGreaterThanOrEqual(6);
      expect(result.goal.incidentLimit, id).toBeLessThanOrEqual(9);
      expect(result.goal.aiAdoptionTarget, id).toBeGreaterThanOrEqual(25);
      expect(result.goal.aiAdoptionTarget, id).toBeLessThanOrEqual(40);
      expect(result.org.morale, id).toBeGreaterThanOrEqual(40);
      expect(result.org.seniorHp, id).toBeLessThanOrEqual(100);
      expect(result.org.techDebt, id).toBeGreaterThanOrEqual(0);
    }

    expect(applyGoalAdjustment(input, 'request_budget').nextBudgetCap).toBe(25);
    expect(applyGoalAdjustment(input, 'pause_ai_rollout').pauseAiDebuff).toBe(true);
    expect(applyGoalAdjustment(input, 'cut_scope').pauseAiDebuff).toBe(false);
  });

  it('RI-17: 全ボス・難易度の四半期目標が許容レンジ内に収まる', () => {
    const difficulties: DifficultyId[] = ['easy', 'normal', 'hard', 'nightmare'];

    for (const boss of BOSS_DEFS) {
      for (const difficulty of difficulties) {
        const diff = getDifficulty(difficulty);
        const g = buildQuarterGoal(boss, difficulty, diff.bossTargetMul);
        expect(g.deliveryTarget, `${boss.id}:${difficulty}:delivery`).toBeGreaterThanOrEqual(
          MIN_QUARTER_DELIVERY_TARGET,
        );
        expect(g.deliveryTarget, `${boss.id}:${difficulty}:delivery`).toBeLessThanOrEqual(4500);
        expect(g.qualityTarget, `${boss.id}:${difficulty}:quality`).toBeGreaterThanOrEqual(40);
        expect(g.qualityTarget, `${boss.id}:${difficulty}:quality`).toBeLessThanOrEqual(55);
        expect(g.techDebtLimit, `${boss.id}:${difficulty}:techDebt`).toBeGreaterThanOrEqual(40);
        expect(g.techDebtLimit, `${boss.id}:${difficulty}:techDebt`).toBeLessThanOrEqual(55);
        expect(g.moraleTarget, `${boss.id}:${difficulty}:morale`).toBeGreaterThanOrEqual(40);
        expect(g.moraleTarget, `${boss.id}:${difficulty}:morale`).toBeLessThanOrEqual(45);
        expect(g.incidentLimit, `${boss.id}:${difficulty}:incident`).toBeGreaterThanOrEqual(5);
        expect(g.incidentLimit, `${boss.id}:${difficulty}:incident`).toBeLessThanOrEqual(6);
        if (g.aiAdoptionTarget !== undefined) {
          expect(g.aiAdoptionTarget, `${boss.id}:${difficulty}:ai`).toBeGreaterThanOrEqual(35);
          expect(g.aiAdoptionTarget, `${boss.id}:${difficulty}:ai`).toBeLessThanOrEqual(45);
        }

        const next = buildQuarterGoal(boss, difficulty, diff.bossTargetMul, g);
        expect(next.deliveryTarget, `${boss.id}:${difficulty}:prior`).toBeLessThan(
          g.deliveryTarget,
        );
        expect(next.deliveryTarget, `${boss.id}:${difficulty}:prior`).toBeGreaterThanOrEqual(
          MIN_PRIOR_QUARTER_DELIVERY_TARGET,
        );
        expect(next.qualityTarget).toBe(g.qualityTarget);
        expect(next.techDebtLimit).toBe(g.techDebtLimit);
        expect(next.moraleTarget).toBe(g.moraleTarget);
        expect(next.incidentLimit).toBe(g.incidentLimit);
      }
    }
  });

  it('予算不足時は extend_deadline を提示しない', () => {
    const trust = buildInitialTrust('normal');
    const adjustments = availableAdjustments('missed_adjustable', trust, 6, org(), totals());
    expect(adjustments).not.toContain('extend_deadline');
    expect(adjustments).toContain('cut_scope');
  });

  it('信頼が枯渇する修正は提示しない', () => {
    const trust: StakeholderTrust = { management: 16, customers: 60, team: 60 };
    const adjustments = availableAdjustments('missed_adjustable', trust, 30, org(), totals());
    expect(adjustments).not.toContain('pause_ai_rollout');
  });

  it('四半期 KPI は達成でもボス単体未達なら missed_adjustable になる', () => {
    const review = buildQuarterReview({
      goal,
      org: org({ quality: 50, morale: 50, techDebt: 30 }),
      totals: totals({ delivered: 100, incidents: 2, completed: 40 }),
      trust: buildInitialTrust('normal'),
      budget: 30,
      quarterNumber: 1,
      bossSprintCleared: false,
    });
    expect(review.outcome).toBe('missed_adjustable');
    expect(review.bossCleared).toBe(false);
  });

  it('士気が低い状態では reorg_teams を提示しない', () => {
    const trust = buildInitialTrust('normal');
    const adjustments = availableAdjustments(
      'missed_adjustable',
      trust,
      30,
      org({ morale: 8 }),
      totals(),
    );
    expect(adjustments).not.toContain('reorg_teams');
  });

  it('6種類の目標修正定義がすべて存在する', () => {
    const ids = [
      'cut_scope',
      'extend_deadline',
      'quality_pivot',
      'request_budget',
      'pause_ai_rollout',
      'reorg_teams',
    ] as const;
    for (const id of ids) {
      expect(getGoalAdjustment(id)).toBeDefined();
    }
  });

  it('RI-72-C1: outcome 補助関数と表示ラベルが全 outcome を分類する', () => {
    const cases: Array<{
      outcome: QuarterOutcome;
      choose: boolean;
      acknowledge: boolean;
      terminal: boolean;
      loseReason: ReturnType<typeof loseReasonForOutcome>;
      label: string;
    }> = [
      {
        outcome: 'exceeded',
        choose: false,
        acknowledge: true,
        terminal: false,
        loseReason: 'trustExhausted',
        label: '超過達成',
      },
      {
        outcome: 'met',
        choose: false,
        acknowledge: true,
        terminal: false,
        loseReason: 'trustExhausted',
        label: '目標達成',
      },
      {
        outcome: 'missed_adjustable',
        choose: true,
        acknowledge: false,
        terminal: false,
        loseReason: 'trustExhausted',
        label: '未達（修正可能）',
      },
      {
        outcome: 'missed_crisis',
        choose: false,
        acknowledge: false,
        terminal: true,
        loseReason: 'trustExhausted',
        label: '深刻な未達',
      },
      {
        outcome: 'reorg_required',
        choose: false,
        acknowledge: false,
        terminal: true,
        loseReason: 'reorgRequired',
        label: '組織再編が必要',
      },
      {
        outcome: 'shutdown',
        choose: false,
        acknowledge: false,
        terminal: true,
        loseReason: 'trustExhausted',
        label: '継続不能',
      },
    ];

    expect(Object.keys(OUTCOME_LABELS).sort()).toEqual(cases.map((c) => c.outcome).sort());
    for (const c of cases) {
      expect(canChooseAdjustment(c.outcome), c.outcome).toBe(c.choose);
      expect(canAcknowledgeWin(c.outcome), c.outcome).toBe(c.acknowledge);
      expect(isTerminalFailure(c.outcome), c.outcome).toBe(c.terminal);
      expect(loseReasonForOutcome(c.outcome), c.outcome).toBe(c.loseReason);
      expect(OUTCOME_LABELS[c.outcome], c.outcome).toBe(c.label);
    }
  });

  it('RI-72-C1: KPI 比較のちょうど境界を固定する', () => {
    const statusFor = (input: {
      delivered?: number;
      quality?: number;
      techDebt?: number;
      morale?: number;
      incidents?: number;
      aiAssisted?: number;
      completed?: number;
    }) =>
      Object.fromEntries(
        measureGoalProgress({
          goal: {
            deliveryTarget: 100,
            qualityTarget: 80,
            techDebtLimit: 40,
            moraleTarget: 50,
            incidentLimit: 8,
            aiAdoptionTarget: 40,
          },
          org: org({
            quality: input.quality ?? 80,
            techDebt: input.techDebt ?? 40,
            morale: input.morale ?? 50,
          }),
          totals: totals({
            delivered: input.delivered ?? 100,
            incidents: input.incidents ?? 8,
            aiAssisted: input.aiAssisted ?? 2,
            completed: input.completed ?? 5,
          }),
        }).map((p) => [p.id, p.status]),
      ) as Record<GoalKpiProgress['id'], GoalKpiProgress['status']>;

    expect(statusFor({ delivered: 99 }).delivery).toBe('missed');
    expect(statusFor({ delivered: 100 }).delivery).toBe('met');
    expect(statusFor({ delivered: 114 }).delivery).toBe('met');
    expect(statusFor({ delivered: 115 }).delivery).toBe('exceeded');
    expect(statusFor({ quality: 91 }).quality).toBe('met');
    expect(statusFor({ quality: 92 }).quality).toBe('exceeded');
    expect(statusFor({ techDebt: 30 }).techDebt).toBe('exceeded');
    expect(statusFor({ techDebt: 31 }).techDebt).toBe('met');
    expect(statusFor({ techDebt: 40 }).techDebt).toBe('met');
    expect(statusFor({ techDebt: 41 }).techDebt).toBe('missed');
    expect(statusFor({ incidents: 6 }).incident).toBe('exceeded');
    expect(statusFor({ incidents: 7 }).incident).toBe('met');
    expect(statusFor({ incidents: 8 }).incident).toBe('met');
    expect(statusFor({ incidents: 9 }).incident).toBe('missed');
    expect(statusFor({ aiAssisted: 1, completed: 3 }).aiAdoption).toBe('missed');
    expect(statusFor({ aiAssisted: 2, completed: 5 }).aiAdoption).toBe('met');
    expect(statusFor({ aiAssisted: 23, completed: 50 }).aiAdoption).toBe('exceeded');
  });

  it('RI-72-C1: buildQuarterGoal は未定義 clear と prior AI 分岐を固定する', () => {
    const emptyBoss: BossDef = {
      id: 'empty',
      name: 'empty',
      description: 'no optional clear fields',
      taskCountMul: 1,
      incidentMul: 1,
      clear: {},
    };
    const base = buildQuarterGoal(emptyBoss, 'normal', 1);
    const baseline = BASELINE_SPRINT_DELIVERY_FLOOR * QUARTER_DELIVERY_GOAL_MUL.normal;
    expect(base).toEqual({
      deliveryTarget: Math.max(
        MIN_QUARTER_DELIVERY_TARGET,
        Math.round(
          (baseline * NORMAL_SPRINTS_PER_QUARTER + baseline) * QUARTER_DELIVERY_THROUGHPUT_MUL,
        ),
      ),
      qualityTarget: 45,
      techDebtLimit: 55,
      moraleTarget: 40,
      incidentLimit: 6,
    });
    expect(base.aiAdoptionTarget).toBeUndefined();

    const priorWithoutAi = buildQuarterGoal(emptyBoss, 'normal', 1, {
      ...base,
      deliveryTarget: MIN_PRIOR_QUARTER_DELIVERY_TARGET + 1,
    });
    expect(priorWithoutAi.deliveryTarget).toBe(MIN_PRIOR_QUARTER_DELIVERY_TARGET);
    expect(priorWithoutAi.aiAdoptionTarget).toBeUndefined();

    const priorWithAi = buildQuarterGoal(emptyBoss, 'normal', 1, {
      ...base,
      deliveryTarget: 80 * QUARTER_DELIVERY_SCALE,
      aiAdoptionTarget: 35,
    });
    expect(priorWithAi.deliveryTarget).toBe(Math.round(80 * QUARTER_DELIVERY_SCALE * 0.95));
    expect(priorWithAi.aiAdoptionTarget).toBe(35);
  });

  it('RI-68: Delivery 目標はボス床を全スプリントへ掛けずボス差を抑える', () => {
    const big = buildQuarterGoal(getBoss('big-release')!, 'normal', 1);
    const major = buildQuarterGoal(getBoss('major-incident')!, 'normal', 1);
    // 旧式（ボス床×6）だと 2700/1200=2.25 倍。通常5+ボス1なら差は小さくなる。
    expect(big.deliveryTarget / major.deliveryTarget).toBeLessThan(1.3);
    expect(big.deliveryTarget).toBe(1950);
    expect(major.deliveryTarget).toBe(1700);
  });

  it('RI-68: cut_scope 後も Delivery 目標が四半期実績帯から大きく外れない', () => {
    const boss = getBoss('exec-review')!;
    const before = buildQuarterGoal(boss, 'normal', 1);
    const cut = applyGoalAdjustment(
      {
        goal: before,
        trust: buildInitialTrust('normal'),
        org: org(),
        budget: 30,
        goalAdjustmentsTaken: [],
        nextBudgetCap: null,
      },
      'cut_scope',
    );
    const next = buildQuarterGoal(boss, 'normal', 1, cut.goal);
    // 代表的な四半期実績（約 2000〜2500）に対し 3 倍超の自明超過に戻らないこと。
    const representativeActual = 2478;
    expect(next.deliveryTarget).toBeGreaterThan(representativeActual / 2.5);
    expect(cut.goal.deliveryTarget / before.deliveryTarget).toBeCloseTo(0.8, 5);
  });

  it('RI-68: 提示できる目標修正が無い missed_adjustable は missed_crisis になる', () => {
    // seniorHp=1 で org 非改善の修正は wouldHardLose、reorg は team 信頼不足で弾く。
    // 未達は Quality のみにして shutdown（seniorHp<=5 かつ未達>=2）を避ける。
    // 安全性フィルタで候補が空でも「使い切り」ではなく通常の継続不能理由へ分類する。
    const review = buildQuarterReview({
      goal: buildQuarterGoal(getBoss('big-release')!, 'normal', 1),
      org: org({ quality: 30, morale: 50, techDebt: 40, seniorHp: 1 }),
      totals: totals({ delivered: 5000, incidents: 2, completed: 20 }),
      trust: { management: 60, customers: 60, team: 25 },
      budget: 40,
      quarterNumber: 1,
      bossSprintCleared: false,
    });
    expect(review.outcome).toBe('missed_crisis');
    expect(review.availableAdjustments).toEqual([]);
    expect(loseReasonForOutcome(review.outcome)).toBe('trustExhausted');
  });

  it('RI-68: cut_scope を繰り返しても Delivery 下限で実績比が壊れない', () => {
    const boss = getBoss('exec-review')!;
    let goal = buildQuarterGoal(boss, 'normal', 1);
    const trust = buildInitialTrust('normal');
    for (let i = 0; i < 3; i += 1) {
      const cut = applyGoalAdjustment(
        {
          goal,
          trust,
          org: org(),
          budget: 40,
          goalAdjustmentsTaken: [],
          nextBudgetCap: null,
        },
        'cut_scope',
      );
      goal = buildQuarterGoal(boss, 'normal', 1, cut.goal);
    }
    expect(goal.deliveryTarget).toBeGreaterThanOrEqual(MIN_PRIOR_QUARTER_DELIVERY_TARGET);
    expect(2478 / goal.deliveryTarget).toBeLessThan(2.5);
  });

  it('RI-68: Delivery 目標と実績は四半期累計の同単位で比較される', () => {
    const boss = getBoss('big-release')!;
    const quarterGoal = buildQuarterGoal(boss, 'normal', 1);
    expect(quarterGoal.deliveryTarget).toBeGreaterThanOrEqual(MIN_QUARTER_DELIVERY_TARGET);

    const progress = measureGoalProgress({
      goal: quarterGoal,
      org: org({ quality: 50, morale: 50, techDebt: 30 }),
      totals: totals({ delivered: 1693, incidents: 2, completed: 40, aiAssisted: 10 }),
    });
    const delivery = progress.find((p) => p.id === 'delivery');
    expect(delivery?.label).toBe('Delivery（四半期累計）');
    expect(delivery?.target).toBe(quarterGoal.deliveryTarget);
    expect(delivery?.actual).toBe(1693);
    // sprint 床スケール（〜90）との比較ではない: 目標と実績は同桁。
    expect(delivery!.target / delivery!.actual).toBeGreaterThan(0.4);
    expect(delivery!.target / delivery!.actual).toBeLessThan(2.5);
  });

  it('RI-68: 代表 seed の四半期レビューで Delivery 比が極端にならない', () => {
    const ratios: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const engine = new RunEngine({ seed: `ri68-delivery-${i}`, difficulty: 'normal' });
      const state = playUntil(engine, 'quarterReview', { skilled: true });
      if (state.phase !== 'quarterReview' || !state.quarterReview) continue;
      const delivery = state.quarterReview.progress.find((p) => p.id === 'delivery');
      if (!delivery || delivery.target <= 0) continue;
      ratios.push(delivery.actual / delivery.target);
    }
    expect(ratios.length).toBeGreaterThanOrEqual(4);
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(0.1);
      expect(ratio).toBeLessThan(10);
    }
    // 超過閾値（actual >= target * 1.15）未満の seed が少なくとも1件あること。
    // 旧バグでは全 seed が数十倍の自明超過になり、ここが落ちる。
    expect(ratios.some((r) => r <= 1.15)).toBe(true);
  });

  it('RI-68: Delivery 目標倍率は難易度別に校正され normal を基準に並ぶ', () => {
    const boss = getBoss('big-release')!;
    const easy = buildQuarterGoal(boss, 'easy', 1);
    const normal = buildQuarterGoal(boss, 'normal', 1);
    const hard = buildQuarterGoal(boss, 'hard', 1);
    expect(QUARTER_DELIVERY_GOAL_MUL.easy).toBeGreaterThan(QUARTER_DELIVERY_GOAL_MUL.normal);
    expect(QUARTER_DELIVERY_GOAL_MUL.hard).toBeGreaterThan(QUARTER_DELIVERY_GOAL_MUL.normal);
    expect(easy.deliveryTarget / normal.deliveryTarget).toBeCloseTo(
      QUARTER_DELIVERY_GOAL_MUL.easy,
      2,
    );
    expect(hard.deliveryTarget / normal.deliveryTarget).toBeCloseTo(
      QUARTER_DELIVERY_GOAL_MUL.hard,
      2,
    );
  });

  it(
    'RI-68: easy/normal/hard で Delivery の達成と未達が分岐する',
    { timeout: 90_000 },
    () => {
      const difficulties: DifficultyId[] = ['easy', 'normal', 'hard'];
      for (const difficulty of difficulties) {
        let reached = 0;
        let achieved = 0;
        let missed = 0;
        for (let i = 0; i < 40; i += 1) {
          const engine = new RunEngine({ seed: `probe-${i}`, difficulty });
          const state = playUntil(engine, 'quarterReview', { skilled: true });
          if (state.phase !== 'quarterReview' || !state.quarterReview) continue;
          const delivery = state.quarterReview.progress.find((p) => p.id === 'delivery');
          if (!delivery) continue;
          reached += 1;
          if (delivery.status === 'missed') missed += 1;
          else achieved += 1;
        }
        expect(reached, difficulty).toBeGreaterThanOrEqual(6);
        expect(achieved, `${difficulty}:achieved`).toBeGreaterThan(0);
        expect(missed, `${difficulty}:missed`).toBeGreaterThan(0);
      }
    },
  );

  it('RI-72-C1: AI 過信診断は rework 比率 0.3 ちょうどでは成立しない', () => {
    const base = {
      progress: [{ id: 'delivery', label: 'Delivery', target: 60, actual: 70, status: 'met' }],
      bossCleared: true,
    } satisfies Pick<Parameters<typeof diagnoseMissedReasons>[0], 'progress' | 'bossCleared'>;

    expect(
      diagnoseMissedReasons({
        ...base,
        org: org({ aiDependency: 60 }),
        totals: totals({ rework: 3, completed: 10 }),
      }),
    ).not.toContain(AI_OVERCONFIDENCE);
    expect(
      diagnoseMissedReasons({
        ...base,
        org: org({ aiDependency: 60 }),
        totals: totals({ rework: 4, completed: 10 }),
      }),
    ).toContain(AI_OVERCONFIDENCE);
    expect(
      diagnoseMissedReasons({
        ...base,
        org: org({ aiDependency: 59 }),
        totals: totals({ rework: 4, completed: 10 }),
      }),
    ).not.toContain(AI_OVERCONFIDENCE);
    expect(
      diagnoseMissedReasons({
        ...base,
        org: org({ aiDependency: 60 }),
        totals: totals({ rework: 1, completed: 0 }),
      }),
    ).toContain(AI_OVERCONFIDENCE);
  });

  it('RI-72-C1: availableAdjustments は outcome と hard lose 後状態で絞り込む', () => {
    const trust = buildInitialTrust('normal');
    const outcomes: QuarterOutcome[] = [
      'exceeded',
      'met',
      'missed_crisis',
      'reorg_required',
      'shutdown',
    ];

    for (const outcome of outcomes) {
      expect(availableAdjustments(outcome, trust, 30, org(), totals()), outcome).toEqual([]);
    }
    expect(
      availableAdjustments('missed_adjustable', trust, 30, org({ techDebt: 90 }), totals()),
    ).toEqual(['quality_pivot', 'reorg_teams']);
    expect(
      availableAdjustments('missed_adjustable', trust, 30, org(), totals({ reviewQueuePeak: 48 })),
    ).toEqual([]);
    expect(
      availableAdjustments('missed_adjustable', trust, 30, org({ seniorHp: 1 }), totals()),
    ).toEqual(['reorg_teams']);
    expect(
      availableAdjustments('missed_adjustable', trust, 30, org({ morale: 1 }), totals()),
    ).toEqual([]);
  });

  it('RI-72-C1: 未知の目標修正 ID は入力を変えずに返す', () => {
    const input = {
      goal: { ...goal },
      trust: buildInitialTrust('normal'),
      org: org({ deliveryScore: 100, morale: 50, seniorHp: 50, techDebt: 40, quality: 60 }),
      budget: 30,
      goalAdjustmentsTaken: [] as GoalAdjustmentId[],
      nextBudgetCap: null as number | null,
    };

    expect(applyGoalAdjustment(input, 'unknown_adjustment' as GoalAdjustmentId)).toEqual({
      ...input,
      pauseAiDebuff: false,
    });
  });

  it('RI-72-C1: チーム正本への目標修正 org 効果を焼き込む', () => {
    const base = team({
      shipping: 101,
      morale: 5,
      seniorHp: 90,
      techDebt: 3,
      reviewQueue: 30,
      incidents: 4,
      quality: 96,
    });
    const qualityPivot = applyGoalOrgEffectsToTeam(base, getGoalAdjustment('quality_pivot')!);
    expect(qualityPivot.shipping).toBe(91);
    expect(qualityPivot.techDebt).toBe(0);
    expect(qualityPivot.morale).toBe(base.morale);
    expect(qualityPivot.seniorHp).toBe(base.seniorHp);
    expect(qualityPivot.reviewCapacity).toBe(15);
    expect(qualityPivot.incidentBias).toBeCloseTo(0.288);

    const reorg = applyGoalOrgEffectsToTeam(base, getGoalAdjustment('reorg_teams')!);
    expect(reorg.shipping).toBe(base.shipping);
    expect(reorg.morale).toBe(0);
    expect(reorg.seniorHp).toBe(100);
    expect(reorg.techDebt).toBe(0);
    expect(reorg.reviewCapacity).toBe(15);
    expect(reorg.incidentBias).toBeCloseTo(0.288);
  });
});

const AI_ADOPTION_SHORTFALL = 'AI Adoption 未達: 経営が求める AI 利用率に届いていない。';
const AI_OVERCONFIDENCE = 'AI 過信: AI 利用率は高いが手戻り・品質が追いついていない。';

describe('diagnoseMissedReasons（RI-42: AI 診断のメッセージ分割）', () => {
  const baseProgress: GoalKpiProgress[] = [
    { id: 'delivery', label: 'Delivery', target: 60, actual: 70, status: 'met' },
  ];

  it('AI Adoption KPI 未達のみなら Adoption 未達メッセージだけを返す', () => {
    const reasons = diagnoseMissedReasons({
      progress: [
        ...baseProgress,
        { id: 'aiAdoption', label: 'AI Adoption', target: 40, actual: 20, status: 'missed' },
      ],
      org: org({ aiDependency: 20 }),
      totals: totals({ rework: 1, completed: 20 }),
      bossCleared: true,
    });
    expect(reasons).toContain(AI_ADOPTION_SHORTFALL);
    expect(reasons).not.toContain(AI_OVERCONFIDENCE);
  });

  it('高 aiDependency + 高手戻り率のみなら AI 過信メッセージだけを返す', () => {
    const reasons = diagnoseMissedReasons({
      progress: baseProgress,
      org: org({ aiDependency: 70 }),
      totals: totals({ rework: 8, completed: 20 }),
      bossCleared: true,
    });
    expect(reasons).toContain(AI_OVERCONFIDENCE);
    expect(reasons).not.toContain(AI_ADOPTION_SHORTFALL);
  });

  it('両方成立時は Adoption 未達と AI 過信の両方を返す', () => {
    const reasons = diagnoseMissedReasons({
      progress: [
        ...baseProgress,
        { id: 'aiAdoption', label: 'AI Adoption', target: 40, actual: 20, status: 'missed' },
      ],
      org: org({ aiDependency: 70 }),
      totals: totals({ rework: 8, completed: 20 }),
      bossCleared: true,
    });
    expect(reasons).toContain(AI_ADOPTION_SHORTFALL);
    expect(reasons).toContain(AI_OVERCONFIDENCE);
  });

  it('どちらも非成立なら AI 関連メッセージを含まない', () => {
    const reasons = diagnoseMissedReasons({
      progress: [
        ...baseProgress,
        { id: 'aiAdoption', label: 'AI Adoption', target: 40, actual: 50, status: 'met' },
      ],
      org: org({ aiDependency: 20 }),
      totals: totals({ rework: 1, completed: 20 }),
      bossCleared: true,
    });
    expect(reasons).not.toContain(AI_ADOPTION_SHORTFALL);
    expect(reasons).not.toContain(AI_OVERCONFIDENCE);
  });
});
