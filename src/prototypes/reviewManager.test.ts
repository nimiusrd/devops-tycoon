import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/review-manager-comparison.json';
import { REVIEW_HP_COST } from '../sim/model';
import { createRngFromState, getRngState } from '../sim/rng';
import { stepSprint } from '../sim/sprint';
import {
  applyReviewManager,
  compareReviewManager,
  createReviewManager,
  restoreReviewManager,
  saveReviewManager,
  summarizeReviewManager,
  viewReviewManager,
  REVIEW_MANAGER_LIMITS,
  type ReviewManagerState,
} from './reviewManager';

function start(seed = 'RI-266', maxTicks = 24) {
  return applyReviewManager(createReviewManager(seed, { maxTicks }), { type: 'start' });
}
function finish(state: ReviewManagerState) {
  for (let i = 0; i < REVIEW_MANAGER_LIMITS.ticks && state.phase === 'running'; i++) {
    state = applyReviewManager(state, { type: 'tick' });
  }
  return state;
}

describe('RI-266 レビュー責任者の隔離API', () => {
  it('開始前の方針・契機・支出が実行ログと一致し、発動と課金は一度だけ', () => {
    const initial = createReviewManager('RI-266');
    const before = structuredClone(initial);
    const view = viewReviewManager(initial);
    expect(initial).toEqual(before);
    expect(view.policy).toMatchObject({
      card: 'auto-test',
      trigger: 'start-once',
      acquisitionCost: 18,
      playFocusCost: 3,
    });
    const state = applyReviewManager(initial, { type: 'start' });
    expect(state.investmentLog).toEqual([
      { tick: 0, card: 'auto-test', outcome: 'applied', budgetSpent: 18, focusSpent: 3 },
    ]);
    expect(state.current).toMatchObject({
      budget: 6,
      org: { quality: 70, securityLevel: 68 },
      sprint: { focus: 5, metrics: { focusSpent: 3 }, cardPiles: { played: [0], hand: [] } },
    });
    expect(applyReviewManager(state, { type: 'start' })).toBe(state);
    expect(initial).toEqual(before);
    const end = finish(state);
    const result = summarizeReviewManager(end)!;
    expect(result).toMatchObject({ budget: 6, focus: 5, focusSpent: 3, reward: 0 });
    expect(end.investmentLog).toEqual(state.investmentLog);
    expect(summarizeReviewManager(end)).toEqual(result);
  });

  it('無介入対照が通常stepSprintとtickごとに一致する', () => {
    let state = start();
    const direct = structuredClone(state.current!);
    const rng = createRngFromState(direct.rngState);
    while (state.phase === 'running') {
      direct.tick++;
      stepSprint(direct.sprint, direct.org, rng, direct.tick);
      state = applyReviewManager(state, { type: 'tick' });
      expect(state.current!.sprint).toEqual(direct.sprint);
      expect(state.current!.org).toEqual(direct.org);
      expect(state.current!.rngState).toBe(getRngState(rng));
    }
  });

  it('任意順の指定が実stepSprintのレビュー順と一致し、他工程の位置を動かさない', () => {
    let state = start();
    for (let i = 0; i < 10; i++) {
      const direct = structuredClone(state.current!);
      const queue = direct.sprint.tasks.filter((t) => t.lane === 'review').reverse();
      let index = 0;
      direct.sprint.tasks = direct.sprint.tasks.map((t) =>
        t.lane === 'review' ? queue[index++] : t,
      );
      const rng = createRngFromState(direct.rngState);
      stepSprint(direct.sprint, direct.org, rng, direct.tick + 1);
      direct.sprint.tasks.sort((a, b) => a.id - b.id);
      state = applyReviewManager(state, { type: 'tick', order: queue.map((t) => t.id) });
      expect(state.current!.sprint).toEqual(direct.sprint);
      expect(state.current!.org).toEqual(direct.org);
      expect(state.current!.rngState).toBe(getRngState(rng));
    }
  });

  it('2群の成果・待ち・レビュー負荷が順序によって変わる', () => {
    const [none, important, ordinary] = compareReviewManager('RI-266', 12);
    expect(important.initial).toEqual(ordinary.initial);
    expect(none.initial).toEqual(ordinary.initial);
    expect(important.result.groups.important.done).toBeGreaterThan(
      ordinary.result.groups.important.done,
    );
    expect(important.result.groups.ordinary.done).toBeLessThan(
      ordinary.result.groups.ordinary.done,
    );
    expect(important.result.groups.ordinary.reviewOccupancyTicks).toBeGreaterThan(
      ordinary.result.groups.ordinary.reviewOccupancyTicks,
    );
    expect(important.result.groups.important.reviewHpDemand).toBeGreaterThan(
      ordinary.result.groups.important.reviewHpDemand,
    );
    expect(none.result.done).toBeGreaterThan(0);
  });

  it('群別試行回数は実simの出荷・手戻り・レビュー点火と一致する', () => {
    for (const seed of ['RI-266', 'RI-266:1', 'RI-266:2']) {
      const state = finish(start(seed, 60));
      const sprint = state.current!.sprint;
      const reviews = Object.values(state.current!.reviews).reduce((a, b) => a + b, 0);
      const ignites = sprint.events.filter(
        (e) => e.kind === 'ignite' && e.source === 'review',
      ).length;
      expect(reviews).toBe(sprint.metrics.doneCount + sprint.metrics.reworkCount + ignites);
      const result = summarizeReviewManager(state)!;
      expect(Object.values(result.groups).reduce((a, g) => a + g.reviewHpDemand, 0)).toBe(
        reviews * REVIEW_HP_COST,
      );
    }
  });

  it('無効入力・深さ/介入/投資・部分順列は状態とRNGを消費しない', () => {
    const ready = createReviewManager('RI-266');
    expect(applyReviewManager(ready, { type: 'tick' })).toBe(ready);
    const state = start();
    const before = structuredClone(state);
    for (const input of [
      null,
      {},
      { type: 'play', id: 'auto-test' },
      { type: 'review', depth: 'focused' },
      { type: 'tick', action: 'interruptReview' },
      { type: 'tick', order: [0] },
      { type: 'tick', order: Array(12).fill(0) },
      { type: 'tick', order: [-1] },
      { type: 'tick', order: [NaN] },
      { type: 'tick', order: [] },
    ]) {
      expect(applyReviewManager(state, input)).toBe(state);
    }
    expect(state).toEqual(before);
  });

  it('JSON再開はRNG位置を含め全入力の続きを一致させ、再課金しない', () => {
    for (const row of comparison.results) {
      let state = createReviewManager(row.seed, { maxTicks: row.maxTicks });
      for (const input of row.inputs) {
        const restored = restoreReviewManager(saveReviewManager(state));
        expect(restored).toEqual(state);
        expect(applyReviewManager(restored!, input)).toEqual(applyReviewManager(state, input));
        state = applyReviewManager(state, input);
      }
      expect(summarizeReviewManager(state)).toEqual(row.result);
      expect(state.investmentLog).toEqual(row.investmentLog);
      expect(state.inputs.length).toBeLessThanOrEqual(REVIEW_MANAGER_LIMITS.ticks + 1);
      expect(new TextEncoder().encode(saveReviewManager(state)).length).toBeLessThan(
        REVIEW_MANAGER_LIMITS.saveBytes,
      );
    }
  });

  it('成功完了・時間切れ・投資失敗後の操作と二重成果を拒否する', () => {
    const completed = finish(start('RI-266', 60));
    expect(summarizeReviewManager(completed)!.timedOut).toBe(false);
    const timeout = finish(start('RI-266', 1));
    expect(summarizeReviewManager(timeout)!.timedOut).toBe(true);
    const failed = applyReviewManager(createReviewManager('RI-266', { budget: 17 }), {
      type: 'start',
    });
    expect(failed.phase).toBe('failed');
    expect(failed.current).toBeNull();
    expect(failed.investmentLog[0]).toMatchObject({ budgetSpent: 0, focusSpent: 0 });
    for (const state of [completed, timeout, failed]) {
      expect(restoreReviewManager(saveReviewManager(state))).toEqual(state);
      for (const input of [{ type: 'start' }, { type: 'tick' }, { type: 'tick', order: [] }]) {
        expect(applyReviewManager(state, input)).toBe(state);
      }
    }
  });

  it('保存の上限・旧規則・不正履歴・RNG破損を復元前に拒否する', () => {
    const saved = JSON.parse(saveReviewManager(start()));
    for (const value of [
      { ...saved, version: 2 },
      { ...saved, ruleset: 'old' },
      { ...saved, seed: 'a'.repeat(129) },
      { ...saved, rngState: saved.rngState + 1 },
      { ...saved, inputs: [{ type: 'start' }, { type: 'start' }] },
      { ...saved, inputs: Array(62).fill({ type: 'tick' }) },
      { ...saved, options: { budget: 24, maxTicks: 61 } },
      { ...saved, options: { maxTicks: 24 } },
    ])
      expect(restoreReviewManager(JSON.stringify(value))).toBeNull();
    expect(restoreReviewManager(' '.repeat(REVIEW_MANAGER_LIMITS.saveBytes + 1))).toBeNull();
    expect(restoreReviewManager('{')).toBeNull();
    expect(() => createReviewManager('RI-266', { maxTicks: 0 })).toThrow();
  });
});
