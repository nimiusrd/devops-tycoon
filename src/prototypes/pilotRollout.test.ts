import { describe, expect, it } from 'vitest';
import {
  applyPilotRollout as apply,
  applyPilotScope,
  choosePilotAction,
  comparePilotRollouts,
  createPilotRollout as create,
  summarizePilotRollout,
  viewPilotRollout,
} from './pilotRollout';
import comparison from '../../docs/prototypes/pilot-rollout-comparison.json';

describe('RI-226 パイロット導入', () => {
  it('試験対象と未導入、展開費用、試験を飛ばした事故を操作前に示す', () => {
    const first = create('RI-226', 'spike');
    expect(create('RI-226', 'spike')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewPilotRollout(first);
    for (let i = 0; i < 8; i++) expect(viewPilotRollout(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      tick: 0,
      adopted: [],
      waiting: ['pilot', 'north', 'south'],
      incidentIfSkipTrial: 20,
      feeIfExpand: 0,
    });
  });

  it('試験中は他チームへ漏れず、展開後も効果は二重にならない', () => {
    const fresh = create('RI-226', 'good');
    expect(applyPilotScope(fresh, 'company')).toBe(fresh);
    const trial = apply(fresh, { type: 'scope', scope: 'pilot' });
    expect(trial.periodShip).toEqual({ pilot: 9, north: 5, south: 5 });
    expect(trial.observations).toEqual([
      { tick: 0, pilotShip: 9, otherShip: 10, delta: 4, kind: 'observed' },
    ]);
    expect(viewPilotRollout(trial)).toMatchObject({
      adopted: ['pilot'],
      waiting: ['north', 'south'],
      incidentIfSkipTrial: 0,
      feeIfExpand: 2,
    });
    const rolled = apply(trial, { type: 'scope', scope: 'all' });
    expect(rolled.periodShip).toEqual({ pilot: 9, north: 9, south: 9 });
    expect(rolled.feePaid).toBe(2);
    expect(rolled.incident).toBe(0);
    const again = apply(rolled, { type: 'scope', scope: 'all' });
    expect(again.feePaid).toBe(2);
    expect(again.periodShip.pilot).toBe(9);
    const skipped = apply(fresh, { type: 'scope', scope: 'all' });
    expect(skipped.incident).toBe(0);
    const spiked = apply(create('RI-226', 'spike'), { type: 'scope', scope: 'all' });
    expect(spiked.incident).toBe(20);
    expect(apply(spiked, { type: 'scope', scope: 'all' }).incident).toBe(20);
    expect(apply(again, { type: 'view' })).toBe(again);
  });

  it('良い効果は即全社、悪い効果は中止、一斉事故は試験後の展開が上回る', () => {
    const rows = comparePilotRollouts(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('good', 'now'), score('good', 'expand'), score('good', 'stop')]).toEqual([
      81, 71, 49,
    ]);
    expect([score('harm', 'stop'), score('harm', 'expand'), score('harm', 'now')]).toEqual([
      42, 22, 18,
    ]);
    expect([score('spike', 'expand'), score('spike', 'now'), score('spike', 'stop')]).toEqual([
      71, 61, 49,
    ]);
    const expanded = rows.find((row) => row.board === 'good' && row.strategy === 'expand')!;
    expect(expanded.result.observed).toBe(4);
    expect(expanded.result.score).not.toBe(expanded.result.observed);
    for (const row of rows) expect(row.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of comparePilotRollouts(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(choosePilotAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizePilotRollout(live)).toEqual(row.result);
    }
  });
});
