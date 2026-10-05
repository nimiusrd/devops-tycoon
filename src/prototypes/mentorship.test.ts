import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/mentorship-comparison.json';
import {
  advanceMentorshipPeriod,
  compareMentorshipStrategies,
  createMentorshipPrototype,
  previewMentorship,
} from './mentorship';

describe('師弟育成の期間単位試作', () => {
  it('記録した短期・中期・長期の比較を再現する', () => {
    for (const scenario of comparison) {
      expect(compareMentorshipStrategies(scenario.seed, scenario.periods)).toEqual(
        scenario.results,
      );
    }
  });
  it('実在する弟子IDのレビュー力だけを上げ、当期の処理を減らす', () => {
    const state = createMentorshipPrototype('RI-206');
    expect(previewMentorship(state)).toMatchObject({
      ability: 'review',
      mentorCapacityCost: 3,
      apprenticeCapacityCost: 1,
      nextPeriodReviewGain: 10,
      effectiveFromPeriod: 2,
    });
    const next = advanceMentorshipPeriod(state, true);
    const before = state.roster.members.find((member) => member.id === state.apprenticeId)!;
    const after = next.roster.members.find((member) => member.id === state.apprenticeId)!;
    expect(after.stats).toEqual({ ...before.stats, review: before.stats.review + 10 });
    expect(next.history[0]).toMatchObject({
      taught: true,
      mentorWork: 3,
      apprenticeWork: 2,
      apprenticeGrowthWork: 0,
    });
    expect(advanceMentorshipPeriod(next, false).history[1].apprenticeGrowthWork).toBe(1);
  });

  it.each(['mentor', 'apprentice'] as const)(
    '%sの休職・不在・別配置で指定した育成は進まない',
    (role) => {
      for (const condition of ['leave', 'absent', 'bench', 'coding', 'exhausted']) {
        const state = createMentorshipPrototype(1);
        const id = role === 'mentor' ? state.mentorId : state.apprenticeId;
        const member = state.roster.members.find((candidate) => candidate.id === id)!;
        if (condition === 'leave') member.onLeave = true;
        if (condition === 'bench') member.assignment = 'bench';
        if (condition === 'coding') member.assignment = 'coding';
        if (condition === 'exhausted') member.stamina = 0;
        if (condition === 'absent')
          state.roster.members = state.roster.members.filter((candidate) => candidate.id !== id);
        const next = advanceMentorshipPeriod(state, true);
        expect(next.lessons).toBe(0);
        expect(previewMentorship(state)).toMatchObject({
          available: false,
          nextPeriodReviewGain: 0,
        });
        expect(next.history[0]).toMatchObject({
          taught: false,
          reviewGain: 0,
          mentorCapacityCost: 0,
        });
      }
    },
  );

  it('短期では集中、長期では育成が有利になり、操作そのものに出荷報酬を付けない', () => {
    const [shortFocus, shortMentor] = compareMentorshipStrategies('RI-206', 2);
    const [longFocus, longMentor] = compareMentorshipStrategies('RI-206', 8);
    expect(shortFocus.delivered).toBe(18);
    expect(shortMentor.delivered).toBe(11);
    expect(longFocus.delivered).toBe(72);
    expect(longMentor.delivered).toBe(77);
    expect(longMentor.apprenticeGrowthWork).toBe(13);
    expect(advanceMentorshipPeriod(createMentorshipPrototype(1), true, 0).delivered).toBe(0);
  });

  it('2期間だけ育成し、上限を超えず、JSON再開から同じ通常処理を続ける', () => {
    let state = createMentorshipPrototype(1);
    state = advanceMentorshipPeriod(state, true);
    state = advanceMentorshipPeriod(state, true);
    let restored = JSON.parse(JSON.stringify(state));
    for (let period = 0; period < 6; period += 1) {
      state = advanceMentorshipPeriod(state, true);
      restored = advanceMentorshipPeriod(restored, true);
    }
    expect(state.lessons).toBe(2);
    expect(restored).toEqual(state);
    expect(state.history.slice(2).every((period) => !period.taught)).toBe(true);
  });

  it('能力100では育成を終え、同じ人物を師匠と弟子に指定しても育たない', () => {
    const state = createMentorshipPrototype(1);
    state.roster.members.find((member) => member.id === state.apprenticeId)!.stats.review = 95;
    const capped = advanceMentorshipPeriod(state, true);
    expect(capped.history[0].reviewGain).toBe(5);
    expect(previewMentorship(capped)).toMatchObject({
      available: false,
      nextPeriodReviewGain: 0,
      remainingLessons: 0,
    });
    expect(advanceMentorshipPeriod(capped, true).lessons).toBe(1);
    state.apprenticeId = state.mentorId;
    const samePerson = advanceMentorshipPeriod(state, true);
    expect(samePerson.lessons).toBe(0);
    expect(samePerson.delivered).toBe(6);
    expect(samePerson.history[0]).toMatchObject({
      mentorWork: 6,
      apprenticeWork: 0,
      apprenticeGrowthWork: 0,
    });
  });
});
