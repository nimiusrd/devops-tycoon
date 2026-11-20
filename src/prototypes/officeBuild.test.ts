import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../data/balance/pacing';
import { assignMember, setAiAssigned } from '../sim/member';
import { computeWhatIfState } from '../sim/run/whatIfState';
import { createOfficeBuildStart, officeReviewHelp, prepareOfficeBuild } from './officeBuild';

describe('#736 オフィスで編成・施策を選ぶ試作', () => {
  it('候補だけで費用や初期編成を変更せず、本番レバーの予算と対象工程を試走へ引き継ぐ', () => {
    const start = createOfficeBuildStart();
    const original = structuredClone(start);
    const initial = prepareOfficeBuild(start, start.roster, false);
    const candidate = prepareOfficeBuild(start, start.roster, true);
    const effect = officeReviewHelp().effect.reviewQueueDelta ?? 0;

    expect(candidate.reviewHelpApplied).toBe(true);
    expect(candidate.forecast.budget).toBe(initial.forecast.budget - officeReviewHelp().cost);
    expect(candidate.forecast.teamReviewQueue).toBe(initial.forecast.teamReviewQueue + effect);
    for (const plan of [initial, candidate]) {
      expect(plan.launch.sprint?.tasks.filter((task) => task.lane === 'review')).toHaveLength(
        plan.forecast.teamReviewQueue,
      );
      expect(plan.launch.sprint?.tasks.filter((task) => task.incident)).toHaveLength(1);
    }
    expect(start).toEqual(original);
    expect(prepareOfficeBuild(start, start.roster, false).forecast).toEqual(initial.forecast);
  });

  it('予算不足の候補を適用済みにしない', () => {
    const start = createOfficeBuildStart();
    start.budget = officeReviewHelp().cost - 1;
    const candidate = prepareOfficeBuild(start, start.roster, true);

    expect(candidate.reviewHelpApplied).toBe(false);
    expect(candidate.forecast.budget).toBe(start.budget);
    expect(candidate.forecast.teamReviewQueue).toBe(10);
  });

  it('配置とAI配布を試算と実走に渡し、同じ入力なら実測を再現する', () => {
    const start = createOfficeBuildStart();
    const initial = prepareOfficeBuild(start, start.roster, false);
    const aiMember = start.roster.members.find((member) => member.aiAssigned)!;
    const otherCoder = start.roster.members.find(
      (member) => member.assignment === 'coding' && !member.aiAssigned,
    )!;
    const moved = assignMember(start.roster, aiMember.id, 'review');
    const roster = setAiAssigned(moved, otherCoder.id, true);
    const candidate = prepareOfficeBuild(start, roster, true);
    const repeated = prepareOfficeBuild(start, roster, true);

    expect(candidate.forecast.roster).toEqual(roster);
    expect(candidate.launch.roster).toEqual(roster);
    expect(roster.members.find((member) => member.id === aiMember.id)?.aiAssigned).toBe(false);
    expect(computeWhatIfState(candidate.forecast)?.current).toBeDefined();
    expect(candidate.engine.snapshot().lastResult).toBeNull();

    const finish = (plan: typeof initial) => {
      const sprint = plan.launch.sprint!;
      plan.engine.step((sprint.config.maxTicks + 1) * FIXED_STEP_MS);
      const result = plan.engine.snapshot().lastResult!;
      return {
        delivered: result.delivered,
        spread: result.spread,
        reviewQueueMax: result.reviewQueueMax,
        aiAssistedPct: result.aiAssistedPct,
      };
    };
    expect(finish(candidate)).toEqual(finish(repeated));
    expect(finish(initial)).not.toEqual(finish(prepareOfficeBuild(start, roster, true)));
  });
});
