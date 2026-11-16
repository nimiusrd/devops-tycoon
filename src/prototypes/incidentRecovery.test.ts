import { describe, expect, it } from 'vitest';
import {
  applyRecoveryInput,
  compareRecoveryFactorSweep,
  compareRecoveryStrategies,
  createRecoveryFactorState,
  createRecoveryPrototype,
  quoteRecovery,
  severeRecoveryFactors,
  summarizeRecovery,
  type RecoveryMethod,
  type RecoverySweepAxis,
} from './incidentRecovery';
import comparison from '../../docs/prototypes/incident-recovery-comparison.json';
import factorSweep from '../../docs/prototypes/incident-recovery-factor-sweep.json';

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
  it('重大障害の資源で要因を一つずつ動かし、軽い障害の比較は繰り返さない', () => {
    const sweep = compareRecoveryFactorSweep(factorSweep.conditions.seed);
    expect(sweep).toEqual(factorSweep);
    expect(sweep.conditions).toMatchObject({
      base: 'severe',
      repeatedLightComparison: false,
      strategies: ['fix', 'rollback', 'disable'],
      excludedStrategies: ['none'],
      shippedValue: 20,
      featureValue: 8,
      focus: 4,
      otherPerTick: 2,
      fixWork: 6,
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegration: false,
    });
    const light = compareRecoveryStrategies(sweep.conditions.seed).find((row) => !row.severe)!;
    const severeRows = compareRecoveryStrategies(sweep.conditions.seed).filter(
      (row) => row.severe && row.method !== 'none',
    );
    const axes: RecoverySweepAxis[] = [
      'horizon',
      'lossPerTick',
      'rollbackValue',
      'disableUpkeep',
      'workError',
    ];
    for (const point of sweep.points) {
      const changed = axes.filter((axis) => point.factors[axis] !== severeRecoveryFactors[axis]);
      expect(changed).toEqual(
        point.value === severeRecoveryFactors[point.axis] ? [] : [point.axis],
      );
      const initial = createRecoveryFactorState(sweep.conditions.seed, point.factors);
      expect(initial).toMatchObject({
        version: 1,
        focus: 4,
        shippedValue: 20,
        incident: { id: 'incident-1', fixWork: 6, featureValue: 8 },
      });
      expect(initial).not.toEqual(light.initial);
      if (changed.length === 0) expect(initial).toEqual(severeRows[0]!.initial);
      for (const method of ['fix', 'rollback', 'disable'] as const) {
        const result = point.results[method];
        expect(result.focusSpent).toBe(method === 'rollback' ? 2 : 1);
        expect(result.quotedWork).toBe(method === 'fix' ? 6 : method === 'rollback' ? 2 : 1);
        if (result.resolvedTick !== null) {
          const lost =
            method === 'rollback' ? point.factors.rollbackValue : method === 'disable' ? 8 : 0;
          expect(result.lostValue).toBe(lost);
          expect(result.shippedValue).toBe(20 - lost);
          expect(result.customerLoss).toBe(result.actualWork * point.factors.lossPerTick);
          expect(result.otherValue).toBe((point.factors.horizon - result.actualWork) * 2);
          expect(result.outstandingImpact).toBe(0);
          expect(result.maintenancePaid).toBe(
            method === 'disable'
              ? (point.factors.horizon - result.actualWork) * point.factors.disableUpkeep
              : 0,
          );
        } else {
          expect(result.lostValue).toBe(0);
          expect(result.trustCost).toBe(0);
          expect(result.shippedValue).toBe(20);
          expect(result.otherValue).toBe(0);
          expect(result.maintenancePaid).toBe(0);
          expect(result.customerLoss).toBe(point.factors.horizon * point.factors.lossPerTick);
        }
      }
    }
    const nets = (axis: RecoverySweepAxis) =>
      sweep.points
        .filter((point) => point.axis === axis)
        .map((point) => [
          point.value,
          point.results.fix.netValue,
          point.results.rollback.netValue,
          point.results.disable.netValue,
          point.leaders,
        ]);
    expect(nets('horizon')).toEqual([
      [2, -5, 5, 7, ['disable']],
      [3, -5, 7, 9, ['disable']],
      [4, -5, 9, 11, ['disable']],
      [5, -5, 11, 13, ['disable']],
      [6, -5, 13, 15, ['disable']],
      [8, -1, 17, 19, ['disable']],
    ]);
    expect(
      sweep.points
        .filter((point) => point.axis === 'horizon')
        .every((point) => point.results.disable.netValue - point.results.rollback.netValue === 2),
    ).toBe(true);
    expect(nets('lossPerTick')).toEqual([
      [0, 19, 15, 13, ['fix']],
      [1, 13, 13, 12, ['fix', 'rollback']],
      [2, 7, 11, 11, ['rollback', 'disable']],
      [3, 1, 9, 10, ['disable']],
      [4, -5, 7, 9, ['disable']],
    ]);
    expect(nets('rollbackValue')).toEqual([
      [0, -5, 11, 9, ['rollback']],
      [1, -5, 10, 9, ['rollback']],
      [2, -5, 9, 9, ['rollback', 'disable']],
      [3, -5, 8, 9, ['disable']],
      [4, -5, 7, 9, ['disable']],
    ]);
    expect(nets('disableUpkeep')).toEqual([
      [0, -5, 7, 9, ['disable']],
      [1, -5, 7, 7, ['rollback', 'disable']],
      [2, -5, 7, 5, ['rollback']],
      [3, -5, 7, 3, ['rollback']],
    ]);
    expect(nets('workError')).toEqual([
      [-1, -1, 13, 9, ['rollback']],
      [0, -5, 7, 9, ['disable']],
      [1, -9, 1, 3, ['disable']],
      [2, -13, 2, -3, ['rollback']],
    ]);
    const loss0 = sweep.points.find((point) => point.axis === 'lossPerTick' && point.value === 0)!;
    expect(loss0.leadersAmongResolved).toEqual(['rollback']);
    expect(loss0.results.fix.resolvedTick).toBeNull();
    const slow = sweep.points.find((point) => point.axis === 'workError' && point.value === 2)!;
    expect(slow.results.rollback).toMatchObject({
      resolvedTick: null,
      lostValue: 0,
      trustCost: 0,
      actualWork: 4,
      netValue: 2,
    });
    expect(slow.leadersAmongResolved).toEqual(['disable']);
    expect(slow.results.disable.resolvedTick).toBe(3);
    const fast = sweep.points.find((point) => point.axis === 'workError' && point.value === -1)!;
    expect(fast.results.rollback.resolvedTick).toBe(1);
    expect(fast.results.disable.actualWork).toBe(1);
    const control = sweep.points.find((point) => point.axis === 'horizon' && point.value === 3)!;
    for (const row of severeRows) {
      const method = row.method as RecoveryMethod;
      expect(control.inputs[method]).toEqual(row.inputs);
      expect(control.results[method].netValue).toBe(row.result.netValue);
    }
    expect(
      sweep.boundaries.map((row) => [
        row.axis,
        row.completedRollbackLeads,
        row.rollbackTies,
        row.unfinishedRollbackLeads,
      ]),
    ).toEqual([
      ['horizon', [], [], []],
      ['lossPerTick', [], [1, 2], []],
      ['rollbackValue', [0, 1], [2], []],
      ['disableUpkeep', [2, 3], [1], []],
      ['workError', [-1], [], [2]],
    ]);
  });
  it('見積誤差は選択前の見積を変えず、停止後の保守は完了後のtickだけ払う', () => {
    const initial = createRecoveryFactorState('RI-169', {
      ...severeRecoveryFactors,
      workError: -1,
      disableUpkeep: 2,
    });
    expect(quoteRecovery(initial.incident, 'disable')).toEqual({
      work: 1,
      focus: 1,
      lostValue: 8,
      trustCost: 2,
    });
    expect(quoteRecovery(initial.incident, 'rollback').work).toBe(2);
    const disable = applyRecoveryInput(initial, {
      type: 'recover',
      id: 'incident-1',
      method: 'disable',
    });
    expect(disable.incident.workLeft).toBe(1);
    expect(disable.focusSpent).toBe(1);
    const resolved = applyRecoveryInput(disable, { type: 'tick' });
    expect(resolved.incident.resolvedTick).toBe(1);
    expect(resolved.maintenancePaid).toBeUndefined();
    expect(resolved.otherValue).toBe(0);
    const maintained = applyRecoveryInput(resolved, { type: 'tick' });
    expect(maintained.maintenancePaid).toBe(2);
    expect(maintained.otherValue).toBe(2);
    expect(maintained.lostValue).toBe(8);
    const rollback = applyRecoveryInput(initial, {
      type: 'recover',
      id: 'incident-1',
      method: 'rollback',
    });
    expect(rollback.incident.workLeft).toBe(1);
    let finished = rollback;
    for (let i = 0; i < 3; i++) finished = applyRecoveryInput(finished, { type: 'tick' });
    expect(finished.maintenancePaid).toBeUndefined();
    expect(finished.lostValue).toBe(4);
    expect(summarizeRecovery(finished).netValue).toBe(
      finished.shippedValue +
        finished.otherValue -
        finished.focusSpent -
        finished.customerLoss -
        finished.trustCost,
    );
  });
  it('要因掃引の入力列を再生すると記録した差引と一致し、元の状態を変えない', () => {
    for (const point of compareRecoveryFactorSweep(factorSweep.conditions.seed).points) {
      for (const method of ['fix', 'rollback', 'disable'] as const) {
        const inputs = point.inputs[method];
        const beforeInputs = structuredClone(inputs);
        let live = createRecoveryFactorState(factorSweep.conditions.seed, point.factors);
        const snapshot = structuredClone(live);
        let saved = structuredClone(live);
        for (const input of inputs) {
          const previous = live;
          const before = structuredClone(live);
          live = applyRecoveryInput(live, input);
          saved = applyRecoveryInput(JSON.parse(JSON.stringify(saved)), input);
          expect(previous).toEqual(before);
          expect(saved).toEqual(live);
        }
        expect(inputs).toEqual(beforeInputs);
        expect(live.tick).toBe(point.factors.horizon);
        const summary = summarizeRecovery(live);
        expect(summary.netValue).toBe(point.results[method].netValue);
        expect(summary.resolvedTick).toBe(point.results[method].resolvedTick);
        expect(live.maintenancePaid ?? 0).toBe(point.results[method].maintenancePaid);
        expect(snapshot.tick).toBe(0);
        expect(snapshot.inputs).toEqual([]);
      }
    }
  });
});
