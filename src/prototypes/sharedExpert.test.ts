import { describe, expect, it } from 'vitest';
import {
  applySharedExpert as apply,
  assignMany,
  baselineExpertRules,
  chooseExpertAction,
  compareSharedExpertFactorReversals,
  compareSharedExperts,
  createSharedExpert as create,
  createSharedExpertCase,
  summarizeSharedExpert,
  viewSharedExpert,
} from './sharedExpert';
import comparison from '../../docs/prototypes/shared-expert-comparison.json';
import factors from '../../docs/prototypes/shared-expert-factor-comparison.json';

describe('RI-218 共有専門家の取り合い', () => {
  it('1期間の支援枠と、依頼ごとの必要枠・チームを事前に示す', () => {
    const first = create('RI-218', 'due');
    expect(create('RI-218', 'due')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewSharedExpert(first);
    for (let i = 0; i < 8; i++) expect(viewSharedExpert(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank.slots).toBe(1);
    expect(blank.expert).toBeNull();
    expect(blank.requests.map((item) => [item.id, item.team, item.slots, item.status])).toEqual([
      ['ship', 'product', 2, 'pending'],
      ['risk', 'incident', 2, 'pending'],
      ['design', 'platform', 2, 'pending'],
    ]);
    expect(new Set(blank.requests.map((item) => item.team)).size).toBe(3);
  });

  it('同じ期間に複数チームへ配置できず、期限後の完了は価値0で保留を解く', () => {
    const fresh = create('RI-218', 'exposure');
    expect(assignMany(fresh, ['ship', 'risk'])).toBe(fresh);
    expect(assignMany(fresh, ['ship', 'ship'])).toBe(fresh);
    expect(apply(fresh, { type: 'assign', id: 'missing' })).toBe(fresh);

    let state = fresh;
    state = apply(state, { type: 'assign', id: 'ship' });
    expect(state.expert).toBe('product');
    state = apply(state, { type: 'assign', id: 'ship' });
    expect(state.delivered).toEqual([{ id: 'ship', tick: 1, value: 8 }]);
    expect(apply(state, { type: 'assign', id: 'ship' })).toBe(state);
    state = apply(state, { type: 'assign', id: 'risk' });
    state = apply(state, { type: 'assign', id: 'risk' });
    expect(state.expert).toBe('incident');
    expect(state.delivered[1]).toEqual({ id: 'risk', tick: 3, value: 0 });
    expect(viewSharedExpert(state).requests.find((item) => item.id === 'risk')).toMatchObject({
      status: 'done',
      openRisk: 0,
    });
    expect(viewSharedExpert(state).requests.find((item) => item.id === 'design')).toMatchObject({
      status: 'pending',
      openRisk: 4,
    });
    expect(summarizeSharedExpert(state).lost).toBe(false);
  });

  it('閲覧しても進捗は変わらず、全待ちでも敗北にしない', () => {
    const fresh = create('RI-218', 'due');
    let seen = fresh;
    for (const id of ['ship', 'risk', 'design']) seen = apply(seen, { type: 'view', id });
    expect(apply(seen, { type: 'view', id: 'ship' })).toBe(seen);
    expect(seen.requests).toEqual(fresh.requests);
    expect(seen.tick).toBe(0);
    let idle = fresh;
    while (idle.tick < idle.horizon) idle = apply(idle, { type: 'wait' });
    expect(summarizeSharedExpert(idle)).toMatchObject({
      value: 0,
      risk: 10,
      score: -10,
      pending: ['ship', 'risk', 'design'],
      lost: false,
    });
    expect(apply(idle, { type: 'assign', id: 'ship' })).toBe(idle);
  });

  it('期限が近い盤面は期限順、リスクが大きい盤面は影響順の差引が上回る', () => {
    const rows = compareSharedExperts(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([score('due', 'deadline'), score('due', 'impact')]).toEqual([8, 4]);
    expect([score('exposure', 'impact'), score('exposure', 'deadline')]).toEqual([7, 4]);
    const late = rows.find((row) => row.board === 'exposure' && row.strategy === 'deadline')!;
    expect(late.result.delivered).toContainEqual({ id: 'risk', tick: 3, value: 0 });
    expect(late.result.lost).toBe(false);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareSharedExperts(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseExpertAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeSharedExpert(live)).toEqual(row.result);
    }
  });
});

describe('RI-218 要因の反転', () => {
  it('依存で止まった依頼は進捗せず、前提の次の期間から進む', () => {
    const rules = { ...baselineExpertRules, blocked: true };
    let state = createSharedExpertCase('due', rules);
    expect(assignMany(state, ['design', 'blocked'])).toBe(state);
    const seen = viewSharedExpert(state);
    expect(seen.requests.find((item) => item.id === 'blocked')).toMatchObject({
      team: 'platform',
      slots: 2,
      status: 'pending',
      blocked: true,
      openRisk: 6,
    });
    expect(
      seen.requests.filter((item) => item.id !== 'blocked').every((item) => !item.blocked),
    ).toBe(true);
    state = apply(state, { type: 'assign', id: 'blocked' });
    expect(state.tick).toBe(1);
    expect(state.expert).toBe('platform');
    expect(state.requests.find((item) => item.id === 'blocked')?.progress).toBe(0);
    state = apply(state, { type: 'assign', id: 'design' });
    expect(viewSharedExpert(state).requests.find((item) => item.id === 'blocked')?.blocked).toBe(
      true,
    );
    state = apply(state, { type: 'assign', id: 'design' });
    expect(state.requests.find((item) => item.id === 'design')?.doneTick).toBe(2);
    expect(state.tick).toBe(3);
    expect(viewSharedExpert(state).requests.find((item) => item.id === 'blocked')?.blocked).toBe(
      false,
    );
    state = apply(state, { type: 'assign', id: 'blocked' });
    expect(state.requests.find((item) => item.id === 'blocked')?.progress).toBe(1);
    expect(summarizeSharedExpert(state).lost).toBe(false);
  });

  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareSharedExpertFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-218',
      horizon: 4,
      periodSlots: 1,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
      avoidsBlocked: false,
    });
    expect(data.allocateNeverBelowProceed).toBe(true);
    const baseline = (
      axis: 'slots' | 'deadlineShift' | 'riskScale',
      parameter: string,
      board: 'due' | 'exposure',
      blocked: boolean,
      strategy: 'deadline' | 'impact' | 'proceed',
    ) => {
      const point = data.sweeps[axis].find((item) => item.parameter === parameter);
      const row = point?.rows.find((item) => item.board === board && item.blocked === blocked);
      if (!row) throw new Error(`${axis}:${parameter}`);
      if (strategy === 'proceed') return row.proceed.result.score;
      return row.allocations.find((item) => item.strategy === strategy)?.result.score;
    };
    expect([
      baseline('slots', '2', 'due', false, 'deadline'),
      baseline('slots', '2', 'due', false, 'impact'),
      baseline('slots', '2', 'exposure', false, 'deadline'),
      baseline('slots', '2', 'exposure', false, 'impact'),
    ]).toEqual([8, 4, 4, 7]);
    expect(baseline('deadlineShift', '0', 'due', false, 'deadline')).toBe(8);
    expect(baseline('riskScale', '1', 'exposure', false, 'impact')).toBe(7);
    expect([
      baseline('slots', '2', 'due', false, 'proceed'),
      baseline('slots', '2', 'exposure', false, 'proceed'),
    ]).toEqual([-10, -19]);
    const edges = (axis: string, blocked: boolean) =>
      data.reversals
        .filter((item) => item.axis === axis && item.blocked === blocked)
        .map((item) => [
          item.board,
          item.strategy,
          item.before.parameter,
          item.before.preference,
          item.after.parameter,
          item.after.preference,
        ]);
    expect(edges('deadlineShift', false)).toEqual([]);
    expect(edges('riskScale', false)).toEqual([]);
    expect(edges('slots', false)).toEqual([
      ['due', 'deadline', '4', 'allocate', '5', 'tie'],
      ['due', 'impact', '4', 'allocate', '5', 'tie'],
      ['exposure', 'deadline', '4', 'allocate', '5', 'tie'],
      ['exposure', 'impact', '4', 'allocate', '5', 'tie'],
    ]);
    expect(edges('slots', true).some((item) => item[0] === 'due' && item[1] === 'impact')).toBe(
      false,
    );
    expect(
      data.blockedOnlyReversals.map((item) => [
        item.axis,
        item.board,
        item.strategy,
        item.before.parameter,
        item.before.plain,
        item.before.blocked,
        item.after.parameter,
        item.after.plain,
        item.after.blocked,
      ]),
    ).toEqual([
      ['deadlineShift', 'due', 'deadline', '0', 'allocate', 'allocate', '1', 'allocate', 'tie'],
      [
        'deadlineShift',
        'exposure',
        'deadline',
        '1',
        'allocate',
        'allocate',
        '2',
        'allocate',
        'tie',
      ],
      ['riskScale', 'exposure', 'impact', '0', 'allocate', 'tie', '1', 'allocate', 'allocate'],
      ['riskScale', 'due', 'impact', '1', 'allocate', 'tie', '2', 'allocate', 'allocate'],
    ]);
    expect(
      data.differsWithBlocked
        .filter((item) => item.axis === 'slots')
        .map((item) => [item.parameter, item.board, item.strategy, item.plain, item.blocked]),
    ).toEqual([
      ['1', 'due', 'impact', 'allocate', 'tie'],
      ['2', 'due', 'impact', 'allocate', 'tie'],
      ['3', 'due', 'impact', 'allocate', 'tie'],
      ['4', 'due', 'impact', 'allocate', 'tie'],
    ]);
    expect([
      baseline('deadlineShift', '0', 'due', true, 'deadline'),
      baseline('deadlineShift', '1', 'due', true, 'deadline'),
      baseline('deadlineShift', '1', 'exposure', true, 'deadline'),
      baseline('deadlineShift', '2', 'exposure', true, 'deadline'),
      baseline('riskScale', '1', 'due', true, 'impact'),
      baseline('riskScale', '2', 'due', true, 'impact'),
      baseline('riskScale', '0', 'exposure', true, 'impact'),
      baseline('riskScale', '1', 'exposure', true, 'impact'),
    ]).toEqual([-5, -16, -16, -25, -16, -8, -6, -5]);
  });

  it('要因比較の入力を再生し、毎入力のJSON保存再開が一致する', () => {
    const data = compareSharedExpertFactorReversals();
    for (const points of Object.values(data.sweeps)) {
      for (const point of points) {
        for (const row of point.rows) {
          const rules = { ...point.rules, blocked: row.blocked };
          const runs = [
            {
              strategy: 'proceed' as const,
              inputs: row.proceed.inputs,
              result: row.proceed.result,
            },
            ...row.allocations.map((item) => ({
              strategy: item.strategy,
              inputs: item.inputs,
              result: item.result,
            })),
          ];
          for (const run of runs) {
            let live = createSharedExpertCase(row.board, rules);
            let saved = structuredClone(live);
            for (const input of run.inputs) {
              const previous = live;
              const before = structuredClone(live);
              if (run.strategy === 'proceed') expect(input).toEqual({ type: 'wait' });
              else expect(chooseExpertAction(previous, run.strategy)).toEqual(input);
              live = apply(live, input);
              saved = apply(JSON.parse(JSON.stringify(saved)), input);
              expect(previous).toEqual(before);
              expect(saved).toEqual(live);
            }
            expect(summarizeSharedExpert(live)).toEqual(run.result);
            expect(run.result.lost).toBe(false);
            expect(run.result.score).toBeGreaterThanOrEqual(
              run.strategy === 'proceed' ? run.result.score : row.proceed.result.score,
            );
          }
        }
      }
    }
  });
});
