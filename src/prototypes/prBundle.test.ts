import { describe, expect, it } from 'vitest';
import {
  applyBundleInput,
  baselineBundleRules,
  bundlePreference,
  compareBundleFactorReversals,
  compareBundleStrategies,
  createBundleFactorState,
  createBundlePrototype,
  summarizeBundle,
  type BundleRules,
} from './prBundle';
import comparison from '../../docs/prototypes/pr-bundle-comparison.json';
import factors from '../../docs/prototypes/pr-bundle-factor-comparison.json';
describe('RI-167 関連PRの束ね', () => {
  it('同領域の未着手2件だけを束ね、価値と元IDを保持する', () => {
    const initial = createBundlePrototype('RI-167');
    const bundled = applyBundleInput(initial, { type: 'bundle', ids: ['b', 'a'] });
    expect(bundled.groups).toEqual([
      { ids: ['a', 'b'], workLeft: 4, started: false, failed: false },
    ]);
    expect(bundled.jobs).toEqual(initial.jobs);
    expect(bundled).toEqual(applyBundleInput(initial, { type: 'bundle', ids: ['a', 'b'] }));
    expect(bundled.inputs).toEqual([{ type: 'bundle', ids: ['a', 'b'] }]);
    expect(applyBundleInput(bundled, { type: 'bundle', ids: ['a', 'b'] })).toBe(bundled);
    expect(initial.groups).toHaveLength(2);
  });
  it('無関係・重複・未知・Done・着手済み・期末を無消費で拒否する', () => {
    const initial = createBundlePrototype('RI-167');
    for (const ids of [['a'], ['a', 'a'], ['a', 'missing'], ['a', 'b', 'c']])
      expect(applyBundleInput(initial, { type: 'bundle', ids })).toBe(initial);
    const other = structuredClone(initial);
    other.jobs[1].domain = 'platform';
    expect(applyBundleInput(other, { type: 'bundle', ids: ['a', 'b'] })).toBe(other);
    const started = applyBundleInput(initial, { type: 'work', id: 'a' });
    expect(applyBundleInput(started, { type: 'bundle', ids: ['a', 'b'] })).toBe(started);
    let done = initial;
    for (let i = 0; i < 3; i++) done = applyBundleInput(done, { type: 'work', id: 'a' });
    expect(applyBundleInput(done, { type: 'bundle', ids: ['a', 'b'] })).toBe(done);
    expect(applyBundleInput(done, { type: 'work', id: 'a' })).toBe(done);
    const ended = { ...initial, tick: initial.horizon };
    expect(applyBundleInput(ended, { type: 'wait' })).toBe(ended);
  });
  it('初回失敗後の再確認待ちを未着手PRとして束ね直さない', () => {
    let state = createBundlePrototype('RI-167', true);
    for (let i = 0; i < 3; i++) state = applyBundleInput(state, { type: 'work', id: 'b' });
    expect(state.groups[1]).toMatchObject({ started: false, failed: true, workLeft: 3 });
    expect(applyBundleInput(state, { type: 'bundle', ids: ['a', 'b'] })).toBe(state);
    expect(summarizeBundle(state).fixedCost).toBe(2);
  });
  it('一部の失敗は束全員の再確認になり、完了は元IDごとに一度記録する', () => {
    let state = applyBundleInput(createBundlePrototype('RI-167', true), {
      type: 'bundle',
      ids: ['a', 'b'],
    });
    state = { ...state, horizon: 9 };
    for (let i = 0; i < 4; i++) state = applyBundleInput(state, { type: 'work', id: 'a' });
    expect(state.jobs.map((j) => j.rechecks)).toEqual([1, 1]);
    expect(summarizeBundle(state).value).toBe(0);
    for (let i = 0; i < 4; i++) state = applyBundleInput(state, { type: 'work', id: 'b' });
    expect(state.jobs.map((j) => j.doneTick)).toEqual([8, 8]);
    expect(summarizeBundle(state).value).toBe(12);
    expect(applyBundleInput(state, { type: 'work', id: 'a' })).toBe(state);
  });
  it('安全なら固定費を節約し、失敗時は個別の先行成果が有利になる', () => {
    const rows = compareBundleStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    expect(rows[1].result.value).toBe(rows[0].result.value);
    expect(rows[1].result.fixedCost).toBeLessThan(rows[0].result.fixedCost);
    expect(rows[2].result.value).toBeGreaterThan(rows[3].result.value);
    expect(rows[2].result.jobs.map((j) => j.rechecks)).toEqual([0, 1]);
  });
  it('毎入力の保存再開と同じ初期状態からの再生が一致する', () => {
    for (const row of compareBundleStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        const before = structuredClone(live);
        const previous = live;
        live = applyBundleInput(live, input);
        expect(previous).toEqual(before);
        restored = applyBundleInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
      }
      expect(summarizeBundle(live)).toEqual(row.result);
    }
  });
  it('初回の資源のまま要因を一つずつ動かし、優劣の変化を再計算できる', () => {
    const rows = compareBundleFactorReversals(factors.conditions.seed);
    expect(rows).toEqual(factors);
    expect(rows.conditions).toMatchObject({
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegrated: false,
      oneAtATime: true,
      contentPerJob: 1,
    });
    const first = compareBundleStrategies(factors.conditions.seed);
    const ruleKeys = Object.keys(baselineBundleRules) as (keyof BundleRules)[];
    for (const series of rows.series) {
      for (const point of series.points) {
        const initial = createBundleFactorState(
          factors.conditions.seed,
          series.factor,
          series.board,
          point.level,
        );
        expect(initial.jobs.map((job) => [job.id, job.failFirst])).toEqual([
          ['a', false],
          ['b', series.board === 'fail'],
        ]);
        expect(initial.jobs.map((job) => job.value)).toEqual([
          initial.rules!.valueA,
          initial.rules!.valueB,
        ]);
        expect(initial.horizon).toBe(initial.rules!.horizon);
        const diffs = ruleKeys.filter((key) => initial.rules![key] !== baselineBundleRules[key]);
        expect(diffs.length).toBeLessThanOrEqual(1);
        const anchor = first.find((row) => row.failFirst === (series.board === 'fail'))!;
        if (diffs.length === 0) {
          for (const strategy of ['separate', 'bundle'] as const) {
            const prior = first.find(
              (row) => row.failFirst === anchor.failFirst && row.strategy === strategy,
            )!;
            expect(point[strategy]).toMatchObject({
              value: prior.result.value,
              workSpent: prior.result.workSpent,
              fixedCost: prior.result.fixedCost,
              rechecks: prior.result.jobs.map((job) => job.rechecks),
              doneTicks: prior.result.jobs.map((job) => job.doneTick),
            });
          }
        }
        for (const strategy of ['separate', 'bundle'] as const) {
          expect(point[strategy].rechecks.every((count) => count <= 1)).toBe(true);
          if (series.board === 'safe') expect(point[strategy].rechecks).toEqual([0, 0]);
        }
      }
    }
    const cell = (factor: string, board: 'safe' | 'fail', level: number | string) =>
      rows.series
        .find((series) => series.factor === factor && series.board === board)!
        .points.find((point) => point.level === level)!;
    expect(cell('horizon', 'safe', 3)).toMatchObject({
      preference: 'separate',
      separate: { value: 6, workSpent: 3 },
      bundle: { value: 0, workSpent: 3 },
    });
    expect(cell('horizon', 'safe', 4)).toMatchObject({
      preference: 'bundle',
      separate: { value: 6, workSpent: 4 },
      bundle: { value: 12, workSpent: 4 },
    });
    expect(cell('horizon', 'fail', 7)).toMatchObject({
      preference: 'separate',
      separate: { value: 6, workSpent: 7 },
      bundle: { value: 0, workSpent: 7 },
    });
    expect(cell('horizon', 'fail', 8)).toMatchObject({
      preference: 'bundle',
      separate: { value: 6, workSpent: 8 },
      bundle: { value: 12, workSpent: 8 },
    });
    expect(cell('precursor', 'fail', 0).preference).toBe('separate');
    expect(cell('precursor', 'fail', 1)).toMatchObject({
      preference: 'bundle',
      separate: { value: 6, workSpent: 7 },
      bundle: { value: 12, workSpent: 7 },
    });
    expect(cell('partialSuccess', 'fail', 'yes')).toMatchObject({
      preference: 'bundle',
      separate: { value: 6, workSpent: 7 },
      bundle: { value: 12, workSpent: 7, rechecks: [0, 1], doneTicks: [4, 7] },
    });
    expect(cell('bundleOpCost', 'safe', 1).preference).toBe('bundle');
    expect(cell('bundleOpCost', 'safe', 2)).toMatchObject({
      preference: 'tie',
      separate: { value: 12, workSpent: 6 },
      bundle: { value: 12, workSpent: 6 },
    });
    expect(cell('bundleOpCost', 'safe', 3)).toMatchObject({
      preference: 'separate',
      separate: { value: 12, workSpent: 6 },
      bundle: { value: 12, workSpent: 7 },
    });
    expect(cell('fixedCost', 'safe', 5)).toMatchObject({
      preference: 'bundle',
      separate: { value: 6, workSpent: 7 },
      bundle: { value: 12, workSpent: 7 },
    });
    expect(cell('fixedCost', 'safe', 6)).toMatchObject({
      preference: 'separate',
      separate: { value: 6, workSpent: 7 },
      bundle: { value: 0, workSpent: 7 },
    });
    const fixedTie = cell('fixedCost', 'fail', 1);
    expect(fixedTie.preference).toBe('tie');
    expect(fixedTie.separate.fixedCost).not.toBe(fixedTie.bundle.fixedCost);
    expect(bundlePreference(fixedTie.separate, fixedTie.bundle)).toBe('tie');
    expect(cell('fixedBasis', 'fail', 'shared-once')).toMatchObject({
      preference: 'bundle',
      separate: { value: 12, workSpent: 7 },
      bundle: { value: 12, workSpent: 6 },
    });
    expect(cell('fixedBasis', 'fail', 'per-job').preference).toBe('separate');
    expect(cell('assignees', 'fail', 1).preference).toBe('separate');
    expect(cell('assignees', 'fail', 2)).toMatchObject({
      preference: 'bundle',
      separate: { value: 12, workSpent: 9 },
      bundle: { value: 12, workSpent: 8 },
    });
    expect(cell('valueA', 'fail', 0).preference).toBe('tie');
    expect(cell('valueA', 'fail', 1).preference).toBe('separate');
    expect(cell('valueB', 'fail', 0).preference).toBe('separate');
    expect(cell('valueB', 'fail', 12).preference).toBe('separate');
    expect(
      rows.reversals.map(
        (row) =>
          `${row.factor}/${row.board}:${row.before.level}:${row.before.preference}->${row.after.level}:${row.after.preference}`,
      ),
    ).toEqual([
      'horizon/safe:2:tie->3:separate',
      'horizon/safe:3:separate->4:bundle',
      'horizon/fail:2:tie->3:separate',
      'horizon/fail:7:separate->8:bundle',
      'valueA/fail:0:tie->1:separate',
      'precursor/fail:0:separate->1:bundle',
      'partialSuccess/fail:no:separate->yes:bundle',
      'bundleOpCost/safe:1:bundle->2:tie',
      'bundleOpCost/safe:2:tie->3:separate',
      'fixedCost/safe:0:tie->1:bundle',
      'fixedCost/safe:5:bundle->6:separate',
      'fixedCost/safe:6:separate->7:tie',
      'fixedCost/fail:0:separate->1:tie',
      'fixedCost/fail:1:tie->2:separate',
      'fixedCost/fail:6:separate->7:tie',
      'fixedBasis/safe:shared-once:bundle->per-job:tie',
      'fixedBasis/fail:shared-recheck:separate->shared-once:bundle',
      'fixedBasis/fail:shared-once:bundle->per-job:separate',
      'assignees/fail:1:separate->2:bundle',
    ]);
  });
  it('予兆・部分成功・操作費・担当は公開した失敗条件の上でだけ効く', () => {
    let partial = createBundleFactorState('RI-167', 'partialSuccess', 'fail', 'yes');
    partial = applyBundleInput(partial, { type: 'bundle', ids: ['a', 'b'] });
    for (let step = 0; step < 4; step++)
      partial = applyBundleInput(partial, { type: 'work', id: 'a' });
    expect(partial.jobs.map((job) => [job.stage, job.rechecks, job.doneTick])).toEqual([
      ['done', 0, 4],
      ['review', 1, null],
    ]);
    expect(partial.groups[0]).toMatchObject({ ids: ['b'], workLeft: 3, failed: true });
    expect(applyBundleInput(partial, { type: 'bundle', ids: ['a', 'b'] })).toBe(partial);
    let early = createBundleFactorState('RI-167', 'precursor', 'fail', 1);
    early = applyBundleInput(early, { type: 'bundle', ids: ['a', 'b'] });
    for (let step = 0; step < 3; step++) early = applyBundleInput(early, { type: 'work', id: 'a' });
    expect(early.tick).toBe(3);
    expect(early.groups[0]).toMatchObject({ failed: true, workLeft: 4, ids: ['a', 'b'] });
    expect(early.jobs.map((job) => job.stage)).toEqual(['review', 'review']);
    const costly = createBundleFactorState('RI-167', 'bundleOpCost', 'safe', 2);
    const bundled = applyBundleInput(costly, { type: 'bundle', ids: ['a', 'b'] });
    expect(bundled.tick).toBe(2);
    expect(bundled.workSpent).toBe(2);
    expect(bundled.groups[0].workLeft).toBe(4);
    const rejected = createBundleFactorState('RI-167', 'bundleOpCost', 'safe', 2);
    expect(applyBundleInput({ ...rejected, tick: 6 }, { type: 'bundle', ids: ['a', 'b'] })).toEqual(
      expect.objectContaining({ tick: 6, groups: rejected.groups }),
    );
    let parallel = createBundleFactorState('RI-167', 'assignees', 'safe', 2);
    parallel = applyBundleInput(parallel, { type: 'work', id: 'a' });
    expect(parallel.groups.map((group) => group.workLeft)).toEqual([2, 2]);
    expect(parallel.workSpent).toBe(2);
    expect(createBundlePrototype('RI-167')).not.toHaveProperty('rules');
  });
  it('要因比較も毎入力のJSON保存再開と再生が一致する', () => {
    const rows = compareBundleFactorReversals(factors.conditions.seed);
    for (const series of rows.series) {
      for (const point of series.points) {
        for (const strategy of ['separate', 'bundle'] as const) {
          let live = createBundleFactorState(
            factors.conditions.seed,
            series.factor,
            series.board,
            point.level,
          );
          let saved = structuredClone(live);
          for (const input of point[strategy].inputs) {
            const before = structuredClone(live);
            const previous = live;
            live = applyBundleInput(live, input);
            saved = applyBundleInput(JSON.parse(JSON.stringify(saved)), input);
            expect(previous).toEqual(before);
            expect(saved).toEqual(live);
          }
          const summary = summarizeBundle(live);
          expect(summary.value).toBe(point[strategy].value);
          expect(summary.workSpent).toBe(point[strategy].workSpent);
          expect(summary.fixedCost).toBe(point[strategy].fixedCost);
          expect(live.jobs.map((job) => job.rechecks)).toEqual(point[strategy].rechecks);
          expect(live.jobs.map((job) => job.doneTick)).toEqual(point[strategy].doneTicks);
          expect(summary.remaining.reduce((sum, group) => sum + group.workLeft, 0)).toBe(
            point[strategy].remainingWork,
          );
          expect(live.inputs).toEqual(point[strategy].inputs);
        }
      }
    }
  });
});
