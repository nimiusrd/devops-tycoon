import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/spec-investigation-comparison.json';
import {
  compareInvestigationStrategies,
  createInvestigationPrototype,
  investigationView,
  replayInvestigation,
  tickInvestigationPrototype,
} from './specInvestigation';

describe('RI-156 曖昧な一件の仕様調査', () => {
  it('調査前はリスクを隠し、読む回数で予定や結果を変えない', () => {
    const state = createInvestigationPrototype(comparison.seeds[1]);
    const before = structuredClone(state);
    const view = investigationView(state);
    expect(view.task.risk).toBeNull();
    expect(view.task.avoidedRework).toBeNull();
    for (let i = 0; i < 20; i++) expect(investigationView(state)).toEqual(view);
    expect(state).toEqual(before);
    expect(createInvestigationPrototype(comparison.seeds[1])).toEqual(state);
  });
  it('調査が2tickの容量を譲り、対象情報だけを更新する', () => {
    const initial = createInvestigationPrototype(comparison.seeds[1]);
    const started = tickInvestigationPrototype(initial, 'investigate');
    expect(started.researchLeft).toBe(1);
    expect(investigationView(started).task.risk).toBeNull();
    const done = tickInvestigationPrototype(started, 'work');
    expect(done.deadline.board.tick).toBe(2);
    expect(done.deadline.board.tasks).toEqual(initial.deadline.board.tasks);
    expect(done.researchTicks).toBe(2);
    expect(investigationView(done).task.risk).toBe(initial.hiddenRisk);
    expect(investigationView(done).otherTask).toEqual(investigationView(initial).otherTask);
    expect(done.deadline.focus).toBe(initial.deadline.focus);
    expect(tickInvestigationPrototype(done, 'investigate')).toBe(done);
  });
  it('低リスクは急ぎ、高リスクは調べる方が出荷価値を得る', () => {
    const results = compareInvestigationStrategies(comparison.seeds);
    expect(results).toEqual(comparison.results);
    expect(results.map((result) => result.risk)).toEqual(['low', 'low', 'high', 'high']);
    expect(results[0].shipped[0].value).toBeGreaterThan(results[1].shipped[0].value);
    expect(results[2].shipped).toEqual([]);
    expect(results[3].shipped[0].value).toBe(5);
    expect(results[0].researchTicks).toBe(0);
    expect(results[1].researchTicks).toBe(2);
  });
  it('調査途中の保存再開・入力再生・表示投影が一致する', () => {
    const initial = createInvestigationPrototype(comparison.seeds[1]);
    const snapshot = structuredClone(initial);
    let state = tickInvestigationPrototype(initial, 'investigate');
    expect(initial).toEqual(snapshot);
    let restored = JSON.parse(JSON.stringify(state));
    for (const action of ['work', 'work', 'work', 'work', 'work'] as const) {
      investigationView(restored);
      state = tickInvestigationPrototype(state, action);
      restored = tickInvestigationPrototype(restored, action);
    }
    expect(restored).toEqual(state);
    expect(replayInvestigation(comparison.seeds[1], state.history)).toEqual(state);
    expect(tickInvestigationPrototype(state, 'investigate')).toBe(state);
    expect(state.deadline.board.shipped).toHaveLength(1);
  });
  it('着手後の調査と資源不足の介入は予定・時間を変えない', () => {
    const initial = createInvestigationPrototype(comparison.seeds[1]);
    const limited = { ...initial, deadline: { ...initial.deadline, focus: 0 } };
    expect(tickInvestigationPrototype(limited, 'boost')).toBe(limited);
    const working = tickInvestigationPrototype(initial, 'work');
    expect(working.deadline.board.tasks[0].workLeft).toBe(6);
    expect(tickInvestigationPrototype(working, 'investigate')).toBe(working);
  });
});
