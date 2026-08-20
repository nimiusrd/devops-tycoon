import { describe, expect, it } from 'vitest';
import { BOSS_DEFS, getBoss, type BossDef } from '../../../src/data/bosses';
import { getDifficulty } from '../../../src/data/difficulties';
import { OUTCOME_BALANCE } from '../../../src/data/balance';
import { allGoalAdjustmentIds, getGoalAdjustment } from '../../../src/data/goalAdjustments';
import { RunEngine } from '../../../src/sim/run/engine';
import { pickQuarterBossId } from '../../../src/sim/run/quarterBoss';
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
  applyGoalCarryoverOrgTick,
  applyGoalCarryoverToEffects,
  applyGoalEffectsToGoal,
  applyGoalOrgEffectsToTeam,
  availableAdjustments,
  canAcknowledgeWin,
  canChooseAdjustment,
  buildInitialTrust,
  buildQuarterGoal,
  buildQuarterReview,
  decayGoalFromPrior,
  diagnoseMissedReasons,
  evaluateQuarterOutcome,
  goalProgressStatus,
  hasGoalCarryoverOrgDelta,
  hasNextQuarterCarryover,
  isTerminalFailure,
  loseReasonForOutcome,
  measureGoalProgress,
  PAUSE_AI_DEBUFF_MUL,
  previewNextQuarterDeliveryTarget,
  PRIOR_GOAL_DELIVERY_DECAY,
  projectForwardGoals,
  resolveNextQuarterEffects,
  REORG_RESET_SENIOR_HP,
  REORG_RESET_TECH_DEBT,
} from '../../../src/sim/run/quarterReview';
import { IDENTITY_CARD_EFFECTS } from '../../../src/sim/model';
import { playUntil } from '../helpers/runFlow';
import type { OrgState } from '../../../src/sim/types';
import type { TeamRunState } from '../../../src/sim/orgscale/types';
import type {
  DifficultyId,
  GoalKpiProgress,
  GoalAdjustmentId,
  QuarterGoal,
  QuarterOutcome,
  RunTotals,
  StakeholderTrust,
} from '../../../src/sim/run/types';
import { org, totals } from '../helpers/orgFixtures';

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
  securityLevel: 55,
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
  it('初期チーム信頼は StakeholderTrust の上限を超えない', () => {
    for (const difficulty of ['easy', 'normal', 'hard', 'nightmare'] as const) {
      const trust = buildInitialTrust(difficulty);
      expect(trust.team).toBeLessThanOrEqual(100);
      expect(trust.management).toBeLessThanOrEqual(100);
      expect(trust.customers).toBeLessThanOrEqual(100);
    }
  });

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
        expect(g.deliveryTarget, `${boss.id}:${difficulty}:delivery`).toBeLessThanOrEqual(5500);
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

  it('RI-79: request_budget は注意帯でも提示し、申請後の信頼は危機閾値より上に残る', () => {
    const trust: StakeholderTrust = { management: 21, customers: 60, team: 60 };
    const adjustments = availableAdjustments('missed_adjustable', trust, 30, org(), totals());
    expect(adjustments).toContain('request_budget');
    const applied = applyGoalAdjustment(
      {
        goal,
        trust,
        org: org(),
        budget: 30,
        goalAdjustmentsTaken: [],
        nextBudgetCap: null,
      },
      'request_budget',
    );
    expect(applied.trust.management).toBeGreaterThan(15);
  });

  it('RI-79: stakeholder_care の Delivery 代償は次期目標を上げる', () => {
    const inputGoal = { ...goal, deliveryTarget: 1950 };
    const applied = applyGoalAdjustment(
      {
        goal: inputGoal,
        trust: buildInitialTrust('normal'),
        org: org(),
        budget: 40,
        goalAdjustmentsTaken: [],
        nextBudgetCap: null,
      },
      'stakeholder_care',
    );
    expect(applied.goal.deliveryTarget).toBe(1950 + 80);
    expect(applied.trust.management).toBeGreaterThan(buildInitialTrust('normal').management);
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

  it('7種類の目標修正定義がすべて存在する', () => {
    const ids = [
      'cut_scope',
      'extend_deadline',
      'quality_pivot',
      'request_budget',
      'pause_ai_rollout',
      'reorg_teams',
      'stakeholder_care',
    ] as const;
    for (const id of ids) {
      expect(getGoalAdjustment(id)).toBeDefined();
    }
  });

  it('RI-83: 目標修正の次四半期キャリーオーバーが分岐する', () => {
    // cut_scope は目標バー緩和が本体で物理キャリーなし（既定オートプレイ経路を壊さない）。
    expect(hasNextQuarterCarryover(getGoalAdjustment('cut_scope')!)).toBe(false);
    const ids = [
      'extend_deadline',
      'quality_pivot',
      'request_budget',
      'pause_ai_rollout',
      'reorg_teams',
      'stakeholder_care',
    ] as const;
    const shipMuls = new Set<number>();
    for (const id of ids) {
      const def = getGoalAdjustment(id)!;
      expect(hasNextQuarterCarryover(def), id).toBe(true);
      const effects = resolveNextQuarterEffects(def);
      expect(Object.keys(effects).length, id).toBeGreaterThan(0);
      if (effects.codingSpeedMul !== undefined) shipMuls.add(effects.codingSpeedMul);
    }
    // 少なくとも出荷速度が複数帯に分かれる。
    expect(shipMuls.size).toBeGreaterThanOrEqual(3);

    const pause = resolveNextQuarterEffects(getGoalAdjustment('pause_ai_rollout')!);
    expect(pause.codingSpeedMul).toBeCloseTo(PAUSE_AI_DEBUFF_MUL);
    expect(pause.routineSpeedMul).toBeUndefined();
    expect(pause.reworkRateAdd).toBeCloseTo(-0.1);
    expect(pause.incidentRateMul).toBeCloseTo(0.7);

    const request = applyGoalCarryoverToEffects(
      { ...IDENTITY_CARD_EFFECTS },
      'request_budget',
      2,
      2,
    );
    expect(request.codingSpeedMul).toBeCloseTo(1.08);
    // 一律出荷バフは coding のみ。routine 同値は定型で 1.08² になる。
    expect(request.routineSpeedMul).toBe(1);
    expect(request.reviewCapacityMul).toBeCloseTo(1.15);
    const qualityEffects = resolveNextQuarterEffects(getGoalAdjustment('quality_pivot')!);
    expect(qualityEffects.codingSpeedMul).toBeCloseTo(0.92);
    expect(qualityEffects.routineSpeedMul).toBeUndefined();
    const careEffects = resolveNextQuarterEffects(getGoalAdjustment('stakeholder_care')!);
    expect(careEffects.codingSpeedMul).toBeCloseTo(0.97);
    expect(careEffects.routineSpeedMul).toBeUndefined();
    const expired = applyGoalCarryoverToEffects(
      { ...IDENTITY_CARD_EFFECTS },
      'request_budget',
      2,
      3,
    );
    expect(expired.codingSpeedMul).toBe(1);

    const before = org({ techDebt: 40, seniorHp: 30, quality: 50 });
    const pivoted = applyGoalCarryoverOrgTick(before, 'quality_pivot', 2, 2);
    expect(pivoted.techDebt).toBe(36);
    expect(pivoted.quality).toBe(54);
    expect(applyGoalCarryoverOrgTick(before, 'quality_pivot', 2, 3)).toEqual(before);
    const extended = applyGoalCarryoverOrgTick(before, 'extend_deadline', 2, 2);
    expect(extended.seniorHp).toBe(35);

    // 実値が変わらなくても、定義に org 差分があればチーム更新対象と判定する。
    expect(hasGoalCarryoverOrgDelta('extend_deadline', 2, 2)).toBe(true);
    expect(hasGoalCarryoverOrgDelta('quality_pivot', 2, 2)).toBe(true);
    expect(hasGoalCarryoverOrgDelta('cut_scope', 2, 2)).toBe(false);
    expect(hasGoalCarryoverOrgDelta('request_budget', 2, 2)).toBe(false);
    expect(hasGoalCarryoverOrgDelta('extend_deadline', 2, 3)).toBe(false);
    const saturated = org({ techDebt: 0, seniorHp: 100, quality: 100 });
    expect(applyGoalCarryoverOrgTick(saturated, 'extend_deadline', 2, 2).seniorHp).toBe(100);
    expect(applyGoalCarryoverOrgTick(saturated, 'quality_pivot', 2, 2)).toMatchObject({
      techDebt: 0,
      quality: 100,
    });
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
      // 入力なしは後方互換フォールバック（RI-79 の原因分解は別テスト）。
      expect(loseReasonForOutcome(c.outcome), c.outcome).toBe(c.loseReason);
      expect(OUTCOME_LABELS[c.outcome], c.outcome).toBe(c.label);
    }
  });

  it('RI-79: loseReasonForOutcome は発火条件ごとにラベルを分解する', () => {
    const baseProgress = [
      { id: 'delivery', label: 'D', target: 1, actual: 0, status: 'missed' as const },
      { id: 'quality', label: 'Q', target: 1, actual: 0, status: 'missed' as const },
      { id: 'techDebt', label: 'T', target: 1, actual: 0, status: 'missed' as const },
      { id: 'morale', label: 'M', target: 1, actual: 0, status: 'missed' as const },
    ];
    const healthyOrg = org({ morale: 50, seniorHp: 50 });

    expect(
      loseReasonForOutcome('missed_crisis', {
        progress: baseProgress,
        trust: { management: 10, customers: 40, team: 40 },
        org: healthyOrg,
        budget: 40,
        quarterNumber: 1,
      }),
    ).toBe('trustExhausted');

    expect(
      loseReasonForOutcome('missed_crisis', {
        progress: baseProgress.slice(0, 1),
        trust: { management: 40, customers: 40, team: 40 },
        org: healthyOrg,
        budget: 3,
        quarterNumber: 1,
      }),
    ).toBe('kpiMissed');

    expect(
      loseReasonForOutcome('missed_crisis', {
        progress: baseProgress.slice(0, 1),
        trust: { management: 40, customers: 40, team: 40 },
        org: healthyOrg,
        budget: 0,
        quarterNumber: 1,
      }),
    ).toBe('budgetExhausted');

    expect(
      loseReasonForOutcome('missed_crisis', {
        progress: baseProgress,
        trust: { management: 40, customers: 40, team: 40 },
        org: healthyOrg,
        budget: 40,
        quarterNumber: 1,
      }),
    ).toBe('kpiMissed');

    expect(
      loseReasonForOutcome('shutdown', {
        progress: baseProgress.slice(0, 2),
        trust: { management: 40, customers: 40, team: 40 },
        org: org({ morale: 10, seniorHp: 50 }),
        budget: 0,
        quarterNumber: 1,
      }),
    ).toBe('budgetExhausted');

    expect(
      loseReasonForOutcome('shutdown', {
        progress: baseProgress.slice(0, 2),
        trust: { management: 40, customers: 40, team: 40 },
        org: org({ morale: 50, seniorHp: 3 }),
        budget: 40,
        quarterNumber: 1,
      }),
    ).toBe('seniorBurnout');

    expect(loseReasonForOutcome('reorg_required')).toBe('reorgRequired');
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
    // RI-77: AI 出荷価値倍率後の目標再校正値。
    expect(big.deliveryTarget).toBe(4388);
    expect(major.deliveryTarget).toBe(3825);
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
    // 空候補の原因（シニア枯渇）を信頼フォールバックへ落とさない（RI-79）。
    expect(
      loseReasonForOutcome(review.outcome, {
        progress: review.progress,
        trust: review.trust,
        org: org({ quality: 30, morale: 50, techDebt: 40, seniorHp: 1 }),
        budget: 40,
        quarterNumber: 1,
      }),
    ).toBe('seniorBurnout');
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

    // RI-77: AI 出荷価値倍率後の四半期実績帯（約 3800〜4400）に合わせた代表値。
    const progress = measureGoalProgress({
      goal: quarterGoal,
      org: org({ quality: 50, morale: 50, techDebt: 30 }),
      totals: totals({ delivered: 4020, incidents: 2, completed: 40, aiAssisted: 10 }),
    });
    const delivery = progress.find((p) => p.id === 'delivery');
    expect(delivery?.label).toBe('Delivery（四半期累計）');
    expect(delivery?.target).toBe(quarterGoal.deliveryTarget);
    expect(delivery?.actual).toBe(4020);
    // sprint 床スケール（〜90）との比較ではない: 目標と実績は同桁。
    expect(delivery!.target / delivery!.actual).toBeGreaterThan(0.4);
    expect(delivery!.target / delivery!.actual).toBeLessThan(2.5);
  });

  it('RI-68: 代表 seed の四半期レビューで Delivery 比が極端にならない', { timeout: 60_000 }, () => {
    // RI-75: taskFloor 増で超過寄り。到達確認済み＋相対的に低い比の seed を固定する。
    const seedIndices = [6, 21, 22, 31, 77, 99, 134, 255] as const;
    const ratios: number[] = [];
    for (const i of seedIndices) {
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
    // 旧バグでは全 seed が数十倍の自明超過になる。相対的に低い比が残ることだけを固定する。
    expect(ratios.some((r) => r <= 1.6)).toBe(true);
  });

  it('RI-68: Delivery 目標倍率は難易度別に校正され normal を基準に並ぶ', () => {
    const boss = getBoss('big-release')!;
    const easy = buildQuarterGoal(boss, 'easy', 1);
    const normal = buildQuarterGoal(boss, 'normal', 1);
    const hard = buildQuarterGoal(boss, 'hard', 1);
    expect(QUARTER_DELIVERY_GOAL_MUL.easy).toBeGreaterThan(QUARTER_DELIVERY_GOAL_MUL.normal);
    // hard はスループットが低いので倍率は normal より低くし、未達経路を残す。
    expect(QUARTER_DELIVERY_GOAL_MUL.hard).toBeLessThan(QUARTER_DELIVERY_GOAL_MUL.normal);
    expect(easy.deliveryTarget / normal.deliveryTarget).toBeCloseTo(
      QUARTER_DELIVERY_GOAL_MUL.easy / QUARTER_DELIVERY_GOAL_MUL.normal,
      2,
    );
    expect(hard.deliveryTarget / normal.deliveryTarget).toBeCloseTo(
      QUARTER_DELIVERY_GOAL_MUL.hard / QUARTER_DELIVERY_GOAL_MUL.normal,
      2,
    );
  });

  it('RI-68: 難易度に応じて Delivery の達成・未達が分岐する', { timeout: 60_000 }, () => {
    // RI-77: AI 出荷価値倍率後の目標再校正でも、到達・達成・未達を含む固定 seed を使う。
    const seedsByDifficulty: Record<'easy' | 'normal' | 'hard', readonly number[]> = {
      easy: [0, 1, 2, 7, 18, 31],
      normal: [0, 1, 2, 3, 6, 7],
      hard: [0, 2, 9, 3, 14, 18],
    };
    const meanRatioByDifficulty: Record<'easy' | 'normal' | 'hard', number> = {
      easy: 0,
      normal: 0,
      hard: 0,
    };
    for (const difficulty of ['easy', 'normal', 'hard'] as const) {
      let reached = 0;
      let achieved = 0;
      let missed = 0;
      let ratioSum = 0;
      for (const i of seedsByDifficulty[difficulty]) {
        const engine = new RunEngine({ seed: `probe-${i}`, difficulty });
        const state = playUntil(engine, 'quarterReview', { skilled: true });
        if (state.phase !== 'quarterReview' || !state.quarterReview) continue;
        const delivery = state.quarterReview.progress.find((p) => p.id === 'delivery');
        if (!delivery || delivery.target <= 0) continue;
        reached += 1;
        if (delivery.status === 'missed') missed += 1;
        else achieved += 1;
        ratioSum += delivery.actual / delivery.target;
      }
      meanRatioByDifficulty[difficulty] = ratioSum / Math.max(1, reached);
      expect(reached, difficulty).toBeGreaterThanOrEqual(4);
      expect(achieved, `${difficulty}:achieved`).toBeGreaterThan(0);
      expect(missed, `${difficulty}:missed`).toBeGreaterThan(0);
    }
    expect(meanRatioByDifficulty.hard, 'hard:meanRatio').toBeLessThan(meanRatioByDifficulty.easy);
    expect(meanRatioByDifficulty.normal, 'normal:meanRatio').toBeLessThan(
      meanRatioByDifficulty.easy,
    );
    expect(meanRatioByDifficulty.hard, 'hard:meanRatio').toBeLessThanOrEqual(
      meanRatioByDifficulty.normal + 0.05,
    );
  });

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

  it('RI-130: 健全状態の missed_adjustable は既存7種を定義順で提示する', () => {
    expect(
      availableAdjustments('missed_adjustable', buildInitialTrust('normal'), 30, org(), totals()),
    ).toEqual(allGoalAdjustmentIds());
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

/** diagnoseMissedReasons が返す文言（ソースの REASON_LABELS と一致させる）。 */
const REASON = {
  scopeOverload: 'スコープ過多: 出荷目標に対して Delivery が不足している。',
  reviewJam: 'レビュー詰まり: Review 待ち行列が限界に近づいた。',
  qualityIssue: '品質問題: Quality / Tech Debt が目標を下回っている。',
  aiAdoptionShortfall: 'AI Adoption 未達: 経営が求める AI 利用率に届いていない。',
  aiOverconfidence: 'AI 過信: AI 利用率は高いが手戻り・品質が追いついていない。',
  moraleDrop: '士気低下: Morale が目標を下回り、チームの持続力が弱い。',
  incidentSpiral: '障害連鎖: Incident が目標上限を超えた。',
  bossMiss: '外部評価未達: ボススプリントの突破条件を満たせなかった。',
} as const;

const makeGoal = (g: Partial<QuarterGoal> = {}): QuarterGoal => ({
  deliveryTarget: 100,
  qualityTarget: 80,
  techDebtLimit: 40,
  moraleTarget: 50,
  incidentLimit: 8,
  ...g,
});

const trust = (t: Partial<StakeholderTrust> = {}): StakeholderTrust => ({
  management: 70,
  customers: 65,
  team: 60,
  ...t,
});

const kpi = (id: GoalKpiProgress['id'], status: GoalKpiProgress['status']): GoalKpiProgress => ({
  id,
  label: id,
  target: 10,
  actual: status === 'missed' ? 1 : status === 'exceeded' ? 20 : 12,
  status,
});

const statusById = (input: {
  delivered?: number;
  quality?: number;
  techDebt?: number;
  morale?: number;
  incidents?: number;
  aiAssisted?: number;
  completed?: number;
  aiAdoptionTarget?: number;
}): Record<string, GoalKpiProgress['status']> =>
  Object.fromEntries(
    measureGoalProgress({
      goal: makeGoal({
        aiAdoptionTarget: input.aiAdoptionTarget,
      }),
      org: org({
        quality: input.quality ?? 80,
        techDebt: input.techDebt ?? 40,
        morale: input.morale ?? 50,
      }),
      totals: totals({
        delivered: input.delivered ?? 100,
        incidents: input.incidents ?? 8,
        aiAssisted: input.aiAssisted ?? 0,
        completed: input.completed ?? 10,
      }),
    }).map((p) => [p.id, p.status]),
  );

describe('RI-91-B2: quarterReview survived mutants', () => {
  describe('measureGoalProgress boundaries', () => {
    it('現行レビューとセーブ再判定で共有する KPI 境界を固定する', () => {
      const higher = OUTCOME_BALANCE.kpiHigherExceededMultiplier.value;
      const lower = OUTCOME_BALANCE.kpiLowerExceededMultiplier.value;
      expect(goalProgressStatus(99, 100, true)).toBe('missed');
      expect(goalProgressStatus(100, 100, true)).toBe('met');
      expect(goalProgressStatus(100 * higher - 0.01, 100, true)).toBe('met');
      expect(goalProgressStatus(100 * higher, 100, true)).toBe('exceeded');
      expect(goalProgressStatus(100 * lower + 0.01, 100, false)).toBe('met');
      expect(goalProgressStatus(100 * lower, 100, false)).toBe('exceeded');
      expect(goalProgressStatus(101, 100, false)).toBe('missed');
    });

    it('quality / morale の met・missed・exceeded 境界を固定する', () => {
      // compareHigher: actual >= target / >= target*1.15
      expect(statusById({ quality: 79 }).quality).toBe('missed');
      expect(statusById({ quality: 80 }).quality).toBe('met');
      expect(statusById({ quality: 91 }).quality).toBe('met');
      expect(statusById({ quality: 92 }).quality).toBe('exceeded');

      expect(statusById({ morale: 49 }).morale).toBe('missed');
      expect(statusById({ morale: 50 }).morale).toBe('met');
      expect(statusById({ morale: 57 }).morale).toBe('met');
      expect(statusById({ morale: 58 }).morale).toBe('exceeded');
    });

    it('delivery のちょうど境界も >= と > を区別する', () => {
      expect(statusById({ delivered: 99 }).delivery).toBe('missed');
      expect(statusById({ delivered: 100 }).delivery).toBe('met');
      expect(statusById({ delivered: 114 }).delivery).toBe('met');
      expect(statusById({ delivered: 115 }).delivery).toBe('exceeded');
    });
  });

  describe('diagnoseMissedReasons', () => {
    const cleanOrg = () => org({ aiDependency: 0 });
    const cleanTotals = (t: Partial<RunTotals> = {}) => totals({ rework: 0, completed: 10, ...t });

    it('KPI id ごとの未達理由を toEqual で全分岐そろえる', () => {
      expect(
        diagnoseMissedReasons({
          progress: [kpi('delivery', 'missed')],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: true,
        }),
      ).toEqual([REASON.scopeOverload]);

      expect(
        diagnoseMissedReasons({
          progress: [kpi('quality', 'missed')],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: true,
        }),
      ).toEqual([REASON.qualityIssue]);

      expect(
        diagnoseMissedReasons({
          progress: [kpi('techDebt', 'missed')],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: true,
        }),
      ).toEqual([REASON.qualityIssue]);

      expect(
        diagnoseMissedReasons({
          progress: [kpi('morale', 'missed')],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: true,
        }),
      ).toEqual([REASON.moraleDrop]);

      expect(
        diagnoseMissedReasons({
          progress: [kpi('incident', 'missed')],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: true,
        }),
      ).toEqual([REASON.incidentSpiral]);

      expect(
        diagnoseMissedReasons({
          progress: [kpi('aiAdoption', 'missed')],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: true,
        }),
      ).toEqual([REASON.aiAdoptionShortfall]);
    });

    it('met の KPI からは理由を出さない', () => {
      expect(
        diagnoseMissedReasons({
          progress: [
            kpi('delivery', 'met'),
            kpi('quality', 'met'),
            kpi('techDebt', 'met'),
            kpi('morale', 'met'),
            kpi('incident', 'met'),
            kpi('aiAdoption', 'exceeded'),
          ],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: true,
        }),
      ).toEqual([]);
    });

    it('quality と techDebt の両方 missed でも qualityIssue は1回だけ', () => {
      expect(
        diagnoseMissedReasons({
          progress: [kpi('quality', 'missed'), kpi('techDebt', 'missed')],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: true,
        }),
      ).toEqual([REASON.qualityIssue]);
    });

    it('bossCleared false で bossMiss を出し、true では出さない', () => {
      expect(
        diagnoseMissedReasons({
          progress: [kpi('delivery', 'met')],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: false,
        }),
      ).toEqual([REASON.bossMiss]);

      expect(
        diagnoseMissedReasons({
          progress: [kpi('delivery', 'met')],
          org: cleanOrg(),
          totals: cleanTotals(),
          bossCleared: true,
        }),
      ).toEqual([]);
    });

    it('reviewQueuePeak は 32 で成立し 31 では非成立', () => {
      expect(
        diagnoseMissedReasons({
          progress: [kpi('delivery', 'met')],
          org: cleanOrg(),
          totals: cleanTotals({ reviewQueuePeak: 31 }),
          bossCleared: true,
        }),
      ).toEqual([]);

      expect(
        diagnoseMissedReasons({
          progress: [kpi('delivery', 'met')],
          org: cleanOrg(),
          totals: cleanTotals({ reviewQueuePeak: 32 }),
          bossCleared: true,
        }),
      ).toEqual([REASON.reviewJam]);
    });

    it('複数理由は順序固定で並び、重複は除去される', () => {
      expect(
        diagnoseMissedReasons({
          progress: [
            kpi('delivery', 'missed'),
            kpi('quality', 'missed'),
            kpi('techDebt', 'missed'),
            kpi('morale', 'missed'),
          ],
          org: cleanOrg(),
          totals: cleanTotals({ reviewQueuePeak: 32 }),
          bossCleared: false,
        }),
      ).toEqual([
        REASON.bossMiss,
        REASON.scopeOverload,
        REASON.qualityIssue,
        REASON.moraleDrop,
        REASON.reviewJam,
      ]);
    });
  });

  describe('buildQuarterReview win path', () => {
    it('met / exceeded では missedReasons が空配列（diagnose 非空条件でも）', () => {
      // reviewJam 成立条件を載せ、win 条件が壊れると diagnose 経由で非空になるようにする。
      const inputTrust = trust({ management: 71, customers: 66, team: 61 });
      const metReview = buildQuarterReview({
        goal: makeGoal(),
        org: org({ quality: 80, morale: 50, techDebt: 40 }),
        totals: totals({
          delivered: 100,
          incidents: 8,
          completed: 10,
          reviewQueuePeak: 32,
        }),
        trust: inputTrust,
        budget: 40,
        quarterNumber: 1,
        bossSprintCleared: true,
      });
      expect(metReview.outcome).toBe('met');
      expect(metReview.missedReasons).toEqual([]);
      expect(metReview.trust).toEqual(inputTrust);
      expect(metReview.trust).not.toBe(inputTrust);

      const exceededReview = buildQuarterReview({
        goal: makeGoal(),
        org: org({ quality: 92, morale: 58, techDebt: 30 }),
        totals: totals({
          delivered: 115,
          incidents: 6,
          completed: 10,
          reviewQueuePeak: 32,
        }),
        trust: inputTrust,
        budget: 40,
        quarterNumber: 1,
        bossSprintCleared: true,
      });
      expect(exceededReview.outcome).toBe('exceeded');
      expect(exceededReview.missedReasons).toEqual([]);
      expect(exceededReview.trust).toEqual(inputTrust);
    });

    it('missed 経路では診断結果が入る（空配列初期値の置換を殺す）', () => {
      const review = buildQuarterReview({
        goal: makeGoal(),
        org: org({ quality: 40, morale: 30, techDebt: 60 }),
        totals: totals({ delivered: 40, incidents: 12, completed: 10, reviewQueuePeak: 32 }),
        trust: trust({ management: 50, customers: 50, team: 50 }),
        budget: 30,
        quarterNumber: 1,
        bossSprintCleared: false,
      });
      expect(review.outcome).not.toBe('met');
      expect(review.outcome).not.toBe('exceeded');
      expect(review.missedReasons.length).toBeGreaterThan(0);
      expect(review.missedReasons).toContain(REASON.bossMiss);
      expect(review.missedReasons).toContain(REASON.reviewJam);
    });
  });

  describe('applyGoalAdjustment trustDelta', () => {
    const baseInput = () => ({
      goal: makeGoal({ moraleTarget: 45 }),
      trust: trust({ management: 70, customers: 65, team: 60 }),
      org: org({
        deliveryScore: 100,
        morale: 50,
        seniorHp: 40,
        techDebt: 40,
        quality: 60,
      }),
      budget: 40,
      goalAdjustmentsTaken: [] as GoalAdjustmentId[],
      nextBudgetCap: null as number | null,
    });

    it('reorg_teams は trust.team を -20 し、他軸は据え置く', () => {
      const result = applyGoalAdjustment(baseInput(), 'reorg_teams');
      // + を - に変えると 60-(-20)=80 になるため、厳密値で Arithmetic を殺す。
      expect(result.trust).toEqual({
        management: 70,
        customers: 65,
        team: 40,
      });
      expect(result.budget).toBe(35);
      expect(result.goal.moraleTarget).toBe(40);
      // orgEffects + reorgReset の加算方向も固定する。
      expect(result.org.morale).toBe(40);
      expect(result.org.seniorHp).toBe(40 + 25 + REORG_RESET_SENIOR_HP);
      expect(result.org.techDebt).toBe(40 - 5 - Math.abs(REORG_RESET_TECH_DEBT));
      expect(result.goalAdjustmentsTaken).toEqual(['reorg_teams']);
    });

    it('customers / management の trustDelta 加算方向を固定する', () => {
      const cut = applyGoalAdjustment(baseInput(), 'cut_scope');
      expect(cut.trust).toEqual({
        management: 70,
        customers: 50,
        team: 60,
      });

      const extend = applyGoalAdjustment(baseInput(), 'extend_deadline');
      expect(extend.trust).toEqual({
        management: 58,
        customers: 65,
        team: 60,
      });
      expect(extend.budget).toBe(30);
    });

    it('availableAdjustments 側でも team trustDelta の加減を区別する', () => {
      const baseTrust = trust({ management: 70, customers: 70, team: 36 });
      // team 36 + (-20) = 16 → 危機閾値(15)より上で通過。
      // team 36 - (-20) = 56 でも通過してしまうため、境界の非提示側を合わせて Arithmetic を刺す。
      expect(
        availableAdjustments(
          'missed_adjustable',
          baseTrust,
          40,
          org({ morale: 50, seniorHp: 50, techDebt: 40 }),
          totals(),
        ),
      ).toContain('reorg_teams');

      expect(
        availableAdjustments(
          'missed_adjustable',
          trust({ management: 70, customers: 70, team: 35 }),
          40,
          org({ morale: 50, seniorHp: 50, techDebt: 40 }),
          totals(),
        ),
      ).not.toContain('reorg_teams');
    });
  });

  describe('projectForwardGoals (RI-131)', () => {
    const current: QuarterGoal = {
      deliveryTarget: 60 * QUARTER_DELIVERY_SCALE,
      qualityTarget: 45,
      techDebtLimit: 55,
      moraleTarget: 40,
      incidentLimit: 6,
      aiAdoptionTarget: 40,
    };
    const applyInput = {
      goal: current,
      trust: buildInitialTrust('normal'),
      org: org(),
      budget: 40,
      goalAdjustmentsTaken: [] as const,
      nextBudgetCap: null as number | null,
    };
    const boss = getBoss('big-release')!;

    it('修正なしは prior 減衰のみで Q+2 は再減衰する', () => {
      const { next, following } = projectForwardGoals(current);
      expect(next).toEqual(decayGoalFromPrior(current));
      expect(following).toEqual(decayGoalFromPrior(next));
      expect(next.deliveryTarget).toBe(
        Math.max(
          MIN_PRIOR_QUARTER_DELIVERY_TARGET,
          Math.round(current.deliveryTarget * PRIOR_GOAL_DELIVERY_DECAY),
        ),
      );
      expect(following.qualityTarget).toBe(current.qualityTarget);
    });

    it('7種の goalEffects 後の Q+1 は applyGoalAdjustment → buildQuarterGoal(prior) と一致する', () => {
      for (const id of allGoalAdjustmentIds()) {
        const def = getGoalAdjustment(id)!;
        const applied = applyGoalAdjustment(applyInput, id);
        const viaPrior = buildQuarterGoal(boss, 'normal', 1, applied.goal);
        const { next, following } = projectForwardGoals(current, def);

        expect(applied.goal, id).toEqual(applyGoalEffectsToGoal(current, def));
        expect(next, id).toEqual(decayGoalFromPrior(applied.goal));
        expect(next.deliveryTarget, id).toBe(viaPrior.deliveryTarget);
        expect(next.qualityTarget, id).toBe(viaPrior.qualityTarget);
        expect(next.techDebtLimit, id).toBe(viaPrior.techDebtLimit);
        expect(next.moraleTarget, id).toBe(viaPrior.moraleTarget);
        expect(next.incidentLimit, id).toBe(viaPrior.incidentLimit);
        expect(next.aiAdoptionTarget, id).toBe(viaPrior.aiAdoptionTarget);
        expect(next.deliveryTarget, id).toBe(
          previewNextQuarterDeliveryTarget(current.deliveryTarget, def),
        );
        expect(following, id).toEqual(decayGoalFromPrior(next));
        expect(following.deliveryTarget, id).not.toBe(next.deliveryTarget);
      }
    });

    it('次ボスが exec-review なら prior に無い AI Adoption 目標を見通しへ載せる', () => {
      const withoutAi: QuarterGoal = {
        deliveryTarget: 60 * QUARTER_DELIVERY_SCALE,
        qualityTarget: 45,
        techDebtLimit: 55,
        moraleTarget: 40,
        incidentLimit: 6,
      };
      let seed = '';
      for (let i = 0; i < 8000; i += 1) {
        const candidate = `ri131-exec-${i}`;
        if (pickQuarterBossId(candidate, 2) === 'exec-review') {
          seed = candidate;
          break;
        }
      }
      expect(seed).not.toBe('');
      const ctx = { seed, difficulty: 'normal' as const, fromQuarter: 1 };
      const nextBoss = getBoss(pickQuarterBossId(seed, 2))!;
      const followingBoss = getBoss(pickQuarterBossId(seed, 3))!;
      const { next, following } = projectForwardGoals(withoutAi, undefined, ctx);
      expect(next).toEqual(buildQuarterGoal(nextBoss, 'normal', 1, withoutAi));
      expect(next.aiAdoptionTarget).toBe(40);
      expect(following).toEqual(buildQuarterGoal(followingBoss, 'normal', 1, next));
    });
  });
});
