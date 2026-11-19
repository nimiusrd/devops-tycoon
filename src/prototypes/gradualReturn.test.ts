import { describe, expect, it } from 'vitest';
import { MEMBER_BALANCE } from '../data/balance';
import { advanceReturnTrial, compareReturnPlans, createReturnTrial } from './gradualReturn';

const seed = 'RI-208:01';
const getPerson = (state: ReturnType<typeof createReturnTrial>) =>
  state.roster.members.find((member) => member.id === state.memberId)!;
const recover = () => advanceReturnTrial(advanceReturnTrial(createReturnTrial(seed)));

describe('復帰プランの比較試作', () => {
  it('現行の回復閾値で控えへ戻り、休職中には配置もプランも受け付けない', () => {
    const initial = createReturnTrial(seed);
    const threshold = Math.ceil(getPerson(initial).staminaMax * MEMBER_BALANCE.returnRatio.value);
    const recovery = Math.round(
      MEMBER_BALANCE.recoveryBetweenSprints.value * MEMBER_BALANCE.leaveRecoveryMultiplier.value,
    );
    getPerson(initial).stamina = threshold - recovery - 1;

    const input = { assignment: 'review', plan: 'gradual' } as const;
    const stillOnLeave = advanceReturnTrial(initial, input);
    expect(getPerson(stillOnLeave)).toMatchObject({
      stamina: threshold - 1,
      onLeave: true,
      assignment: 'bench',
    });
    expect(stillOnLeave.returnSprint).toBeNull();
    expect(stillOnLeave.gradualLastSprint).toBeNull();

    getPerson(initial).stamina += 1;
    const returned = advanceReturnTrial(initial, input);
    expect(getPerson(returned)).toMatchObject({
      stamina: threshold,
      onLeave: false,
      assignment: 'bench',
      aiAssigned: false,
    });
    expect(returned.returnSprint).toBe(2);
    expect(returned.gradualLastSprint).toBeNull();
  });

  it('プランも編成も指定せずに、通常復帰でスプリントを進められる', () => {
    const returned = recover();
    const normal = advanceReturnTrial(returned);
    expect(normal).toEqual(advanceReturnTrial(returned, { plan: 'normal' }));
    expect(normal.history).toHaveLength(3);
    expect(normal.history[2]).toMatchObject({
      assignment: 'bench',
      contributionMultiplier: 1,
      drainMultiplier: 1,
    });
    expect(getPerson(normal).stamina).toBeGreaterThan(getPerson(returned).stamina);
    expect(advanceReturnTrial(returned, { assignment: 'review' })).toEqual(
      advanceReturnTrial(returned, { plan: 'normal', assignment: 'review' }),
    );
  });

  it.each(['coding', 'review'] as const)('段階復帰中の %s の能力と消耗を抑える', (assignment) => {
    const returned = recover();
    const normal = advanceReturnTrial(returned, { assignment });
    const gradual = advanceReturnTrial(returned, { assignment, plan: 'gradual' });
    const normalSprint = normal.history[2];
    const gradualSprint = gradual.history[2];
    expect(gradualSprint.staminaAfterWork).toBeGreaterThan(normalSprint.staminaAfterWork);
    expect(gradualSprint.codingSpeedMul).toBeLessThanOrEqual(normalSprint.codingSpeedMul);
    expect(gradualSprint.reviewEfficiencyMul).toBeLessThanOrEqual(normalSprint.reviewEfficiencyMul);
    const laneEffect = assignment === 'coding' ? 'codingSpeedMul' : 'reviewEfficiencyMul';
    expect(gradualSprint[laneEffect]).toBeLessThan(normalSprint[laneEffect]);
    expect(getPerson(gradual).stats.review).toBeGreaterThanOrEqual(
      getPerson(returned).stats.review,
    );
    expect(getPerson(gradual).stats.implementation).toBeGreaterThanOrEqual(
      getPerson(returned).stats.implementation,
    );
  });

  it('復帰直後の2スプリントだけ係数が掛かり、再指定や保存再開で延長しない', () => {
    let state = recover();
    const input = { assignment: 'review', plan: 'gradual' } as const;
    for (let sprint = 3; sprint <= 6; sprint++) {
      const continuation = sprint === 3 ? input : { plan: 'gradual' as const };
      const resumed = advanceReturnTrial(JSON.parse(JSON.stringify(state)), continuation);
      state = advanceReturnTrial(state, continuation);
      expect(state).toEqual(resumed);
      expect(state.gradualLastSprint).toBe(4);
    }
    expect(state.history.map((sprint) => sprint.contributionMultiplier)).toEqual([
      1, 1, 0.5, 0.5, 1, 1,
    ]);
    expect(state.history.map((sprint) => sprint.drainMultiplier)).toEqual([1, 1, 0.6, 0.6, 1, 1]);
  });

  it('控えの期間も段階復帰の期間に数える', () => {
    const first = advanceReturnTrial(recover(), { plan: 'gradual' });
    const second = advanceReturnTrial(first, { assignment: 'review' });
    const third = advanceReturnTrial(second);
    expect([first.history[2], second.history[3], third.history[4]]).toMatchObject([
      { assignment: 'bench', contributionMultiplier: 1, drainMultiplier: 1 },
      { assignment: 'review', contributionMultiplier: 0.5, drainMultiplier: 0.6 },
      { assignment: 'review', contributionMultiplier: 1, drainMultiplier: 1 },
    ]);
  });

  it('同じ初期状態と入力列で比較を再現する', () => {
    const [normal, gradual] = compareReturnPlans(seed, 'review');
    expect(compareReturnPlans(seed, 'review')).toEqual([normal, gradual]);
    expect(normal.history.slice(0, 2)).toEqual(gradual.history.slice(0, 2));
    expect(normal.history[2].staminaAtStart).toBe(gradual.history[2].staminaAtStart);
  });

  it('再休職した回は自然回復を飛ばし、再復帰後に段階復帰を始め直さない', () => {
    const placed = advanceReturnTrial(recover(), { assignment: 'review', plan: 'gradual' });
    const tookLeave = advanceReturnTrial(placed);
    expect(tookLeave.history[3]).toMatchObject({
      tookLeave: true,
      staminaAfterWork: 12,
      staminaAfterRecovery: 12,
    });
    const returnedAgain = advanceReturnTrial(advanceReturnTrial(tookLeave));
    expect(getPerson(returnedAgain)).toMatchObject({ onLeave: false, assignment: 'bench' });
    const next = advanceReturnTrial(returnedAgain, { assignment: 'review', plan: 'gradual' });
    expect(next.gradualLastSprint).toBe(4);
    expect(next.history[6]).toMatchObject({ contributionMultiplier: 1, drainMultiplier: 1 });
  });

  it.each([
    ['review', [7_448, 15_000, 27_228, 36, 12], [7_433, 15_115, 28_502, 216, 10]],
    ['coding', [6_771, 13_995, 25_532, 120, 12], [6_759, 14_000, 25_564, 264, 8]],
  ] as const)('12 seed の %s 配置で出荷・再消耗の記録を再現する', (assignment, normal, gradual) => {
    const totals = [0, 0].map(() => [0, 0, 0, 0, 0]);
    for (let i = 1; i <= 12; i++) {
      const trialSeed = `RI-208:${String(i).padStart(2, '0')}`;
      const pair = compareReturnPlans(trialSeed, assignment);
      const metrics = pair.map(({ history }) => {
        const postReturn = history.slice(2);
        return [
          postReturn[0].delivered,
          postReturn[0].delivered + postReturn[1].delivered,
          postReturn.reduce((sum, sprint) => sum + sprint.delivered, 0),
          postReturn[0].staminaAfterWork,
          Number(postReturn.some((sprint) => sprint.tookLeave)),
        ];
      });
      metrics.forEach((plan, index) =>
        plan.forEach((value, metric) => (totals[index][metric] += value)),
      );
    }
    expect(totals).toEqual([normal, gradual]);
  });
});
