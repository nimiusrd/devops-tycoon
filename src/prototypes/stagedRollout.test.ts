import { describe, expect, it } from 'vitest';
import { createRng } from '../sim/rng';
import {
  applyRolloutInput as apply,
  createRolloutPrototype as create,
  compareRolloutFactorSensitivity,
  compareRolloutStrategies,
  ROLLOUT_FACTOR_BASELINE,
  ROLLOUT_FACTOR_SCENARIOS,
  summarizeRollout,
  viewRollout,
  type RolloutSensitivityFactor,
} from './stagedRollout';
import comparison from '../../docs/prototypes/staged-rollout-comparison.json';
import factorComparison from '../../docs/prototypes/staged-rollout-factor-comparison.json';

describe('RI-174 段階公開', () => {
  it('seed付き兆候はtickだけで進み、閲覧や確認を重ねても抽選されない', () => {
    const faulty = create(0);
    const healthy = create(1);
    expect(faulty.defect).toBe(true);
    expect(healthy.defect).toBe(false);
    expect(create(0)).toEqual(faulty);
    expect(viewRollout(faulty)).toEqual(viewRollout(healthy));
    const before = structuredClone(faulty);
    for (let i = 0; i < 10; i++) viewRollout(faulty);
    expect(faulty).toEqual(before);
    const checked = apply(faulty, { type: 'check' });
    expect(checked.tick).toBe(0);
    expect(checked.checkedSignal).toBe('pending');
    expect(apply(checked, { type: 'check' })).toBe(checked);
    let state = apply(checked, { type: 'tick' });
    expect(state.signal).toBe('pending');
    state = apply(state, { type: 'tick' });
    expect(state.signal).toBe('anomaly');
    expect(state.checkedSignal).toBe('pending');
    state = apply(state, { type: 'check' });
    expect(state.checkedSignal).toBe('anomaly');
    expect(state.checkedTick).toBe(2);
    expect(state.inputs.map((i) => i.type)).toEqual(['check', 'tick', 'tick', 'check']);
  });
  it('2段階の到達範囲・健全成果・事故上限が見積どおりになる', () => {
    const initial = create(0, 30);
    expect(viewRollout(initial).stages).toEqual([
      { stage: 'pilot', reachPercent: 20, valuePerHealthyTick: 1, maxCustomerLoss: 16 },
      { stage: 'full', reachPercent: 100, valuePerHealthyTick: 5, maxCustomerLoss: 80 },
    ]);
    let pilot = initial;
    let full = apply(initial, { type: 'expand' });
    for (let i = 0; i < 30; i++) {
      pilot = apply(pilot, { type: 'tick' });
      full = apply(full, { type: 'tick' });
    }
    expect(pilot.customerLoss).toBe(16);
    expect(full.customerLoss).toBe(80);
    const healthyPilot = apply(create(1), { type: 'tick' });
    const healthyFull = apply(apply(create(1), { type: 'expand' }), { type: 'tick' });
    expect(healthyPilot.earnedValue).toBe(1);
    expect(healthyFull.earnedValue).toBe(5);
  });
  it.each(['pilot', 'full'] as const)(
    '%s停止は既得成果・実損失を維持し、以降の到達価値を譲る',
    (stage) => {
      let state = stage === 'full' ? apply(create(0), { type: 'expand' }) : create(0);
      state = apply(apply(state, { type: 'tick' }), { type: 'tick' });
      const before = structuredClone(state);
      state = apply(state, { type: 'stop' });
      expect(state.earnedValue).toBe(before.earnedValue);
      expect(state.customerLoss).toBe(before.customerLoss);
      expect(summarizeRollout(state).reachPercent).toBe(0);
      expect(apply(state, { type: 'stop' })).toBe(state);
      expect(apply(state, { type: 'expand' })).toBe(state);
      expect(apply(state, { type: 'check' })).toBe(state);
      const ticked = apply(state, { type: 'tick' });
      expect(ticked.earnedValue).toBe(state.earnedValue);
      expect(ticked.customerLoss).toBe(state.customerLoss);
    },
  );
  it('拡大連打・資源不足・期末の操作は無消費で拒否する', () => {
    const full = apply(create(1), { type: 'expand' });
    expect(apply(full, { type: 'expand' })).toBe(full);
    const poor = { ...create(1), focus: 0 };
    expect(apply(poor, { type: 'expand' })).toBe(poor);
    expect(apply(poor, { type: 'stop' })).toBe(poor);
    const ended = { ...create(1), tick: 6 };
    for (const type of ['check', 'expand', 'stop', 'tick'] as const)
      expect(apply(ended, { type })).toBe(ended);
  });
  it('短納期は即拡大、高影響は観察して停止/拡大が有力で永久観察も最善ではない', () => {
    const rows = compareRolloutStrategies();
    expect(rows).toEqual(comparison.results);
    const mean = (horizon: number, strategy: string) =>
      rows
        .filter((r) => r.horizon === horizon && r.strategy === strategy)
        .reduce((sum, r) => sum + r.result.netValue, 0) / 2;
    expect(mean(2, 'immediate')).toBe(4);
    expect(mean(2, 'observe-decide')).toBe(1);
    expect(mean(6, 'immediate')).toBe(-23.5);
    expect(mean(6, 'observe-decide')).toBe(8.5);
    expect(mean(6, 'observe-forever')).toBe(-4.5);
    const decisions = rows.filter((r) => r.horizon === 6 && r.strategy === 'observe-decide');
    expect(decisions.map((r) => r.result.stage)).toEqual(['stopped', 'full']);
    expect(decisions.every((r) => r.inputs.some((i) => i.type === 'check'))).toBe(true);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareRolloutStrategies()) {
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
      expect(summarizeRollout(live)).toEqual(row.result);
    }
  });
  it('不具合率0.3はseed 0/1の不具合有無が0.5と同じなので比較しない', () => {
    for (const seed of [0, 1]) {
      expect(create(seed, 6, 1, { defectRate: 0.3 }).defect).toBe(
        create(seed, 6, 1, { defectRate: 0.5 }).defect,
      );
    }
    expect(create(0, 6, 1, { defectRate: 0.2 }).defect).toBe(false);
    expect(create(0, 6, 1).defect).toBe(true);
  });
  it('要因を一つずつ動かすと即拡大と観察判断の平均優劣が決まった方向で反転する', () => {
    const rows = compareRolloutFactorSensitivity();
    expect(factorComparison.evaluation).toBe('fixed-strategy');
    expect(factorComparison.humanPlaytest).toBe(false);
    expect(factorComparison.productionIntegrated).toBe(false);
    expect(createRng(0)()).toBe(factorComparison.seedDraws[0]);
    expect(createRng(1)()).toBe(factorComparison.seedDraws[1]);
    expect(rows).toEqual(factorComparison.results);
    const moved: Record<
      Exclude<RolloutSensitivityFactor, 'baseline'>,
      'defectRate' | 'signalAtTick' | 'impact'
    > = {
      defectRate: 'defectRate',
      signalAtTick: 'signalAtTick',
      impactPerValue: 'impact',
    };
    for (const scenario of ROLLOUT_FACTOR_SCENARIOS) {
      expect(scenario.horizon).toBe(ROLLOUT_FACTOR_BASELINE.horizon);
      const diffs = (['defectRate', 'signalAtTick', 'impact'] as const).filter(
        (key) => scenario[key] !== ROLLOUT_FACTOR_BASELINE[key],
      );
      expect(diffs).toEqual(scenario.factor === 'baseline' ? [] : [moved[scenario.factor]]);
      for (const seed of [0, 1]) {
        const pair = rows.filter(
          (row) =>
            row.factor === scenario.factor &&
            row.defectRate === scenario.defectRate &&
            row.signalAtTick === scenario.signalAtTick &&
            row.impact === scenario.impact &&
            row.seed === seed,
        );
        expect(pair.map((row) => row.strategy)).toEqual(['immediate', 'observe-decide']);
        expect(pair[0].initial).toEqual(pair[1].initial);
        expect(pair[0].initial).toEqual(
          create(seed, scenario.horizon, scenario.impact, {
            defectRate: scenario.defectRate,
            signalAtTick: scenario.signalAtTick,
          }),
        );
        expect(pair[0].initial).not.toHaveProperty('defectRate');
        expect(Object.keys(pair[0].initial).sort()).toEqual(Object.keys(create(0)).sort());
        expect(pair[0].valuePerHealthyPilotTick).toBe(1);
        expect(pair[0].valuePerHealthyFullTick).toBe(5);
        expect(pair[0].impactPerValue).toBe(scenario.impact);
      }
    }
    const mean = (
      match: (row: (typeof rows)[number]) => boolean,
      strategy: 'immediate' | 'observe-decide',
    ) => {
      const found = rows.filter((row) => match(row) && row.strategy === strategy);
      expect(found.map((row) => row.seed)).toEqual([0, 1]);
      return found.reduce((sum, row) => sum + row.result.netValue, 0) / 2;
    };
    const wins = (
      match: (row: (typeof rows)[number]) => boolean,
      leader: 'immediate' | 'observe-decide',
    ) => {
      const immediate = mean(match, 'immediate');
      const observe = mean(match, 'observe-decide');
      expect(leader === 'immediate' ? immediate : observe).toBeGreaterThan(
        leader === 'immediate' ? observe : immediate,
      );
      return { immediate, observe };
    };
    expect(wins((row) => row.factor === 'baseline', 'observe-decide')).toEqual({
      immediate: 6.5,
      observe: 10,
    });
    expect(
      wins((row) => row.factor === 'defectRate' && row.defectRate === 0.2, 'immediate'),
    ).toEqual({
      immediate: 29,
      observe: 21,
    });
    expect(
      wins((row) => row.factor === 'defectRate' && row.defectRate === 1, 'observe-decide'),
    ).toEqual({
      immediate: -16,
      observe: -1,
    });
    expect(
      wins((row) => row.factor === 'signalAtTick' && row.signalAtTick === 1, 'observe-decide'),
    ).toEqual({
      immediate: 4,
      observe: 11.5,
    });
    expect(
      wins((row) => row.factor === 'signalAtTick' && row.signalAtTick === 3, 'immediate'),
    ).toEqual({
      immediate: 9,
      observe: 8.5,
    });
    expect(
      wins((row) => row.factor === 'impactPerValue' && row.impact === 0.5, 'immediate'),
    ).toEqual({
      immediate: 11.5,
      observe: 10.25,
    });
    expect(
      wins((row) => row.factor === 'impactPerValue' && row.impact === 2, 'observe-decide'),
    ).toEqual({
      immediate: -3.5,
      observe: 9.5,
    });
    const seedPrefersObserve = (match: (row: (typeof rows)[number]) => boolean, seed: number) => {
      const at = (strategy: 'immediate' | 'observe-decide') =>
        rows.find((row) => match(row) && row.seed === seed && row.strategy === strategy)!.result
          .netValue;
      return at('observe-decide') > at('immediate');
    };
    for (const match of [
      (row: (typeof rows)[number]) => row.factor === 'baseline',
      (row: (typeof rows)[number]) => row.factor === 'signalAtTick' && row.signalAtTick === 1,
      (row: (typeof rows)[number]) => row.factor === 'signalAtTick' && row.signalAtTick === 3,
      (row: (typeof rows)[number]) => row.factor === 'impactPerValue' && row.impact === 0.5,
      (row: (typeof rows)[number]) => row.factor === 'impactPerValue' && row.impact === 2,
    ]) {
      expect(seedPrefersObserve(match, 0)).toBe(true);
      expect(seedPrefersObserve(match, 1)).toBe(false);
    }
    expect(
      seedPrefersObserve((row) => row.factor === 'defectRate' && row.defectRate === 0.2, 0),
    ).toBe(false);
    expect(
      seedPrefersObserve((row) => row.factor === 'defectRate' && row.defectRate === 0.2, 1),
    ).toBe(false);
    expect(
      seedPrefersObserve((row) => row.factor === 'defectRate' && row.defectRate === 1, 0),
    ).toBe(true);
    expect(
      seedPrefersObserve((row) => row.factor === 'defectRate' && row.defectRate === 1, 1),
    ).toBe(true);
    for (const row of rows) {
      if (row.strategy === 'immediate') {
        expect(row.inputs.some((input) => input.type === 'check')).toBe(false);
        expect(row.result.stage).toBe('full');
      } else {
        expect(row.result.checkedSignal).toBe(row.initial.defect ? 'anomaly' : 'healthy');
        expect(row.result.stage).toBe(row.initial.defect ? 'stopped' : 'full');
      }
    }
  });
  it('要因比較の全入力も再生とJSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareRolloutFactorSensitivity()) {
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
      expect(summarizeRollout(live)).toEqual(row.result);
    }
  });
});
