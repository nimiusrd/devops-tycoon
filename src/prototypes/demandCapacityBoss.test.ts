import { describe, expect, it } from 'vitest';
import {
  applyDemandCapacityBoss as apply,
  chooseCapacityAction,
  compareDemandCapacityBoss,
  createDemandCapacityBoss as create,
  summarizeDemandCapacityBoss as summarize,
  viewDemandCapacityBoss as view,
} from './demandCapacityBoss';
import comparison from '../../docs/prototypes/demand-capacity-comparison.json';

describe('RI-257 アクセス急増ボス', () => {
  it('同じ予測帯のまま異なる将来を持ち、公開モデルから確定前の実需要を漏らさない', () => {
    const first = create(comparison.seeds[0]!);
    const other = structuredClone(first);
    other.seed = 'hidden-other';
    other.plannedDemand = [6, 14, 12, 14];
    expect(view(first)).toEqual(view(other));
    expect(view(first)).toMatchObject({
      phase: 'prepare',
      forecast: { start: { low: 4, high: 6 }, peak: { low: 7, high: 14 } },
      observations: [],
      result: null,
    });
    expect(Object.keys(view(first))).not.toContain('seed');
    expect(Object.keys(view(first))).not.toContain('plannedDemand');
    for (let i = 0; i < 10; i++) {
      expect(view(first)).toEqual(view(other));
      expect(apply(first, { type: 'view' })).toBe(first);
    }
    let live = apply(first, { type: 'advance' });
    expect(view(live).observations).toEqual([]);
    live = apply(live, { type: 'advance' });
    expect(view(live).observations.map((item) => item.actualDemand)).toEqual([
      first.plannedDemand[0],
    ]);
    const changedFuture = structuredClone(live);
    changedFuture.plannedDemand[1] = 14;
    changedFuture.plannedDemand[2] = 7;
    expect(view(changedFuture)).toEqual(view(live));
    expect(chooseCapacityAction(changedFuture, 'small-reactive')).toEqual(
      chooseCapacityAction(live, 'small-reactive'),
    );
  });

  it('準備→開始→ピーク→結果が進み、無操作でも基礎容量と予算を残して運用する', () => {
    let state = create(comparison.seeds[0]!);
    const phases = [view(state).phase];
    for (let i = 0; i < 5; i++) {
      state = apply(state, { type: 'advance' });
      phases.push(view(state).phase);
    }
    expect(phases).toEqual(['prepare', 'start', 'peak', 'peak', 'peak', 'result']);
    expect(state.observations).toHaveLength(4);
    expect(state.observations[0]?.unserved).toBe(0);
    expect(state.observations.every((item) => item.served > 0)).toBe(true);
    expect(summarize(state)).toMatchObject({
      completed: true,
      continued: true,
      capacitySpent: 12,
      normalDevelopmentBudget: 88,
    });
    expect(view(state).result).toEqual(summarize(state));
    expect(apply(state, { type: 'advance' })).toBe(state);
    expect(apply(state, { type: 'scale' })).toBe(state);
    expect(apply(state, { type: 'invest', level: 'large' })).toBe(state);
  });

  it('投資は準備中に1回だけで、容量費と将来の確定費をツール維持費から分離する', () => {
    const first = create('budget');
    expect(view(first).finance).toMatchObject({
      initialBudget: 100,
      committedCapacityLease: 12,
      normalDevelopmentBudget: 88,
      existingToolUpkeepCharged: false,
    });
    const small = apply(first, { type: 'invest', level: 'small' });
    const large = apply(first, { type: 'invest', level: 'large' });
    expect(view(small)).toMatchObject({ capacity: 9, finance: { normalDevelopmentBudget: 68 } });
    expect(view(large)).toMatchObject({ capacity: 14, finance: { normalDevelopmentBudget: 34 } });
    expect(apply(small, { type: 'invest', level: 'large' })).toBe(small);
    expect(
      apply(apply(first, { type: 'advance' }), { type: 'invest', level: 'small' }).investment,
    ).toBeNull();
    expect(apply(first, { type: 'scale' })).toBe(first);
    const start = apply(large, { type: 'advance' });
    // 将来のリースを確保した残予算34では、12+4*10の増強を買えない。
    expect(apply(start, { type: 'scale' })).toBe(start);
  });

  it('増強は1種類・1回だけで次の進行から効き、未経過分の費用だけを計上する', () => {
    let state = apply(create('scaling'), { type: 'invest', level: 'small' });
    state = apply(state, { type: 'advance' });
    state = apply(state, { type: 'advance' });
    const original = structuredClone(state);
    const scaled = apply(state, { type: 'scale' });
    expect(state).toEqual(original);
    expect(view(scaled)).toMatchObject({
      capacity: 14,
      scaled: true,
      finance: {
        setupSpent: 20,
        leaseSpent: 6,
        committedCapacityLease: 48,
        normalDevelopmentBudget: 26,
      },
    });
    expect(scaled.observations).toEqual(state.observations);
    expect(apply(scaled, { type: 'scale' })).toBe(scaled);
    const peak = apply(scaled, { type: 'advance' });
    expect(peak.observations[1]?.capacity).toBe(14);
    expect(summarize(peak).capacitySpent).toBe(42);
  });

  it('低需要2seed・高需要2seedで同じ4方針を比較し、過剰投資と停止の交換がある', () => {
    const rows = compareDemandCapacityBoss(comparison.seeds);
    expect(rows).toEqual(comparison.results);
    const peaks = comparison.seeds.map((seed) => create(seed).plannedDemand.slice(1));
    expect(peaks.filter((values) => values.every((value) => value <= 9))).toHaveLength(2);
    expect(peaks.filter((values) => values.every((value) => value >= 12))).toHaveLength(2);
    for (const seed of comparison.seeds) {
      const row = (strategy: string) =>
        rows.find((item) => item.seed === seed && item.strategy === strategy)!;
      const small = row('small');
      const large = row('large');
      const reactive = row('small-reactive');
      expect(large.result.equivalentDowntimeSeconds).toBe(0);
      expect(large.result.capacitySpent).toBeGreaterThan(small.result.capacitySpent);
      expect(large.result.unusedCapacityLease).toBeGreaterThan(small.result.unusedCapacityLease);
      expect(large.result.normalDevelopmentBudget).toBeLessThan(
        small.result.normalDevelopmentBudget,
      );
      if (small.result.unserved === 0) {
        expect(small.result.comparisonValue).toBeGreaterThan(large.result.comparisonValue);
        expect(reactive.inputs.some((input) => input.type === 'scale')).toBe(false);
      } else {
        expect(large.result.comparisonValue).toBeGreaterThan(small.result.comparisonValue);
        expect(reactive.result.equivalentDowntimeSeconds).toBeLessThan(
          small.result.equivalentDowntimeSeconds,
        );
        expect(reactive.result.capacitySpent).toBeGreaterThan(small.result.capacitySpent);
        // 停止の評価単価を半分にすると大容量の順位は逆転する。
        expect(small.sensitivity[0]!.comparisonValue).toBeGreaterThan(
          large.sensitivity[0]!.comparisonValue,
        );
      }
      expect(row('none').result.continued).toBe(true);
    }
  });

  it('全入力の再生・毎入力JSON保存再開・閲覧挿入が一致し、元状態を変更しない', () => {
    for (const row of compareDemandCapacityBoss(comparison.seeds)) {
      expect(create(row.seed)).toEqual(row.initial);
      let live = row.initial;
      let resumed = create(row.seed);
      for (const input of row.inputs) {
        const before = structuredClone(live);
        expect(chooseCapacityAction(live, row.strategy)).toEqual(input);
        const next = apply(live, input);
        expect(live).toEqual(before);
        live = next;
        resumed = JSON.parse(JSON.stringify(resumed));
        const displayed = view(resumed);
        displayed.forecast.peak.high = 0;
        displayed.observations.length = 0;
        resumed = apply(apply(resumed, { type: 'view' }), input);
        expect(resumed).toEqual(live);
        expect(live.plannedDemand).toEqual(row.initial.plannedDemand);
        expect(view(live).finance.normalDevelopmentBudget).toBeGreaterThanOrEqual(0);
        for (const observation of live.observations) {
          expect(observation.served + observation.unserved).toBe(observation.actualDemand);
          expect(observation.equivalentDowntimeSeconds).toBe(
            Math.ceil((600 * observation.unserved) / observation.actualDemand),
          );
        }
      }
      expect(summarize(live)).toEqual(row.result);
      expect(live.observations).toEqual(row.observations);
    }
  });
});
