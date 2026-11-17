import { describe, expect, it } from 'vitest';
import { RECRUIT_ARCHETYPES } from '../data/members';
import { foldTraitModifiers } from '../data/traits';
import {
  applyRecruitInterview as apply,
  createRecruitInterview as create,
  viewRecruitInterview as view,
  summarizeRecruitInterview as summarize,
  chooseRecruitInterviewAction as choose,
  compareRecruitInterviews,
  runRecruitInterview,
  INTERVIEW_TOPICS,
  type InterviewMode,
} from './recruitInterview';
import comparison from '../../docs/prototypes/recruit-interview-comparison.json';

const modes: InterviewMode[] = ['precision', 'additional'];
describe('RI-210 面接の確認項目', () => {
  it('既存3アーキタイプの能力・traitをコピーし、両案と担当需要で同じ観測を使う', () => {
    const catalog = structuredClone(RECRUIT_ARCHETYPES);
    const initial = create('RI-210-0', 'additional', 'implementation');
    for (const candidate of initial.candidates) {
      const archetype = RECRUIT_ARCHETYPES.find((item) => item.id === candidate.id)!;
      expect(candidate.stats).toEqual(archetype.stats);
      expect(candidate.traits).toEqual(archetype.traits);
      expect(candidate.anchors.learning).toBe(40 * foldTraitModifiers(archetype.traits).xpMul);
      expect(candidate.stats).not.toBe(archetype.stats);
      expect(candidate.traits).not.toBe(archetype.traits);
    }
    for (const mode of modes)
      for (const demand of INTERVIEW_TOPICS) {
        const state = create(initial.seed, mode, demand);
        expect(state.candidates).toEqual(initial.candidates);
        expect(state).toMatchObject({ budget: 12, ticks: 0, horizon: 3, asked: [], hired: null });
      }
    expect(RECRUIT_ARCHETYPES).toEqual(catalog);
    expect(create('RI-210-1', 'additional', 'implementation').candidates).not.toEqual(
      initial.candidates,
    );
  });

  it('追加情報案は全能力・traitを保持し、精度案だけ粗くする。未確認観測を漏らさない', () => {
    for (const mode of modes) {
      const state = create('RI-210-0', mode, 'review');
      const shown = view(state);
      expect(shown).not.toHaveProperty('seed');
      const hidden = structuredClone(state);
      for (const candidate of hidden.candidates) {
        for (const topic of INTERVIEW_TOPICS) candidate.sample[topic] += 1;
      }
      expect(view(hidden)).toEqual(shown);
      expect(choose(hidden, 'none')).toEqual(choose(state, 'none'));
      for (const topic of INTERVIEW_TOPICS) {
        const after = apply(state, { type: 'ask', topic });
        const visible = view(after);
        for (let index = 0; index < state.candidates.length; index += 1) {
          const before = shown.candidates[index]!;
          const candidate = state.candidates[index]!;
          const refined = visible.candidates[index]!;
          expect(refined.evidence[topic]).toEqual({
            low: candidate.sample[topic],
            high: candidate.sample[topic],
          });
          for (const unasked of INTERVIEW_TOPICS.filter((item) => item !== topic))
            expect(refined.evidence[unasked]).toEqual(before.evidence[unasked]);
          if (mode === 'additional') {
            expect(before.stats).toEqual(candidate.stats);
            expect(refined.stats).toEqual(before.stats);
          } else {
            expect(before.stats.implementation).toHaveProperty('low');
          }
          expect(refined.traits).toEqual(candidate.traits);
        }
      }
    }
  });

  it('事前の範囲は全seedの実観測を含み、確認は選んだ1項目だけを精密にする', () => {
    for (const seed of comparison.conditions.seeds)
      for (const mode of modes) {
        const state = create(seed, mode, 'learning');
        const shown = view(state);
        for (let i = 0; i < state.candidates.length; i += 1)
          for (const topic of INTERVIEW_TOPICS) {
            expect(state.candidates[i]!.sample[topic]).toBeGreaterThanOrEqual(
              shown.candidates[i]!.evidence[topic].low,
            );
            expect(state.candidates[i]!.sample[topic]).toBeLessThanOrEqual(
              shown.candidates[i]!.evidence[topic].high,
            );
          }
      }
  });

  it('再表示・同項目再確認は無料の再抽選にならず、2回の費用・機会費用で全確認を禁じる', () => {
    const first = create('RI-210-0', 'additional', 'review');
    const before = structuredClone(first);
    for (let i = 0; i < 5; i += 1) {
      view(first);
      expect(apply(first, { type: 'view' })).toBe(first);
    }
    expect(first).toEqual(before);
    const once = apply(first, { type: 'ask', topic: 'implementation' });
    expect(once).toMatchObject({ budget: 10, ticks: 1 });
    expect(apply(once, { type: 'ask', topic: 'implementation' })).toBe(once);
    const twice = apply(once, { type: 'ask', topic: 'review' });
    expect(twice).toMatchObject({ budget: 8, ticks: 2 });
    expect(apply(twice, { type: 'ask', topic: 'learning' })).toBe(twice);
    const hired = apply(twice, { type: 'hire', id: first.candidates[0]!.id });
    expect(summarize(hired)).toMatchObject({
      fee: 4,
      opportunity: 4,
      workTicksLeft: 1,
      unasked: ['learning'],
    });
    expect(apply(hired, { type: 'ask', topic: 'learning' })).toBe(hired);
    expect(apply(hired, { type: 'hire', id: first.candidates[1]!.id })).toBe(hired);
    expect(apply(first, { type: 'hire', id: 'missing' })).toBe(first);
    expect(first).toEqual(before);
  });

  it('予算不足・予算ちょうど・無料時も制約を維持し、不正係数を拒否する', () => {
    const poor = create('budget', 'precision', 'review', { fee: 13 });
    expect(apply(poor, { type: 'ask', topic: 'review' })).toBe(poor);
    expect(choose(poor, 'two').type).toBe('hire');
    const exact = apply(create('budget', 'precision', 'review', { fee: 12 }), {
      type: 'ask',
      topic: 'review',
    });
    expect(exact.budget).toBe(0);
    expect(apply(exact, { type: 'ask', topic: 'learning' })).toBe(exact);
    let free = create('budget', 'additional', 'review', { fee: 0 });
    for (const topic of INTERVIEW_TOPICS) free = apply(free, { type: 'ask', topic });
    expect(free.asked).toHaveLength(2);
    expect(free.ticks).toBe(2);
    expect(summarize(free).opportunity).toBe(4);
    for (const fee of [-1, 1.5, NaN, Infinity])
      expect(() => create('bad', 'additional', 'review', { fee })).toThrow();
    expect(() => create('bad', 'additional', 'review', { spread: 41 })).toThrow();
  });

  it('追加情報案の振れ幅0では確認の情報利益がなく、費用だけを変えても課題を抽選し直さない', () => {
    for (const demand of INTERVIEW_TOPICS) {
      const base = create('RI-210-0', 'additional', demand, { spread: 0 });
      const immediate = runRecruitInterview(base, 'none').result;
      for (const topic of INTERVIEW_TOPICS) {
        const result = runRecruitInterview(base, topic).result;
        expect(result.hired).toBe(immediate.hired);
        expect(result.gross).toBe(immediate.gross);
        expect(result.net).toBe(immediate.net - 4);
      }
      const standard = create('RI-210-0', 'additional', demand);
      const costly = create('RI-210-0', 'additional', demand, { fee: 6 });
      expect(costly.candidates).toEqual(standard.candidates);
      const one = runRecruitInterview(standard, demand).result;
      const other = runRecruitInterview(costly, demand).result;
      expect(other.hired).toBe(one.hired);
      expect(other.net).toBeCloseTo(one.net - 4);
    }
  });

  it('需要で有力な質問が変わり、費用・不確実性で確認する価値も変わる', () => {
    const data = compareRecruitInterviews();
    for (const mode of modes) {
      const rows = data.baseline.summary.filter((row) => row.mode === mode);
      expect(rows.map((row) => row.singleQuestionLeaders)).toEqual([
        ['implementation'],
        ['review'],
        ['learning'],
      ]);
      expect(rows.map((row) => row.leaders)).toEqual([['none'], ['review'], ['none']]);
      for (const sensitivity of data.sensitivity.filter(
        (row) => row.rules.fee === 6 || row.rules.spread < 18,
      ))
        expect(
          sensitivity.summary.filter((row) => row.mode === mode).map((row) => row.leaders),
        ).toEqual([['none'], ['none'], ['none']]);
    }
  });

  it('全比較と感度を再計算し、各入力でJSON保存再開・再生・非破壊性が一致する', () => {
    expect(compareRecruitInterviews()).toEqual(comparison);
    for (const run of comparison.baseline.runs) {
      const initial = comparison.baseline.initial[run.initialIndex]!;
      let live = create(
        initial.seed,
        run.mode as InterviewMode,
        run.demand as (typeof INTERVIEW_TOPICS)[number],
      );
      expect(live).toEqual({ ...initial, mode: run.mode, demand: run.demand });
      let resumed = structuredClone(live);
      for (const input of run.inputs) {
        const action = input as Parameters<typeof apply>[1];
        expect(choose(live, run.strategy as Parameters<typeof choose>[1])).toEqual(action);
        const before = structuredClone(live);
        const previous = live;
        live = apply(live, action);
        resumed = apply(JSON.parse(JSON.stringify(resumed)), action);
        expect(previous).toEqual(before);
        expect(resumed).toEqual(live);
      }
      expect(summarize(live)).toEqual(run.result);
      expect(live.hired).not.toBeNull();
      expect(summarize(live).net).toBe(
        summarize(live).gross - summarize(live).fee - summarize(live).opportunity,
      );
    }
  });
});
