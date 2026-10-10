import { describe, expect, it } from 'vitest';
import {
  applyAdoptionInput as apply,
  chooseAdoptionAction,
  chooseAdoptionTool,
  compareAdoptionStrategies,
  createAdoptionEval as create,
  summarizeAdoption,
  viewAdoptionEval,
} from './adoptionEval';
import comparison from '../../docs/prototypes/adoption-eval-comparison.json';

const cells = [
  ['swift', 'routine'],
  ['swift', 'migration'],
  ['swift', 'incident'],
  ['careful', 'routine'],
  ['careful', 'migration'],
  ['careful', 'incident'],
] as const;

function evaluateAll(mix: 'balanced' | 'routineHeavy', horizon: number) {
  let state = create(197, horizon, mix);
  for (const [tool, kind] of cells) {
    state = apply(state, { type: 'benchmark', tool, kind });
    state = apply(state, { type: 'tick' });
  }
  return state;
}

describe('RI-197 導入前の評価セット', () => {
  it('同じseedの評価は再現し、表示では未測定の手戻りを出さない', () => {
    const first = create(197, 8, 'balanced');
    expect(create(197, 8, 'balanced')).toEqual(first);
    expect(create(198, 8, 'balanced').generation).not.toBe(first.generation);
    const before = structuredClone(first);
    const seen = viewAdoptionEval(first);
    for (let i = 0; i < 10; i++) expect(viewAdoptionEval(first)).toEqual(seen);
    expect(first).toEqual(before);
    expect(seen.observations).toEqual([]);
    expect(seen.tools[0]!.jobs.map((job) => job.rework)).toEqual([null, null, null]);
    expect(seen.tools[0]!.jobs.map((job) => job.ticks)).toEqual([1, 1, 1]);
    expect(seen.production).toEqual(['migration', 'incident', 'routine']);
  });
  it('代表仕事の結果を種類別に残し、測定中は本番価値を出さない', () => {
    let state = apply(create(197, 20, 'balanced'), {
      type: 'benchmark',
      tool: 'swift',
      kind: 'migration',
    });
    expect(apply(state, { type: 'benchmark', tool: 'swift', kind: 'incident' })).toBe(state);
    state = apply(state, { type: 'tick' });
    expect(state.shippedValue).toBe(0);
    expect(state.observations).toEqual([
      { tool: 'swift', kind: 'migration', ticks: 1, rework: 14 },
    ]);
    expect(viewAdoptionEval(state).tools[0]!.jobs.map((job) => job.rework)).toEqual([
      null,
      14,
      null,
    ]);
    expect(apply(state, { type: 'benchmark', tool: 'swift', kind: 'migration' })).toBe(state);
    const done = evaluateAll('routineHeavy', 20);
    expect(done.observations).toHaveLength(6);
    expect(done.shippedValue).toBe(0);
    expect(done.observations.map((item) => item.rework)).toEqual([0, 14, 10, 0, 1, 1]);
    expect(chooseAdoptionTool(done, 'perKind')).toBe('swift');
    expect(chooseAdoptionTool(done, 'pooled')).toBe('careful');
    expect(chooseAdoptionTool(evaluateAll('balanced', 20), 'perKind')).toBe('careful');
    expect(chooseAdoptionTool(evaluateAll('balanced', 8), 'perKind')).toBe('swift');
  });
  it('採用後の再測定、二重採用、判断前のtick、期末は無消費で拒否する', () => {
    const initial = create(197, 8, 'balanced');
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    expect(apply(initial, { type: 'start' })).toBe(initial);
    const adopted = apply(initial, { type: 'adopt', tool: 'swift' });
    expect(apply(adopted, { type: 'adopt', tool: 'careful' })).toBe(adopted);
    expect(apply(adopted, { type: 'benchmark', tool: 'swift', kind: 'routine' })).toBe(adopted);
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'adopt', tool: 'swift' })).toBe(ended);
  });
  it('短期は見切りの速さが有利で、長期の定型偏重では種類別評価が合算評価を上回る', () => {
    const rows = compareAdoptionStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (mix: string, horizon: number, strategy: string) =>
      rows.find((row) => row.mix === mix && row.horizon === horizon && row.strategy === strategy)!
        .result.netValue;
    expect([
      net('balanced', 8, 'swift'),
      net('balanced', 8, 'careful'),
      net('balanced', 8, 'perKind'),
    ]).toEqual([5, 2, -20]);
    expect([
      net('balanced', 20, 'swift'),
      net('balanced', 20, 'careful'),
      net('balanced', 20, 'perKind'),
    ]).toEqual([17, 33, 27]);
    expect(net('routineHeavy', 8, 'swift')).toBe(36);
    expect([
      net('routineHeavy', 20, 'swift'),
      net('routineHeavy', 20, 'perKind'),
      net('routineHeavy', 20, 'careful'),
      net('routineHeavy', 20, 'pooled'),
    ]).toEqual([48, 42, 40, 34]);
    expect(
      rows.find(
        (row) => row.mix === 'routineHeavy' && row.horizon === 20 && row.strategy === 'pooled',
      )!.result.adopted,
    ).toBe('careful');
    expect(
      rows.find(
        (row) => row.mix === 'routineHeavy' && row.horizon === 20 && row.strategy === 'perKind',
      )!.result.adopted,
    ).toBe('swift');
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、評価と本番の価値を混ぜない', () => {
    for (const row of compareAdoptionStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseAdoptionAction(previous, row.strategy)).toEqual(input);
        const shippedBefore = live.shippedValue;
        live = apply(live, input);
        if (input.type === 'benchmark' || (input.type === 'tick' && previous.benchmark)) {
          expect(live.shippedValue).toBe(shippedBefore);
        }
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeAdoption(live)).toEqual(row.result);
      if (row.strategy === 'perKind' || row.strategy === 'pooled')
        expect(live.observations).toHaveLength(6);
    }
  });
});
