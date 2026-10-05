import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/feature-sets-comparison.json';
import {
  createFeatureSetPrototype,
  tickFeatureSetPrototype,
  compareFeatureSetStrategies,
} from './featureSets';

describe('固定六タスクの機能セット出荷試作', () => {
  it('記録した固定盤面と攻略順序の比較を再現する', () => {
    expect(createFeatureSetPrototype(comparison.seed)).toEqual(comparison.initial);
    expect(compareFeatureSetStrategies(comparison.seed)).toEqual(comparison.results);
  });
  it('最後の必須タスクのDoneで一度だけ完成し、部分成果を消さない', () => {
    let state = createFeatureSetPrototype(1);
    state.tasks.forEach((task) => {
      task.reworkPending = false;
    });
    for (const id of [3, 4]) state = tickFeatureSetPrototype(state, id);
    expect(state.individualValue).toBe(4);
    expect(state.completions).toHaveLength(0);
    for (let work = 0; work < 3; work += 1) state = tickFeatureSetPrototype(state, 5);
    expect(state.completions).toHaveLength(0);
    state = tickFeatureSetPrototype(state, 5);
    expect(state.individualValue).toBe(7);
    expect(state.completions).toEqual([{ featureId: 'alerts', tick: 6, integrationValue: 5 }]);
    expect(tickFeatureSetPrototype(state, 5)).toEqual(state);
  });

  it('最後の仕事が手戻り中なら完成せず、追加作業を終えるまで出荷も加点しない', () => {
    let state = createFeatureSetPrototype(1);
    state.tasks[5].reworkPending = true;
    for (const id of [3, 4, 5, 5, 5, 5]) state = tickFeatureSetPrototype(state, id);
    expect(state.completions).toHaveLength(0);
    expect(state.individualValue).toBe(4);
    expect(state.history[state.history.length - 1].result).toBe('rework');
    state = tickFeatureSetPrototype(state, 5);
    expect(state.individualValue).toBe(7);
    expect(state.completions).toHaveLength(1);
  });

  it('時間切れで未完成のセットを完成扱いにせず、確定した個別価値は残す', () => {
    let state = createFeatureSetPrototype(1);
    for (const id of [0, 0, 1, 1, 3, 4, 5, 5]) state = tickFeatureSetPrototype(state, id);
    expect(state.individualValue).toBe(12);
    expect(state.completions).toHaveLength(0);
    expect(state.tasks[5].done).toBe(false);
    expect(tickFeatureSetPrototype(state, 5)).toEqual(state);
  });

  it('同じ入力とJSON再開で、所属・手戻り・完成の時点が一致する', () => {
    const initial = createFeatureSetPrototype('RI-153');
    const before = structuredClone(initial);
    let state = tickFeatureSetPrototype(initial, 3);
    expect(initial).toEqual(before);
    let restored = JSON.parse(JSON.stringify(state));
    for (const id of [4, 5, 5, 5, 5, 5, 0]) {
      state = tickFeatureSetPrototype(state, id);
      restored = tickFeatureSetPrototype(restored, id);
    }
    expect(restored).toEqual(state);
  });

  it('即時出荷と機能完成の利益を別指標で比較できる', () => {
    const [immediate, feature] = compareFeatureSetStrategies('RI-153');
    expect(immediate.individualValue).toBeGreaterThan(feature.individualValue);
    expect(immediate.integrationValue).toBe(0);
    expect(feature.integrationValue).toBe(5);
    expect(feature.completedFeatures).toHaveLength(1);
  });

  it('両セットを完成させても各タスクとセットの評価は一度ずつに留まる', () => {
    let state = createFeatureSetPrototype(1);
    state.deadline = 20;
    state.tasks.forEach((task) => {
      task.reworkPending = false;
    });
    for (const id of [5, 4, 3, 2, 1, 0]) {
      while (!state.tasks[id].done) state = tickFeatureSetPrototype(state, id);
    }
    expect(state.individualValue).toBe(19);
    expect(state.completions.map((feature) => feature.featureId)).toEqual(['alerts', 'reports']);
    expect(state.completions.reduce((sum, feature) => sum + feature.integrationValue, 0)).toBe(13);
    expect(tickFeatureSetPrototype(state, 0)).toEqual(state);
  });
});
