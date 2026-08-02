import { describe, expect, it } from 'vitest';
import { loseNextActionView } from '../../src/render/loseNextActionView';
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

  it('aiDependency はペアレビューまたは依存抑制の一手を示す', () => {
    const view = loseNextActionView('aiDependency');
    expect(view.nextAction).toMatch(/ペアレビュー|AIガイドライン|AIスロットル/);
    expect(view.insight).toMatch(/AI|検証|判断/);
  });

  it('incidentCascade は緊急対応の一手を示す', () => {
    const view = loseNextActionView('incidentCascade');
    expect(view.nextAction).toContain('緊急対応');
  });
});
