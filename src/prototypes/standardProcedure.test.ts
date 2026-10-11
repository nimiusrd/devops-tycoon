import { describe, expect, it } from 'vitest';
import {
  applyStandardAction,
  applyStandardProcedure as apply,
  chooseStandardAction,
  compareStandardProcedures,
  createStandardProcedure as create,
  summarizeStandardProcedure,
  viewStandardProcedure,
} from './standardProcedure';
import comparison from '../../docs/prototypes/standard-procedure-comparison.json';

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
