import { describe, expect, it } from 'vitest';
import {
  applyTraitInput as apply,
  baselineTraitRules,
  chooseTraitAction,
  compareTraitExperience,
  compareTraitFactorReversals,
  createTraitExperiencePrototype as create,
  summarizeTraitExperience,
  traitEffect,
  viewTraitExperience,
  type TraitFactorRules,
} from './traitExperience';
import comparison from '../../docs/prototypes/trait-experience-comparison.json';
import factors from '../../docs/prototypes/trait-experience-factor-comparison.json';

describe('RI-203 経験で変わるトレイト', () => {
  it('変化に必要な分割回数と、IDごとの効果を事前に示す', () => {
    const first = create('RI-203', 'rush');
    expect(create('RI-203', 'rush')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewTraitExperience(first);
    for (let i = 0; i < 10; i++) expect(viewTraitExperience(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      personId: 'ren',
      requiredSplits: 2,
      traits: ['megaPrMaker'],
      experience: 0,
      effect: { trait: 'megaPrMaker', value: 6, load: 4 },
    });
    expect(traitEffect(['prSplitter'])).toEqual({ trait: 'prSplitter', value: 4, load: 1 });
    const seen = viewTraitExperience(first);
    seen.effects.megaPrMaker.value = 999;
    expect(traitEffect(['megaPrMaker']).value).toBe(6);
    expect(viewTraitExperience(first).effects.megaPrMaker.value).toBe(6);
  });

  it('出荷を続けても経過だけでは変わらず、分割2回で旧IDが消え新IDが一度付く', () => {
    let rushed = create('RI-203', 'rush');
    for (let i = 0; i < 3; i++) rushed = apply(rushed, { type: 'ship' });
    expect(summarizeTraitExperience(rushed)).toMatchObject({
      id: 'ren',
      traits: ['megaPrMaker'],
      experience: 0,
      transitions: 0,
      effect: { value: 6, load: 4 },
    });
    expect(apply(rushed, { type: 'ship' })).toBe(rushed);

    let trained = create('RI-203', 'congested');
    trained = apply(trained, { type: 'split' });
    expect(trained.person).toMatchObject({ traits: ['megaPrMaker'], experience: 1 });
    trained = apply(trained, { type: 'split' });
    expect(trained.person.traits).toEqual(['prSplitter']);
    expect(trained.transitions).toBe(1);
    trained = apply(trained, { type: 'ship' });
    expect(trained.value).toBe(4);
    expect(trained.load).toBe(1);
    trained = apply(trained, { type: 'split' });
    expect(trained.person.traits).toEqual(['prSplitter']);
    expect(trained.transitions).toBe(1);
  });

  it('最初から後継を持つ人物へは重複付与せず、両方持っていれば旧IDだけ外す', () => {
    let splitter = create('RI-203', 'congested', ['prSplitter']);
    splitter = apply(apply(splitter, { type: 'split' }), { type: 'split' });
    expect(splitter.person.traits).toEqual(['prSplitter']);
    expect(splitter.transitions).toBe(0);
    expect(traitEffect(splitter.person.traits).trait).toBe('prSplitter');

    let both = create('RI-203', 'rush', ['megaPrMaker', 'prSplitter']);
    both = apply(both, { type: 'split' });
    expect(both.person.traits).toEqual(['megaPrMaker', 'prSplitter']);
    both = apply(both, { type: 'split' });
    expect(both.person.traits).toEqual(['prSplitter']);
    expect(both.transitions).toBe(0);
    expect(both.person.id).toBe('ren');
  });

  it('急ぐ盤面では出荷継続、レビュー混雑では分割経験の差引が上回る', () => {
    const rows = compareTraitExperience(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('rush', 'ship'), score('rush', 'train')]).toEqual([6, 3]);
    expect([score('congested', 'ship'), score('congested', 'train')]).toEqual([-12, 8]);
    const trained = rows.find((row) => row.board === 'congested' && row.strategy === 'train')!;
    expect(trained.result).toMatchObject({
      id: 'ren',
      traits: ['prSplitter'],
      experience: 2,
      transitions: 1,
    });
    const shipped = rows.find((row) => row.board === 'rush' && row.strategy === 'ship')!.result;
    expect(shipped.traits).toEqual(['megaPrMaker']);
    expect(shipped.transitions).toBe(0);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareTraitExperience(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseTraitAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeTraitExperience(live)).toEqual(row.result);
    }
  });
});

function changedKeys(rules: TraitFactorRules): (keyof TraitFactorRules)[] {
  return (Object.keys(baselineTraitRules) as (keyof TraitFactorRules)[]).filter(
    (key) => rules[key] !== baselineTraitRules[key],
  );
}

describe('RI-203 要因の反転', () => {
  it('感度の閲覧は基準の効果を書き換えない', () => {
    const rules = { ...baselineTraitRules, requiredSplits: 1, successorValue: 8 };
    const seen = viewTraitExperience(create('RI-203', 'rush'), rules);
    expect(seen.requiredSplits).toBe(1);
    expect(seen.effects.prSplitter).toEqual({ trait: 'prSplitter', value: 8, load: 1 });
    seen.effects.megaPrMaker.value = 999;
    expect(viewTraitExperience(create('RI-203', 'rush')).effects.prSplitter.value).toBe(4);
    expect(traitEffect(['megaPrMaker']).value).toBe(6);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareTraitFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-203',
      personId: 'ren',
      startingTrait: 'megaPrMaker',
      megaValue: 6,
      megaLoad: 4,
      successorLoad: 1,
      boards: [
        { board: 'rush', horizon: 3, loadWeight: 1 },
        { board: 'congested', horizon: 6, loadWeight: 2 },
      ],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    const scores = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.boards.map((board) => [
          board.board,
          board.train.result.score,
          board.ship.result.score,
          board.preference,
        ]),
      ]);
    expect(scores('requiredSplits')).toEqual([
      [
        '1',
        [
          ['rush', 6, 6, 'tie'],
          ['congested', 10, -12, 'train'],
        ],
      ],
      [
        '2',
        [
          ['rush', 3, 6, 'ship'],
          ['congested', 8, -12, 'train'],
        ],
      ],
      [
        '3',
        [
          ['rush', 0, 6, 'ship'],
          ['congested', 6, -12, 'train'],
        ],
      ],
      [
        '4',
        [
          ['rush', 0, 6, 'ship'],
          ['congested', 4, -12, 'train'],
        ],
      ],
      [
        '5',
        [
          ['rush', 0, 6, 'ship'],
          ['congested', 2, -12, 'train'],
        ],
      ],
      [
        '6',
        [
          ['rush', 0, 6, 'ship'],
          ['congested', 0, -12, 'train'],
        ],
      ],
      [
        '7',
        [
          ['rush', 0, 6, 'ship'],
          ['congested', 0, -12, 'train'],
        ],
      ],
    ]);
    expect(scores('successorValue')).toEqual([
      [
        '-2',
        [
          ['rush', -3, 6, 'ship'],
          ['congested', -16, -12, 'ship'],
        ],
      ],
      [
        '-1',
        [
          ['rush', -2, 6, 'ship'],
          ['congested', -12, -12, 'tie'],
        ],
      ],
      [
        '0',
        [
          ['rush', -1, 6, 'ship'],
          ['congested', -8, -12, 'train'],
        ],
      ],
      [
        '1',
        [
          ['rush', 0, 6, 'ship'],
          ['congested', -4, -12, 'train'],
        ],
      ],
      [
        '2',
        [
          ['rush', 1, 6, 'ship'],
          ['congested', 0, -12, 'train'],
        ],
      ],
      [
        '3',
        [
          ['rush', 2, 6, 'ship'],
          ['congested', 4, -12, 'train'],
        ],
      ],
      [
        '4',
        [
          ['rush', 3, 6, 'ship'],
          ['congested', 8, -12, 'train'],
        ],
      ],
      [
        '5',
        [
          ['rush', 4, 6, 'ship'],
          ['congested', 12, -12, 'train'],
        ],
      ],
      [
        '6',
        [
          ['rush', 5, 6, 'ship'],
          ['congested', 16, -12, 'train'],
        ],
      ],
      [
        '7',
        [
          ['rush', 6, 6, 'tie'],
          ['congested', 20, -12, 'train'],
        ],
      ],
      [
        '8',
        [
          ['rush', 7, 6, 'train'],
          ['congested', 24, -12, 'train'],
        ],
      ],
    ]);
    expect(scores('loadWeight')).toEqual([
      [
        '0',
        [
          ['rush', 4, 18, 'ship'],
          ['congested', 16, 36, 'ship'],
        ],
      ],
      [
        '1',
        [
          ['rush', 3, 6, 'ship'],
          ['congested', 12, 12, 'tie'],
        ],
      ],
      [
        '2',
        [
          ['rush', 2, -6, 'train'],
          ['congested', 8, -12, 'train'],
        ],
      ],
      [
        '3',
        [
          ['rush', 1, -18, 'train'],
          ['congested', 4, -36, 'train'],
        ],
      ],
      [
        '4',
        [
          ['rush', 0, -30, 'train'],
          ['congested', 0, -60, 'train'],
        ],
      ],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['requiredSplits', 'rush', '1', 'tie', '2', 'ship'],
      ['successorValue', 'congested', '-2', 'ship', '-1', 'tie'],
      ['successorValue', 'congested', '-1', 'tie', '0', 'train'],
      ['successorValue', 'rush', '6', 'ship', '7', 'tie'],
      ['successorValue', 'rush', '7', 'tie', '8', 'train'],
      ['loadWeight', 'congested', '0', 'ship', '1', 'tie'],
      ['loadWeight', 'rush', '1', 'ship', '2', 'train'],
      ['loadWeight', 'congested', '1', 'tie', '2', 'train'],
    ]);
  });

  it('基準行は初回の出荷と経験と一致し、動かした規則は一つである', () => {
    const data = compareTraitFactorReversals();
    const first = compareTraitExperience(comparison.seed);
    const matchBoard = (
      point: (typeof data.sweeps.requiredSplits)[number] | undefined,
      board: 'rush' | 'congested',
    ) => {
      if (!point) throw new Error('baseline');
      const row = point.boards.find((item) => item.board === board);
      if (!row) throw new Error(board);
      for (const strategy of ['train', 'ship'] as const) {
        const expected = first.find((item) => item.board === board && item.strategy === strategy);
        if (!expected) throw new Error(strategy);
        expect(row[strategy].initial).toEqual(expected.initial);
        expect(row[strategy].inputs).toEqual(expected.inputs);
        expect(row[strategy].result).toEqual(expected.result);
      }
    };
    for (const point of [
      data.sweeps.requiredSplits.find((item) => item.parameter === '2'),
      data.sweeps.successorValue.find((item) => item.parameter === '4'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      matchBoard(point, 'rush');
      matchBoard(point, 'congested');
    }
    const weights = data.sweeps.loadWeight;
    const weightOne = weights.find((item) => item.parameter === '1');
    if (!weightOne) throw new Error('loadWeight');
    expect(changedKeys(weightOne.rules)).toEqual(['loadWeight']);
    matchBoard(weightOne, 'rush');
    matchBoard(
      weights.find((item) => item.parameter === '2'),
      'congested',
    );
    const only: Record<string, keyof TraitFactorRules> = {
      requiredSplits: 'requiredSplits',
      successorValue: 'successorValue',
      loadWeight: 'loadWeight',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps])
        expect(changedKeys(item.rules).every((name) => name === key)).toBe(true);
    }
    const atLimit = data.sweeps.requiredSplits.find((item) => item.parameter === '3');
    const pastRush = data.sweeps.requiredSplits.find((item) => item.parameter === '4');
    const atCongested = data.sweeps.requiredSplits.find((item) => item.parameter === '6');
    const pastCongested = data.sweeps.requiredSplits.find((item) => item.parameter === '7');
    expect(atLimit?.boards.find((board) => board.board === 'rush')?.train.result).toMatchObject({
      traits: ['prSplitter'],
      experience: 3,
      transitions: 1,
      value: 0,
      load: 0,
    });
    expect(pastRush?.boards.find((board) => board.board === 'rush')?.train.result).toMatchObject({
      traits: ['megaPrMaker'],
      experience: 3,
      transitions: 0,
      value: 0,
    });
    expect(
      atCongested?.boards.find((board) => board.board === 'congested')?.train.result,
    ).toMatchObject({
      traits: ['prSplitter'],
      experience: 6,
      transitions: 1,
      score: 0,
    });
    expect(
      pastCongested?.boards.find((board) => board.board === 'congested')?.train.result,
    ).toMatchObject({
      traits: ['megaPrMaker'],
      experience: 6,
      transitions: 0,
      score: 0,
    });
    for (const point of data.sweeps.successorValue) {
      expect(point.boards.map((board) => board.ship.result.score)).toEqual([6, -12]);
      expect(point.boards.every((board) => board.ship.result.transitions === 0)).toBe(true);
    }
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = compareTraitFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const board of item.boards) {
        for (const strategy of ['train', 'ship'] as const) {
          const run = board[strategy];
          let state = run.initial;
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseTraitAction(state, strategy, item.rules)).toEqual(input);
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
            expect(state.value - state.load * state.loadWeight).toBe(
              summarizeTraitExperience(state, item.rules).score,
            );
          }
          expect(summarizeTraitExperience(state, item.rules)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'ship' }, item.rules)).toBe(state);
          expect(state.person.id).toBe('ren');
        }
      }
    }
  });
});
