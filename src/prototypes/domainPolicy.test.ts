import { describe, expect, it } from 'vitest';
import {
  applyDomainPolicyInput as apply,
  chooseDomainPolicyAction,
  compareDomainFactorReversals,
  compareDomainPolicies,
  createDomainPolicyPrototype as create,
  summarizeDomainPolicy,
  viewDomainPolicy,
} from './domainPolicy';
import comparison from '../../docs/prototypes/domain-policy-comparison.json';
import factors from '../../docs/prototypes/domain-policy-factor-comparison.json';

describe('RI-199 領域別のAI利用方針', () => {
  it('方針がAI可否を先に示し、閲覧は状態を変えない', () => {
    const first = create('RI-199', 'routine');
    expect(create('RI-199', 'routine')).toEqual(first);
    expect(create('RI-199-other', 'routine').seed).not.toBe(first.seed);
    const before = structuredClone(first);
    const blank = viewDomainPolicy(first);
    for (let i = 0; i < 10; i++) expect(viewDomainPolicy(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      policy: null,
      memberAi: null,
      feePerAiTick: 1,
      complexIncident: 6,
      speeds: { human: 1, ai: 2 },
    });
    expect(blank.jobs.every((job) => job.allowed === null && job.willAssist === null)).toBe(true);
    const routine = apply(first, { type: 'configure', policy: 'routine', memberAi: true });
    const seen = viewDomainPolicy(routine);
    expect(seen.jobs.find((job) => job.kind === 'routine')).toMatchObject({
      allowed: true,
      willAssist: true,
      aiAssisted: false,
    });
    expect(seen.jobs.find((job) => job.kind === 'complex')).toMatchObject({
      allowed: false,
      willAssist: false,
    });
  });

  it('方針外の仕事は配布があってもaiAssistedにならず、利用費も増えない', () => {
    let state = apply(create('RI-199', 'important'), {
      type: 'configure',
      policy: 'routine',
      memberAi: true,
    });
    for (let i = 0; i < 4; i++) state = apply(state, { type: 'tick' });
    expect(state.jobs[0]).toMatchObject({
      id: 'c1',
      kind: 'complex',
      aiAssisted: false,
      shipped: 4,
      incident: 0,
    });
    expect(summarizeDomainPolicy(state)).toMatchObject({
      fees: 0,
      aiTicks: 0,
      humanTicks: 4,
      incidents: 0,
      value: 20,
      netValue: 20,
    });
    const distributed = apply(create('RI-199', 'routine'), {
      type: 'configure',
      policy: 'all',
      memberAi: false,
    });
    const worked = apply(distributed, { type: 'tick' });
    expect(worked.jobs[0]).toMatchObject({ aiAssisted: false, progress: 1 });
    expect(worked.fees).toBe(0);
  });

  it('未設定のtick、不正な方針、二重設定、期末は無消費で拒否する', () => {
    const initial = create('RI-199', 'routine');
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    expect(apply(initial, { type: 'configure', policy: 'lead', memberAi: true })).toBe(initial);
    const chosen = apply(initial, { type: 'configure', policy: 'off', memberAi: true });
    expect(apply(chosen, { type: 'configure', policy: 'all', memberAi: false })).toBe(chosen);
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'configure', policy: 'all', memberAi: true })).toBe(ended);
  });

  it('定型中心では対象を絞る方が有利で、重要仕事中心では全許可が上回る', () => {
    const rows = compareDomainPolicies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.netValue;
    expect([net('routine', 'all'), net('routine', 'routine'), net('routine', 'off')]).toEqual([
      17, 24, 15,
    ]);
    expect([net('important', 'all'), net('important', 'routine'), net('important', 'off')]).toEqual(
      [24, 20, 20],
    );
    expect(net('routine', 'no-member')).toBe(net('routine', 'off'));
    expect(net('important', 'no-member')).toBe(net('important', 'off'));
    const widened = rows.find((row) => row.board === 'routine' && row.strategy === 'all')!;
    expect(widened.result.jobs.find((job) => job.id === 'c1')).toMatchObject({
      aiAssisted: true,
      incident: 6,
    });
    expect(widened.result.fees).toBe(widened.result.aiTicks);
    const narrow = rows.find((row) => row.board === 'important' && row.strategy === 'routine')!;
    expect(narrow.result.jobs.every((job) => job.aiAssisted === false)).toBe(true);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareDomainPolicies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseDomainPolicyAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeDomainPolicy(live)).toEqual(row.result);
    }
  });
});

describe('RI-199 要因の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = compareDomainFactorReversals();
    expect(data).toEqual(factors);
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((point) => [
        point.parameter,
        ...point.boards.flatMap((board) => [
          board.use.result.netValue,
          board.off.result.netValue,
          board.preference,
        ]),
      ]);
    expect(data.conditions).toMatchObject({
      seed: 'RI-199',
      humanSpeed: 1,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    });
    expect(data.conditions.baseline).toEqual({ fee: 1, aiSpeed: 2, incident: 6 });
    expect(data.conditions.boards.routine).toMatchObject({
      horizon: 6,
      use: 'routine',
      off: 'off',
    });
    expect(data.conditions.boards.important).toMatchObject({ horizon: 4, use: 'all', off: 'off' });
    expect(nets('fee')).toEqual([
      ['0', 28, 15, 'use', 28, 20, 'use'],
      ['1', 24, 15, 'use', 24, 20, 'use'],
      ['2', 20, 15, 'use', 20, 20, 'tie'],
      ['3', 16, 15, 'use', 16, 20, 'off'],
      ['4', 12, 15, 'off', 12, 20, 'off'],
      ['5', 8, 15, 'off', 8, 20, 'off'],
    ]);
    expect(nets('aiSpeed')).toEqual([
      ['1', 9, 15, 'off', 10, 20, 'off'],
      ['2', 24, 15, 'use', 24, 20, 'use'],
      ['3', 24, 15, 'use', 24, 20, 'use'],
      ['4', 24, 15, 'use', 29, 20, 'use'],
    ]);
    expect(nets('incident')).toEqual([
      ['0', 24, 15, 'use', 36, 20, 'use'],
      ['4', 24, 15, 'use', 28, 20, 'use'],
      ['6', 24, 15, 'use', 24, 20, 'use'],
      ['7', 24, 15, 'use', 22, 20, 'use'],
      ['8', 24, 15, 'use', 20, 20, 'tie'],
      ['9', 24, 15, 'use', 18, 20, 'off'],
      ['12', 24, 15, 'use', 12, 20, 'off'],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.board,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['fee', 'important', '1', 'use', '2', 'tie'],
      ['fee', 'important', '2', 'tie', '3', 'off'],
      ['fee', 'routine', '3', 'use', '4', 'off'],
      ['aiSpeed', 'routine', '1', 'off', '2', 'use'],
      ['aiSpeed', 'important', '1', 'off', '2', 'use'],
      ['incident', 'important', '7', 'use', '8', 'tie'],
      ['incident', 'important', '8', 'tie', '9', 'off'],
    ]);
    expect(
      data.reversals.some((item) => item.axis === 'incident' && item.board === 'routine'),
    ).toBe(false);
  });

  it('基準行は初回の該当戦略と一致し、動かした規則は一つである', () => {
    const data = compareDomainFactorReversals();
    const first = compareDomainPolicies(comparison.seed);
    const baselines = [
      data.sweeps.fee.find((item) => item.parameter === '1'),
      data.sweeps.aiSpeed.find((item) => item.parameter === '2'),
      data.sweeps.incident.find((item) => item.parameter === '6'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(point.sameAsFirstComparison).toBe(true);
      expect(point.rules).toEqual({ fee: 1, aiSpeed: 2, incident: 6 });
      for (const board of point.boards) {
        const used = first.find(
          (row) => row.board === board.board && row.strategy === board.useStrategy,
        );
        const stopped = first.find((row) => row.board === board.board && row.strategy === 'off');
        if (!used || !stopped) throw new Error(board.board);
        expect(board.use.inputs).toEqual(used.inputs);
        expect(board.use.result).toEqual(used.result);
        expect(board.off.inputs).toEqual(stopped.inputs);
        expect(board.off.result).toEqual(stopped.result);
      }
    }
    expect(first.some((row) => row.strategy === 'no-member')).toBe(true);
    expect(first.some((row) => row.board === 'routine' && row.strategy === 'all')).toBe(true);
    expect(Object.keys(data.sweeps)).toEqual(['fee', 'aiSpeed', 'incident']);
    for (const point of data.sweeps.fee) {
      expect(point.rules).toEqual({ fee: Number(point.parameter), aiSpeed: 2, incident: 6 });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '1');
    }
    for (const point of data.sweeps.aiSpeed) {
      expect(point.rules).toEqual({ fee: 1, aiSpeed: Number(point.parameter), incident: 6 });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '2');
    }
    for (const point of data.sweeps.incident) {
      expect(point.rules).toEqual({ fee: 1, aiSpeed: 2, incident: Number(point.parameter) });
      expect(point.sameAsFirstComparison).toBe(point.parameter === '6');
    }
    for (const board of ['routine', 'important'] as const) {
      const initial = create(comparison.seed, board);
      const recorded = data.conditions.boards[board];
      const firstJobs = first.find((row) => row.board === board)!.initial.jobs;
      expect(initial.horizon).toBe(recorded.horizon);
      expect(recorded.jobs).toEqual(
        firstJobs.map((job) => ({ id: job.id, kind: job.kind, work: job.work, value: job.value })),
      );
    }
  });

  it('使う判断は領域ごとの固定方針で、影響は定型中心の複雑作業に乗らない', () => {
    const data = compareDomainFactorReversals();
    for (const point of Object.values(data.sweeps).flat()) {
      const routine = point.boards.find((board) => board.board === 'routine');
      const important = point.boards.find((board) => board.board === 'important');
      if (!routine || !important) throw new Error(point.parameter);
      expect(routine.useStrategy).toBe('routine');
      expect(important.useStrategy).toBe('all');
      expect(routine.use.inputs[0]).toEqual({
        type: 'configure',
        policy: 'routine',
        memberAi: true,
      });
      expect(important.use.inputs[0]).toEqual({ type: 'configure', policy: 'all', memberAi: true });
      expect(routine.off.inputs[0]).toEqual({ type: 'configure', policy: 'off', memberAi: true });
      expect(important.off.inputs[0]).toEqual({ type: 'configure', policy: 'off', memberAi: true });
      expect(routine.off.result).toMatchObject({ netValue: 15, fees: 0, incidents: 0, aiTicks: 0 });
      expect(important.off.result).toMatchObject({
        netValue: 20,
        fees: 0,
        incidents: 0,
        aiTicks: 0,
      });
      expect(Object.keys(point.rules).sort()).toEqual(['aiSpeed', 'fee', 'incident']);
    }
    for (const point of data.sweeps.incident) {
      const routine = point.boards.find((board) => board.board === 'routine')!;
      expect(routine.preference).toBe('use');
      expect(routine.use.result).toMatchObject({ netValue: 24, incidents: 0, fees: 4, aiTicks: 4 });
      expect(routine.use.result.jobs.find((job) => job.id === 'c1')).toMatchObject({
        aiAssisted: false,
        incident: 0,
        shipped: 6,
      });
    }
    const slow = data.sweeps.aiSpeed.find((point) => point.parameter === '1')!;
    expect(slow.boards[0]?.use.result).toMatchObject({
      value: 15,
      fees: 6,
      incidents: 0,
      netValue: 9,
      aiTicks: 6,
      humanTicks: 0,
    });
    expect(slow.boards[0]?.use.result.jobs.filter((job) => job.shipped !== null)).toHaveLength(3);
    expect(slow.boards[1]?.use.result).toMatchObject({
      value: 20,
      fees: 4,
      incidents: 6,
      netValue: 10,
      aiTicks: 4,
    });
    expect(slow.boards[1]?.use.result.jobs.find((job) => job.id === 'c1')).toMatchObject({
      aiAssisted: true,
      incident: 6,
      shipped: 4,
    });
    expect(slow.boards[1]?.use.result.jobs.find((job) => job.id === 'c2')?.shipped).toBeNull();
    const fast = data.sweeps.aiSpeed.find((point) => point.parameter === '4')!;
    expect(fast.boards[1]?.use.result).toMatchObject({
      value: 44,
      fees: 3,
      incidents: 12,
      netValue: 29,
      aiTicks: 3,
    });
    expect(fast.boards[1]?.use.result.jobs.map((job) => job.shipped)).toEqual([1, 2, 3]);
    const costly = data.sweeps.incident.find((point) => point.parameter === '12')!;
    expect(costly.boards[1]?.use.result).toMatchObject({ incidents: 24, netValue: 12 });
    expect(costly.boards[1]?.preference).toBe('off');
  });

  it('要因比較の入力を再生すると差引が一致し、閲覧の係数は初回のまま', () => {
    const data = compareDomainFactorReversals();
    for (const point of Object.values(data.sweeps).flat()) {
      for (const board of point.boards) {
        for (const side of ['use', 'off'] as const) {
          const strategy = side === 'use' ? board.useStrategy : 'off';
          const run = board[side];
          let state = create(data.conditions.seed, board.board);
          const snapshot = structuredClone(state);
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(chooseDomainPolicyAction(state, strategy)).toEqual(input);
            state = apply(state, input, point.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, point.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizeDomainPolicy(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'tick' }, point.rules)).toBe(state);
          expect(viewDomainPolicy(state)).toMatchObject({
            feePerAiTick: 1,
            complexIncident: 6,
            speeds: { human: 1, ai: 2 },
          });
        }
      }
    }
  });
});
