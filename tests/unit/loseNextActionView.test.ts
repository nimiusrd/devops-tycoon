import { describe, expect, it } from 'vitest';
import {
  classifyExhaustedStakeholder,
  classifyMissedCrisisCause,
  classifyReorgCause,
  classifyShutdownCause,
  loseNextActionView,
} from '../../src/render/loseNextActionView';
import type { LoseReason } from '../../src/sim/run/types';

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

  it('reviewFreeze の低HP経路では割り込みレビューを勧めない', () => {
    const view = loseNextActionView('reviewFreeze', {
      snapshot: { seniorHp: 40, reviewQueuePeak: 12 },
    });
    expect(view.nextAction).toContain('休息');
    expect(view.nextAction).toMatch(/割り込みレビューでシニアHPを削らず|割り込みレビューに頼/);
  });

  it('reviewFreeze のキュー経路では渋滞対策を示す', () => {
    const view = loseNextActionView('reviewFreeze', {
      snapshot: { seniorHp: 80, reviewQueuePeak: 50 },
    });
    expect(view.nextAction).toMatch(/AIスロットル|PR分割|レビュー応援/);
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
        quarterNumber: 2,
        missedKpiCount: 3,
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
    expect(kpi.nextAction).not.toContain('品質・士気・障害');
    expect(kpi.nextAction).not.toContain('目標修正');

    const trust = loseNextActionView('reorgRequired', {
      quarterOutcome: 'reorg_required',
      snapshot: {
        quarterNumber: 1,
        missedKpiCount: 2,
        trust: { management: 18, customers: 40, team: 40 },
      },
    });
    expect(
      classifyReorgCause({
        quarterNumber: 1,
        missedKpiCount: 2,
        trust: { management: 18, customers: 40, team: 40 },
      }),
    ).toBe('trust');
    expect(trust.nextAction).toMatch(/経営|目標修正/);
  });
});
