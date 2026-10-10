import { describe, expect, it } from 'vitest';
import {
  applyCareerInput as apply,
  chooseCareerAction,
  compareCareers,
  createCareerPrototype as create,
  summarizeCareer,
  viewCareer,
} from './careerBranch';
import comparison from '../../docs/prototypes/career-branch-comparison.json';

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
