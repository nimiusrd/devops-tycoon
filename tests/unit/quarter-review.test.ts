import { describe, expect, it } from 'vitest';
import { getBoss } from '../../src/data/bosses';
import { getGoalAdjustment } from '../../src/data/goalAdjustments';
import { createOrgState } from '../../src/sim/org';
import {
  applyGoalAdjustment,
  availableAdjustments,
  buildInitialTrust,
  buildQuarterGoal,
  buildQuarterReview,
  evaluateQuarterOutcome,
  measureGoalProgress,
} from '../../src/sim/run/quarterReview';
import type { OrgState, SprintResult } from '../../src/sim/types';
import type { QuarterGoal, RunTotals, StakeholderTrust } from '../../src/sim/run/types';

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
    const adjustments = availableAdjustments(outcome, trust);
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
    expect(availableAdjustments(outcome, trust)).toEqual([]);
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
    expect(budget.nextBudgetCap).toBe(984);

    const extend = applyGoalAdjustment(input, 'extend_deadline');
    expect(extend.budget).toBe(input.budget - 10);
    expect(extend.goal.qualityTarget).toBeGreaterThan(input.goal.qualityTarget);
  });

  it('同一入力では同一レビュー結果になる（決定論）', () => {
    const boss = getBoss('big-release')!;
    const build = () =>
      buildQuarterReview({
        goal: buildQuarterGoal(boss, 'normal', 1),
        bossCleared: false,
        org: org({ quality: 35, morale: 38, techDebt: 50 }),
        totals: totals({ delivered: 30, incidents: 8, completed: 25 }),
        trust: buildInitialTrust('normal'),
        budget: 25,
        quarterNumber: 1,
        lastResult: null as SprintResult | null,
      });
    expect(build()).toEqual(build());
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
