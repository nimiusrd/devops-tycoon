import { describe, expect, it } from 'vitest';
import {
  applyUncertaintyInput as apply,
  chooseUncertaintyAction,
  compareUncertaintyPolicies,
  createUncertaintyPrototype as create,
  summarizeUncertainty,
  viewUncertainty,
} from './uncertaintyCheck';
import comparison from '../../docs/prototypes/uncertainty-check-comparison.json';

describe('RI-196 不確実な出力の確認', () => {
  it('兆候は確認対象だけで、同じseedの表示を繰り返しても実リスクを出さない', () => {
    const first = create(196, 5, 'thick');
    expect(create(196, 5, 'thick')).toEqual(first);
    expect(create(197, 5, 'thick').generation).not.toBe(first.generation);
    const before = structuredClone(first);
    const seen = viewUncertainty(first);
    for (let i = 0; i < 10; i++) expect(viewUncertainty(first)).toEqual(seen);
    expect(first).toEqual(before);
    expect(JSON.stringify(seen)).not.toContain('actualRisk');
    expect(seen.tasks.map((task) => [task.id, task.signal, task.riskReduced])).toEqual([
      ['alarm', 'uncertain', null],
      ['flagged', 'uncertain', null],
      ['miss', 'clear', null],
    ]);
    expect(viewUncertainty(create(197, 10, 'thin')).tasks).toEqual(seen.tasks);
    expect(first.tasks.find((task) => task.id === 'miss')!.actualRisk).toBe(4);
    expect(first.tasks.find((task) => task.id === 'alarm')!.actualRisk).toBe(0);
  });
  it('誤警報は時間だけを記録し、見落としは未確認出荷のあとでリスクが残る', () => {
    let alarm = apply(create(196, 8, 'thick'), { type: 'check', id: 'alarm' });
    alarm = apply(alarm, { type: 'tick' });
    expect(alarm.tasks[0]).toMatchObject({
      checkTicksSpent: 1,
      riskReduced: 0,
      shipped: false,
    });
    expect(summarizeUncertainty(alarm).shippedValue).toBe(0);
    const partial = apply(apply(create(196, 8, 'thin'), { type: 'check', id: 'flagged' }), {
      type: 'tick',
    });
    expect(partial.tasks[1]).toMatchObject({ checkTicksSpent: 1, riskReduced: null });
    let missed = apply(create(196, 8, 'thick'), { type: 'ship', id: 'miss' });
    expect(viewUncertainty(missed).tasks[2]!.riskReduced).toBeNull();
    missed = apply(missed, { type: 'tick' });
    expect(summarizeUncertainty(missed).tasks[2]).toMatchObject({
      shipped: true,
      realizedRisk: 4,
      riskReduced: null,
      checkTicksSpent: 0,
    });
    let checked = apply(create(196, 8, 'thick'), { type: 'check', id: 'miss' });
    checked = apply(apply(checked, { type: 'tick' }), { type: 'ship', id: 'miss' });
    checked = apply(checked, { type: 'tick' });
    expect(summarizeUncertainty(checked).tasks[2]).toMatchObject({
      shipped: true,
      realizedRisk: 0,
      riskReduced: 4,
      checkTicksSpent: 1,
    });
  });
  it('作業中・確認済み・存在しない対象・期末は無消費で拒否する', () => {
    const initial = create(196, 5, 'thin');
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    expect(apply(initial, { type: 'check', id: 'missing' })).toBe(initial);
    const busy = apply(initial, { type: 'check', id: 'alarm' });
    expect(apply(busy, { type: 'ship', id: 'flagged' })).toBe(busy);
    expect(apply(busy, { type: 'check', id: 'flagged' })).toBe(busy);
    let done = apply(apply(create(196, 5, 'thick'), { type: 'check', id: 'alarm' }), {
      type: 'tick',
    });
    expect(apply(done, { type: 'check', id: 'alarm' })).toBe(done);
    done = apply(apply(done, { type: 'ship', id: 'alarm' }), { type: 'tick' });
    expect(apply(done, { type: 'ship', id: 'alarm' })).toBe(done);
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'ship', id: 'alarm' })).toBe(ended);
  });
  it('検証が薄く期末が短いときは未確認出荷、厚い検証の長い期末は全件確認が有利', () => {
    const rows = compareUncertaintyPolicies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (verifier: string, horizon: number, policy: string) =>
      rows.find(
        (row) => row.verifier === verifier && row.horizon === horizon && row.policy === policy,
      )!.result.netValue;
    expect([net('thin', 5, 'ship'), net('thin', 5, 'flagged'), net('thin', 5, 'all')]).toEqual([
      20, -9, -9,
    ]);
    expect([net('thin', 10, 'ship'), net('thin', 10, 'flagged'), net('thin', 10, 'all')]).toEqual([
      20, 26, 4,
    ]);
    expect([net('thick', 5, 'ship'), net('thick', 5, 'flagged'), net('thick', 5, 'all')]).toEqual([
      20, 26, 17,
    ]);
    expect([
      net('thick', 10, 'ship'),
      net('thick', 10, 'flagged'),
      net('thick', 10, 'all'),
    ]).toEqual([20, 26, 30]);
    const thickShort = rows.find(
      (row) => row.verifier === 'thick' && row.horizon === 5 && row.policy === 'flagged',
    )!;
    expect(thickShort.result.tasks.find((task) => task.id === 'alarm')).toMatchObject({
      falseAlarm: true,
      realizedRisk: 0,
    });
    expect(thickShort.result.tasks.find((task) => task.id === 'miss')).toMatchObject({
      missedSignal: true,
      realizedRisk: 4,
      checkTicksSpent: 0,
    });
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、方針は兆候だけを見る', () => {
    for (const row of compareUncertaintyPolicies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseUncertaintyAction(previous, row.policy)).toEqual(input);
        if (input.type === 'check' && row.policy === 'flagged') {
          expect(previous.tasks.find((task) => task.id === input.id)!.signal).toBe('uncertain');
        }
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeUncertainty(live)).toEqual(row.result);
    }
  });
});
