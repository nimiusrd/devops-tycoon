import { describe, expect, it } from 'vitest';
import {
  applyTraitInput as apply,
  chooseTraitAction,
  compareTraitExperience,
  createTraitExperiencePrototype as create,
  summarizeTraitExperience,
  traitEffect,
  viewTraitExperience,
} from './traitExperience';
import comparison from '../../docs/prototypes/trait-experience-comparison.json';

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
