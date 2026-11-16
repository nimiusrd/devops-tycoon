import { describe, expect, it } from 'vitest';
import {
  applyCareerInput as apply,
  chooseCareerAction,
  compareCareerFactorReversals,
  compareCareers,
  createCareerPrototype as create,
  summarizeCareer,
  viewCareer,
} from './careerBranch';
import comparison from '../../docs/prototypes/career-branch-comparison.json';
import factors from '../../docs/prototypes/career-branch-factor-comparison.json';

describe('RI-201 キャリアの分岐', () => {
  it('階級・レベルとキャリアを分け、選択は最初の期の前だけ開く', () => {
    const first = create('RI-201', 'short');
    expect(create('RI-201', 'short')).toEqual(first);
    expect(create('other', 'long').scenario).toBe('long');
    const before = structuredClone(first);
    const blank = viewCareer(first);
    for (let i = 0; i < 10; i++) expect(viewCareer(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      choiceOpen: true,
      canChange: false,
      paths: ['specialist', 'coach'],
      deadline: 8,
      candidate: { id: 'aoi', rank: 'senior', level: 1, career: null },
    });
    expect(blank.juniors.map((member) => member.output)).toEqual([1, 1]);
    const chosen = apply(first, { type: 'choose', career: 'coach' });
    expect(viewCareer(chosen)).toMatchObject({
      choiceOpen: false,
      canChange: false,
      candidate: { rank: 'senior', level: 1, career: 'coach' },
    });
  });

  it('未選択の進行、チームリード、二度目の選択、期末は無消費で拒否する', () => {
    const initial = create('RI-201', 'short');
    expect(apply(initial, { type: 'period' })).toBe(initial);
    expect(apply(initial, { type: 'choose', career: 'lead' })).toBe(initial);
    const chosen = apply(initial, { type: 'choose', career: 'specialist' });
    expect(apply(chosen, { type: 'choose', career: 'coach' })).toBe(chosen);
    const ended = apply(chosen, { type: 'period' });
    expect(ended.period).toBe(ended.horizon);
    expect(apply(ended, { type: 'period' })).toBe(ended);
    expect(apply(ended, { type: 'choose', career: 'coach' })).toBe(ended);
  });

  it('育成は進めた期の後に乗り、同じ人物の階級とレベルは変わらない', () => {
    let state = apply(create('RI-201', 'long'), { type: 'choose', career: 'coach' });
    state = apply(state, { type: 'period' });
    expect(summarizeCareer(state)).toMatchObject({
      value: 5,
      growth: 4,
      fatigue: 2,
      rank: 'senior',
      level: 1,
      juniors: [
        { id: 'jun', review: 4, rank: 'junior', level: 1 },
        { id: 'mei', review: 4, rank: 'junior', level: 1 },
      ],
    });
    state = apply(state, { type: 'period' });
    expect(state.value).toBe(20);
    expect(state.growth).toBe(8);
    expect(
      state.members
        .filter((member) => member.role === 'junior')
        .every((member) => member.review === 6),
    ).toBe(true);
  });

  it('短い納期では専門家、育成の猶予では育成役の差引が上回る', () => {
    const rows = compareCareers(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.score;
    expect([score('short', 'specialist'), score('short', 'coach')]).toEqual([10, -1]);
    expect([score('long', 'specialist'), score('long', 'coach')]).toEqual([30, 35]);
    const coach = rows.find((row) => row.scenario === 'long' && row.strategy === 'coach')!.result;
    const specialist = rows.find(
      (row) => row.scenario === 'long' && row.strategy === 'specialist',
    )!.result;
    expect(coach.growth).toBe(8);
    expect(specialist.growth).toBe(0);
    expect(coach.fatigue).toBe(6);
    expect(specialist.fatigue).toBe(3);
    expect(coach.rank).toBe('senior');
    expect(coach.level).toBe(1);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareCareers(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseCareerAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeCareer(live)).toEqual(row.result);
    }
  });
});

describe('RI-201 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareCareerFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-201',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
      leadSeparate: true,
    });
    const nets = (
      rows: {
        parameter: string;
        preference: string;
        specialist: { result: { score: number } };
        coach: { result: { score: number } };
      }[],
    ) =>
      rows.map((item) => [
        item.parameter,
        item.specialist.result.score,
        item.coach.result.score,
        item.preference,
      ]);
    expect(nets(data.sweeps.output.short)).toEqual([
      ['2', -2, -1, 'coach'],
      ['3', -1, -1, 'tie'],
      ['4', 0, -1, 'specialist'],
      ['6', 8, -1, 'specialist'],
      ['8', 10, -1, 'specialist'],
      ['9', 11, -1, 'specialist'],
      ['10', 12, -1, 'specialist'],
    ]);
    expect(nets(data.sweeps.output.long)).toEqual([
      ['2', 12, 35, 'coach'],
      ['3', 15, 35, 'coach'],
      ['4', 18, 35, 'coach'],
      ['6', 24, 35, 'coach'],
      ['8', 30, 35, 'coach'],
      ['9', 33, 35, 'coach'],
      ['10', 36, 35, 'specialist'],
    ]);
    expect(nets(data.sweeps.growth.short)).toEqual([
      ['0', 10, -1, 'specialist'],
      ['1', 10, -1, 'specialist'],
      ['2', 10, -1, 'specialist'],
      ['3', 10, -1, 'specialist'],
      ['4', 10, -1, 'specialist'],
    ]);
    expect(nets(data.sweeps.growth.long)).toEqual([
      ['0', 30, 15, 'specialist'],
      ['1', 30, 25, 'specialist'],
      ['2', 30, 35, 'coach'],
      ['3', 30, 35, 'coach'],
      ['4', 30, 35, 'coach'],
    ]);
    expect(nets(data.sweeps.penalty.short)).toEqual([
      ['-6', 10, 11, 'coach'],
      ['-5', 10, 10, 'tie'],
      ['-4', 10, 9, 'specialist'],
      ['0', 10, 5, 'specialist'],
      ['6', 10, -1, 'specialist'],
      ['12', 10, -7, 'specialist'],
    ]);
    expect(Object.keys(data.sweeps.penalty)).toEqual(['short']);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.scenario,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['output', 'short', '2', 'coach', '3', 'tie'],
      ['output', 'short', '3', 'tie', '4', 'specialist'],
      ['output', 'long', '9', 'coach', '10', 'specialist'],
      ['growth', 'long', '1', 'specialist', '2', 'coach'],
      ['penalty', 'short', '-6', 'coach', '-5', 'tie'],
      ['penalty', 'short', '-5', 'tie', '-4', 'specialist'],
    ]);
    expect(data.reversals.some((item) => item.axis === 'growth' && item.scenario === 'short')).toBe(
      false,
    );
  });

  it('基準行は初回と一致し、チームリードは既存のどちらを上回るかを分けて残す', () => {
    const data = compareCareerFactorReversals();
    const first = compareCareers(comparison.seed);
    const baselines = [
      data.sweeps.output.short.find((item) => item.parameter === '8'),
      data.sweeps.output.long.find((item) => item.parameter === '8'),
      data.sweeps.growth.short.find((item) => item.parameter === '2'),
      data.sweeps.growth.long.find((item) => item.parameter === '2'),
      data.sweeps.penalty.short.find((item) => item.parameter === '6'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(point.sameAsFirstComparison).toBe(true);
      for (const strategy of ['specialist', 'coach'] as const) {
        const row = first.find(
          (item) => item.scenario === point.scenario && item.strategy === strategy,
        );
        if (!row) throw new Error('first');
        expect(point[strategy].inputs).toEqual(row.inputs);
        expect(point[strategy].result).toEqual(row.result);
      }
    }
    expect(first.map((row) => `${row.scenario}:${row.strategy}`)).toEqual([
      'short:specialist',
      'short:coach',
      'long:specialist',
      'long:coach',
    ]);
    expect(comparison.results).toEqual(first);
    for (const item of [...data.sweeps.output.short, ...data.sweeps.output.long]) {
      expect(item.rules).toMatchObject({
        coachOutput: 3,
        growth: 2,
        juniorOutput: 1,
        skilledOutput: 6,
      });
      expect(item.rules.specialistOutput).toBe(Number(item.parameter));
      expect(item.rules.penalty).toBe(item.scenario === 'short' ? 6 : null);
    }
    for (const item of [...data.sweeps.growth.short, ...data.sweeps.growth.long]) {
      expect(item.rules.specialistOutput).toBe(8);
      expect(item.rules.growth).toBe(Number(item.parameter));
    }
    for (const item of data.sweeps.penalty.short) {
      expect(item.rules).toMatchObject({ specialistOutput: 8, growth: 2 });
      expect(item.rules.penalty).toBe(Number(item.parameter));
      expect(item.specialist.result.penalties).toBe(0);
      expect(item.coach.result.penalties).toBe(Number(item.parameter));
    }
    const narrow = data.sweeps.growth.long.find((item) => item.parameter === '1');
    const wide = data.sweeps.growth.long.find((item) => item.parameter === '4');
    expect(narrow?.coach.result).toMatchObject({ score: 25, growth: 6 });
    expect(narrow?.coach.result.juniors.every((member) => member.review === 5)).toBe(true);
    expect(wide?.coach.result).toMatchObject({ score: 35, growth: 8 });
    expect(wide?.coach.result.juniors.every((member) => member.review === 6)).toBe(true);
    expect(data.sweeps.growth.short.map((item) => item.coach.result.score)).toEqual([
      -1, -1, -1, -1, -1,
    ]);
    expect(data.lead.rule).toEqual({
      output: 3,
      fatigue: 1,
      support: 2,
      raisesReview: false,
      rankUnchanged: true,
      levelUnchanged: true,
    });
    expect(data.lead.rows.map((row) => [row.scenario, row.scores, row.above])).toEqual([
      ['short', { lead: 9, specialist: 10, coach: -1 }, ['coach']],
      ['long', { lead: 27, specialist: 30, coach: 35 }, []],
    ]);
    expect(data.lead.rows[0]?.beats).toEqual({ specialist: false, coach: true });
    expect(data.lead.rows[1]?.beats).toEqual({ specialist: false, coach: false });
    expect(viewCareer(create('RI-201', 'short')).paths).toEqual(['specialist', 'coach']);
    expect(viewCareer(create('RI-201', 'short'), { allowLead: true }).paths).toEqual([
      'specialist',
      'coach',
      'lead',
    ]);
  });

  it('要因と比較リードの入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareCareerFactorReversals();
    const points = [
      ...data.sweeps.output.short,
      ...data.sweeps.output.long,
      ...data.sweeps.growth.short,
      ...data.sweeps.growth.long,
      ...data.sweeps.penalty.short,
    ];
    for (const item of points) {
      const rules = { specialistOutput: item.rules.specialistOutput, growth: item.rules.growth };
      for (const strategy of ['specialist', 'coach'] as const) {
        let state = create(data.conditions.seed, item.scenario);
        if (state.deadline !== null) state.penalty = item.rules.penalty ?? 0;
        const snapshot = structuredClone(state);
        const run = item[strategy];
        for (const input of run.inputs) {
          const previous = state;
          const before = structuredClone(state);
          expect(chooseCareerAction(state, strategy)).toEqual(input);
          state = apply(state, input, rules);
          const restored = apply(JSON.parse(JSON.stringify(before)), input, rules);
          expect(previous).toEqual(before);
          expect(restored).toEqual(state);
        }
        expect(snapshot.period).toBe(0);
        expect(summarizeCareer(state)).toEqual(run.result);
        expect(state.inputs).toEqual(run.inputs);
        expect(state.value - state.penalties).toBe(run.result.score);
        expect(apply(state, { type: 'period' }, rules)).toBe(state);
      }
    }
    for (const row of data.lead.rows) {
      const opened = create(data.conditions.seed, row.scenario);
      expect(apply(opened, { type: 'choose', career: 'lead' })).toBe(opened);
      let state = opened;
      for (const input of row.inputs) {
        const before = structuredClone(state);
        expect(chooseCareerAction(state, 'lead')).toEqual(input);
        state = apply(state, input, { allowLead: true });
        expect(apply(JSON.parse(JSON.stringify(before)), input, { allowLead: true })).toEqual(
          state,
        );
      }
      expect(summarizeCareer(state)).toEqual(row.result);
      expect(row.result.rank).toBe('senior');
      expect(row.result.level).toBe(1);
      expect(row.result.juniors.every((member) => member.review === 2)).toBe(true);
      expect(apply(state, { type: 'period' }, { allowLead: true })).toBe(state);
    }
  });
});
