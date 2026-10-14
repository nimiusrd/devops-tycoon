import { describe, expect, it } from 'vitest';
import {
  applyDelayedHire as apply,
  chooseDelayedHireAction,
  compareDelayedHires,
  createDelayedHire as create,
  summarizeDelayedHire,
  viewDelayedHire,
} from './delayedHire';
import comparison from '../../docs/prototypes/delayed-hire-comparison.json';

describe('RI-250 入社まで待ちがある採用', () => {
  it('支払時点と入社予定と空き枠不足を先に示し、決定だけでは戦力にしない', () => {
    const first = create('RI-250', 'blocked');
    expect(create('RI-250', 'blocked')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewDelayedHire(first);
    for (let i = 0; i < 8; i++) expect(viewDelayedHire(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(blank).toMatchObject({
      reason: 'delayed-hire',
      fee: 6,
      joinAfterTicks: 2,
      slots: 0,
      waiting: 0,
      quarterAt: 3,
      slotRule: 'wait-without-power',
      choices: ['hire', 'tactic'],
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score, item.roster])).toEqual([
      ['hire', -6, 0],
      ['tactic', 9, 0],
    ]);
    const hired = apply(first, { type: 'hire' });
    expect(hired).toMatchObject({ fee: 6, power: 0, waiting: 1, roster: 0, joined: false });
    expect(apply(hired, { type: 'tactic' })).toBe(hired);
    expect(viewDelayedHire(hired).choices).toEqual([]);
    const open = viewDelayedHire(create('RI-250', 'next'));
    expect(open.slots).toBe(1);
    expect(open.forecasts.map((item) => item.score)).toEqual([10, 9]);
  });

  it('短期と空き枠なしでは即時施策、入社が間に合う期間では遅延採用が上回る', () => {
    const rows = compareDelayedHires(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('boss', 'hire').result).toMatchObject({
      score: -2,
      power: 4,
      fee: 6,
      roster: 1,
      waiting: 0,
      path: [-6, -6, -6, -2],
    });
    expect(row('boss', 'tactic').result).toMatchObject({ score: 9, power: 15, roster: 0 });
    expect(row('next', 'hire').result).toMatchObject({
      score: 10,
      power: 16,
      roster: 1,
      waiting: 0,
      quarterCrossed: true,
      path: [-6, -6, -6, -2, 2, 6, 10],
    });
    expect(row('blocked', 'hire').result).toMatchObject({
      score: -6,
      power: 0,
      fee: 6,
      waiting: 1,
      roster: 0,
      joined: false,
      quarterCrossed: true,
    });
    expect(row('boss', 'tactic').result.score).toBeGreaterThan(row('boss', 'hire').result.score);
    expect(row('next', 'hire').result.score).toBeGreaterThan(row('next', 'tactic').result.score);
    expect(row('blocked', 'tactic').result.score).toBeGreaterThan(
      row('blocked', 'hire').result.score,
    );
    let waiting = apply(create('RI-250', 'blocked'), { type: 'hire' });
    waiting = apply(waiting, { type: 'work' });
    waiting = apply(waiting, { type: 'work' });
    expect(waiting).toMatchObject({
      worked: 2,
      quarterCrossed: false,
      waiting: 1,
      fee: 6,
      power: 0,
      roster: 0,
    });
    waiting = apply(waiting, { type: 'work' });
    expect(waiting).toMatchObject({
      quarterCrossed: true,
      waiting: 1,
      fee: 6,
      power: 0,
      roster: 0,
    });
    for (const item of rows) expect(item.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareDelayedHires(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseDelayedHireAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeDelayedHire(live)).toEqual(row.result);
    }
  });
});
