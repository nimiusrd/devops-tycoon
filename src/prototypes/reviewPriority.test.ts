import { describe, expect, it } from 'vitest';
import {
  createPriorityPrototype,
  applyPriorityInput,
  summarizePriority,
  comparePriorityStrategies,
  comparePriorityFactorReversals,
  createPriorityFactorState,
  baselinePriorityRules,
  type PriorityRules,
} from './reviewPriority';
import comparison from '../../docs/prototypes/review-priority-comparison.json';
import factors from '../../docs/prototypes/review-priority-factor-comparison.json';

describe('RI-165 レビュー追い越し', () => {
  it('対象だけ先頭へ動かし、他の順序・進捗・時刻を保持する', () => {
    const initial = createPriorityPrototype(1, 'b');
    const snapshot = structuredClone(initial);
    const promoted = applyPriorityInput(initial, { type: 'promote', id: 'b' });
    expect(promoted.board.jobs.map((job) => job.id)).toEqual(['b', 'a', 'c']);
    expect(promoted.board.jobs.every((job) => job.reviewLeft === 2 && job.stage === 'review')).toBe(
      true,
    );
    expect(promoted.board.tick).toBe(0);
    expect(promoted.focus).toBe(4);
    expect(applyPriorityInput(promoted, { type: 'promote', id: 'b' })).toBe(promoted);
    expect(initial).toEqual(snapshot);
  });
  it('先頭の処理後も他PRが安定順序で続き、後回しの待ちを記録する', () => {
    let state = applyPriorityInput(createPriorityPrototype(1, 'b'), { type: 'promote', id: 'b' });
    for (let i = 0; i < 3; i++) state = applyPriorityInput(state, { type: 'tick' });
    expect(state.board.jobs.find((job) => job.id === 'b')).toMatchObject({
      stage: 'done',
      completedTick: 3,
    });
    expect(state.board.jobs.find((job) => job.id === 'a')).toMatchObject({
      stage: 'review',
      reviewLeft: 1,
    });
    expect(state.reviewWait).toEqual({ a: 2, b: 0, c: 3 });
    expect(applyPriorityInput(state, { type: 'promote', id: 'c' })).toBe(state);
  });
  it('未知対象・Review以外・資源不足・期末を無消費で拒否する', () => {
    const initial = createPriorityPrototype(1, 'b');
    expect(applyPriorityInput(initial, { type: 'promote', id: 'missing' })).toBe(initial);
    const poor = { ...initial, focus: 1 };
    expect(applyPriorityInput(poor, { type: 'promote', id: 'b' })).toBe(poor);
    expect(applyPriorityInput(poor, { type: 'rush' })).toBe(poor);
    let state = initial;
    for (let i = 0; i < 2; i++) state = applyPriorityInput(state, { type: 'tick' });
    expect(applyPriorityInput(state, { type: 'promote', id: 'a' })).toBe(state);
    const exhausted = { ...state, board: { ...state.board, budget: 0 } };
    expect(applyPriorityInput(exhausted, { type: 'tick' })).toBe(exhausted);
    const ended = { ...state, board: { ...state.board, tick: state.board.horizon } };
    expect(applyPriorityInput(ended, { type: 'rush' })).toBe(ended);
  });
  it('一括即処理は先頭2件のレビューだけを完了し、CIを飛ばさない', () => {
    const rushed = applyPriorityInput(createPriorityPrototype(1, 'b'), { type: 'rush' });
    expect(rushed.board.jobs.map((job) => job.reviewLeft)).toEqual([0, 0, 2]);
    expect(rushed.board.jobs.every((job) => job.stage === 'review')).toBe(true);
    expect(rushed.focusSpent).toBe(6);
    expect(summarizePriority(rushed).value).toBe(0);
  });
  it('期限が変わると順番維持と追い越しの優劣が反転する', () => {
    expect(comparePriorityStrategies(comparison.seed)).toEqual(comparison.results);
    const [aFifo, aPromote, , bFifo, bPromote, bRush] = comparison.results;
    expect(aFifo.result.netValue).toBeGreaterThan(aPromote.result.netValue);
    expect(bPromote.result.netValue).toBeGreaterThan(bFifo.result.netValue);
    expect(bPromote.result.netValue).toBeGreaterThan(bRush.result.netValue);
    expect(bPromote.result.reviewWait.a).toBeGreaterThan(bFifo.result.reviewWait.a);
    expect(bPromote.result.focusSpent).toBeLessThan(bRush.result.focusSpent);
  });
  it('順序変更後・Review途中・CI待ちの保存再開と入力再生が一致する', () => {
    for (const row of comparePriorityStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = applyPriorityInput(live, input);
        restored = applyPriorityInput(JSON.parse(JSON.stringify(restored)), input);
        expect(restored).toEqual(live);
        expect(new Set(live.board.jobs.map((job) => job.id)).size).toBe(3);
      }
      expect(summarizePriority(live)).toEqual(row.result);
    }
  });
  it('初回と同じ資源で要因を一つずつ動かし、優劣の変化を再計算できる', () => {
    const sweep = comparePriorityFactorReversals(factors.conditions.seed);
    expect(sweep).toEqual(factors);
    expect(sweep.conditions).toMatchObject({
      urgent: 'b',
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegrated: false,
      oneAtATime: true,
      incidentLottery: false,
      playerTargetLoad: false,
    });
    const first = comparePriorityStrategies(factors.conditions.seed);
    const fifo = first.find((row) => row.urgent === 'b' && row.strategy === 'fifo')!;
    const moved = first.find((row) => row.urgent === 'b' && row.strategy === 'promote-b')!;
    const ruleKeys = Object.keys(baselinePriorityRules) as (keyof PriorityRules)[];
    for (const series of sweep.series) {
      for (const point of series.points) {
        const diffs = ruleKeys.filter((key) => point.rules[key] !== baselinePriorityRules[key]);
        expect(diffs.length).toBeLessThanOrEqual(1);
        if (diffs.length === 0) {
          expect(point.preference).toBe('move');
          expect(point.keep).toMatchObject({ inputs: fifo.inputs, result: fifo.result });
          expect(point.move).toMatchObject({ inputs: moved.inputs, result: moved.result });
        }
        for (const strategy of ['keep', 'move'] as const) {
          let live = createPriorityFactorState(factors.conditions.seed, point.rules);
          let restored = structuredClone(live);
          for (const input of point[strategy].inputs) {
            live = applyPriorityInput(live, input);
            restored = applyPriorityInput(JSON.parse(JSON.stringify(restored)), input);
            expect(restored).toEqual(live);
            expect(new Set(live.board.jobs.map((job) => job.id)).size).toBe(3);
          }
          expect(summarizePriority(live)).toEqual(point[strategy].result);
          expect(live.board.tick).toBe(live.board.horizon);
          expect(point[strategy].inputs.some((input) => input.type === 'rush')).toBe(false);
        }
      }
    }
    const cell = (factor: string, level: number | string) =>
      sweep.series
        .find((series) => series.factor === factor)!
        .points.find((point) => point.level === level)!;
    expect(cell('deadlineB', 2)).toMatchObject({
      preference: 'keep',
      keep: { result: { netValue: 10 } },
      move: { result: { netValue: 8 } },
    });
    expect(cell('deadlineB', 3)).toMatchObject({
      preference: 'move',
      keep: { result: { netValue: 10 } },
      move: { result: { netValue: 18 } },
    });
    expect(cell('deadlineB', 4).preference).toBe('move');
    expect(cell('deadlineB', 5)).toMatchObject({
      preference: 'keep',
      keep: { result: { netValue: 20 } },
      move: { result: { netValue: 18 } },
    });
    expect(cell('focusValue', 4).preference).toBe('move');
    expect(cell('focusValue', 5)).toMatchObject({
      preference: 'tie',
      keep: { result: { netValue: 10 } },
      move: { result: { netValue: 10 } },
    });
    expect(cell('focusValue', 6)).toMatchObject({
      preference: 'keep',
      move: { result: { netValue: 8 } },
    });
    expect(cell('effortB', 2).preference).toBe('move');
    expect(cell('effortB', 3)).toMatchObject({
      preference: 'keep',
      move: { result: { netValue: 8 } },
    });
    expect(cell('reserveAfter', 0).preference).toBe('move');
    expect(cell('reserveAfter', 1)).toMatchObject({
      preference: 'keep',
      move: { result: { netValue: 8 } },
    });
    expect(cell('reserveAfter', 2).move.inputs.map((input) => input.type)).toContain('apply');
    expect(cell('elapsed', 0).preference).toBe('move');
    expect(cell('elapsed', 1)).toMatchObject({
      preference: 'keep',
      move: { result: { netValue: 8 } },
    });
    expect(cell('reactRotations', 1)).toMatchObject({
      preference: 'move',
      move: { result: { netValue: 14 } },
    });
    expect(
      cell('reactRotations', 1).move.result.jobs.find((job) => job.id === 'b')!.completedTick,
    ).toBeNull();
    expect(cell('reactRotations', 2)).toMatchObject({
      preference: 'keep',
      move: { result: { netValue: 8 } },
    });
    expect(cell('reactRotations', 3).preference).toBe('move');
    expect(cell('failure', 'b')).toMatchObject({
      preference: 'keep',
      keep: { result: { netValue: 8 } },
      move: { result: { netValue: 0 } },
    });
    expect(cell('failure', 'none').preference).toBe('move');
    expect(cell('failure', 'c').preference).toBe('move');
    const atSix = cell('assignees', 6);
    expect(atSix.preference).toBe('move');
    expect(atSix.keep.result.jobs.find((job) => job.id === 'b')!.completedTick).toBe(4);
    expect(atSix.move.result.jobs.find((job) => job.id === 'b')!.completedTick).toBe(2);
    for (const point of sweep.series.find((series) => series.factor === 'waitPenalty')!.points) {
      const total = (wait: Record<string, number>) =>
        Object.values(wait).reduce((sum, value) => sum + value, 0);
      expect(point.preference).toBe('move');
      expect(point.move.result.netValue - point.keep.result.netValue).toBe(8);
      expect(total(point.keep.result.reviewWait)).toBe(total(point.move.result.reviewWait));
    }
    expect(
      sweep.reversals.map((row) => [
        row.factor,
        row.before.level,
        row.before.preference,
        row.after.level,
        row.after.preference,
      ]),
    ).toEqual([
      ['reserveAfter', 0, 'move', 1, 'keep'],
      ['effortB', 2, 'move', 3, 'keep'],
      ['deadlineB', 2, 'keep', 3, 'move'],
      ['deadlineB', 4, 'move', 5, 'keep'],
      ['focusValue', 4, 'move', 5, 'tie'],
      ['focusValue', 5, 'tie', 6, 'keep'],
      ['reactRotations', 1, 'move', 2, 'keep'],
      ['reactRotations', 2, 'keep', 3, 'move'],
      ['elapsed', 0, 'move', 1, 'keep'],
      ['failure', 'none', 'move', 'b', 'keep'],
      ['failure', 'b', 'keep', 'a', 'move'],
    ]);
  });
});
