import { describe, expect, it } from 'vitest';
import {
  applyDomainPolicyInput as apply,
  chooseDomainPolicyAction,
  compareDomainPolicies,
  createDomainPolicyPrototype as create,
  summarizeDomainPolicy,
  viewDomainPolicy,
} from './domainPolicy';
import comparison from '../../docs/prototypes/domain-policy-comparison.json';

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
