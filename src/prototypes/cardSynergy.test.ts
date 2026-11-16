import { describe, expect, it } from 'vitest';
import {
  applySynergyInput as apply,
  compareSynergyStrategies,
  createSynergyPrototype as create,
  summarizeSynergy,
  synergyComparison,
  synergyEstablished,
  synergyStatusText,
  SYNERGY_RULE,
  SYNERGY_STATUS_TEXT,
  viewSynergy,
} from './cardSynergy';
import comparison from '../../docs/prototypes/card-synergy-comparison.json';

describe('RI-184 条件付き相乗効果', () => {
  it('所持だけでは自動処理が始まらず、閲覧は状態を変えない', () => {
    const state = create(1, 'routine');
    expect(create(1, 'routine')).toEqual(state);
    const before = structuredClone(state);
    expect(synergyEstablished(state)).toBe(false);
    expect(viewSynergy(state)).toMatchObject({
      owned: { test: true, ai: true },
      active: { test: false, ai: false },
      established: false,
      manualRoutine: 1,
      autoRoutine: 0,
      statusText: SYNERGY_STATUS_TEXT.unmet,
    });
    expect(state).toEqual(before);
  });
  it('片方の発動は係数だけを足し、両方で自動処理が1件だけ別枠になる', () => {
    const testOnly = apply(create(1, 'routine'), { type: 'activate', id: 'test' });
    expect(viewSynergy(testOnly)).toMatchObject({ manualRoutine: 2, autoRoutine: 0 });
    expect(apply(testOnly, { type: 'tick' })).toMatchObject({ routineCleared: 2, autoCleared: 0 });
    const both = apply(apply(create(1, 'routine'), { type: 'activate', id: 'test' }), {
      type: 'activate',
      id: 'ai',
    });
    expect(viewSynergy(both)).toMatchObject({ manualRoutine: 3, autoRoutine: 1 });
    expect(apply(both, { type: 'tick' })).toMatchObject({ routineCleared: 4, autoCleared: 1 });
    const reversed = apply(apply(create(1, 'routine'), { type: 'activate', id: 'ai' }), {
      type: 'activate',
      id: 'test',
    });
    expect(apply(reversed, { type: 'tick' })).toMatchObject({ routineCleared: 4, autoCleared: 1 });
  });
  it('同じカードの再発動と集中力不足、期末の操作は無消費で拒否する', () => {
    const once = apply(create(1, 'routine'), { type: 'activate', id: 'test' });
    expect(apply(once, { type: 'activate', id: 'test' })).toBe(once);
    const poor = { ...create(1, 'routine'), focus: 0 };
    expect(apply(poor, { type: 'activate', id: 'ai' })).toBe(poor);
    const ended = { ...create(1, 'routine'), tick: 6 };
    expect(apply(ended, { type: 'activate', id: 'test' })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
  });
  it('未成立・成立・発動中で表示文が変わり、通常状態は変えない', () => {
    const unmet = create(1, 'complex');
    const before = structuredClone(unmet);
    expect(synergyStatusText(unmet)).toBe(SYNERGY_STATUS_TEXT.unmet);
    const one = apply(unmet, { type: 'activate', id: 'ai' });
    expect(synergyStatusText(one)).toBe(SYNERGY_STATUS_TEXT.unmet);
    const complexBoth = apply(one, { type: 'activate', id: 'test' });
    const incidentBoth = apply(apply(create(1, 'incident'), { type: 'activate', id: 'test' }), {
      type: 'activate',
      id: 'ai',
    });
    const routineBoth = apply(apply(create(1, 'routine'), { type: 'activate', id: 'test' }), {
      type: 'activate',
      id: 'ai',
    });
    expect(synergyStatusText(complexBoth)).toBe(SYNERGY_STATUS_TEXT.ready);
    expect(synergyStatusText(incidentBoth)).toBe(SYNERGY_STATUS_TEXT.ready);
    expect(synergyStatusText(routineBoth)).toBe(SYNERGY_STATUS_TEXT.active);
    expect(viewSynergy(routineBoth).statusText).toBe(synergyStatusText(routineBoth));
    expect(
      new Set([
        synergyStatusText(unmet),
        synergyStatusText(complexBoth),
        synergyStatusText(routineBoth),
      ]).size,
    ).toBe(3);
    expect(unmet).toEqual(before);
    expect(SYNERGY_RULE.requiredCards).toEqual(['test', 'ai']);
    expect(SYNERGY_RULE.costPerCard).toBe(1);
    expect(SYNERGY_RULE.costPerCard * SYNERGY_RULE.requiredCards.length).toBe(2);
    expect(SYNERGY_RULE.autoAddsToCoefficient).toBe(false);
  });
  it('定型と複雑は両方が上回り、障害は無発動が上回り、組合せは固定必須にならない', () => {
    const report = synergyComparison();
    expect(report).toEqual(comparison);
    expect(compareSynergyStrategies()).toEqual(comparison.results);
    const net = (board: string, strategy: string) =>
      report.results.find((row) => row.board === board && row.strategy === strategy)!.result
        .netValue;
    expect(net('routine', 'both')).toBe(22);
    expect(net('routine', 'test')).toBe(11);
    expect(net('routine', 'ai')).toBe(11);
    expect(net('routine', 'none')).toBe(6);
    expect(net('complex', 'both')).toBe(16);
    expect(net('complex', 'test')).toBe(11);
    expect(net('complex', 'ai')).toBe(11);
    expect(net('complex', 'none')).toBe(6);
    expect(net('incident', 'none')).toBe(6);
    expect(net('incident', 'test')).toBe(5);
    expect(net('incident', 'ai')).toBe(5);
    expect(net('incident', 'both')).toBe(4);
    expect(report.split.beatsSingleAndNone).toEqual(['routine', 'complex']);
    expect(report.split.losesToSingleOrNone).toEqual(['incident']);
    expect(report.split.autoClearedWhenBoth).toEqual({ routine: 6, incident: 0, complex: 0 });
    expect(report.conditions).toMatchObject({
      seed: 1,
      horizon: 6,
      focus: 2,
      inflowPerTick: 4,
      requiredCards: ['test', 'ai'],
      costPerCard: 1,
      costForBoth: 2,
      fixedStrategy: true,
      humanPlaytest: false,
    });
    const combo = report.results.find((row) => row.board === 'routine' && row.strategy === 'both')!;
    expect(combo.result.autoCleared).toBe(6);
    expect(combo.result.routineCleared - combo.result.autoCleared).toBe(18);
    const complex = report.results.find(
      (row) => row.board === 'complex' && row.strategy === 'both',
    )!;
    expect(complex.result.autoCleared).toBe(0);
    expect(complex.result.complexCleared).toBe(18);
    for (const row of report.results) {
      const activations = row.strategy === 'both' ? 2 : row.strategy === 'none' ? 0 : 1;
      expect(row.inputs.slice(0, activations).every((input) => input.type === 'activate')).toBe(
        true,
      );
      expect(row.inputs.slice(activations).every((input) => input.type === 'tick')).toBe(true);
      expect(row.inputs.filter((input) => input.type === 'tick')).toHaveLength(row.initial.horizon);
    }
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareSynergyStrategies()) {
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
      expect(summarizeSynergy(live)).toEqual(row.result);
    }
  });
});
