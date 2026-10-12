import { describe, expect, it } from 'vitest';
import {
  applyProductivityPressure as apply,
  choosePressureAction,
  compareProductivityPressures,
  createProductivityPressure as create,
  summarizeProductivityPressure,
  viewProductivityPressure,
} from './productivityPressure';
import comparison from '../../docs/prototypes/productivity-pressure-comparison.json';

describe('RI-245 見かけの生産性への圧力', () => {
  it('PR数と実得点を分け、回数稼ぎを同じスプリントで繰り返せない', () => {
    const first = create('RI-245', 'coupled');
    expect(create('RI-245', 'coupled')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewProductivityPressure(first);
    for (let i = 0; i < 8; i++) expect(viewProductivityPressure(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(blank).toMatchObject({
      required: 4,
      prCount: 0,
      delivery: 0,
      apparent: 'pr-count',
      real: 'delivery-minus-burden',
      met: false,
      reason: 'visible-pr-count',
      choices: ['comply', 'explain'],
    });
    expect(blank.forecasts).toEqual([
      {
        strategy: 'comply',
        prCount: 4,
        delivery: 4,
        rework: 4,
        explanation: 0,
        met: true,
        score: 0,
      },
      {
        strategy: 'explain',
        prCount: 2,
        delivery: 14,
        rework: 0,
        explanation: 3,
        met: false,
        score: 11,
      },
    ]);
    const split = apply(first, { type: 'comply' });
    expect(split.prCount).toBe(4);
    expect(summarizeProductivityPressure(split)).toMatchObject({
      met: true,
      score: 0,
      lost: false,
    });
    expect(apply(split, { type: 'comply' })).toBe(split);
    expect(apply(split, { type: 'explain' })).toBe(split);
    expect(viewProductivityPressure(split).choices).toEqual([]);
    const explained = apply(first, { type: 'explain' });
    expect(summarizeProductivityPressure(explained)).toMatchObject({
      met: false,
      prCount: 2,
      score: 11,
      lost: false,
    });
  });

  it('独立した修正では分割、一連の流れでは説明が実得点で上回る', () => {
    const rows = compareProductivityPressures(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('fragmented', 'comply').result).toMatchObject({
      prCount: 4,
      met: true,
      delivery: 12,
      rework: 0,
      score: 12,
    });
    expect(row('fragmented', 'explain').result).toMatchObject({
      prCount: 2,
      met: false,
      delivery: 6,
      explanation: 3,
      score: 3,
    });
    expect(row('coupled', 'comply').result).toMatchObject({
      met: true,
      delivery: 4,
      rework: 4,
      score: 0,
    });
    expect(row('coupled', 'explain').result).toMatchObject({
      met: false,
      delivery: 14,
      explanation: 3,
      score: 11,
    });
    expect(row('fragmented', 'comply').result.score).toBeGreaterThan(
      row('fragmented', 'explain').result.score,
    );
    expect(row('coupled', 'explain').result.score).toBeGreaterThan(
      row('coupled', 'comply').result.score,
    );
    for (const item of rows) {
      expect(item.result.score).toBe(
        item.result.delivery - item.result.rework - item.result.explanation,
      );
      expect(item.result.lost).toBe(false);
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareProductivityPressures(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(choosePressureAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeProductivityPressure(live)).toEqual(row.result);
    }
  });
});
