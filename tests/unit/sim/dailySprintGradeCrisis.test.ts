import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { planSprintGradeView } from '../../../src/render/sprintGradeView';
import { computeGrade, computeTitleAndDiagnosis } from '../../../src/sim/sprint';
import { createOrgState } from '../../../src/sim/org';
import { makeSprint } from '../helpers/sprintFixtures';
import type { SprintMetrics, SprintState } from '../../../src/sim/types';

function patchMetrics(sprint: SprintState, overrides: Partial<SprintMetrics>): void {
  Object.assign(sprint.metrics, overrides);
}

function playDailySprint1(dateStr: string) {
  const game = createGame({ seed: 'title' });
  game.startDailyRun(dateStr);
  let s = game.getState();
  let guard = 0;
  while (s.phase !== 'result' && s.status === 'playing' && guard < 5000) {
    guard += 1;
    switch (s.phase) {
      case 'setup':
        game.beginSetupSprint();
        break;
      case 'sprint':
        game.step(1_000_000);
        break;
      default:
        throw new Error(`unexpected phase ${s.phase}`);
    }
    s = game.getState();
  }
  if (s.phase !== 'result' || !s.lastResult) {
    throw new Error(`result に到達しない: phase=${s.phase}`);
  }
  return s;
}

describe('Daily 無介入 Sprint 1 の評価と危機の読み（#364）', () => {
  it('seed daily-2026-08-27 は出荷主導で B だが、診断と内訳で危機が読める', () => {
    const s = playDailySprint1('2026-08-27');
    const result = s.lastResult!;

    expect(s.seed).toBe('daily-2026-08-27');
    expect(s.difficulty).toBe('normal');
    expect(result.grade).toBe('B');
    expect(result.delivered).toBe(576);
    expect(result.incidents).toBe(10);
    expect(result.seniorHpDelta).toBe(-98);
    expect(s.org.seniorHp).toBeGreaterThan(0);
    expect(s.org.seniorHp).toBeLessThan(3);
    expect(result.title).toBe('シニア過労メーカー');
    expect(result.diagnosis).toContain('燃え尽き寸前');
    expect(result.diagnosis).not.toContain('出荷は伸びました');

    const view = planSprintGradeView(result);
    expect(view.caption).toContain('大きな危機を出しつつ出荷した');
    expect(view.tip).toContain('出荷点を母数');
    expect(view.rows.some((row) => row.label === 'Incident' && row.value.includes('10件'))).toBe(
      true,
    );
    expect(view.rows.some((row) => row.label === 'シニアHP' && row.value.includes('-98'))).toBe(
      true,
    );
  });

  it('同じ危機でも出荷点が大きいと等級は B に留まる（delivered 主導）', () => {
    const org = createOrgState('default', false);
    org.seniorHp = 2;
    const sprint = makeSprint(org, []);
    patchMetrics(sprint, {
      seniorHpStart: 100,
      delivered: 576,
      reworkCount: 3,
      incidentCount: 10,
      spread: 1,
      completedCount: 50,
      reviewQueueMax: 26,
      aiAssistedCompleted: 0,
      actionCounts: {},
    });

    expect(computeGrade(sprint, org)).toBe('B');
    expect(computeTitleAndDiagnosis(sprint, org)).toEqual({
      title: 'シニア過労メーカー',
      diagnosis: 'レビュー負荷がシニアに集中し燃え尽き寸前です。体力が尽きる前に分散を。',
    });
  });
});
