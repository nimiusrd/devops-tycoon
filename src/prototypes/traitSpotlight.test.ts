import { describe, expect, it } from 'vitest';
import { getTrait } from '../data/traits';
import {
  applyTraitSpotlight as apply,
  chooseSpotlightAction,
  compareTraitSpotlights,
  createTraitSpotlight as create,
  summarizeTraitSpotlight,
  viewTraitSpotlight,
} from './traitSpotlight';
import comparison from '../../docs/prototypes/trait-spotlight-comparison.json';

describe('RI-241 欠点のある人の見せ場', () => {
  it('在籍と稼働を示し、不在のレビュー鬼は選択肢に出さない', () => {
    const trait = getTrait('reviewDemon');
    const first = create('RI-241', 'calm');
    expect(create('RI-241', 'calm')).toEqual(first);
    expect(trait?.modifiers).toMatchObject({ reviewMul: 1.3, staminaDrainMul: 1.35 });
    const before = structuredClone(first);
    const blank = viewTraitSpotlight(first);
    for (let i = 0; i < 8; i++) expect(viewTraitSpotlight(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(blank).toMatchObject({
      queue: 8,
      trait: 'reviewDemon',
      reason: 'review-backlog',
      helpsWhen: 'inflow-at-least-12',
      hindersWhen: 'inflow-at-most-11',
      choices: ['steady', 'demon'],
      demon: { present: true, active: true, output: 13, drain: 27, stamina: 80 },
    });
    const absent = create('RI-241', 'absent');
    expect(viewTraitSpotlight(absent).choices).toEqual(['steady']);
    expect(viewTraitSpotlight(absent).demon).toMatchObject({ present: false, active: false });
    expect(apply(absent, { type: 'assign', member: 'demon' })).toBe(absent);
    const tired = structuredClone(first);
    tired.members[1].stamina = 0;
    expect(viewTraitSpotlight(tired).choices).toEqual(['steady']);
    expect(apply(tired, { type: 'assign', member: 'demon' })).toBe(tired);
    expect(apply(tired, { type: 'note' }).skipped).toBe(true);
  });

  it('待ちが少ないときは速度を捨て、消費の欠点はそのまま残す', () => {
    const open = create('RI-241', 'calm');
    expect(open.members[0].output).toBe(10);
    expect(open.members[1].output).toBe(13);
    expect(apply(open, { type: 'note' })).toBe(open);
    const once = apply(open, { type: 'assign', member: 'demon' });
    expect(once.periods[0]).toMatchObject({ cleared: 8, remaining: 0, arrived: 8 });
    expect(once.queue).toBe(8);
    const used = apply(once, { type: 'assign', member: 'demon' });
    expect(used.periods[1]).toMatchObject({ cleared: 8, remaining: 0, arrived: 0 });
    expect(used.queue).toBe(0);
    expect(used.value).toBe(64);
    expect(used.spent).toBe(54);
    expect(used.members[1].stamina).toBe(26);
    expect(viewTraitSpotlight(used).choices).toEqual([]);
    expect(apply(used, { type: 'note' })).toBe(used);
    expect(apply(used, { type: 'assign', member: 'demon' })).toBe(used);
    const noted = apply(create('RI-241', 'absent'), { type: 'note' });
    expect(noted.skipped).toBe(true);
    expect(noted.tick).toBe(0);
    expect(apply(noted, { type: 'note' })).toBe(noted);
  });

  it('危機ではレビュー鬼、平常では安定した人物が得点で上回る', () => {
    const rows = compareTraitSpotlights(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('calm', 'steady').result).toMatchObject({
      score: 24,
      spent: 40,
      path: [12, 24],
      assigned: ['steady', 'steady'],
      skipped: false,
    });
    expect(row('calm', 'spotlight').result).toMatchObject({
      score: 10,
      spent: 54,
      path: [5, 10],
      assigned: ['demon', 'demon'],
    });
    expect(row('even', 'steady').result).toMatchObject({ score: 40, path: [20, 40] });
    expect(row('even', 'spotlight').result).toMatchObject({ score: 26, spent: 54, path: [13, 26] });
    expect(row('even', 'steady').result.score).toBeGreaterThan(
      row('even', 'spotlight').result.score,
    );
    expect(row('over', 'steady').result).toMatchObject({ score: 40, path: [20, 40] });
    expect(row('over', 'spotlight').result).toMatchObject({
      value: 88,
      spent: 54,
      score: 34,
      path: [17, 34],
    });
    expect(row('flip', 'spotlight').result).toMatchObject({ value: 96, spent: 54, score: 42 });
    expect(row('flip', 'steady').result.score).toBe(40);
    expect(row('over', 'steady').result.score).toBeGreaterThan(
      row('over', 'spotlight').result.score,
    );
    expect(row('flip', 'spotlight').result.score).toBeGreaterThan(
      row('flip', 'steady').result.score,
    );
    expect(row('crisis', 'spotlight').result).toMatchObject({
      score: 50,
      value: 104,
      spent: 54,
      path: [25, 50],
    });
    expect(row('crisis', 'steady').result.score).toBe(40);
    expect(row('absent', 'spotlight').result).toMatchObject({
      score: 40,
      assigned: ['steady', 'steady'],
      skipped: true,
    });
    expect(row('absent', 'spotlight').result.score).toBe(row('absent', 'steady').result.score);
    expect(row('calm', 'steady').result.score).toBeGreaterThan(
      row('calm', 'spotlight').result.score,
    );
    expect(row('crisis', 'spotlight').result.score).toBeGreaterThan(
      row('crisis', 'steady').result.score,
    );
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareTraitSpotlights(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseSpotlightAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeTraitSpotlight(live)).toEqual(row.result);
    }
  });
});
