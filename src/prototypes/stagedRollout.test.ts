import { describe, expect, it } from 'vitest';
import {
  applyRolloutInput as apply,
  createRolloutPrototype as create,
  compareRolloutStrategies,
  summarizeRollout,
  viewRollout,
} from './stagedRollout';
import comparison from '../../docs/prototypes/staged-rollout-comparison.json';

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
});
