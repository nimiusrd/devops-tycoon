import { describe, expect, it } from 'vitest';
import { BOSS_DEFS, getBoss } from '../../src/data/bosses';
import { getDifficulty } from '../../src/data/difficulties';
import { getGoalAdjustment } from '../../src/data/goalAdjustments';
import { createOrgState } from '../../src/sim/org';
import {
  applyGoalAdjustment,
  availableAdjustments,
  buildInitialTrust,
  buildQuarterGoal,
  buildQuarterReview,
  diagnoseMissedReasons,
  evaluateQuarterOutcome,
  measureGoalProgress,
} from '../../src/sim/run/quarterReview';
import type { OrgState } from '../../src/sim/types';
import type {
  DifficultyId,
  GoalKpiProgress,
  QuarterGoal,
  QuarterOutcome,
  RunTotals,
  StakeholderTrust,
} from '../../src/sim/run/types';

const org = (o: Partial<OrgState> = {}): OrgState => ({ ...createOrgState('default', true), ...o });

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
      goal: { ...goal },
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
      goal: { ...goal, aiAdoptionTarget: 40 },
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
      expect(result.goal.deliveryTarget, id).toBeGreaterThanOrEqual(25);
      expect(result.goal.deliveryTarget, id).toBeLessThanOrEqual(75);
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
        expect(g.deliveryTarget, `${boss.id}:${difficulty}:delivery`).toBeGreaterThanOrEqual(30);
        expect(g.deliveryTarget, `${boss.id}:${difficulty}:delivery`).toBeLessThanOrEqual(160);
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
        expect(next.deliveryTarget, `${boss.id}:${difficulty}:prior`).toBeGreaterThanOrEqual(20);
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
