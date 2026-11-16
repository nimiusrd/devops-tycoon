import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/mentorship-comparison.json';
import factors from '../../docs/prototypes/mentorship-factor-comparison.json';
import { assignMember } from '../sim/member/roster';
import {
  advanceMentorshipPeriod,
  compareMentorshipFactorReversals,
  compareMentorshipStrategies,
  createMentorshipPrototype,
  previewMentorship,
} from './mentorship';

describe('師弟育成の期間単位試作', () => {
  it('レビュー配置の弟子にはAIを配布しない', () => {
    const state = createMentorshipPrototype(1);
    expect(state.roster.members.find((member) => member.id === state.apprenticeId)).toMatchObject({
      assignment: 'review',
      aiAssigned: false,
    });
  });

  it('弟子の一時不在では残り育成回数を消さず、同じIDの復帰後も維持する', () => {
    const state = advanceMentorshipPeriod(createMentorshipPrototype(1), true);
    const apprentice = state.roster.members.find((member) => member.id === state.apprenticeId)!;
    state.roster.members = state.roster.members.filter((member) => member.id !== apprentice.id);
    expect(previewMentorship(state)).toMatchObject({ available: false, remainingLessons: 1 });
    const absent = advanceMentorshipPeriod(state, true);
    expect(absent.lessons).toBe(1);
    absent.roster.members.push(apprentice);
    expect(previewMentorship(absent)).toMatchObject({ available: true, remainingLessons: 1 });
  });

  it('弟子IDを変更しても本人の初期能力を使い、未育成の能力差を成長扱いしない', () => {
    const state = createMentorshipPrototype(1);
    const originalId = state.apprenticeId;
    const replacement = state.roster.members.find(
      (member) => member.id !== originalId && member.id !== state.mentorId,
    )!;
    state.apprenticeId = replacement.id;
    state.roster = assignMember(state.roster, replacement.id, 'review');
    const unchanged = advanceMentorshipPeriod(state, false);
    expect(unchanged.history[0].apprenticeWork).toBe(4);
    expect(unchanged.history[0].apprenticeGrowthWork).toBe(0);
    const taught = advanceMentorshipPeriod(unchanged, true);
    expect(advanceMentorshipPeriod(taught, false).history[2].apprenticeGrowthWork).toBe(1);
    taught.apprenticeId = originalId;
    expect(advanceMentorshipPeriod(taught, false).history[2].apprenticeGrowthWork).toBe(0);
  });

  it('後から追加した弟子への育成増分を記録し、保存再開でも引き継ぐ', () => {
    const state = createMentorshipPrototype(1);
    const template = state.roster.members.find((member) => member.id === state.apprenticeId)!;
    const newcomer = {
      ...template,
      id: 'new-apprentice',
      stats: { ...template.stats, review: 40 },
    };
    state.roster.members.push(newcomer);
    state.apprenticeId = newcomer.id;
    const taught = advanceMentorshipPeriod(state, true);
    expect(taught.mentorshipReviewGains[newcomer.id]).toBe(10);
    expect(taught.history[0].apprenticeGrowthWork).toBe(0);
    const restored = JSON.parse(JSON.stringify(taught));
    expect(advanceMentorshipPeriod(restored, false).history[1].apprenticeGrowthWork).toBe(1);
    expect(advanceMentorshipPeriod(restored, false)).toEqual(
      advanceMentorshipPeriod(taught, false),
    );
  });

  it('弟子になる前に得た能力は育成成果へ含めない', () => {
    const state = createMentorshipPrototype(1);
    const replacement = state.roster.members.find(
      (member) => member.id !== state.apprenticeId && member.id !== state.mentorId,
    )!;
    replacement.stats.review = 50;
    state.apprenticeId = replacement.id;
    state.roster = assignMember(state.roster, replacement.id, 'review');
    const selected = advanceMentorshipPeriod(state, false);
    expect(selected.mentorshipReviewGains[replacement.id]).toBeUndefined();
    expect(selected.history[0].apprenticeGrowthWork).toBe(0);
    const taught = advanceMentorshipPeriod(selected, true);
    expect(advanceMentorshipPeriod(taught, false).history[2].apprenticeGrowthWork).toBe(1);
  });

  it.each([false, true])('育成実施%sの弟子を再選択しても自然成長を加算しない', (teach) => {
    let state = createMentorshipPrototype(1);
    const originalId = state.apprenticeId;
    const replacement = state.roster.members.find(
      (member) => member.id !== originalId && member.id !== state.mentorId,
    )!;
    state.apprenticeId = replacement.id;
    state.roster = assignMember(state.roster, replacement.id, 'review');
    state = advanceMentorshipPeriod(state, teach);
    state.apprenticeId = originalId;
    state = advanceMentorshipPeriod(state, false);
    state.roster.members.find((member) => member.id === replacement.id)!.stats.review += 10;
    state.apprenticeId = replacement.id;
    const returned = advanceMentorshipPeriod(JSON.parse(JSON.stringify(state)), false);
    expect(returned.history[2].apprenticeGrowthWork).toBe(teach ? 1 : 0);
    expect(returned.mentorshipReviewGains[replacement.id] ?? 0).toBe(teach ? 10 : 0);
  });
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

describe('RI-206 要因を一つずつ動かした比較', () => {
  const data = compareMentorshipFactorReversals();
  const point = (axis: 'load' | 'deadline' | 'return', parameter: string) => {
    const found = data.sweeps[axis].find((row) => row.parameter === parameter);
    if (!found) throw new Error(`${axis}:${parameter}`);
    return found;
  };
  const delivered = (axis: 'load' | 'deadline' | 'return', parameter: string) => {
    const row = point(axis, parameter);
    return [row.runs.concentrate.delivered, row.runs.mentor.delivered];
  };

  it('記録した要因比較を再計算と照合する', () => {
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-206',
      horizon: 8,
      baselineDemand: 12,
      score: 'delivered',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
      traitsStaminaGrowth: false,
    });
  });

  it('需要・失効・復帰はそれぞれ一つだけ動き、8期間の対照は初回と一致する', () => {
    expect(
      data.sweeps.load.every(
        (row) =>
          row.schedule.every((step) => step.mentorPresent && !step.expireBacklog) &&
          new Set(row.schedule.map((step) => step.demand)).size === 1,
      ),
    ).toBe(true);
    expect(
      data.sweeps.deadline.every((row) => {
        const expiries = row.schedule.filter((step) => step.expireBacklog);
        return (
          row.schedule.every((step) => step.mentorPresent && step.demand === 12) &&
          expiries.length === (row.parameter === 'none' ? 0 : 1)
        );
      }),
    ).toBe(true);
    expect(
      data.sweeps.return.every((row) =>
        row.schedule.every((step) => step.demand === 12 && !step.expireBacklog),
      ),
    ).toBe(true);
    const [focus, taught] = compareMentorshipStrategies('RI-206', 8);
    expect(point('load', '12').runs.concentrate.history).toEqual(focus.history);
    expect(point('load', '12').runs.mentor.history).toEqual(taught.history);
    expect(point('deadline', 'none').runs.concentrate.history).toEqual(focus.history);
    expect(point('return', '1').runs.mentor.history).toEqual(taught.history);
  });

  it('需要9と10、復帰3と4で優劣が変わり、期限の失効では出荷が反転しない', () => {
    expect(delivered('load', '9')).toEqual([72, 72]);
    expect(point('load', '9').runs.mentor.apprenticeGrowthWork).toBe(8);
    expect(delivered('load', '10')).toEqual([72, 77]);
    expect(delivered('load', '12')).toEqual([72, 77]);
    expect(point('load', '12').preference).toBe('mentor');
    for (const parameter of ['none', '1', '5', '6', '8']) {
      expect(delivered('deadline', parameter)).toEqual([72, 77]);
      expect(point('deadline', parameter).preference).toBe('mentor');
    }
    expect(point('deadline', '5').runs.concentrate.expired).toBe(15);
    expect(point('deadline', '5').runs.mentor.expired).toBe(16);
    expect(point('deadline', '6').runs.concentrate.expired).toBe(18);
    expect(point('deadline', '6').runs.mentor.expired).toBe(17);
    expect(point('deadline', '1').runs.concentrate.history[1]?.backlog).toBe(3);
    expect(point('deadline', 'none').runs.concentrate.history[1]?.backlog).toBe(6);
    expect(delivered('return', '3')).toEqual([60, 61]);
    expect(delivered('return', '4')).toEqual([54, 53]);
    expect(point('return', '4').runs.mentor.teach).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(point('return', '4').runs.mentor.history.map((period) => period.taught)).toEqual([
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(delivered('return', '8')).toEqual([30, 26]);
    expect(point('return', '8').runs.mentor.apprenticeReview).toBe(42);
    expect(point('return', '8').runs.mentor.apprenticeGrowthWork).toBe(0);
    expect(delivered('return', 'absent')).toEqual([24, 24]);
    expect(data.reversals).toEqual([
      {
        axis: 'load',
        before: { parameter: '9', preference: 'tie', concentrate: 72, mentor: 72 },
        after: { parameter: '10', preference: 'mentor', concentrate: 72, mentor: 77 },
      },
      {
        axis: 'return',
        before: { parameter: '3', preference: 'mentor', concentrate: 60, mentor: 61 },
        after: { parameter: '4', preference: 'concentrate', concentrate: 54, mentor: 53 },
      },
      {
        axis: 'return',
        before: { parameter: '8', preference: 'concentrate', concentrate: 30, mentor: 26 },
        after: { parameter: 'absent', preference: 'tie', concentrate: 24, mentor: 24 },
      },
    ]);
  });
});
