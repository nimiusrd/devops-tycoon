import { describe, expect, it } from 'vitest';
import {
  applyDelayedHire as apply,
  chooseDelayedHireAction,
  compareDelayedHireDurations,
  compareDelayedHires,
  createDelayedHire as create,
  summarizeDelayedHire,
  viewDelayedHire,
} from './delayedHire';
import comparison from '../../docs/prototypes/delayed-hire-comparison.json';
import durations from '../../docs/prototypes/delayed-hire-duration-comparison.json';

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
      tacticFee: 6,
      feePaidAt: 'decision',
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

  it('次期の資源のまま即時施策の持続を1期間ずつ動かし、優劣の反転を再計算できる', () => {
    expect(create('RI-250', 'next')).not.toHaveProperty('tacticTicks');
    const report = compareDelayedHireDurations(durations.conditions.seed);
    expect(report).toEqual(durations);
    expect(report.conditions).toMatchObject({
      board: 'next',
      excludedBoards: ['boss', 'blocked'],
      workTicks: 6,
      slots: 1,
      fee: 6,
      hirePower: 4,
      tacticPower: 5,
      joinAfterTicks: 2,
      quarterAt: 3,
      baselineTacticTicks: 3,
      extendedTacticTicks: 4,
      durations: [1, 2, 3, 4, 5, 6, 7],
      repeatedFirstComparison: false,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      productionIntegration: false,
    });
    expect(
      report.points.map((point) => [
        point.tacticTicks,
        point.hireScore,
        point.tacticScore,
        point.preference,
      ]),
    ).toEqual([
      [1, 10, -1, 'hire'],
      [2, 10, 4, 'hire'],
      [3, 10, 9, 'hire'],
      [4, 10, 14, 'tactic'],
      [5, 10, 19, 'tactic'],
      [6, 10, 24, 'tactic'],
      [7, 10, 24, 'tactic'],
    ]);
    expect(report.extended).toEqual({
      tacticTicks: 4,
      hireScore: 10,
      tacticScore: 14,
      preference: 'tactic',
      hireStillWins: false,
    });
    expect(report.reversals).toEqual([
      {
        before: { tacticTicks: 3, preference: 'hire', hireScore: 10, tacticScore: 9 },
        after: { tacticTicks: 4, preference: 'tactic', hireScore: 10, tacticScore: 14 },
        strict: true,
      },
    ]);
    const at4 = report.points.find((point) => point.tacticTicks === 4)!;
    expect(at4.runs.find((run) => run.strategy === 'hire')!.result.path).toEqual([
      -6, -6, -6, -2, 2, 6, 10,
    ]);
    expect(at4.runs.find((run) => run.strategy === 'tactic')!.result.path).toEqual([
      -6, -1, 4, 9, 14, 14, 14,
    ]);
    const first = (strategy: string) =>
      comparison.results.find((row) => row.board === 'next' && row.strategy === strategy)!;
    const at3 = report.points.find((point) => point.tacticTicks === 3)!;
    for (const strategy of ['hire', 'tactic'] as const) {
      const run = at3.runs.find((item) => item.strategy === strategy)!;
      expect(run.inputs).toEqual(first(strategy).inputs);
      expect(run.result).toEqual(first(strategy).result);
      const { tacticTicks, ...initial } = run.initial;
      expect(tacticTicks).toBe(3);
      expect(initial).toEqual(first(strategy).initial);
    }
    for (const point of report.points) {
      for (const run of point.runs) expect(run.initial.board).toBe('next');
    }
    for (let index = 1; index < report.points.length; index += 1) {
      const previous = report.points[index - 1]!;
      const point = report.points[index]!;
      expect(point.tacticTicks - previous.tacticTicks).toBe(1);
      expect(point.hireScore).toBe(previous.hireScore);
      const step =
        point.tacticTicks <= report.conditions.workTicks ? report.conditions.tacticPower : 0;
      expect(point.tacticScore - previous.tacticScore).toBe(step);
    }
    const opened = create('RI-250', 'next', 4);
    const before = structuredClone(opened);
    const forecast = viewDelayedHire(opened);
    expect(opened).toEqual(before);
    expect(forecast.tacticTicks).toBe(4);
    expect(forecast.forecasts.map((item) => [item.strategy, item.score])).toEqual([
      ['hire', 10],
      ['tactic', 14],
    ]);
  });

  it('持続比較の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const point of compareDelayedHireDurations(durations.conditions.seed).points) {
      const hire = point.runs.find((run) => run.strategy === 'hire')!;
      const tactic = point.runs.find((run) => run.strategy === 'tactic')!;
      expect(hire.initial).toEqual(tactic.initial);
      expect(hire.initial.tacticTicks).toBe(point.tacticTicks);
      for (const run of point.runs) {
        let live = run.initial;
        let saved = structuredClone(live);
        for (const input of run.inputs) {
          const previous = live;
          const before = structuredClone(live);
          expect(chooseDelayedHireAction(previous, run.strategy)).toEqual(input);
          live = apply(live, input);
          saved = apply(JSON.parse(JSON.stringify(saved)), input);
          expect(previous).toEqual(before);
          expect(saved).toEqual(live);
        }
        expect(summarizeDelayedHire(live)).toEqual(run.result);
        expect(run.result.lost).toBe(false);
      }
      expect(tactic.result).toMatchObject({
        fee: 6,
        roster: 0,
        joined: false,
        slots: 1,
        waiting: 0,
        quarterCrossed: true,
      });
      expect(tactic.result.power).toBe(tactic.result.score + 6);
    }
  });
});
