import { describe, expect, it } from 'vitest';
import {
  allocateConsult,
  applyFocusConsult as apply,
  chooseFocusAction,
  compareFocusConsults,
  createFocusConsult as create,
  summarizeFocusConsult,
  viewFocusConsult,
} from './focusConsult';
import comparison from '../../docs/prototypes/focus-consult-comparison.json';

describe('RI-222 集中時間と相談時間', () => {
  it('期間、到着、相談枠の出荷と無駄を操作前に示す', () => {
    const first = create('RI-222', 'quiet');
    expect(create('RI-222', 'quiet')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewFocusConsult(first);
    for (let i = 0; i < 8; i++) expect(viewFocusConsult(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({ tick: 0, horizon: 4, slack: 0, arrivals: 0, queue: 0 });
    expect(blank.options).toEqual([
      { reserve: 0, ship: 6, missed: 0, wasted: 0 },
      { reserve: 2, ship: 4, missed: 0, wasted: 2 },
      { reserve: 6, ship: 0, missed: 0, wasted: 6 },
    ]);
  });

  it('相談が来なくても相談枠は出荷へ戻らず、不正な枠は無視する', () => {
    const fresh = create('RI-222', 'quiet');
    expect(allocateConsult(fresh, 1)).toBe(fresh);
    expect(allocateConsult(fresh, 4)).toBe(fresh);
    const reserved = apply(fresh, { type: 'allocate', reserve: 2 });
    expect(summarizeFocusConsult(reserved)).toMatchObject({
      shipped: 4,
      wastedReserve: 2,
      missed: 0,
      score: 4,
    });
    expect(apply(reserved, { type: 'view' })).toBe(reserved);
  });

  it('期限を超えた相談だけを一度引き、待ちは実時間を増やさない', () => {
    let state = create('RI-222', 'steady');
    state = apply(state, { type: 'allocate', reserve: 0 });
    expect(state.tick).toBe(1);
    expect(summarizeFocusConsult(state)).toMatchObject({
      shipped: 6,
      missed: 2,
      penalty: 14,
      waitPeriods: 2,
    });
    const burst = create('RI-222', 'burst');
    const held = apply(burst, { type: 'allocate', reserve: 0 });
    expect(held.tick).toBe(1);
    expect(held.queue).toEqual([]);
    const queued = apply(held, { type: 'allocate', reserve: 0 });
    expect(queued.queue).toHaveLength(4);
    expect(queued.missed).toBe(0);
    expect(queued.waitPeriods).toBe(4);
  });

  it('静穏は長い集中、集中割り込みは短い集中、毎期到着は常時相談が上回る', () => {
    const rows = compareFocusConsults(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('quiet', 'long'), score('quiet', 'always'), score('quiet', 'short')]).toEqual([
      18, 16, 12,
    ]);
    expect([score('burst', 'short'), score('burst', 'always'), score('burst', 'long')]).toEqual([
      7, 6, -2,
    ]);
    expect([score('steady', 'always'), score('steady', 'short'), score('steady', 'long')]).toEqual([
      -12, -16, -24,
    ]);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareFocusConsults(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseFocusAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeFocusConsult(live)).toEqual(row.result);
    }
  });
});
