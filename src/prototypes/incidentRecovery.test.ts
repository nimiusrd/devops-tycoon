import { describe, expect, it } from 'vitest';
import {
  applyRecoveryInput,
  compareRecoveryStrategies,
  createRecoveryPrototype,
  quoteRecovery,
  summarizeRecovery,
  type RecoveryMethod,
} from './incidentRecovery';
import comparison from '../../docs/prototypes/incident-recovery-comparison.json';

describe('RI-169 復旧方法の三択', () => {
  it.each<RecoveryMethod>(['fix', 'rollback', 'disable'])(
    '%sの見積と完了後の代償が一致する',
    (method) => {
      const initial = createRecoveryPrototype('RI-169');
      const quote = quoteRecovery(initial.incident, method);
      let state = applyRecoveryInput(initial, { type: 'recover', id: 'incident-1', method });
      expect(state.focusSpent).toBe(quote.focus);
      expect(state.shippedValue).toBe(20);
      for (let i = 0; i < quote.work; i++) state = applyRecoveryInput(state, { type: 'tick' });
      expect(summarizeRecovery(state)).toMatchObject({
        resolvedTick: quote.work,
        recoveryWork: quote.work,
        shippedValue: 20 - quote.lostValue,
        lostValue: quote.lostValue,
        customerLoss: quote.work,
        trustCost: quote.trustCost,
        remainingWork: 0,
      });
      expect(applyRecoveryInput(state, { type: 'recover', id: 'incident-1', method })).toBe(state);
      expect(applyRecoveryInput(state, { type: 'tick' }).lostValue).toBe(quote.lostValue);
    },
  );
  it('未知対象・復旧中・資源不足・期末を無消費で拒否する', () => {
    const initial = createRecoveryPrototype('RI-169');
    const input = { type: 'recover', id: 'incident-1', method: 'rollback' } as const;
    expect(applyRecoveryInput(initial, { ...input, id: 'unknown' })).toBe(initial);
    const poor = { ...initial, focus: 1 };
    expect(applyRecoveryInput(poor, input)).toBe(poor);
    const recovering = applyRecoveryInput(initial, input);
    expect(applyRecoveryInput(recovering, { ...input, method: 'disable' })).toBe(recovering);
    const ended = { ...initial, tick: initial.horizon };
    expect(applyRecoveryInput(ended, input)).toBe(ended);
    expect(applyRecoveryInput(ended, { type: 'tick' })).toBe(ended);
  });
  it('期末に未復旧の作業と将来影響を残し、実損失とは区別する', () => {
    let state = createRecoveryPrototype('RI-169', true);
    state = applyRecoveryInput(state, { type: 'recover', id: 'incident-1', method: 'fix' });
    for (let i = 0; i < 3; i++) state = applyRecoveryInput(state, { type: 'tick' });
    expect(state.incident.status).toBe('recovering');
    expect(summarizeRecovery(state)).toMatchObject({
      customerLoss: 12,
      outstandingImpact: 12,
      remainingWork: 3,
      shippedValue: 20,
    });
  });
  it('軽い障害は修正、期限直前の重大障害は停止が有利になる', () => {
    const rows = compareRecoveryStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows.slice(0, 4).map((r) => r.result.netValue)).toEqual([29, 23, 22, 10]);
    expect(rows.slice(4).map((r) => r.result.netValue)).toEqual([-5, 7, 9, -16]);
  });
  it('同じ盤面と入力を毎入力JSON保存再開でき、元状態は変化しない', () => {
    for (const row of compareRecoveryStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const before = structuredClone(live);
        const previous = live;
        live = applyRecoveryInput(live, input);
        expect(previous).toEqual(before);
        saved = applyRecoveryInput(JSON.parse(JSON.stringify(saved)), input);
        expect(saved).toEqual(live);
      }
      expect(summarizeRecovery(live)).toEqual(row.result);
    }
  });
});
