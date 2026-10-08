import { describe, expect, it } from 'vitest';
import {
  createDebtPrototype,
  tickDebtPrototype,
  summarizeDebt,
  compareDebtStrategies,
} from './domainDebt';
import comparison from '../../docs/prototypes/domain-debt-comparison.json';

describe('RI-163 領域別負債', () => {
  it('返済は指定領域だけに作用し、2工数を払い一度だけ選べる', () => {
    const initial = createDebtPrototype(1, 'payment');
    const snapshot = structuredClone(initial);
    const repaired = tickDebtPrototype(initial, 'auth');
    expect(repaired.debt).toEqual({ payment: 4, auth: 0 });
    expect(repaired.tick).toBe(2);
    expect(tickDebtPrototype(repaired, 'payment')).toBe(repaired);
    const working = tickDebtPrototype(repaired, 'work');
    expect(working.jobs[0].remaining).toBe(3);
    expect(initial).toEqual(snapshot);
  });
  it('完了した仕事の発生先を記録し、会社負債は常に領域別合計になる', () => {
    let state = tickDebtPrototype(createDebtPrototype(1, 'payment'), 'payment');
    state = tickDebtPrototype(tickDebtPrototype(state, 'work'), 'work');
    expect(state.ledger).toEqual([{ jobId: 'job-0', domain: 'payment', added: 1 }]);
    expect(state.debt).toEqual({ payment: 1, auth: 4 });
    expect(summarizeDebt(state).techDebt).toBe(5);
    expect(tickDebtPrototype(state, 'work').jobs[1].remaining).toBe(2);
  });
  it('需要を反転すると有力な返済先も反転し、低需要への投資には機会費用がある', () => {
    expect(compareDebtStrategies(comparison.seed)).toEqual(comparison.results);
    for (const demand of ['payment', 'auth']) {
      const rows = comparison.results.filter((row) => row.demand === demand);
      const best = rows.find((row) => row.choice === demand)!;
      const others = rows.filter((row) => row.choice !== demand);
      for (const other of others) expect(best.result.value).toBeGreaterThan(other.result.value);
      expect(best.result.repairEffort).toBe(2);
    }
  });
  it('選択前・資源不足・期末・全件完了を無消費で拒否する', () => {
    const initial = createDebtPrototype(1, 'payment');
    expect(tickDebtPrototype(initial, 'work')).toBe(initial);
    const short = { ...initial, horizon: 1 };
    expect(tickDebtPrototype(short, 'payment')).toBe(short);
    const ended = { ...initial, tick: initial.horizon };
    expect(tickDebtPrototype(ended, 'skip')).toBe(ended);
    const done = { ...initial, jobs: initial.jobs.map((job) => ({ ...job, done: true })) };
    expect(tickDebtPrototype(done, 'payment')).toBe(done);
  });
  it('返済後・仕事途中の保存再開と入力再生が一致する', () => {
    for (const row of compareDebtStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = tickDebtPrototype(live, input);
        restored = tickDebtPrototype(JSON.parse(JSON.stringify(restored)), input);
        expect(summarizeDebt(live).techDebt).toBe(live.debt.payment + live.debt.auth);
        expect(restored).toEqual(live);
      }
      expect(summarizeDebt(live)).toEqual(row.result);
    }
  });
});
