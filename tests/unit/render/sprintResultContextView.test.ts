import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import { companyOrgFromTeams } from '../../../src/sim/orgscale';
import { measureGoalProgress } from '../../../src/sim/run/quarterReview';
import { planSprintResultContextLine } from '../../../src/render/sprintResultContextView';
import { reviewFreezeWatchPeak } from '../../../src/render/reviewFreezeCopy';
import { advance } from '../helpers/runFlow';

describe('sprintResultContextView（#1011 / #1014）', () => {
  const base = {
    quarterNumber: 1,
    sprintsPerQuarter: 6,
    sprintIndexInQuarter: 5,
    quarterGoal: {
      deliveryTarget: 5265,
      qualityTarget: 45,
      techDebtLimit: 55,
      moraleTarget: 40,
      incidentLimit: 6,
    },
    quarterTotals: {
      delivered: 4515,
      done: 100,
      rework: 0,
      incidents: 30,
      contained: 0,
      spread: 0,
      aiAssisted: 0,
      completed: 100,
      reviewQueuePeak: 0,
    },
    org: new RunEngine({ seed: 'unit', difficulty: 'easy' }).snapshot().org,
    teams: new RunEngine({ seed: 'unit', difficulty: 'easy' }).snapshot().teams,
    runReviewQueuePeak: 0,
    sprintReviewQueueMax: 0,
  };

  it('ボス直前以外の四半期内スプリントでも四半期進捗を出す', () => {
    const line = planSprintResultContextLine({
      ...base,
      sprintIndexInQuarter: 4,
      runReviewQueuePeak: 40,
      sprintReviewQueueMax: 40,
    });
    expect(line.show).toBe(true);
    if (!line.show) return;
    expect(line.kind).toBe('quarterGoal');
    expect(line.text).toContain('（残り2スプリント）');
  });

  it('当四半期の最終手前スプリントで watch 以上なら凍結予兆を1行出す', () => {
    const peak = reviewFreezeWatchPeak();
    const line = planSprintResultContextLine({
      ...base,
      sprintIndexInQuarter: 5,
      runReviewQueuePeak: peak,
      sprintReviewQueueMax: 10,
      quarterTotals: {
        ...base.quarterTotals,
        delivered: 5300,
        incidents: 0,
      },
    });
    expect(line.show).toBe(true);
    if (!line.show) {
      throw new Error('line should show');
    }
    expect(line.kind).toBe('reviewFreeze');
    expect(line.text).toContain('レビュー凍結');
  });

  it('四半期未達の危険度が高いときは凍結行より四半期行を優先する', () => {
    const peak = reviewFreezeWatchPeak();
    const line = planSprintResultContextLine({
      ...base,
      sprintIndexInQuarter: 5,
      runReviewQueuePeak: peak,
      sprintReviewQueueMax: 10,
    });
    expect(line.show).toBe(true);
    if (!line.show) return;
    expect(line.kind).toBe('quarterGoal');
    expect(line.tone).toBe('danger');
    expect(line.text).toContain('インシデント 30 / 上限 6');
  });

  it('qa-seed-1031c のスプリント5結果で危険行が出る', () => {
    const e = new RunEngine({ seed: 'qa-seed-1031c', difficulty: 'easy' });
    e.startRun();
    let guard = 0;
    let s = e.snapshot();
    while (guard < 50_000 && !(s.phase === 'result' && s.sprintIndexInQuarter === 5)) {
      guard += 1;
      advance(e);
      s = e.snapshot();
    }
    expect(s.phase).toBe('result');
    expect(s.sprintIndexInQuarter).toBe(5);
    const line = planSprintResultContextLine({
      quarterNumber: s.quarterNumber,
      sprintIndexInQuarter: s.sprintIndexInQuarter,
      sprintsPerQuarter: s.sprintsPerQuarter,
      quarterGoal: s.quarterGoal,
      quarterTotals: s.quarterTotals,
      org: s.org,
      teams: s.teams,
      runReviewQueuePeak: s.totals.reviewQueuePeak ?? 0,
      sprintReviewQueueMax: s.lastResult?.reviewQueueMax ?? 0,
    });
    const progress = measureGoalProgress({
      goal: s.quarterGoal,
      org: companyOrgFromTeams(s.teams, s.org),
      totals: s.quarterTotals,
    });
    const delivery = progress.find((kpi) => kpi.id === 'delivery');
    const incident = progress.find((kpi) => kpi.id === 'incident');
    expect(delivery?.status).toBe('missed');
    expect(incident?.status).toBe('missed');
    expect(line.show).toBe(true);
    if (!line.show) return;
    expect(line.tone).toBe('danger');
    expect(line.kind).toBe('quarterGoal');
    expect(line.text).toContain('出荷');
    expect(line.text).toContain('インシデント');
  });
});
