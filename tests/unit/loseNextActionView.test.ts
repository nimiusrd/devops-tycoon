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

  it('seniorBurnout は割り込みレビューではなく緊急対応と休息を勧める', () => {
    const view = loseNextActionView('seniorBurnout');
    expect(view.nextAction).toContain('緊急対応');
    expect(view.nextAction).toContain('休息');
    expect(view.nextAction).not.toContain('割り込みレビュー');
  });

  it('budgetExhausted は全社レバーではなく追加予算申請を勧める', () => {
    const view = loseNextActionView('budgetExhausted');
    expect(view.nextAction).toMatch(/追加予算申請|AI導入一時停止/);
    expect(view.nextAction).not.toContain('全社レバー');
  });

  it('moraleCollapse はレリックではなく休息で士気を戻す', () => {
    const view = loseNextActionView('moraleCollapse');
    expect(view.nextAction).toContain('休息');
    expect(view.nextAction).not.toContain('レリック');
  });

  it('四半期 outcome があるときは trustExhausted より outcome 固有の助言を返す', () => {
    const missed = loseNextActionView('trustExhausted', { quarterOutcome: 'missed_crisis' });
    expect(missed.nextAction).toMatch(/KPI|予算|信頼/);
    expect(missed.insight).toContain('深刻な未達');

    const shutdown = loseNextActionView('trustExhausted', { quarterOutcome: 'shutdown' });
    expect(shutdown.nextAction).toMatch(/信頼|予算|士気|シニアHP/);
    expect(shutdown.insight).toContain('継続不能');
  });
});
