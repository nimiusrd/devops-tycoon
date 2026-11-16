import { describe, expect, it } from 'vitest';
import {
  applyTeamDependency as apply,
  baselineDependencyRules,
  chooseDependencyAction,
  chooseDependencyFactorInput,
  compareTeamDependencies,
  compareTeamDependencyFactors,
  createTeamDependencyFactorState,
  createTeamDependencyPrototype as create,
  dependencyEdges,
  jobEligible,
  summarizeTeamDependency,
  supportMany,
  viewTeamDependencies,
  type DependencyRules,
} from './teamDependencies';
import comparison from '../../docs/prototypes/team-dependencies-comparison.json';
import factors from '../../docs/prototypes/team-dependencies-factor-comparison.json';

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
    expect(forward.inputs[forward.inputs.length - 1]).toEqual({
      type: 'support-batch',
      teams: ['platform', 'product'],
    });
    expect(forward.tick).toBe(opening.tick + 1);
    const replayed = apply(JSON.parse(JSON.stringify(opening)), {
      type: 'support-batch',
      teams: ['platform', 'product'],
    });
    expect(replayed).toEqual(forward);
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

function changedKeys(rules: DependencyRules): (keyof DependencyRules)[] {
  return (Object.keys(baselineDependencyRules) as (keyof DependencyRules)[]).filter(
    (key) => rules[key] !== baselineDependencyRules[key],
  );
}

describe('RI-216 要因の反転', () => {
  it('自チーム処理・分割・期末・期限の再計算がJSONと一致する', () => {
    expect(compareTeamDependencyFactors()).toEqual(factors);
  });

  it('基準行は初回の上流支援と危機支援に一致し、動かした規則は一つである', () => {
    const data = compareTeamDependencyFactors();
    const first = compareTeamDependencies(comparison.seed);
    expect(data.conditions.fixedStrategies).toBe(true);
    expect(data.conditions.humanPlaytest).toBe(false);
    expect(data.conditions.productionAdoption).toBe(false);
    expect(data.conditions.repeatedFirstComparison).toBe(false);
    const baselines = [
      data.sweeps.passive.find((item) => item.parameter === '0'),
      data.sweeps.split.find((item) => item.parameter === '1'),
      data.sweeps.deadline.find((item) => item.parameter === '2'),
      ...data.sweeps.horizon.filter((item) => item.parameter === '3' || item.parameter === '4'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const board of point.boards) {
        const aware = first.find(
          (row) =>
            row.strategy === 'upstream' &&
            ((board.horizon === 3 && row.board === 'tight') ||
              (board.horizon === 4 && row.board === 'open')),
        );
        const blind = first.find(
          (row) =>
            row.strategy === 'crisis' &&
            ((board.horizon === 3 && row.board === 'tight') ||
              (board.horizon === 4 && row.board === 'open')),
        );
        if (!aware || !blind) throw new Error(String(board.horizon));
        expect(board.aware.inputs).toEqual(aware.inputs);
        expect(board.aware.result).toEqual(aware.result);
        expect(board.blind.inputs).toEqual(blind.inputs);
        expect(board.blind.result).toEqual(blind.result);
      }
    }
    const only: Record<string, keyof DependencyRules | null> = {
      passive: 'passive',
      split: 'split',
      horizon: null,
      deadline: 'deadline',
    };
    for (const [axis, key] of Object.entries(only)) {
      for (const item of data.sweeps[axis as keyof typeof data.sweeps]) {
        const changed = changedKeys(item.rules);
        expect(changed.every((name) => name === key)).toBe(true);
        if (key === null) expect(changed).toEqual([]);
      }
    }
  });

  it('優劣が反転する位置は自チーム処理、分割、期末、期限に分かれる', () => {
    const data = compareTeamDependencyFactors();
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.before.parameter,
        item.before.horizon,
        item.before.preference,
        item.before.aware,
        item.before.blind,
        item.after.parameter,
        item.after.horizon,
        item.after.preference,
        item.after.aware,
        item.after.blind,
      ]),
    ).toEqual([
      ['passive', '0', 3, 'blind', 1, 6, '1', 3, 'aware', 19, 15],
      ['passive', '0', 4, 'aware', 9, 7, '1', 4, 'tie', 19, 19],
      ['passive', '1', 3, 'aware', 19, 15, '2', 3, 'tie', 19, 19],
      ['split', '1', 3, 'blind', 1, 6, '2', 3, 'tie', 0, 0],
      ['split', '1', 4, 'aware', 9, 7, '2', 4, 'tie', 1, 1],
      ['horizon', '3', 3, 'blind', 1, 6, '4', 4, 'aware', 9, 7],
      ['horizon', '5', 5, 'aware', 9, 7, '6', 6, 'blind', 9, 15],
      ['deadline', '0', 3, 'tie', 1, 1, '1', 3, 'blind', 1, 6],
    ]);
    const horizon = (parameter: string) =>
      data.sweeps.horizon.find((item) => item.parameter === parameter)?.boards[0];
    expect(horizon('7')?.aware.result.pending).toEqual(['followup']);
    expect(horizon('7')?.blind.result.pending).toEqual(['followup']);
    expect(horizon('7')?.preference).toBe('blind');
    expect(horizon('8')?.aware.result.delivered.map((item) => [item.id, item.value])).toEqual([
      ['gate', 1],
      ['feature', 8],
      ['hot', 0],
      ['followup', 4],
    ]);
    expect(horizon('8')?.blind.result.score).toBe(19);
    expect(horizon('6')?.aware.result.delivered.find((item) => item.id === 'hot')).toEqual({
      id: 'hot',
      tick: 5,
      value: 0,
    });
    const split = data.sweeps.split.find((item) => item.parameter === '2')?.boards[1];
    expect(split?.aware.inputs[0]).toEqual({
      type: 'support-batch',
      teams: ['platform', 'incident'],
    });
    expect(split?.blind.inputs[0]).toEqual({
      type: 'support-batch',
      teams: ['incident', 'platform'],
    });
    expect(split?.aware.result.delivered.find((item) => item.id === 'hot')?.value).toBe(0);
    const openDeadline = data.sweeps.deadline.flatMap((item) =>
      item.boards.filter((board) => board.horizon === 4).map((board) => board.preference),
    );
    expect(openDeadline).toEqual(['aware', 'aware', 'aware', 'aware']);
  });

  it('自チーム処理があっても、完了と同じ期間には下流を進めない', () => {
    const rules = { ...baselineDependencyRules, passive: 1 };
    let state = createTeamDependencyFactorState(4, rules);
    state = apply(state, { type: 'support', team: 'platform' }, rules);
    expect(state.jobs.find((job) => job.id === 'gate')).toMatchObject({ workLeft: 0, doneTick: 0 });
    expect(state.jobs.find((job) => job.id === 'feature')?.workLeft).toBe(2);
    expect(jobEligible(state, 'feature')).toBe(true);
    expect(state.version).toBe(1);
  });

  it('要因比較の入力を再生すると差引が一致し、期末後は同じ状態を返す', () => {
    const data = compareTeamDependencyFactors();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const board of item.boards) {
        for (const judgment of ['aware', 'blind'] as const) {
          const run = board[judgment];
          let state = createTeamDependencyFactorState(board.horizon, item.rules);
          expect(state.jobs.find((job) => job.id === 'hot')?.deadline).toBe(item.rules.deadline);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseDependencyFactorInput(state, judgment, item.rules)).toEqual(input);
            if (item.rules.split <= 1) {
              const legacy = judgment === 'aware' ? 'upstream' : 'crisis';
              expect(chooseDependencyAction(state, legacy)).toEqual(input);
            }
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
          }
          expect(summarizeTeamDependency(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(state.tick).toBe(board.horizon);
          expect(apply(state, { type: 'support', team: 'platform' }, item.rules)).toBe(state);
        }
      }
    }
  });
});
