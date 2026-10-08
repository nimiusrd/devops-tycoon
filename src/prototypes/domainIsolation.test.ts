import { describe, expect, it } from 'vitest';
import {
  applyIsolationInput,
  compareIsolationStrategies,
  createIsolationPrototype,
  summarizeIsolation,
} from './domainIsolation';
import comparison from '../../docs/prototypes/domain-isolation-comparison.json';

describe('RI-171 領域隔離', () => {
  it('隔離対象のCoding/Reviewと新規流入を止め、対象外を進める', () => {
    const initial = createIsolationPrototype('RI-171', true);
    for (const stage of ['coding', 'review'] as const) {
      initial.tasks[0].stage = stage;
      const isolated = applyIsolationInput(initial, { type: 'isolate', domain: 'product' });
      expect(applyIsolationInput(isolated, { type: 'admit', id: 'product-reserve' })).toBe(
        isolated,
      );
      let state = applyIsolationInput(isolated, { type: 'admit', id: 'platform-reserve' });
      state = applyIsolationInput(state, { type: 'tick' });
      expect(state.tasks[0].workLeft).toBe(2);
      expect(state.tasks[2].workLeft).toBe(1);
      expect(summarizeIsolation(state)).toMatchObject({
        spreadTicks: 0,
        customerLoss: 4,
        pausedValue: 8,
        blockedCapacity: { product: 1, platform: 0 },
        remainingWork: 6,
      });
    }
  });
  it('隔離しなければ延焼が対象外を止めるが、元の事故は隔離後も残る', () => {
    let state = applyIsolationInput(createIsolationPrototype('RI-171', true), { type: 'tick' });
    expect(state).toMatchObject({
      customerLoss: 5,
      spreadTicks: 1,
      blockedCapacity: { product: 1, platform: 1 },
    });
    state = applyIsolationInput(state, { type: 'isolate', domain: 'product' });
    state = applyIsolationInput(state, { type: 'tick' });
    expect(state).toMatchObject({ customerLoss: 9, spreadTicks: 1 });
    expect(state.incident.status).toBe('active');
  });
  it('復旧前の解除と連打を拒否し、復旧後は費用を払って同じ仕事を再開する', () => {
    let state = applyIsolationInput(createIsolationPrototype('RI-171'), {
      type: 'isolate',
      domain: 'product',
    });
    const release = { type: 'release', domain: 'product' } as const;
    expect(applyIsolationInput(state, release)).toBe(state);
    expect(applyIsolationInput(state, { type: 'isolate', domain: 'product' })).toBe(state);
    state = applyIsolationInput(state, { type: 'repair' });
    expect(applyIsolationInput(state, { type: 'repair' })).toBe(state);
    for (let i = 0; i < 2; i++) state = applyIsolationInput(state, { type: 'tick' });
    expect(state.incident.status).toBe('resolved');
    expect(state.tasks[0].workLeft).toBe(2);
    state = applyIsolationInput(state, release);
    expect(state.focusSpent).toBe(4);
    expect(applyIsolationInput(state, release)).toBe(state);
    expect(applyIsolationInput(state, { type: 'isolate', domain: 'product' })).toBe(state);
    state = applyIsolationInput(state, { type: 'tick' });
    expect(state.tasks[0].workLeft).toBe(1);
    expect(state.customerLoss).toBe(2);
  });
  it('対象外隔離・未知流入・資源不足・期末を無消費で拒否する', () => {
    const initial = createIsolationPrototype('RI-171');
    expect(applyIsolationInput(initial, { type: 'isolate', domain: 'platform' })).toBe(initial);
    expect(applyIsolationInput(initial, { type: 'admit', id: 'unknown' })).toBe(initial);
    expect(applyIsolationInput(initial, { type: 'admit', id: 'product-job' })).toBe(initial);
    const poor = { ...initial, focus: 0 };
    expect(applyIsolationInput(poor, { type: 'isolate', domain: 'product' })).toBe(poor);
    expect(applyIsolationInput(poor, { type: 'repair' })).toBe(poor);
    const ended = { ...initial, tick: initial.horizon };
    expect(applyIsolationInput(ended, { type: 'tick' })).toBe(ended);
  });
  it('短い障害では隔離を避け、長い障害では対象外を救う方が有利になる', () => {
    const rows = compareIsolationStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows.map((r) => r.result.netValue)).toEqual([31, 30, -11, 0]);
    expect(rows[2].result.remaining).toHaveLength(2);
    expect(rows[3].result.remaining).toHaveLength(1);
    expect(rows[3].result.blockedCapacity).toEqual({ product: 6, platform: 0 });
  });
  it('全比較を毎入力JSON保存再開・再生でき、元状態を変えない', () => {
    for (const row of compareIsolationStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(previous);
        live = applyIsolationInput(live, input);
        expect(previous).toEqual(before);
        saved = applyIsolationInput(JSON.parse(JSON.stringify(saved)), input);
        expect(saved).toEqual(live);
      }
      expect(summarizeIsolation(live)).toEqual(row.result);
    }
  });
});
