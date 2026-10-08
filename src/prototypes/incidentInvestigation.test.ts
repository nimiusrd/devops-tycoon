import { describe, expect, it } from 'vitest';
import {
  applyInvestigationInput as apply,
  compareInvestigationStrategies,
  createInvestigationPrototype as create,
  summarizeInvestigation,
  viewInvestigation,
} from './incidentInvestigation';
import comparison from '../../docs/prototypes/incident-investigation-comparison.json';

describe('RI-172 原因調査', () => {
  it('同じ症状の2原因をseedで固定し、表示では未知原因を公開しない', () => {
    const a = create(0);
    const b = create(1);
    expect(a.cause).toBe('configuration');
    expect(b.cause).toBe('code');
    expect(create(1)).toEqual(b);
    const before = structuredClone(b);
    expect(viewInvestigation(a)).toEqual(viewInvestigation(b));
    for (let i = 0; i < 10; i++) expect(viewInvestigation(b).knownCause).toBeNull();
    expect(b).toEqual(before);
  });
  it('調査2tickの間も損失が進み、完了後に原因と見積が分かる', () => {
    let state = apply(create(1), { type: 'investigate' });
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({ knownCause: null, customerLoss: 4, workLeft: 1 });
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({
      knownCause: 'code',
      customerLoss: 8,
      phase: 'active',
      focusSpent: 1,
    });
    expect(viewInvestigation(state).methods.map((m) => m.workRange)).toEqual([
      [6, 6],
      [1, 1],
      [1, 1],
    ]);
    expect(apply(state, { type: 'investigate' })).toBe(state);
  });
  it('未調査でも全手段を選べ、間違った修正は時間を払い、巻き戻し損失は一度だけ', () => {
    const initial = create(1);
    expect(apply(initial, { type: 'recover', method: 'configuration' }).workLeft).toBe(6);
    expect(apply(initial, { type: 'recover', method: 'code' }).workLeft).toBe(1);
    let state = apply(initial, { type: 'recover', method: 'rollback' });
    expect(state.shippedValue).toBe(20);
    state = apply(state, { type: 'tick' });
    expect(state).toMatchObject({ shippedValue: 6, lostValue: 14, customerLoss: 4 });
    expect(apply(state, { type: 'recover', method: 'rollback' })).toBe(state);
    expect(apply(state, { type: 'tick' }).lostValue).toBe(14);
  });
  it('多重操作・資源不足・期末は無消費で拒否し、未復旧を保持する', () => {
    const busy = apply(create(1), { type: 'investigate' });
    expect(apply(busy, { type: 'recover', method: 'code' })).toBe(busy);
    const poor = { ...create(1), focus: 0 };
    expect(apply(poor, { type: 'investigate' })).toBe(poor);
    expect(apply(poor, { type: 'recover', method: 'code' })).toBe(poor);
    const ended = { ...busy, tick: busy.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'investigate' })).toBe(ended);
    expect(summarizeInvestigation(ended).outstandingImpact).toBeGreaterThan(0);
  });
  it('原因を知らない同一方針は短期で巻き戻し、長期で調査が有利になる', () => {
    const rows = compareInvestigationStrategies();
    expect(rows).toEqual(comparison.results);
    const mean = (horizon: number, strategy: string) =>
      rows
        .filter((r) => r.horizon === horizon && r.strategy === strategy)
        .reduce((sum, r) => sum + r.result.netValue, 0) / 2;
    expect(mean(2, 'rollback')).toBe(3);
    expect(mean(2, 'investigate')).toBe(-3);
    expect(mean(2, 'configuration')).toBe(1);
    expect(mean(8, 'investigate')).toBe(16);
    expect(mean(8, 'rollback')).toBe(15);
    expect(mean(8, 'configuration')).toBe(14);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareInvestigationStrategies()) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeInvestigation(live)).toEqual(row.result);
    }
  });
});
