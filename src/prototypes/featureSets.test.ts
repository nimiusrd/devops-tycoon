import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/feature-sets-comparison.json';
import factors from '../../docs/prototypes/feature-sets-factor-comparison.json';
import {
  createFeatureSetPrototype,
  tickFeatureSetPrototype,
  compareFeatureSetStrategies,
  compareFeatureSetFactorReversals,
  summarizeFeatureSets,
  FEATURE_SETS,
} from './featureSets';
import type { FeatureSetFactorPlay, FeatureSetFactorRow, FeatureSetState } from './featureSets';

describe('固定六タスクの機能セット出荷試作', () => {
  it('残タスクに追加手戻りの有無を残し、発生後は残工数に置き換わる', () => {
    let state = createFeatureSetPrototype('RI-153');
    expect(summarizeFeatureSets(state).pendingTasks).toContainEqual({
      id: 2,
      workLeft: 5,
      reworkPending: true,
    });
    for (let work = 0; work < 5; work += 1) state = tickFeatureSetPrototype(state, 2);
    expect(summarizeFeatureSets(state).pendingTasks).toContainEqual({
      id: 2,
      workLeft: 1,
      reworkPending: false,
    });
    state = tickFeatureSetPrototype(state, 2);
    expect(summarizeFeatureSets(state).pendingTasks.some((task) => task.id === 2)).toBe(false);
  });
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

describe('機能セットの優劣が反転する条件', () => {
  const report = compareFeatureSetFactorReversals('RI-153');
  const rows = [
    ...report.sweeps.deadline,
    ...report.sweeps.reworkOnDeadline,
    ...report.sweeps.customerNeed,
  ];

  function replay(initial: FeatureSetState, inputs: FeatureSetFactorPlay['inputs']) {
    let state = structuredClone(initial);
    for (const taskId of inputs) {
      const before = structuredClone(state);
      const resumed = tickFeatureSetPrototype(
        JSON.parse(JSON.stringify(state)),
        taskId ?? undefined,
      );
      const next = tickFeatureSetPrototype(state, taskId ?? undefined);
      expect(state).toEqual(before);
      expect(next).toEqual(resumed);
      state = next;
    }
    return state;
  }

  it('記録した要因比較を再計算し、初回の盤面と統合価値を動かさない', () => {
    expect(report).toEqual(factors);
    expect(FEATURE_SETS.map((feature) => feature.integrationValue)).toEqual([8, 5]);
    expect(report.conditions.integrationAdjusted).toBe(false);
    expect(report.conditions.featureCompletionAlwaysAhead).toBe(false);
    expect(report.conditions.fixedStrategies).toBe(true);
    expect(report.conditions.humanPlaytest).toBe(false);
    expect(report.conditions.productionAdoption).toBe(false);
    const anchor = report.sweeps.deadline.find((row) => row.parameter.deadline === 8);
    expect(anchor?.initial).toEqual(comparison.initial);
    expect(anchor?.sameAsFirstComparison).toBe(true);
    for (const play of anchor?.plays ?? []) {
      const original = comparison.results.find((result) => result.strategy === play.strategy);
      expect(play.history).toEqual(original?.history);
      expect(play.individualValue).toBe(original?.individualValue);
      expect(play.integrationValue).toBe(original?.integrationValue);
      expect(play.countedIntegration).toBe(original?.integrationValue);
    }
  });

  it('各行は対照から要因を一つだけ動かし、入力再生と保存再開が一致する', () => {
    for (const row of report.sweeps.deadline) {
      expect(row.parameter.alertsRework).toBe(false);
      expect(row.parameter.needed).toEqual(['reports', 'alerts']);
      expect(row.differsFromAnchor).toEqual(row.parameter.deadline === 8 ? [] : ['deadline']);
    }
    for (const row of report.sweeps.customerNeed) {
      expect(row.parameter.deadline).toBe(8);
      expect(row.parameter.alertsRework).toBe(false);
      expect(row.differsFromAnchor).toEqual(
        row.parameter.needed.join(',') === 'reports,alerts' ? [] : ['needed'],
      );
    }
    for (const row of report.sweeps.reworkOnDeadline) {
      const paired = report.sweeps.deadline.find(
        (candidate) => candidate.parameter.deadline === row.parameter.deadline,
      );
      expect(paired?.parameter.alertsRework).toBe(false);
      expect(row.parameter.alertsRework).toBe(true);
      expect(row.parameter.needed).toEqual(paired?.parameter.needed);
      expect(knobDiffs(paired, row)).toEqual(['alertsRework']);
    }
    for (const row of rows) {
      expect(row.initial.tasks.find((task) => task.id === 2)?.reworkPending).toBe(true);
      expect(row.initial.tasks.find((task) => task.id === 5)?.reworkPending).toBe(
        row.parameter.alertsRework,
      );
      expect(row.initial.tasks.map((task) => task.workLeft)).toEqual([2, 2, 5, 1, 1, 4]);
      expect(row.initial.tasks.map((task) => task.value)).toEqual([4, 4, 4, 2, 2, 3]);
      for (const play of row.plays) {
        expect(play.inputs).toEqual(play.history.map((entry) => entry.taskId));
        const state = replay(row.initial, play.inputs);
        expect(summarizeFeatureSets(state)).toMatchObject({
          individualValue: play.individualValue,
          integrationValue: play.integrationValue,
          completedTasks: play.completedTasks,
          rework: play.rework,
          tick: play.tick,
        });
        expect(state.history).toEqual(play.history);
        expect(state.completions).toEqual(play.completedFeatures);
      }
    }
  });

  it('短い期限、手戻りが期限にかかる状態、顧客必要性で優劣が反転する', () => {
    expect(relations(report.sweeps.deadline)).toEqual([
      [1, 'complete-feature', -2, 0],
      [2, 'tie', 0, 0],
      [3, 'tie', 0, 0],
      [4, 'immediate', 4, 0],
      [5, 'immediate', 6, 0],
      [6, 'tradeoff', 5, 5],
      [7, 'tradeoff', 5, 5],
      [8, 'tradeoff', 1, 5],
      [9, 'tradeoff', 1, 5],
      [10, 'tie', 0, 0],
    ]);
    expect(relations(report.sweeps.reworkOnDeadline)).toEqual([
      [6, 'immediate', 8, 0],
      [7, 'tradeoff', 5, 5],
      [8, 'tradeoff', 5, 5],
    ]);
    expect(
      report.sweeps.customerNeed.map((row) => [
        row.parameter.needed.join(','),
        row.relation,
        row.individualGap,
        row.integrationGap,
      ]),
    ).toEqual([
      ['reports,alerts', 'tradeoff', 1, 5],
      ['alerts', 'tradeoff', 1, 5],
      ['reports', 'immediate', 1, 0],
      ['', 'immediate', 1, 0],
    ]);
    const justFinished = play(report.sweeps.deadline, 6, 'complete-feature');
    expect(justFinished.completedFeatures).toEqual([
      { featureId: 'alerts', tick: 6, integrationValue: 5 },
    ]);
    expect(justFinished.countedIntegration).toBe(5);
    const cut = play(report.sweeps.reworkOnDeadline, 6, 'complete-feature');
    expect(cut.completedFeatures).toEqual([]);
    expect(cut.individualValue).toBe(4);
    expect(cut.history[cut.history.length - 1]).toEqual({ tick: 6, taskId: 5, result: 'rework' });
    expect(cut.pendingTasks).toContainEqual({ id: 5, workLeft: 1, reworkPending: false });
    const slack = play(report.sweeps.reworkOnDeadline, 7, 'complete-feature');
    expect(slack.completedFeatures).toEqual([
      { featureId: 'alerts', tick: 7, integrationValue: 5 },
    ]);
    const reportsOnly = report.sweeps.customerNeed.find(
      (row) => row.parameter.needed.join(',') === 'reports',
    );
    const pushed = reportsOnly?.plays.find((item) => item.strategy === 'complete-feature');
    expect(pushed?.integrationValue).toBe(5);
    expect(pushed?.countedIntegration).toBe(0);
    expect(pushed?.completedFeatures).toHaveLength(1);
    expect(report.reversals.map((reversal) => reversal.factor)).toEqual([
      'deadline',
      'deadline',
      'deadline',
      'deadline',
      'reworkOnDeadline',
      'customerNeed',
      'reworkVersusSameDeadline',
    ]);
  });
});

function relations(rows: FeatureSetFactorRow[]) {
  return rows.map((row) => [
    row.parameter.deadline,
    row.relation,
    row.individualGap,
    row.integrationGap,
  ]);
}

function play(
  rows: FeatureSetFactorRow[],
  deadline: number,
  strategy: FeatureSetFactorPlay['strategy'],
) {
  const found = rows
    .find((row) => row.parameter.deadline === deadline)
    ?.plays.find((item) => item.strategy === strategy);
  if (found === undefined) throw new Error('比較行がない');
  return found;
}

function knobDiffs(left: FeatureSetFactorRow | undefined, right: FeatureSetFactorRow) {
  if (left === undefined) return [];
  return (['deadline', 'alertsRework', 'needed'] as const).filter((knob) => {
    if (knob === 'needed') {
      return left.parameter.needed.join(',') !== right.parameter.needed.join(',');
    }
    return left.parameter[knob] !== right.parameter[knob];
  });
}
