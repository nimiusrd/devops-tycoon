import { describe, expect, it } from 'vitest';
import {
  applyTeamDependency as apply,
  chooseDependencyAction,
  compareTeamDependencies,
  createTeamDependencyPrototype as create,
  dependencyEdges,
  jobEligible,
  summarizeTeamDependency,
  supportMany,
  viewTeamDependencies,
} from './teamDependencies';
import comparison from '../../docs/prototypes/team-dependencies-comparison.json';

describe('RI-216 チーム間の依存', () => {
  it('依存2本の解除条件と、止まっている仕事を事前に示す', () => {
    const first = create('RI-216', 'tight');
    expect(create('RI-216', 'tight')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewTeamDependencies(first);
    for (let i = 0; i < 8; i++) expect(viewTeamDependencies(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(dependencyEdges(first.jobs)).toEqual([
      { requires: 'gate', unlocks: 'feature', source: 'platform', target: 'product' },
      { requires: 'gate', unlocks: 'followup', source: 'platform', target: 'incident' },
    ]);
    expect(blank.edges.map((edge) => edge.unlocked)).toEqual([false, false]);
    expect(blank.jobs.find((job) => job.id === 'feature')).toMatchObject({
      eligible: false,
      workLeft: 2,
      requires: ['gate'],
    });
    expect(blank.fanout).toEqual({ platform: 2, product: 0, incident: 0 });
    expect(blank).not.toHaveProperty('capacityMul');
  });

  it('同じ期間の支援順では下流が進まず、次の期間から対象になる', () => {
    let opening = create('RI-216', 'open');
    opening = apply(opening, { type: 'support', team: 'platform' });
    const forward = supportMany(opening, ['platform', 'product']);
    const reverse = supportMany(opening, ['product', 'platform']);
    expect(forward.jobs.map(({ id, workLeft, doneTick }) => ({ id, workLeft, doneTick }))).toEqual(
      reverse.jobs.map(({ id, workLeft, doneTick }) => ({ id, workLeft, doneTick })),
    );
    expect(forward.delivered).toEqual([{ id: 'gate', tick: opening.tick, value: 1 }]);
    expect(forward.jobs.find((job) => job.id === 'feature')!.workLeft).toBe(2);
    expect(jobEligible(forward, 'feature')).toBe(true);
    expect(jobEligible(forward, 'followup')).toBe(true);
    expect(forward.wasted).toBe(1);
  });

  it('期限を過ぎた独立仕事は価値が落ち、閲覧の有無では結果が変わらない', () => {
    let late = create('RI-216', 'open');
    late = apply(late, { type: 'wait' });
    late = apply(late, { type: 'wait' });
    late = apply(late, { type: 'support', team: 'incident' });
    late = apply(late, { type: 'support', team: 'incident' });
    expect(summarizeTeamDependency(late)).toMatchObject({
      value: 0,
      score: 0,
      lost: false,
      delivered: [{ id: 'hot', tick: 3, value: 0 }],
    });

    let unseen = create('RI-216', 'tight');
    let seen = unseen;
    for (const team of ['platform', 'product', 'incident'] as const) {
      seen = apply(seen, { type: 'view', team });
    }
    expect(apply(seen, { type: 'view', team: 'platform' })).toBe(seen);
    while (unseen.tick < unseen.horizon)
      unseen = apply(unseen, { type: 'support', team: 'platform' });
    while (seen.tick < seen.horizon) seen = apply(seen, { type: 'support', team: 'platform' });
    expect(summarizeTeamDependency(seen).score).toBe(summarizeTeamDependency(unseen).score);
    expect(seen.jobs.map(({ workLeft, doneTick }) => ({ workLeft, doneTick }))).toEqual(
      unseen.jobs.map(({ workLeft, doneTick }) => ({ workLeft, doneTick })),
    );
  });

  it('前提を解いた次の期間に、後続の仕事へ支援できる', () => {
    let state = { ...create('RI-216', 'open'), horizon: 6 };
    state = apply(state, { type: 'support', team: 'incident' });
    state = apply(state, { type: 'support', team: 'incident' });
    expect(state.delivered).toEqual([{ id: 'hot', tick: 1, value: 6 }]);
    state = apply(state, { type: 'support', team: 'platform' });
    state = apply(state, { type: 'support', team: 'platform' });
    expect(state.tick).toBe(4);
    expect(jobEligible(state, 'followup')).toBe(true);
    const before = state.jobs.find((job) => job.id === 'followup')!.workLeft;
    state = apply(state, { type: 'support', team: 'incident' });
    expect(state.jobs.find((job) => job.id === 'followup')!.workLeft).toBe(before - 1);
    expect(state.jobs.find((job) => job.id === 'feature')!.workLeft).toBe(before);
  });

  it('短い期末は危機支援、余裕のある期末は上流支援の差引が上回る', () => {
    const rows = compareTeamDependencies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('tight', 'upstream'), score('tight', 'crisis')]).toEqual([1, 6]);
    expect([score('open', 'upstream'), score('open', 'crisis')]).toEqual([9, 7]);
    const openUpstream = rows.find((row) => row.board === 'open' && row.strategy === 'upstream')!;
    expect(openUpstream.result.delivered.map((item) => item.id)).toEqual(['gate', 'feature']);
    expect(openUpstream.result.lost).toBe(false);
    expect(openUpstream.result.pending).toEqual(['followup', 'hot']);
  });

  it('全待ちでも敗北にせず、期末後の支援と未知のチームは状態を変えない', () => {
    let state = create('RI-216', 'tight');
    while (state.tick < state.horizon) state = apply(state, { type: 'wait' });
    expect(summarizeTeamDependency(state)).toMatchObject({ value: 0, lost: false, score: 0 });
    expect(apply(state, { type: 'support', team: 'platform' })).toBe(state);
    expect(apply(state, { type: 'wait' })).toBe(state);
    const fresh = create('RI-216', 'open');
    expect(apply(fresh, { type: 'support', team: 'billing' as 'platform' })).toBe(fresh);
    expect(supportMany(fresh, [])).toBe(fresh);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareTeamDependencies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseDependencyAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeTeamDependency(live)).toEqual(row.result);
    }
  });
});
