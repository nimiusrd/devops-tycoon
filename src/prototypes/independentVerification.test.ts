import { describe, expect, it } from 'vitest';
import {
  applyVerificationInput as apply,
  chooseVerificationAction,
  compareVerificationFactorReversals,
  compareVerificationStrategies,
  createVerificationPrototype as create,
  summarizeVerification,
  viewVerification,
} from './independentVerification';
import comparison from '../../docs/prototypes/independent-verification-comparison.json';
import factors from '../../docs/prototypes/independent-verification-factor-comparison.json';

describe('RI-194 実装と検証の独立性', () => {
  it('同じ手法は1tickで共通見落としを残し、別手法は3tickでそれだけを見つける', () => {
    const same = apply(create('RI-194', 'high'), { type: 'verify', method: 'script' });
    expect(viewVerification(same).methods).toEqual({
      script: { ticks: 1, catches: 'none' },
      walkthrough: { ticks: 3, catches: 'assumption' },
    });
    let state = same;
    for (let count = 0; count < 4; count += 1) state = apply(state, { type: 'tick' });
    expect(state.implLeft).toBe(0);
    expect(state.verifyLeft).toBe(0);
    expect(state.shipped).toBe(-2);
    expect(state.caughtShared).toBe(false);
    expect(state.resolutions[3]).toBe('t4,verify:script,missed:assumption,ship:-2');
    const other = apply(create('RI-194', 'other'), { type: 'verify', method: 'walkthrough' });
    let walked = other;
    for (let count = 0; count < 6; count += 1) walked = apply(walked, { type: 'tick' });
    expect(walked.caughtShared).toBe(true);
    expect(walked.shipped).toBe(7);
    expect(walked.resolutions[5]).toBe(
      't6,verify:walkthrough,caught:assumption,missed:load,ship:7',
    );
  });

  it('未知の手法、同じ手法の再設定、着手後の変更、手法なしの進行を拒否する', () => {
    const initial = create('RI-194', 'low');
    expect(apply(initial, { type: 'verify', method: 'llm' })).toBe(initial);
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    const chosen = apply(initial, { type: 'verify', method: 'script' });
    expect(apply(chosen, { type: 'verify', method: 'script' })).toBe(chosen);
    const switched = apply(chosen, { type: 'verify', method: 'walkthrough' });
    expect(switched.verifyLeft).toBe(3);
    const started = apply(switched, { type: 'tick' });
    expect(apply(started, { type: 'verify', method: 'script' })).toBe(started);
  });

  it('閲覧では検証も実装も進まず、期末は無消費で拒否する', () => {
    const initial = create('RI-194', 'low');
    const before = structuredClone(initial);
    for (let count = 0; count < 30; count += 1) viewVerification(initial);
    expect(initial).toEqual(before);
    expect(viewVerification(initial).ignoredRisk).toBe('load');
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'verify', method: 'script' })).toBe(ended);
  });

  it('低影響の短い期末は同じ手法、高影響は別手法が有利で、負荷リスクは残る', () => {
    const rows = compareVerificationStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect([net('low', 'same'), net('low', 'independent')]).toEqual([8, 0]);
    expect([net('high', 'independent'), net('high', 'same')]).toEqual([12, -2]);
    expect([net('other', 'independent'), net('other', 'same')]).toEqual([7, -7]);
    const clean = rows.find((row) => row.scenario === 'high' && row.strategy === 'independent')!;
    expect(clean.result.caughtShared).toBe(true);
    const partial = rows.find((row) => row.scenario === 'other' && row.strategy === 'independent')!;
    expect(partial.result.resolutions.some((line) => line.includes('missed:load'))).toBe(true);
    expect(partial.result.resolutions.some((line) => line.includes('caught:assumption'))).toBe(
      true,
    );
    const rushed = rows.find((row) => row.scenario === 'low' && row.strategy === 'independent')!;
    expect(rushed.result.shipped).toBeNull();
  });

  it('全入力の再生と毎入力JSON保存再開が一致する', () => {
    for (const row of compareVerificationStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseVerificationAction(previous, row.strategy)).toEqual(input);
      }
      expect(summarizeVerification(live)).toEqual(row.result);
      const again = row.inputs.reduce((state, input) => apply(state, input), row.initial);
      expect(again).toEqual(live);
    }
  });
});

const BOARDS = ['low', 'high', 'other'] as const;

function runOf<T extends { strategy: string }>(
  point: { runs: T[] },
  strategy: 'same' | 'independent',
): T {
  const found = point.runs.find((run) => run.strategy === strategy);
  if (!found) throw new Error(strategy);
  return found;
}

describe('RI-194 検証tickと見落としを一つずつ動かした比較', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const report = compareVerificationFactorReversals(factors.conditions.seed);
    expect(report).toEqual(factors);
    expect(report.conditions).toMatchObject({
      seed: 'RI-194',
      baseline: { implTicks: 3, scriptTicks: 1, walkthroughTicks: 3, shipValue: 12 },
      verifyTickLevels: [1, 2, 3, 4, 5, 6],
      sharedLevels: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
      methodAssignConsumesTick: false,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
    });
    expect(report.conditions.boards).toEqual({
      low: { horizon: 5, sharedPenalty: 4, otherPenalty: 0 },
      high: { horizon: 8, sharedPenalty: 14, otherPenalty: 0 },
      other: { horizon: 8, sharedPenalty: 14, otherPenalty: 5 },
    });
    const cells = (
      points: {
        scenario: string;
        verifyTicks: number;
        sharedPenalty: number;
        preference: string;
        same: number;
        independent: number;
      }[],
    ) =>
      points.map((point) => [
        point.scenario,
        point.verifyTicks,
        point.sharedPenalty,
        point.preference,
        point.same,
        point.independent,
      ]);
    expect(cells(report.verifyTicks.points)).toEqual([
      ['low', 1, 4, 'independent', 8, 12],
      ['high', 1, 14, 'independent', -2, 12],
      ['other', 1, 14, 'independent', -7, 7],
      ['low', 2, 4, 'independent', 8, 12],
      ['high', 2, 14, 'independent', -2, 12],
      ['other', 2, 14, 'independent', -7, 7],
      ['low', 3, 4, 'same', 8, 0],
      ['high', 3, 14, 'independent', -2, 12],
      ['other', 3, 14, 'independent', -7, 7],
      ['low', 4, 4, 'same', 8, 0],
      ['high', 4, 14, 'independent', -2, 12],
      ['other', 4, 14, 'independent', -7, 7],
      ['low', 5, 4, 'same', 8, 0],
      ['high', 5, 14, 'independent', -2, 12],
      ['other', 5, 14, 'independent', -7, 7],
      ['low', 6, 4, 'same', 8, 0],
      ['high', 6, 14, 'independent', -2, 0],
      ['other', 6, 14, 'independent', -7, 0],
    ]);
    expect(
      report.sharedPenalty.points
        .filter((point) => point.scenario === 'low')
        .map((point) => [point.sharedPenalty, point.preference, point.same, point.independent]),
    ).toEqual([
      [0, 'same', 12, 0],
      [1, 'same', 11, 0],
      [2, 'same', 10, 0],
      [3, 'same', 9, 0],
      [4, 'same', 8, 0],
      [5, 'same', 7, 0],
      [6, 'same', 6, 0],
      [7, 'same', 5, 0],
      [8, 'same', 4, 0],
      [9, 'same', 3, 0],
      [10, 'same', 2, 0],
      [11, 'same', 1, 0],
      [12, 'tie', 0, 0],
      [13, 'independent', -1, 0],
      [14, 'independent', -2, 0],
    ]);
    expect(
      report.sharedPenalty.points
        .filter((point) => point.scenario === 'high')
        .map((point) => [point.preference, point.same, point.independent]),
    ).toEqual([
      ['tie', 12, 12],
      ...Array.from({ length: 14 }, (_, index) => ['independent', 11 - index, 12]),
    ]);
    expect(
      report.sharedPenalty.points
        .filter((point) => point.scenario === 'other')
        .map((point) => [point.preference, point.same, point.independent]),
    ).toEqual([
      ['tie', 7, 7],
      ...Array.from({ length: 14 }, (_, index) => ['independent', 6 - index, 7]),
    ]);
    expect(report.verifyTicks.reversals).toEqual([
      {
        factor: 'verifyTicks',
        scenario: 'low',
        before: { level: 2, preference: 'independent', same: 8, independent: 12 },
        after: { level: 3, preference: 'same', same: 8, independent: 0 },
        strict: true,
      },
    ]);
    expect(report.sharedPenalty.reversals).toEqual([
      {
        factor: 'sharedPenalty',
        scenario: 'low',
        before: { level: 11, preference: 'same', same: 1, independent: 0 },
        after: { level: 12, preference: 'tie', same: 0, independent: 0 },
        strict: false,
      },
      {
        factor: 'sharedPenalty',
        scenario: 'low',
        before: { level: 12, preference: 'tie', same: 0, independent: 0 },
        after: { level: 13, preference: 'independent', same: -1, independent: 0 },
        strict: false,
      },
      {
        factor: 'sharedPenalty',
        scenario: 'high',
        before: { level: 0, preference: 'tie', same: 12, independent: 12 },
        after: { level: 1, preference: 'independent', same: 11, independent: 12 },
        strict: false,
      },
      {
        factor: 'sharedPenalty',
        scenario: 'other',
        before: { level: 0, preference: 'tie', same: 7, independent: 7 },
        after: { level: 1, preference: 'independent', same: 6, independent: 7 },
        strict: false,
      },
    ]);
    const first = compareVerificationStrategies(comparison.seed);
    for (const scenario of BOARDS) {
      const board = report.conditions.boards[scenario];
      const anchored = [
        report.verifyTicks.points.find(
          (point) => point.scenario === scenario && point.verifyTicks === 3,
        ),
        report.sharedPenalty.points.find(
          (point) => point.scenario === scenario && point.sharedPenalty === board.sharedPenalty,
        ),
      ];
      for (const point of anchored) {
        if (!point) throw new Error(scenario);
        for (const strategy of ['same', 'independent'] as const) {
          const run = runOf(point, strategy);
          const row = first.find(
            (item) => item.scenario === scenario && item.strategy === strategy,
          );
          if (!row) throw new Error(strategy);
          expect(run.initial).toEqual(row.initial);
          expect(run.inputs).toEqual(row.inputs);
          expect(run.result).toEqual(row.result);
        }
      }
    }
    for (const point of report.verifyTicks.points) {
      const board = report.conditions.boards[point.scenario];
      expect(point.sharedPenalty).toBe(board.sharedPenalty);
      expect(point.otherPenalty).toBe(board.otherPenalty);
      expect(point.horizon).toBe(board.horizon);
      for (const run of point.runs) {
        expect(run.rules).toEqual({
          implTicks: 3,
          scriptTicks: 1,
          walkthroughTicks: point.verifyTicks,
          shipValue: 12,
        });
      }
    }
    for (const point of report.sharedPenalty.points) {
      const board = report.conditions.boards[point.scenario];
      expect(point.verifyTicks).toBe(3);
      expect(point.horizon).toBe(board.horizon);
      expect(point.otherPenalty).toBe(board.otherPenalty);
      for (const run of point.runs) {
        expect(run.rules).toEqual(report.conditions.baseline);
        expect(run.initial.sharedPenalty).toBe(point.sharedPenalty);
        expect(run.initial.otherPenalty).toBe(board.otherPenalty);
      }
    }
    const finished = report.verifyTicks.points.find(
      (point) => point.scenario === 'low' && point.verifyTicks === 2,
    );
    const missed = report.verifyTicks.points.find(
      (point) => point.scenario === 'low' && point.verifyTicks === 3,
    );
    if (!finished || !missed) throw new Error('verify boundary');
    expect(finished).toMatchObject({
      preference: 'independent',
      independentCaught: true,
      independentShipped: true,
    });
    const caughtLine = runOf(finished, 'independent').result.resolutions;
    expect(caughtLine[caughtLine.length - 1]).toBe(
      't5,verify:walkthrough,caught:assumption,ship:12',
    );
    expect(missed).toMatchObject({
      preference: 'same',
      independentCaught: false,
      independentShipped: false,
    });
    expect(
      runOf(missed, 'independent').result.resolutions.some((line) => line.includes('ship:')),
    ).toBe(false);
    const late = report.verifyTicks.points.find(
      (point) => point.scenario === 'high' && point.verifyTicks === 6,
    );
    if (!late) throw new Error('late');
    expect(late).toMatchObject({
      preference: 'independent',
      same: -2,
      independent: 0,
      independentCaught: false,
      independentShipped: false,
    });
    const unshipped = report.sharedPenalty.points.find(
      (point) => point.scenario === 'low' && point.sharedPenalty === 13,
    );
    const even = report.sharedPenalty.points.find(
      (point) => point.scenario === 'low' && point.sharedPenalty === 12,
    );
    if (!unshipped || !even) throw new Error('shared boundary');
    expect(runOf(even, 'same').result).toMatchObject({
      shipped: 0,
      caughtShared: false,
      netValue: 0,
    });
    expect(runOf(unshipped, 'independent').result).toMatchObject({
      shipped: null,
      caughtShared: false,
      netValue: 0,
    });
    expect(runOf(unshipped, 'same').result.resolutions[3]).toBe(
      't4,verify:script,missed:assumption,ship:-1',
    );
    const zero = report.sharedPenalty.points.find(
      (point) => point.scenario === 'high' && point.sharedPenalty === 0,
    );
    if (!zero) throw new Error('zero');
    expect(runOf(zero, 'same').result.caughtShared).toBe(false);
    expect(runOf(zero, 'independent').result).toMatchObject({
      caughtShared: true,
      shipped: 12,
      netValue: 12,
    });
    const loaded = report.verifyTicks.points.find(
      (point) => point.scenario === 'other' && point.verifyTicks === 3,
    );
    if (!loaded) throw new Error('load');
    expect(
      runOf(loaded, 'independent').result.resolutions.some((line) => line.includes('missed:load')),
    ).toBe(true);
    for (const scenario of BOARDS) {
      for (const strategy of ['same', 'independent'] as const) {
        const inputs = [...report.verifyTicks.points, ...report.sharedPenalty.points]
          .filter((point) => point.scenario === scenario)
          .map((point) => runOf(point, strategy).inputs);
        const head = inputs[0];
        if (!head) throw new Error(scenario);
        expect(inputs.every((row) => JSON.stringify(row) === JSON.stringify(head))).toBe(true);
      }
    }
  });

  it('記録した規則で再生すると差引が一致し、規則を落とすと別手法のtickは初回に戻る', () => {
    const report = compareVerificationFactorReversals(factors.conditions.seed);
    const shifted = report.verifyTicks.points.find(
      (point) => point.scenario === 'low' && point.verifyTicks === 2,
    );
    if (!shifted) throw new Error('shifted');
    const independent = runOf(shifted, 'independent');
    let ignored = independent.initial;
    for (const input of independent.inputs) ignored = apply(ignored, input);
    expect(summarizeVerification(ignored)).not.toEqual(independent.result);
    expect(summarizeVerification(ignored).shipped).toBeNull();
    for (const point of [...report.verifyTicks.points, ...report.sharedPenalty.points]) {
      expect(point.runs.map((run) => run.strategy)).toEqual(['same', 'independent']);
      for (const run of point.runs) {
        expect(run.initial.version).toBe(1);
        expect(run.initial.implTicks).toBe(3);
        let live = run.initial;
        let saved = structuredClone(live);
        for (const input of run.inputs) {
          const previous = live;
          const before = structuredClone(live);
          expect(chooseVerificationAction(previous, run.strategy)).toEqual(input);
          live = apply(live, input, run.rules);
          saved = apply(JSON.parse(JSON.stringify(saved)), input, run.rules);
          expect(previous).toEqual(before);
          expect(saved).toEqual(live);
          if (live.shipped !== null) {
            const shared = live.caughtShared ? 0 : live.sharedPenalty;
            expect(live.shipped).toBe(run.rules.shipValue - shared - live.otherPenalty);
          }
        }
        expect(summarizeVerification(live)).toEqual(run.result);
        expect(live.inputs).toEqual(run.inputs);
        expect(apply(live, { type: 'tick' }, run.rules)).toBe(live);
        expect(run.result.netValue).toBe(run.result.shipped ?? 0);
      }
      if (point.independentShipped) {
        expect(point.independentCaught).toBe(true);
        expect(point.independent).toBe(12 - point.otherPenalty);
      } else {
        expect(point.independentCaught).toBe(false);
        expect(point.independent).toBe(0);
      }
    }
  });
});
