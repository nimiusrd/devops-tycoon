import { describe, expect, it } from 'vitest';
import {
  applySpecMismatch as apply,
  chooseSpecMismatchAction,
  compareSpecMismatches,
  createSpecMismatch as create,
  summarizeSpecMismatch,
  viewSpecMismatch,
} from './specMismatch';
import comparison from '../../docs/prototypes/spec-mismatch-comparison.json';

describe('RI-248 認識違いの救い方', () => {
  it('確認前に兆候と対象を示し、対応ごとに残作業と価値が違う', () => {
    const first = create('RI-248', 'open');
    expect(create('RI-248', 'open')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewSpecMismatch(first);
    for (let i = 0; i < 8; i++) expect(viewSpecMismatch(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(first.sign).toBe('unconfirmed-assumption');
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(blank).toMatchObject({
      target: 'checkout-flow',
      sign: 'unconfirmed-assumption',
      signKnownBefore: true,
      deadlineTicks: 8,
      checkWork: 2,
      mismatchAfter: 4,
      responses: {
        rebuild: { work: 6, value: 18 },
        explain: { work: 2, value: 12 },
        narrow: { work: 1, value: 7 },
      },
      choices: ['check', 'rebuild', 'explain', 'narrow'],
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score])).toEqual([
      ['check', 18],
      ['rebuild', 0],
      ['explain', 12],
      ['narrow', 7],
    ]);
    const chosen = apply(first, { type: 'check' });
    expect(chosen.delivered).toBe(0);
    expect(chosen.mismatchFound).toBe(false);
    expect(apply(chosen, { type: 'explain' })).toBe(chosen);
    expect(viewSpecMismatch(chosen).choices).toEqual([]);
  });

  it('期限8では確認、期限6では説明、期限5では範囲縮小が上回る', () => {
    const rows = compareSpecMismatches(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('open', 'check').result).toMatchObject({
      score: 18,
      scope: 'full',
      checked: true,
      mismatchFound: false,
      agreement: false,
      remaining: 0,
    });
    expect(row('open', 'rebuild').result).toMatchObject({
      score: 0,
      mismatchFound: true,
      sunk: 4,
      remaining: 2,
    });
    expect(row('mid', 'explain').result).toMatchObject({
      score: 12,
      scope: 'negotiated',
      agreement: true,
      mismatchFound: true,
    });
    expect(row('mid', 'check').result).toMatchObject({
      score: 0,
      checked: true,
      mismatchFound: false,
      remaining: 2,
    });
    expect(row('tight', 'narrow').result).toMatchObject({
      score: 7,
      scope: 'narrow',
      agreement: false,
      mismatchFound: true,
    });
    expect(row('tight', 'explain').result).toMatchObject({
      score: 0,
      agreement: false,
      remaining: 1,
    });
    expect(row('open', 'check').result.score).toBeGreaterThan(row('open', 'explain').result.score);
    expect(row('mid', 'explain').result.score).toBeGreaterThan(row('mid', 'check').result.score);
    expect(row('tight', 'narrow').result.score).toBeGreaterThan(row('tight', 'check').result.score);
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareSpecMismatches(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseSpecMismatchAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeSpecMismatch(live)).toEqual(row.result);
    }
  });
});
