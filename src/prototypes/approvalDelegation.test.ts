import { describe, expect, it } from 'vitest';
import {
  applyApprovalDelegation as apply,
  chooseApprovalAction,
  compareApprovalDelegations,
  createApprovalDelegation as create,
  summarizeApprovalDelegation,
  viewApprovalDelegation,
} from './approvalDelegation';
import comparison from '../../docs/prototypes/approval-delegation-comparison.json';

describe('RI-225 権限委譲', () => {
  it('成熟度と、方針ごとの確認経路を操作前に示す', () => {
    const first = create('RI-225', 'mature');
    expect(create('RI-225', 'mature')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewApprovalDelegation(first);
    for (let i = 0; i < 8; i++) expect(viewApprovalDelegation(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({ maturity: 3, maturityLine: 2, policy: null, remaining: 4 });
    const low = blank.items.find((item) => item.id === 'l1')!;
    const important = blank.items.find((item) => item.id === 'i1')!;
    expect(low.routes).toEqual({ human: 'human', delegate: 'auto', rush: 'auto' });
    expect(important.routes).toEqual({ human: 'human', delegate: 'human', rush: 'blocked' });
    const junior = viewApprovalDelegation(create('RI-225', 'junior'));
    expect(junior.items.find((item) => item.id === 'l1')!.routes.delegate).toBe('human');
  });

  it('重要変更は自動承認にならず、委譲だけでは報酬を足さない', () => {
    const fresh = create('RI-225', 'heavy');
    expect(apply(fresh, { type: 'review' })).toBe(fresh);
    expect(apply(fresh, { type: 'adopt', policy: 'delegate' })).not.toBe(fresh);
    let rushed = apply(fresh, { type: 'adopt', policy: 'rush' });
    while (rushed.index < rushed.items.length) rushed = apply(rushed, { type: 'review' });
    expect(rushed.items.every((item) => item.risk !== 'important' || item.reviewed)).toBe(true);
    expect(rushed.blocked).toBe(4);
    expect(summarizeApprovalDelegation(rushed).importantResidual).toBe(0);
    const delegated = compareApprovalDelegations('RI-225').find(
      (row) => row.board === 'junior' && row.strategy === 'delegate',
    )!;
    const human = compareApprovalDelegations('RI-225').find(
      (row) => row.board === 'junior' && row.strategy === 'human',
    )!;
    expect(delegated.result.score).toBeLessThan(human.result.score);
    expect(delegated.result.audit).toBe(1);
    expect(apply(rushed, { type: 'view' })).toBe(rushed);
  });

  it('低リスクが多い成熟チームだけ委譲が上回り、急ぎ承認はどの盤面でも上回らない', () => {
    const rows = compareApprovalDelegations(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([
      score('mature', 'delegate'),
      score('mature', 'human'),
      score('mature', 'rush'),
    ]).toEqual([20, 18, 12]);
    expect([
      score('junior', 'human'),
      score('junior', 'delegate'),
      score('junior', 'rush'),
    ]).toEqual([18, 17, 12]);
    expect([score('heavy', 'human'), score('heavy', 'delegate'), score('heavy', 'rush')]).toEqual([
      12, 11, 3,
    ]);
    for (const row of rows) {
      expect(row.result.importantResidual).toBe(0);
      expect(row.result.lost).toBe(false);
    }
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareApprovalDelegations(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseApprovalAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeApprovalDelegation(live)).toEqual(row.result);
    }
  });
});
