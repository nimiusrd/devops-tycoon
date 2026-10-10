import { describe, expect, it } from 'vitest';
import {
  applyVerificationInput as apply,
  chooseVerificationAction,
  compareVerificationStrategies,
  createVerificationPrototype as create,
  summarizeVerification,
  viewVerification,
} from './independentVerification';
import comparison from '../../docs/prototypes/independent-verification-comparison.json';

describe('RI-194 実装と検証の独立性', () => {
  it('同じ手法は1tickで共通見落としを残し、別手法は3tickでそれだけを見つける', () => {
    const same = apply(create('RI-194', 'high'), { type: 'verify', method: 'script' });
    expect(viewVerification(same).methods).toEqual({
      script: { ticks: 1, catches: 'none' },
      walkthrough: { ticks: 3, catches: 'assumption' },
    });
    let state = same;
    for (let count = 0; count < 4; count += 1) state = apply(state, { type: 'tick' });
    expect(state.implLeft).toBe(0);
    expect(state.verifyLeft).toBe(0);
    expect(state.shipped).toBe(-2);
    expect(state.caughtShared).toBe(false);
    expect(state.resolutions[3]).toBe('t4,verify:script,missed:assumption,ship:-2');
    const other = apply(create('RI-194', 'other'), { type: 'verify', method: 'walkthrough' });
    let walked = other;
    for (let count = 0; count < 6; count += 1) walked = apply(walked, { type: 'tick' });
    expect(walked.caughtShared).toBe(true);
    expect(walked.shipped).toBe(7);
    expect(walked.resolutions[5]).toBe(
      't6,verify:walkthrough,caught:assumption,missed:load,ship:7',
    );
  });

  it('未知の手法、同じ手法の再設定、着手後の変更、手法なしの進行を拒否する', () => {
    const initial = create('RI-194', 'low');
    expect(apply(initial, { type: 'verify', method: 'llm' })).toBe(initial);
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    const chosen = apply(initial, { type: 'verify', method: 'script' });
    expect(apply(chosen, { type: 'verify', method: 'script' })).toBe(chosen);
    const switched = apply(chosen, { type: 'verify', method: 'walkthrough' });
    expect(switched.verifyLeft).toBe(3);
    const started = apply(switched, { type: 'tick' });
    expect(apply(started, { type: 'verify', method: 'script' })).toBe(started);
  });

  it('閲覧では検証も実装も進まず、期末は無消費で拒否する', () => {
    const initial = create('RI-194', 'low');
    const before = structuredClone(initial);
    for (let count = 0; count < 30; count += 1) viewVerification(initial);
    expect(initial).toEqual(before);
    expect(viewVerification(initial).ignoredRisk).toBe('load');
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'verify', method: 'script' })).toBe(ended);
  });

  it('低影響の短い期末は同じ手法、高影響は別手法が有利で、負荷リスクは残る', () => {
    const rows = compareVerificationStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect([net('low', 'same'), net('low', 'independent')]).toEqual([8, 0]);
    expect([net('high', 'independent'), net('high', 'same')]).toEqual([12, -2]);
    expect([net('other', 'independent'), net('other', 'same')]).toEqual([7, -7]);
    const clean = rows.find((row) => row.scenario === 'high' && row.strategy === 'independent')!;
    expect(clean.result.caughtShared).toBe(true);
    const partial = rows.find((row) => row.scenario === 'other' && row.strategy === 'independent')!;
    expect(partial.result.resolutions.some((line) => line.includes('missed:load'))).toBe(true);
    expect(partial.result.resolutions.some((line) => line.includes('caught:assumption'))).toBe(
      true,
    );
    const rushed = rows.find((row) => row.scenario === 'low' && row.strategy === 'independent')!;
    expect(rushed.result.shipped).toBeNull();
  });

  it('全入力の再生と毎入力JSON保存再開が一致する', () => {
    for (const row of compareVerificationStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(chooseVerificationAction(previous, row.strategy)).toEqual(input);
      }
      expect(summarizeVerification(live)).toEqual(row.result);
      const again = row.inputs.reduce((state, input) => apply(state, input), row.initial);
      expect(again).toEqual(live);
    }
  });
});
