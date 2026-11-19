import { beforeAll, describe, expect, it } from 'vitest';
import { getBoss } from '../data/bossDisplay';
import { buildQuarterGoal, canAcknowledgeWin } from '../sim/run/quarterReview';
import { parseRunSaveShare } from '../state/runSaveShare';
import { ENDURANCE_RULES, evaluateEndurance } from './enduranceEconomy';

describe('RI-268 耐久経営の6期比較', () => {
  let run: ReturnType<typeof evaluateEndurance>;

  beforeAll(() => {
    run = evaluateEndurance('ri268:10');
  });

  it('通常レビューの目標修正と勝利を通り、達成後にだけ新しい目標で分岐する', () => {
    expect(run.preVictory[0]).toMatchObject({
      outcome: 'missed_adjustable',
      adjustment: 'cut_scope',
    });
    expect(run.normalStatus).toBe('won');
    expect(run.firstVictory).toMatchObject({ quarter: 2, winType: 'chaos' });
    expect(run.firstVictory?.ordinaryMetaPoints).toBeGreaterThan(0);
    expect(run.firstVictory?.bossRelicReward).toBeTruthy();
    for (const comparison of run.comparisons) {
      const first = comparison.quarters[0];
      expect(first.quarter).toBe(3);
      expect(first.goal).toEqual(buildQuarterGoal(getBoss(first.boss)!, 'easy'));
      expect(first.start.budget - comparison.quarterlyGrant).toBe(run.preVictory[1].end.budget);
      expect(first.start.roster).toEqual(run.preVictory[1].end.roster);
      expect(first.start.relics).toEqual(run.preVictory[1].end.relics);
    }
  });

  it('耐久中は突破レリック・メタ進行を再付与せず、通常セーブとして受理されない', () => {
    const quarters = run.comparisons.flatMap((comparison) => comparison.quarters);
    expect(quarters.some(({ bossCleared }) => bossCleared)).toBe(true);
    expect(quarters.every(({ bossRelicReward }) => bossRelicReward === null)).toBe(true);
    expect(
      quarters.every(({ end }) => end.relics.length === run.preVictory[1].end.relics.length),
    ).toBe(true);
    expect(run.comparisons.every(({ metaPoints }) => metaPoints === 0)).toBe(true);
    expect(parseRunSaveShare(JSON.stringify(run)).ok).toBe(false);
  });

  it('6期完了と途中の敗北を区別し、達成を更新、未達を修正として数える', () => {
    const reserve = run.comparisons.find(
      ({ policy, quarterlyGrant }) =>
        policy === 'reserve' && quarterlyGrant === ENDURANCE_RULES.quarterlyGrant,
    )!;
    const delivery = run.comparisons.find(
      ({ policy, quarterlyGrant }) => policy === 'delivery' && quarterlyGrant === 0,
    )!;
    expect(reserve).toMatchObject({
      stoppedBy: 'horizon',
      completedQuarters: 6,
      longestStableStreak: 1,
      loseReason: null,
    });
    expect(reserve.quarters[reserve.quarters.length - 1]).toMatchObject({
      outcome: 'missed_adjustable',
      adjustment: null,
    });
    expect(reserve.quarters.some(({ adjustment }) => adjustment === 'quality_pivot')).toBe(true);
    for (const quarter of reserve.quarters.slice(0, -1)) {
      if (quarter.outcome && canAcknowledgeWin(quarter.outcome)) {
        const next = reserve.quarters.find(
          ({ quarter: number }) => number === quarter.quarter + 1,
        )!;
        expect(next.goal).toEqual(buildQuarterGoal(getBoss(next.boss)!, 'easy'));
      }
    }
    expect(delivery).toMatchObject({
      stoppedBy: 'lost',
      completedQuarters: 1,
      loseReason: 'budgetExhausted',
    });
    expect(delivery.quarters[delivery.quarters.length - 1]).toMatchObject({
      outcome: null,
      bossInfraCharge: expect.any(Number),
    });
  });

  it('第6期に入った後の途中敗北を6期完走に含めない', () => {
    const result = evaluateEndurance('ri75j-easy-7');
    const delivery = result.comparisons.find(
      ({ policy, quarterlyGrant }) =>
        policy === 'delivery' && quarterlyGrant === ENDURANCE_RULES.quarterlyGrant,
    )!;
    expect(delivery.quarters).toHaveLength(ENDURANCE_RULES.quarters);
    expect(delivery).toMatchObject({
      stoppedBy: 'lost',
      completedQuarters: 5,
      loseReason: 'seniorBurnout',
    });
  });

  it('同じseedと固定方針で入力列・結果を再現できる', () => {
    expect(evaluateEndurance('ri268:10')).toEqual(run);
  });

  it('初回勝利できなかった状態から耐久を始めない', () => {
    expect(evaluateEndurance('ri268:2')).toMatchObject({
      normalStatus: 'lost',
      firstVictory: null,
      comparisons: [],
    });
  });
});
