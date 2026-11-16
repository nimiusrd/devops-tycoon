import { describe, expect, it } from 'vitest';
import {
  applyStandardAction,
  applyStandardProcedure as apply,
  baselineStandardRules,
  chooseStandardAction,
  compareStandardFactorReversals,
  compareStandardProcedures,
  createStandardProcedure as create,
  summarizeStandardProcedure,
  viewStandardProcedure,
} from './standardProcedure';
import comparison from '../../docs/prototypes/standard-procedure-comparison.json';
import factors from '../../docs/prototypes/standard-procedure-factor-comparison.json';

describe('RI-227 標準化と現場実験', () => {
  it('適合、移行費用、手順差の支援費用、支援しない罰を操作前に示す', () => {
    const first = create('RI-227', 'different');
    expect(create('RI-227', 'different')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewStandardProcedure(first);
    for (let i = 0; i < 8; i++) expect(viewStandardProcedure(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toEqual({
      tick: 0,
      horizon: 3,
      teams: [
        { id: 'alpha', procedure: 'kit', work: 'batch', fit: true, periodShip: 6 },
        { id: 'beta', procedure: 'local', work: 'custom', fit: true, periodShip: 6 },
      ],
      migrationFee: 5,
      supportCost: 4,
      blockerIfIdle: 5,
    });
    expect(viewStandardProcedure(create('RI-227', 'same')).teams[1]).toMatchObject({
      work: 'batch',
      fit: false,
      periodShip: 3,
    });
  });

  it('移行費用は一度だけ、支援費用は移行後の手順で決まり、未知の操作は進まない', () => {
    const fresh = create('RI-227', 'same');
    expect(applyStandardAction(fresh, 'sync')).toBe(fresh);
    const moved = apply(fresh, { type: 'act', action: 'migrate' });
    expect(moved.migrationPaid).toBe(5);
    expect(moved.betaShip).toBe(6);
    expect(moved.penalty).toBe(5);
    expect(moved.supportPaid).toBe(0);
    expect(viewStandardProcedure(moved)).toMatchObject({
      migrationFee: 0,
      supportCost: 1,
      teams: [
        { id: 'alpha', fit: true, periodShip: 6 },
        { id: 'beta', procedure: 'kit', fit: true, periodShip: 6 },
      ],
    });
    expect(apply(moved, { type: 'act', action: 'migrate' })).toBe(moved);
    const helped = apply(moved, { type: 'act', action: 'support' });
    expect(helped.supportPaid).toBe(1);
    expect(helped.penalty).toBe(5);
    const mismatched = apply(create('RI-227', 'different'), { type: 'act', action: 'migrate' });
    expect(mismatched.betaShip).toBe(3);
    expect(apply(mismatched, { type: 'view' })).toBe(mismatched);
  });

  it('同じ仕事は標準化、違う仕事は個別手順の支援が上回る', () => {
    const rows = compareStandardProcedures(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([
      score('same', 'standardize'),
      score('same', 'experiment'),
      score('same', 'hold'),
    ]).toEqual([24, 15, 12]);
    expect([
      score('different', 'experiment'),
      score('different', 'hold'),
      score('different', 'standardize'),
    ]).toEqual([24, 21, 15]);
    const standardized = rows.find(
      (row) => row.board === 'same' && row.strategy === 'standardize',
    )!;
    expect(standardized.result.migration).toBe(5);
    expect(standardized.result.support).toBe(2);
    const experimented = rows.find(
      (row) => row.board === 'different' && row.strategy === 'experiment',
    )!;
    expect(experimented.result.migration).toBe(0);
    expect(experimented.result.support).toBe(12);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareStandardProcedures(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseStandardAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeStandardProcedure(live)).toEqual(row.result);
    }
  });
});

describe('RI-227 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareStandardFactorReversals();
    expect(data).toEqual(factors);
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((point) => [
        point.parameter,
        ...point.boards.flatMap((board) => [
          board.standardize.result.score,
          board.experiment.result.score,
          board.preference,
        ]),
      ]);
    expect(data.conditions).toMatchObject({
      seed: 'RI-227',
      horizon: 3,
      blocker: 5,
      supportSame: 1,
      missShip: 3,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
      omitted: '様子見は初回JSONのまま再出力しない',
    });
    expect(data.conditions.baseline).toEqual({ supportDiff: 4, migrationFee: 5, fitGap: 3 });
    expect(data.conditions.plans).toEqual({
      standardize: ['migrate', 'support', 'support'],
      experiment: ['support', 'support', 'support'],
    });
    expect(nets('supportDiff')).toEqual([
      ['0', 24, 27, 'experiment', 15, 36, 'experiment'],
      ['1', 24, 24, 'tie', 15, 33, 'experiment'],
      ['2', 24, 21, 'standardize', 15, 30, 'experiment'],
      ['4', 24, 15, 'standardize', 15, 24, 'experiment'],
      ['6', 24, 9, 'standardize', 15, 18, 'experiment'],
      ['7', 24, 6, 'standardize', 15, 15, 'tie'],
      ['8', 24, 3, 'standardize', 15, 12, 'standardize'],
    ]);
    expect(nets('migrationFee')).toEqual([
      ['0', 29, 15, 'standardize', 20, 24, 'experiment'],
      ['5', 24, 15, 'standardize', 15, 24, 'experiment'],
      ['13', 16, 15, 'standardize', 7, 24, 'experiment'],
      ['14', 15, 15, 'tie', 6, 24, 'experiment'],
      ['15', 14, 15, 'experiment', 5, 24, 'experiment'],
    ]);
    expect(nets('fitGap')).toEqual([
      ['-1', 0, 3, 'experiment', 3, 0, 'standardize'],
      ['0', 6, 6, 'tie', 6, 6, 'tie'],
      ['1', 12, 9, 'standardize', 9, 12, 'experiment'],
      ['3', 24, 15, 'standardize', 15, 24, 'experiment'],
      ['6', 42, 24, 'standardize', 24, 42, 'experiment'],
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
      ['supportDiff', 'same', '0', 'experiment', '1', 'tie'],
      ['supportDiff', 'same', '1', 'tie', '2', 'standardize'],
      ['supportDiff', 'different', '6', 'experiment', '7', 'tie'],
      ['supportDiff', 'different', '7', 'tie', '8', 'standardize'],
      ['migrationFee', 'same', '13', 'standardize', '14', 'tie'],
      ['migrationFee', 'same', '14', 'tie', '15', 'experiment'],
      ['fitGap', 'same', '-1', 'experiment', '0', 'tie'],
      ['fitGap', 'different', '-1', 'standardize', '0', 'tie'],
      ['fitGap', 'same', '0', 'tie', '1', 'standardize'],
      ['fitGap', 'different', '0', 'tie', '1', 'experiment'],
    ]);
    expect(
      data.reversals.some((item) => item.axis === 'migrationFee' && item.board === 'different'),
    ).toBe(false);
  });

  it('基準行は初回の標準化と現場手順と一致し、動かした規則は一つである', () => {
    const data = compareStandardFactorReversals();
    const first = compareStandardProcedures(comparison.seed);
    expect(first.some((row) => row.strategy === 'hold')).toBe(true);
    const baselines = [
      data.sweeps.supportDiff.find((item) => item.parameter === '4'),
      data.sweeps.migrationFee.find((item) => item.parameter === '5'),
      data.sweeps.fitGap.find((item) => item.parameter === '3'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(point.sameAsFirstComparison).toBe(true);
      expect(point.rules).toEqual(baselineStandardRules);
      for (const board of point.boards) {
        for (const strategy of ['standardize', 'experiment'] as const) {
          const prior = first.find((row) => row.board === board.board && row.strategy === strategy);
          if (!prior) throw new Error(`${board.board}:${strategy}`);
          expect(board[strategy].inputs).toEqual(prior.inputs);
          expect(board[strategy].result).toEqual(prior.result);
        }
      }
    }
    const only = {
      supportDiff: 'supportDiff',
      migrationFee: 'migrationFee',
      fitGap: 'fitGap',
    } as const;
    for (const axis of Object.keys(only) as (keyof typeof only)[]) {
      for (const point of data.sweeps[axis]) {
        const changed = (Object.keys(point.rules) as (keyof typeof point.rules)[]).filter(
          (key) => point.rules[key] !== baselineStandardRules[key],
        );
        expect(changed.every((key) => key === only[axis])).toBe(true);
        expect(point.sameAsFirstComparison).toBe(changed.length === 0);
      }
    }
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        expect(board.standardize.inputs).toEqual([
          { type: 'act', action: 'migrate' },
          { type: 'act', action: 'support' },
          { type: 'act', action: 'support' },
        ]);
        expect(board.experiment.inputs).toEqual([
          { type: 'act', action: 'support' },
          { type: 'act', action: 'support' },
          { type: 'act', action: 'support' },
        ]);
        expect(board.standardize.result.lost).toBe(false);
        expect(board.experiment.result.lost).toBe(false);
        expect(board.margin).toBe(board.standardize.result.score - board.experiment.result.score);
      }
    }
    for (const point of data.sweeps.supportDiff) {
      for (const board of point.boards) {
        expect(board.standardize.result).toMatchObject({ support: 2, migration: 5, penalty: 5 });
        expect(board.experiment.result).toMatchObject({
          support: point.rules.supportDiff * 3,
          migration: 0,
          penalty: 0,
        });
      }
    }
    for (const point of data.sweeps.migrationFee) {
      const same = point.boards.find((board) => board.board === 'same');
      const different = point.boards.find((board) => board.board === 'different');
      expect(same?.experiment.result.score).toBe(15);
      expect(different?.experiment.result.score).toBe(24);
      expect(different?.preference).toBe('experiment');
      expect(same?.standardize.result.migration).toBe(point.rules.migrationFee);
      expect(different?.standardize.result.migration).toBe(point.rules.migrationFee);
    }
    const freeMove = data.sweeps.migrationFee.find((point) => point.parameter === '0');
    expect(freeMove?.boards.find((board) => board.board === 'different')).toMatchObject({
      preference: 'experiment',
      margin: -4,
    });
    for (const point of data.sweeps.fitGap) {
      const same = point.boards.find((board) => board.board === 'same');
      const different = point.boards.find((board) => board.board === 'different');
      expect(same?.margin).toBe(point.rules.fitGap * 3);
      expect(different?.margin).toBe(0 - point.rules.fitGap * 3);
      expect(same?.experiment.result.support).toBe(12);
      expect(same?.standardize.result.migration).toBe(5);
    }
  });

  it('要因比較の入力を再生すると差引が一致し、基準の作成は掃引で変わらない', () => {
    const data = compareStandardFactorReversals();
    const untouched = create('RI-227', 'same');
    const before = structuredClone(untouched);
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        for (const strategy of ['standardize', 'experiment'] as const) {
          const run = board[strategy];
          let live = create(data.conditions.seed, board.board, point.rules);
          let saved = structuredClone(live);
          for (const input of run.inputs) {
            const previous = live;
            const snapshot = structuredClone(live);
            expect(chooseStandardAction(previous, strategy)).toEqual(input);
            live = apply(live, input);
            saved = apply(JSON.parse(JSON.stringify(saved)), input);
            expect(previous).toEqual(snapshot);
            expect(saved).toEqual(live);
          }
          expect(summarizeStandardProcedure(live)).toEqual(run.result);
          expect(live.inputs).toEqual(run.inputs);
          expect(apply(live, { type: 'act', action: 'support' })).toBe(live);
        }
      }
    }
    expect(untouched).toEqual(before);
    expect(create('RI-227', 'same', baselineStandardRules)).toEqual(untouched);
    expect(viewStandardProcedure(untouched)).toMatchObject({
      migrationFee: 5,
      supportCost: 4,
      blockerIfIdle: 5,
      teams: [
        { id: 'alpha', fit: true, periodShip: 6 },
        { id: 'beta', work: 'batch', fit: false, periodShip: 3 },
      ],
    });
    const costly = create('RI-227', 'different', { supportDiff: 8, migrationFee: 5, fitGap: 3 });
    expect(viewStandardProcedure(costly)).toMatchObject({
      migrationFee: 5,
      supportCost: 8,
      teams: [{ periodShip: 6 }, { periodShip: 6 }],
    });
    const wide = create('RI-227', 'same', { supportDiff: 4, migrationFee: 5, fitGap: 6 });
    expect(wide.fitShip).toBe(9);
    expect(wide.missShip).toBe(3);
    expect(viewStandardProcedure(wide).teams.map((item) => item.periodShip)).toEqual([9, 3]);
    const inverted = create('RI-227', 'different', { supportDiff: 4, migrationFee: 5, fitGap: -1 });
    expect(inverted.fitShip).toBe(2);
    expect(viewStandardProcedure(inverted).teams.map((item) => item.periodShip)).toEqual([2, 2]);
    expect(untouched.fitShip).toBe(6);
  });
});
