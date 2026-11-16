import { describe, expect, it } from 'vitest';
import { rosterOf } from './customerSegments';
import { PRODUCT_CAPACITY } from './productGrowth';
import {
  applyCustomerInterview as apply,
  chooseInterviewAction,
  compareCustomerInterviewFactors,
  compareCustomerInterviews,
  createCustomerInterview as create,
  summarizeCustomerInterview,
  viewCustomerInterview,
  type InterviewBoard,
  type InterviewFactorAxis,
  type InterviewFeature,
  type InterviewRules,
  type InterviewStrategy,
} from './customerInterview';
import comparison from '../../docs/prototypes/customer-interview-comparison.json';
import factors from '../../docs/prototypes/customer-interview-factor-comparison.json';

describe('RI-231 顧客への聞き取り', () => {
  it('聞き取り前は需要が不明で、聞き取り後も未確認の候補が残る', () => {
    const first = create('RI-231', 'uncertain');
    expect(create('RI-231', 'uncertain')).toEqual(first);
    expect(first.capacity).toBe(PRODUCT_CAPACITY);
    expect(first.speaker).toEqual(rosterOf('keeper'));
    const before = structuredClone(first);
    const blank = viewCustomerInterview(first);
    for (let i = 0; i < 8; i++) expect(viewCustomerInterview(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      capacity: 4,
      deadline: 3,
      rumor: 'api',
      speaker: { pioneers: 1, keepers: 3 },
      asked: false,
      likely: null,
      unconfirmed: null,
      unknowns: ['needed-feature'],
      valueIfRight: 12,
      latePenalty: 10,
    });
    expect(blank).not.toHaveProperty('needed');
    expect(blank).not.toHaveProperty('clueLikely');
    const asked = apply(first, { type: 'ask' });
    expect(viewCustomerInterview(asked)).toMatchObject({
      asked: true,
      likely: 'screen',
      unconfirmed: 'billing',
      unknowns: ['unconfirmed-feature'],
    });
    expect(viewCustomerInterview(asked)).not.toHaveProperty('needed');
    const misled = apply(create('RI-231', 'mislead'), { type: 'ask' });
    expect(misled.likely).toBe('screen');
    expect(misled.needed).toBe('billing');
    expect(misled.likely).not.toBe(misled.needed);
    expect(asked.listenCost).toBe(4);
    expect(apply(asked, { type: 'ask' })).toBe(asked);
  });

  it('聞き取りは期間を使い、正しい機能でも完成の報酬は一度だけ', () => {
    const urgent = create('RI-231', 'urgent');
    expect(urgent.speaker).toEqual(rosterOf('pioneer'));
    const rushed = apply(urgent, { type: 'build', feature: 'api' });
    expect(rushed.value).toBe(12);
    expect(rushed.late).toBe(0);
    expect(apply(rushed, { type: 'build', feature: 'api' }).value).toBe(12);
    const listened = apply(urgent, { type: 'ask' });
    const late = apply(listened, { type: 'build', feature: 'api' });
    expect(late.value).toBe(12);
    expect(late.late).toBe(10);
    expect(apply(listened, { type: 'build', feature: 'billing' }).value).toBe(0);
    expect(apply(urgent, { type: 'view' })).toBe(urgent);
  });

  it('短納期は即着手、要望が不確実な盤面は聞き取りが上回る', () => {
    const rows = compareCustomerInterviews(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('urgent', 'rush'), score('urgent', 'ask'), score('urgent', 'askMiss')]).toEqual([
      12, 2, 0,
    ]);
    expect([
      score('uncertain', 'ask'),
      score('uncertain', 'rush'),
      score('uncertain', 'askMiss'),
    ]).toEqual([12, 0, 0]);
    expect([
      score('mislead', 'askMiss'),
      score('mislead', 'ask'),
      score('mislead', 'rush'),
    ]).toEqual([12, 0, 0]);
    const asked = rows.find((row) => row.board === 'uncertain' && row.strategy === 'askMiss')!;
    expect(asked.result.delivered).toBe(false);
    expect(asked.result.listenCost).toBe(4);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareCustomerInterviews(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseInterviewAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeCustomerInterview(live)).toEqual(row.result);
    }
  });
});

describe('RI-231 要因の反転', () => {
  const axes = [
    'deadline',
    'askTicks',
    'candidates',
  ] as const satisfies readonly InterviewFactorAxis[];
  const strategies = ['rush', 'ask', 'askMiss'] as const satisfies readonly InterviewStrategy[];
  const ruleFields = ['deadline', 'askTicks', 'needed', 'clueLikely', 'clueOther'] as const;
  const candidateFields = ['needed', 'clueLikely', 'clueOther'] as const;

  function finishTick(periods: number, horizon: number) {
    return periods < horizon ? periods : null;
  }

  function deliveryScore(
    feature: InterviewFeature,
    needed: InterviewFeature,
    tick: number | null,
    deadline: number,
    value: number,
    latePenalty: number,
  ) {
    if (tick === null || feature !== needed) return 0;
    return value - (tick >= deadline ? latePenalty : 0);
  }

  it('上書きは基準の盤面を書き換えず、期間0でも真の需要は返さない', () => {
    const baseline = create('RI-231', 'urgent');
    const moved = create('RI-231', 'urgent', { deadline: 0, askTicks: 0, needed: 'billing' });
    expect(create('RI-231', 'urgent')).toEqual(baseline);
    expect(baseline).not.toHaveProperty('askTicks');
    expect(baseline.deadline).toBe(1);
    expect(baseline.needed).toBe('api');
    expect(moved).toMatchObject({ deadline: 0, askTicks: 0, needed: 'billing', rumor: 'api' });
    const shown = viewCustomerInterview(moved);
    expect(shown.deadline).toBe(0);
    expect(shown).not.toHaveProperty('needed');
    expect(shown).not.toHaveProperty('askTicks');
    expect(shown).not.toHaveProperty('clueLikely');
    const hidden = apply(create('RI-231', 'mislead', { askTicks: 0 }), { type: 'ask' });
    expect(hidden.tick).toBe(0);
    expect(hidden.listenCost).toBe(0);
    expect(hidden.likely).toBe('screen');
    expect(hidden.needed).toBe('billing');
    expect(viewCustomerInterview(hidden)).not.toHaveProperty('needed');
    const spent = apply(create('RI-231', 'urgent', { askTicks: 2 }), { type: 'ask' });
    expect(spent.tick).toBe(2);
    expect(spent.listenCost).toBe(8);
    expect(apply(spent, { type: 'ask' })).toBe(spent);
    expect(
      create('RI-231', 'urgent', {
        deadline: 1,
        askTicks: 1,
        needed: 'api',
        clueLikely: 'api',
        clueOther: 'billing',
      }),
    ).toEqual(baseline);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareCustomerInterviewFactors();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-231',
      horizon: 3,
      capacity: 4,
      need: 4,
      value: 12,
      latePenalty: 10,
      rumor: 'api',
      features: ['api', 'screen', 'billing'],
      score: 'value - late',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.baselines).toEqual({
      urgent: { deadline: 1, askTicks: 1, needed: 'api', clueLikely: 'api', clueOther: 'billing' },
      uncertain: {
        deadline: 3,
        askTicks: 1,
        needed: 'screen',
        clueLikely: 'screen',
        clueOther: 'billing',
      },
      mislead: {
        deadline: 3,
        askTicks: 1,
        needed: 'billing',
        clueLikely: 'screen',
        clueOther: 'billing',
      },
    });

    for (const axis of ['deadline', 'askTicks'] as const) {
      for (const series of data.sweeps[axis]) {
        const baseline = data.conditions.baselines[series.anchor];
        expect(series.axis).toBe(axis);
        expect(series.rows.length).toBeGreaterThan(1);
        for (const row of series.rows) {
          expect(row.axis).toBe(axis);
          expect(row.rules).toMatchObject(series.held);
          const changed = ruleFields.filter((field) => row.rules[field] !== baseline[field]);
          if (row.parameter === String(baseline[axis])) expect(changed).toEqual([]);
          else expect(changed).toEqual([axis]);
        }
      }
    }

    for (const series of data.sweeps.candidates) {
      expect(series.rows.map((row) => row.parameter)).toEqual([
        'both-correct',
        'likely-wrong',
        'likely-correct',
        'other-correct',
      ]);
      for (let index = 1; index < series.rows.length; index += 1) {
        const before = series.rows[index - 1];
        const after = series.rows[index];
        expect(before).toBeDefined();
        expect(after).toBeDefined();
        const changed = candidateFields.filter(
          (field) => before!.rules[field] !== after!.rules[field],
        );
        expect(changed).toHaveLength(1);
        expect(changed).not.toContain('clueOther');
        expect(after!.rules.deadline).toBe(before!.rules.deadline);
        expect(after!.rules.askTicks).toBe(before!.rules.askTicks);
      }
    }

    for (const axis of axes) {
      for (const series of data.sweeps[axis]) {
        for (const row of series.rows) {
          expect(row.margin).toBe(row.scores.ask - row.scores.rush);
          expect(row.preference).toBe(
            row.scores.ask > row.scores.rush
              ? 'ask'
              : row.scores.rush > row.scores.ask
                ? 'rush'
                : 'tie',
          );
          expect(row.initial.rumor).toBe('api');
          expect(row.initial.board).toBe(row.board);
          expect(row.initial.speaker).toEqual(
            rosterOf(row.board === 'urgent' ? 'pioneer' : 'keeper'),
          );
          if (row.rules.askTicks === 1) expect(row.initial).not.toHaveProperty('askTicks');
          else expect(row.initial.askTicks).toBe(row.rules.askTicks);
          const shown = viewCustomerInterview(row.initial);
          expect(shown).not.toHaveProperty('needed');
          expect(shown).not.toHaveProperty('askTicks');
          expect(shown.deadline).toBe(row.rules.deadline);
          expect(shown.valueIfRight).toBe(data.conditions.value);
          expect(shown.latePenalty).toBe(data.conditions.latePenalty);
          const score = (feature: InterviewFeature, periods: number) =>
            deliveryScore(
              feature,
              row.rules.needed,
              finishTick(periods, row.initial.horizon),
              row.rules.deadline,
              shown.valueIfRight,
              shown.latePenalty,
            );
          expect(row.scores.rush).toBe(score(row.initial.rumor, 0));
          expect(row.scores.ask).toBe(score(row.rules.clueLikely, row.rules.askTicks));
          expect(row.scores.askMiss).toBe(score(row.rules.clueOther, row.rules.askTicks));
          for (const strategy of strategies) {
            expect(row.runs[strategy].result.score).toBe(row.scores[strategy]);
            expect(row.runs[strategy].result.score).toBe(
              row.runs[strategy].result.value - row.runs[strategy].result.late,
            );
            expect(row.runs[strategy].result.lost).toBe(false);
            expect(row.runs[strategy].result.delivered).toBe(row.runs[strategy].result.value > 0);
            expect(row.runs[strategy].result.listenCost).toBe(
              strategy === 'rush' ? 0 : row.initial.capacity * row.rules.askTicks,
            );
          }
        }
      }
    }

    for (const board of ['urgent', 'uncertain', 'mislead'] as const) {
      for (const strategy of strategies) {
        const first = comparison.results.find(
          (row) => row.board === board && row.strategy === strategy,
        );
        expect(first).toBeDefined();
        const baseline = data.conditions.baselines[board];
        const matched = axes.flatMap((axis) =>
          data.sweeps[axis].flatMap((series) =>
            series.rows.filter((row) =>
              ruleFields.every((field) => row.rules[field] === baseline[field]),
            ),
          ),
        );
        expect(matched.length).toBeGreaterThan(0);
        for (const row of matched) {
          expect(row.initial).toEqual(first!.initial);
          expect(row.runs[strategy].inputs).toEqual(first!.inputs);
          expect(row.runs[strategy].result).toEqual(first!.result);
        }
      }
    }
  });

  it('即着手と聞き取りの優劣が反転する位置は期限、確認期間、候補の組み合わせに分かれる', () => {
    const data = compareCustomerInterviewFactors();
    const line = (axis: InterviewFactorAxis, anchor: InterviewBoard) => {
      const series = data.sweeps[axis].find((item) => item.anchor === anchor);
      expect(series).toBeDefined();
      return series!.rows.map((row) => [
        row.parameter,
        row.scores.rush,
        row.scores.ask,
        row.scores.askMiss,
        row.preference,
        row.leaders,
      ]);
    };
    expect(line('deadline', 'urgent')).toEqual([
      ['0', 2, 2, 0, 'tie', ['rush', 'ask']],
      ['1', 12, 2, 0, 'rush', ['rush']],
      ['2', 12, 12, 0, 'tie', ['rush', 'ask']],
      ['3', 12, 12, 0, 'tie', ['rush', 'ask']],
    ]);
    expect(line('deadline', 'uncertain')).toEqual([
      ['0', 0, 2, 0, 'ask', ['ask']],
      ['1', 0, 2, 0, 'ask', ['ask']],
      ['2', 0, 12, 0, 'ask', ['ask']],
      ['3', 0, 12, 0, 'ask', ['ask']],
    ]);
    expect(line('deadline', 'mislead')).toEqual([
      ['0', 0, 0, 2, 'tie', ['askMiss']],
      ['1', 0, 0, 2, 'tie', ['askMiss']],
      ['2', 0, 0, 12, 'tie', ['askMiss']],
      ['3', 0, 0, 12, 'tie', ['askMiss']],
    ]);
    expect(line('askTicks', 'urgent')).toEqual([
      ['0', 12, 12, 0, 'tie', ['rush', 'ask']],
      ['1', 12, 2, 0, 'rush', ['rush']],
      ['2', 12, 2, 0, 'rush', ['rush']],
      ['3', 12, 0, 0, 'rush', ['rush']],
    ]);
    expect(line('askTicks', 'uncertain')).toEqual([
      ['0', 0, 12, 0, 'ask', ['ask']],
      ['1', 0, 12, 0, 'ask', ['ask']],
      ['2', 0, 12, 0, 'ask', ['ask']],
      ['3', 0, 0, 0, 'tie', ['rush', 'ask', 'askMiss']],
    ]);
    expect(line('askTicks', 'mislead')).toEqual([
      ['0', 0, 0, 12, 'tie', ['askMiss']],
      ['1', 0, 0, 12, 'tie', ['askMiss']],
      ['2', 0, 0, 12, 'tie', ['askMiss']],
      ['3', 0, 0, 0, 'tie', ['rush', 'ask', 'askMiss']],
    ]);
    expect(line('candidates', 'urgent')).toEqual([
      ['both-correct', 12, 2, 0, 'rush', ['rush']],
      ['likely-wrong', 12, 0, 0, 'rush', ['rush']],
      ['likely-correct', 0, 2, 0, 'ask', ['ask']],
      ['other-correct', 0, 0, 2, 'tie', ['askMiss']],
    ]);
    expect(line('candidates', 'uncertain')).toEqual([
      ['both-correct', 12, 12, 0, 'tie', ['rush', 'ask']],
      ['likely-wrong', 12, 0, 0, 'rush', ['rush']],
      ['likely-correct', 0, 12, 0, 'ask', ['ask']],
      ['other-correct', 0, 0, 12, 'tie', ['askMiss']],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.held,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      [
        'deadline',
        { askTicks: 1, needed: 'api', clueLikely: 'api', clueOther: 'billing' },
        '0',
        'tie',
        '1',
        'rush',
      ],
      [
        'deadline',
        { askTicks: 1, needed: 'api', clueLikely: 'api', clueOther: 'billing' },
        '1',
        'rush',
        '2',
        'tie',
      ],
      [
        'askTicks',
        { deadline: 1, needed: 'api', clueLikely: 'api', clueOther: 'billing' },
        '0',
        'tie',
        '1',
        'rush',
      ],
      [
        'askTicks',
        { deadline: 3, needed: 'screen', clueLikely: 'screen', clueOther: 'billing' },
        '2',
        'ask',
        '3',
        'tie',
      ],
      [
        'candidates',
        { deadline: 1, askTicks: 1, clueOther: 'billing' },
        'likely-wrong',
        'rush',
        'likely-correct',
        'ask',
      ],
      [
        'candidates',
        { deadline: 1, askTicks: 1, clueOther: 'billing' },
        'likely-correct',
        'ask',
        'other-correct',
        'tie',
      ],
      [
        'candidates',
        { deadline: 3, askTicks: 1, clueOther: 'billing' },
        'both-correct',
        'tie',
        'likely-wrong',
        'rush',
      ],
      [
        'candidates',
        { deadline: 3, askTicks: 1, clueOther: 'billing' },
        'likely-wrong',
        'rush',
        'likely-correct',
        'ask',
      ],
      [
        'candidates',
        { deadline: 3, askTicks: 1, clueOther: 'billing' },
        'likely-correct',
        'ask',
        'other-correct',
        'tie',
      ],
    ]);
    expect(data.sweeps.deadline.find((series) => series.anchor === 'uncertain')!.reversals).toEqual(
      [],
    );
    expect(data.sweeps.deadline.find((series) => series.anchor === 'mislead')!.reversals).toEqual(
      [],
    );
    expect(data.sweeps.askTicks.find((series) => series.anchor === 'mislead')!.reversals).toEqual(
      [],
    );
    const otherCorrect = data.sweeps.candidates
      .find((series) => series.anchor === 'uncertain')!
      .rows.find((row) => row.parameter === 'other-correct')!;
    expect(otherCorrect.preference).toBe('tie');
    expect(otherCorrect.leaders).toEqual(['askMiss']);
  });

  it('未確認候補だけを変えても即着手と聞き取りの差引は動かない', () => {
    const play = (rules?: Partial<InterviewRules>) => {
      const scores = { rush: 0, ask: 0, askMiss: 0 };
      for (const strategy of strategies) {
        let state = create('RI-231', 'mislead', rules);
        while (state.tick < state.horizon)
          state = apply(state, chooseInterviewAction(state, strategy));
        scores[strategy] = summarizeCustomerInterview(state).score;
      }
      return scores;
    };
    expect(play()).toEqual({ rush: 0, ask: 0, askMiss: 12 });
    expect(play({ clueOther: 'api' })).toEqual({ rush: 0, ask: 0, askMiss: 0 });
  });

  it('入力列は戦略に従い、保存再開と再生が一致する', () => {
    const data = compareCustomerInterviewFactors();
    for (const axis of axes) {
      for (const series of data.sweeps[axis]) {
        for (const row of series.rows) {
          expect(create('RI-231', row.board, row.rules)).toEqual(row.initial);
          const builds = Math.max(0, row.initial.horizon - row.rules.askTicks);
          expect(row.runs.rush.inputs).toEqual([
            { type: 'build', feature: 'api' },
            { type: 'build', feature: 'api' },
            { type: 'build', feature: 'api' },
          ]);
          expect(row.runs.ask.inputs).toEqual([
            { type: 'ask' },
            ...Array.from({ length: builds }, () => ({
              type: 'build' as const,
              feature: row.rules.clueLikely,
            })),
          ]);
          expect(row.runs.askMiss.inputs).toEqual([
            { type: 'ask' },
            ...Array.from({ length: builds }, () => ({
              type: 'build' as const,
              feature: row.rules.clueOther,
            })),
          ]);
          for (const strategy of strategies) {
            let live = row.initial;
            let saved = structuredClone(live);
            for (const input of row.runs[strategy].inputs) {
              const previous = live;
              const before = structuredClone(live);
              expect(chooseInterviewAction(previous, strategy)).toEqual(input);
              live = apply(live, input);
              saved = apply(JSON.parse(JSON.stringify(saved)), input);
              expect(previous).toEqual(before);
              expect(saved).toEqual(live);
            }
            expect(summarizeCustomerInterview(live)).toEqual(row.runs[strategy].result);
            expect(live.tick).toBeGreaterThanOrEqual(row.initial.horizon);
          }
        }
      }
    }
  });
});
