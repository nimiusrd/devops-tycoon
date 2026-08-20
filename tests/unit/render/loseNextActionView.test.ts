import { describe, expect, it } from 'vitest';
import {
  classifyExhaustedStakeholder,
  classifyMissedCrisisCause,
  classifyReorgCause,
  classifyShutdownCause,
  loseNextActionView,
} from '../../../src/render/loseNextActionView';
import { OUTCOME_BALANCE } from '../../../src/data/balance';
import type { LoseReason } from '../../../src/sim/run/types';

const ALL_LOSE_REASONS: readonly LoseReason[] = [
  'seniorBurnout',
  'techDebt',
  'moraleCollapse',
  'reviewFreeze',
  'incidentCascade',
  'aiDependency',
  'budgetExhausted',
  'bossFailed',
  'trustExhausted',
  'reorgRequired',
  'kpiMissed',
];

describe('loseNextActionView（RI-82 / F-6）', () => {
  it('全 LoseReason で次の一手と現場示唆を返す', () => {
    for (const reason of ALL_LOSE_REASONS) {
      const view = loseNextActionView(reason);
      expect(view.nextAction.trim().length).toBeGreaterThan(0);
      expect(view.insight.trim().length).toBeGreaterThan(0);
    }
  });

  it('aiDependency はペアレビューまたは依存度を下げるレバーを示す', () => {
    const view = loseNextActionView('aiDependency');
    expect(view.nextAction).toMatch(/ペアレビュー/);
    expect(view.nextAction).toMatch(/30/);
    expect(view.nextAction).toMatch(/95/);
    expect(view.nextAction).toMatch(/AIガイドライン|レバー|ガイドライン/);
    expect(view.nextAction).not.toMatch(/AIガイドライン／AIスロットル/);
    expect(view.insight).toMatch(/AI|検証|判断/);
  });

  it('incidentCascade は緊急対応の一手を示す', () => {
    const view = loseNextActionView('incidentCascade');
    expect(view.nextAction).toContain('緊急対応');
  });

  it('seniorBurnout は割り込みレビューではなく緊急対応と休息を勧める', () => {
    const view = loseNextActionView('seniorBurnout');
    expect(view.nextAction).toContain('緊急対応');
    expect(view.nextAction).toContain('休息');
    expect(view.nextAction).not.toMatch(/割り込みレビューで負荷を分散/);
  });

  it('budgetExhausted は追加予算申請と支出抑制に限定する', () => {
    const view = loseNextActionView('budgetExhausted');
    expect(view.nextAction).toContain('追加予算申請');
    expect(view.nextAction).not.toContain('全社レバー');
    expect(view.nextAction).not.toContain('AI導入一時停止');
  });

  it('moraleCollapse はレリックではなく休息で士気を戻す', () => {
    const view = loseNextActionView('moraleCollapse');
    expect(view.nextAction).toContain('休息');
    expect(view.nextAction).not.toContain('レリック');
  });

  it('reviewFreeze は待ち行列ピーク向けの渋滞対策を示す', () => {
    const lowHpButQueueLose = loseNextActionView('reviewFreeze', {
      snapshot: { seniorHp: 40, reviewQueuePeak: 12 },
    });
    const queuePath = loseNextActionView('reviewFreeze', {
      snapshot: { seniorHp: 80, reviewQueuePeak: 50 },
    });
    // 低HP専用分岐は廃止（現行の reviewFreeze 経路はピーク閾値のみ）。
    expect(lowHpButQueueLose.nextAction).toMatch(/AIスロットル|PR分割|レビュー応援/);
    expect(lowHpButQueueLose.nextAction).not.toMatch(/低HPからのレビュー凍結/);
    expect(queuePath.nextAction).toMatch(/AIスロットル|PR分割|レビュー応援/);
  });

  it('shutdown はトリガー別に助言を分ける', () => {
    const trust = loseNextActionView('trustExhausted', {
      quarterOutcome: 'shutdown',
      snapshot: { trust: { management: 8, customers: 40, team: 40 } },
    });
    expect(classifyShutdownCause({ trust: { management: 8, customers: 40, team: 40 } })).toBe(
      'trust',
    );
    expect(classifyExhaustedStakeholder({ management: 8, customers: 40, team: 40 }, 10)).toBe(
      'management',
    );
    expect(trust.nextAction).toMatch(/経営|延期交渉/);
    expect(trust.nextAction).not.toContain('目標修正で継続資源');

    const teamTrust = loseNextActionView('trustExhausted', {
      quarterOutcome: 'shutdown',
      snapshot: { trust: { management: 40, customers: 40, team: 8 } },
    });
    expect(teamTrust.nextAction).toMatch(/急募|採用/);

    const budgetMorale = loseNextActionView('trustExhausted', {
      quarterOutcome: 'shutdown',
      snapshot: {
        trust: { management: 50, customers: 50, team: 50 },
        budget: 0,
        morale: 10,
      },
    });
    expect(budgetMorale.nextAction).toMatch(/追加予算申請|士気/);

    const hpMissed = loseNextActionView('trustExhausted', {
      quarterOutcome: 'shutdown',
      snapshot: {
        trust: { management: 50, customers: 50, team: 50 },
        budget: 20,
        morale: 50,
        seniorHp: 3,
        missedKpiCount: 2,
      },
    });
    expect(hpMissed.nextAction).toMatch(/シニアHP|未達/);
  });

  it('missed_crisis でもハード敗北原因は cause-specific 助言を使う（RI-79）', () => {
    // seniorBurnout が missed_crisis 経由で降格しても seniorBurnout 固有の一手を返す。
    const seniorBurnout = loseNextActionView('seniorBurnout', {
      quarterOutcome: 'missed_crisis',
      snapshot: { seniorHp: 1, reviewQueuePeak: 10 },
    });
    expect(seniorBurnout.nextAction).toContain('緊急対応');
    expect(seniorBurnout.nextAction).not.toContain('信頼');

    // techDebt が missed_crisis 経由でも techDebt 固有の一手を返す。
    const techDebt = loseNextActionView('techDebt', {
      quarterOutcome: 'missed_crisis',
      snapshot: {},
    });
    expect(techDebt.nextAction).toContain('休息');
    expect(techDebt.nextAction).toContain('負債');

    // moraleCollapse が missed_crisis 経由でも moraleCollapse 固有の一手を返す。
    const moraleCollapse = loseNextActionView('moraleCollapse', {
      quarterOutcome: 'missed_crisis',
      snapshot: {},
    });
    expect(moraleCollapse.nextAction).toContain('休息');
    expect(moraleCollapse.nextAction).toContain('士気');

    // reviewFreeze が missed_crisis 経由でも reviewFreeze 固有の一手を返す。
    const reviewFreeze = loseNextActionView('reviewFreeze', {
      quarterOutcome: 'missed_crisis',
      snapshot: { seniorHp: 40, reviewQueuePeak: 50 },
    });
    expect(reviewFreeze.nextAction).toMatch(/AIスロットル|PR分割|レビュー応援/);
  });

  it('missed_crisis はトリガー別に助言を分ける', () => {
    const trust = loseNextActionView('trustExhausted', {
      quarterOutcome: 'missed_crisis',
      snapshot: { trust: { management: 12, customers: 40, team: 40 } },
    });
    expect(classifyMissedCrisisCause({ trust: { management: 12, customers: 40, team: 40 } })).toBe(
      'trust',
    );
    expect(trust.nextAction).toMatch(/経営|延期交渉/);
    expect(trust.nextAction).not.toContain('目標修正で継続条件');

    const budget = loseNextActionView('trustExhausted', {
      quarterOutcome: 'missed_crisis',
      snapshot: {
        trust: { management: 50, customers: 50, team: 50 },
        budget: 4,
      },
    });
    expect(budget.nextAction).toContain('追加予算申請');

    const kpi = loseNextActionView('trustExhausted', {
      quarterOutcome: 'missed_crisis',
      snapshot: {
        trust: { management: 50, customers: 50, team: 50 },
        budget: 20,
        missedKpiCount: 4,
        missedKpiIds: ['delivery', 'quality', 'techDebt', 'morale'],
      },
    });
    expect(kpi.nextAction).toMatch(/Delivery|Quality|Tech Debt|Morale/);
  });

  it('reorg_required はトリガー別に助言を分ける', () => {
    const kpi = loseNextActionView('reorgRequired', {
      quarterOutcome: 'reorg_required',
      snapshot: {
        quarterNumber: OUTCOME_BALANCE.quarterReorgMinQuarter.value,
        missedKpiCount: OUTCOME_BALANCE.quarterReorgMissedKpiMin.value,
        missedKpiIds: ['delivery', 'techDebt', 'aiAdoption'],
        trust: { management: 50, customers: 50, team: 50 },
      },
    });
    expect(
      classifyReorgCause({
        quarterNumber: 2,
        missedKpiCount: 3,
        trust: { management: 50, customers: 50, team: 50 },
      }),
    ).toBe('kpiMissed');
    expect(kpi.nextAction).toMatch(/Delivery|Tech Debt|AI Adoption/);
    expect(kpi.nextAction).toContain(`Q${OUTCOME_BALANCE.quarterReorgMinQuarter.value}`);
    expect(kpi.nextAction).toContain(`${OUTCOME_BALANCE.quarterReorgMissedKpiMin.value}件以上`);
    expect(kpi.nextAction).not.toContain('品質・士気・障害');
    expect(kpi.nextAction).not.toContain('目標修正');

    const trust = loseNextActionView('reorgRequired', {
      quarterOutcome: 'reorg_required',
      snapshot: {
        quarterNumber: OUTCOME_BALANCE.quarterReorgMinQuarter.value - 1,
        missedKpiCount: OUTCOME_BALANCE.quarterReorgTrustMissedKpiMin.value,
        trust: { management: 18, customers: 40, team: 40 },
      },
    });
    expect(
      classifyReorgCause({
        quarterNumber: OUTCOME_BALANCE.quarterReorgMinQuarter.value - 1,
        missedKpiCount: OUTCOME_BALANCE.quarterReorgTrustMissedKpiMin.value,
        trust: { management: 18, customers: 40, team: 40 },
      }),
    ).toBe('trust');
    expect(trust.nextAction).toMatch(/経営|目標修正/);
  });
});
