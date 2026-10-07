import { describe, expect, it } from 'vitest';
import {
  createDepthPrototype,
  tickDepthPrototype,
  describeDepth,
  summarizeDepth,
  compareDepthStrategies,
} from './reviewDepth';
import comparison from '../../docs/prototypes/review-depth-comparison.json';
describe('RI-162 レビュー深度', () => {
  it('公開情報と実際の時間・体力・損失が一致し途中変更は拒否する', () => {
    expect(describeDepth('high', 'focused')).toEqual({ ticks: 3, staminaPerTick: 2, riskLoss: 0 });
    expect(describeDepth('high', 'normal')).toEqual({ ticks: 1, staminaPerTick: 1, riskLoss: 8 });
    expect(describeDepth('low', 'normal').riskLoss).toBe(1);
    const initial = createDepthPrototype(1, 'high');
    const snapshot = structuredClone(initial);
    let state = tickDepthPrototype(initial, 'focused');
    expect(state.board.jobs[0]).toMatchObject({ stage: 'review', reviewLeft: 2 });
    expect(state.stamina).toBe(28);
    expect(tickDepthPrototype(state, 'normal')).toBe(state);
    state = tickDepthPrototype(tickDepthPrototype(state, 'continue'), 'continue');
    expect(state.board.jobs[0]).toMatchObject({ stage: 'ci', reviewLeft: 0 });
    expect(state.stamina).toBe(24);
    state = tickDepthPrototype(state, 'normal');
    expect(summarizeDepth(state)).toMatchObject({ done: ['a'], expectedLoss: 0 });
    expect(initial).toEqual(snapshot);
  });
  it('資源不足・深度未選択・期末を無消費で拒否する', () => {
    const initial = createDepthPrototype(1, 'high');
    expect(tickDepthPrototype(initial, 'continue')).toBe(initial);
    const tired = { ...initial, stamina: 1 };
    expect(tickDepthPrototype(tired, 'focused')).toBe(tired);
    const ended = { ...initial, board: { ...initial.board, tick: initial.board.horizon } };
    expect(tickDepthPrototype(ended, 'normal')).toBe(ended);
  });
  it('低影響は通常、高影響は重点が有利になる同条件比較を再現する', () => {
    expect(compareDepthStrategies(comparison.seed)).toEqual(comparison.results);
    const [lowNormal, lowFocused, highNormal, highFocused] = comparison.results;
    expect(lowNormal.result.netValue).toBeGreaterThan(lowFocused.result.netValue);
    expect(highFocused.result.netValue).toBeGreaterThan(highNormal.result.netValue);
    expect(highFocused.result.stamina).toBeLessThan(highNormal.result.stamina);
    const [mixedNormal, mixedFocused, selective] = comparison.results.slice(4);
    expect(selective.result.netValue).toBeGreaterThan(mixedNormal.result.netValue);
    expect(selective.result.netValue).toBeGreaterThan(mixedFocused.result.netValue);
  });
  it('重点レビュー途中・CI待ちの保存再開と入力再生が一致する', () => {
    for (const row of comparison.results) {
      let live = createDepthPrototype(comparison.seed, row.impact as 'low' | 'high' | 'mixed');
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = tickDepthPrototype(live, input as 'normal' | 'focused' | 'continue');
        restored = tickDepthPrototype(
          JSON.parse(JSON.stringify(restored)),
          input as 'normal' | 'focused' | 'continue',
        );
      }
      expect(restored).toEqual(live);
      expect(summarizeDepth(live)).toEqual(row.result);
    }
  });
});
