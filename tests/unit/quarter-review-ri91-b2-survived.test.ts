/**
 * RI-91-B2: src/sim/run/quarterReview.ts の Survived / 境界 mutation を潰す。
 * 共有の quarter-review テストは触らず、単位専用ファイルで exact 断言する。
 */
import { describe, expect, it } from 'vitest';
import { createOrgState } from '../../src/sim/org';
import {
  REORG_RESET_SENIOR_HP,
  REORG_RESET_TECH_DEBT,
  applyGoalAdjustment,
  availableAdjustments,
  buildQuarterReview,
  diagnoseMissedReasons,
  measureGoalProgress,
} from '../../src/sim/run/quarterReview';
import type { OrgState } from '../../src/sim/types';
import type {
  GoalAdjustmentId,
  GoalKpiProgress,
  QuarterGoal,
  RunTotals,
  StakeholderTrust,
} from '../../src/sim/run/types';

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

const goal = (g: Partial<QuarterGoal> = {}): QuarterGoal => ({
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
      goal: goal({
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
    it('met / exceeded では missedReasons が空配列', () => {
      const metReview = buildQuarterReview({
        goal: goal(),
        org: org({ quality: 80, morale: 50, techDebt: 40 }),
        totals: totals({ delivered: 100, incidents: 8, completed: 10 }),
        trust: trust(),
        budget: 40,
        quarterNumber: 1,
        bossSprintCleared: true,
      });
      expect(metReview.outcome).toBe('met');
      expect(metReview.missedReasons).toEqual([]);

      const exceededReview = buildQuarterReview({
        goal: goal(),
        org: org({ quality: 92, morale: 58, techDebt: 30 }),
        totals: totals({ delivered: 115, incidents: 6, completed: 10 }),
        trust: trust(),
        budget: 40,
        quarterNumber: 1,
        bossSprintCleared: true,
      });
      expect(exceededReview.outcome).toBe('exceeded');
      expect(exceededReview.missedReasons).toEqual([]);
    });

    it('missed 経路では診断結果が入る（空配列初期値の置換を殺す）', () => {
      const review = buildQuarterReview({
        goal: goal(),
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
      goal: goal({ moraleTarget: 45 }),
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
      const baseTrust = trust({ management: 70, customers: 70, team: 31 });
      // team 31 + (-20) = 11 → min>10 で通過。team 31 - (-20) = 51 でも通過してしまうため、
      // 境界の非提示側を合わせて Arithmetic を刺す。
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
          trust({ management: 70, customers: 70, team: 30 }),
          40,
          org({ morale: 50, seniorHp: 50, techDebt: 40 }),
          totals(),
        ),
      ).not.toContain('reorg_teams');
    });
  });
});
