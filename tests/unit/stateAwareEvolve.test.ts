/**
 * RI-86: 盤面依存の進化ブランチ選択が、状態に応じて先頭ブランチを変えること。
 */
import { describe, expect, it } from 'vitest';
import { createOrgState } from '../../src/sim/org';
import type { RunTotals } from '../../src/sim/run/types';
import { stateAwareEvolveBranches } from '../playtest/harness';

const totals = (t: Partial<RunTotals> = {}): RunTotals => ({
  delivered: 0,
  done: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 0,
  aiAssisted: 0,
  completed: 0,
  reviewQueuePeak: 0,
  maxCombo: 0,
  ...t,
});

const base = (over: Parameters<typeof stateAwareEvolveBranches>[0]) =>
  stateAwareEvolveBranches({ unlocked: [], ...over });

describe('stateAwareEvolveBranches (RI-86)', () => {
  it('シニア危機＋高キューなら review を先頭にする', () => {
    const org = createOrgState('default', true);
    const order = base({
      org: { ...org, seniorHp: 15, techDebt: 10, morale: 70, testCoverage: 60, quality: 60 },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 18,
    });
    expect(order[0]).toBe('review');
  });

  it('技術的負債が高いなら quality を先頭にする', () => {
    const org = createOrgState('default', true);
    const order = base({
      org: {
        ...org,
        techDebt: 55,
        testCoverage: 30,
        seniorHp: 80,
        morale: 70,
        aiDependency: 10,
        quality: 60,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 2,
    });
    expect(order[0]).toBe('quality');
  });

  it('AI 依存が高くリテラシー不足なら ai を先頭にする', () => {
    const org = createOrgState('default', true);
    const order = base({
      org: {
        ...org,
        aiDependency: 70,
        aiLiteracy: 30,
        techDebt: 10,
        seniorHp: 80,
        morale: 70,
        testCoverage: 60,
        quality: 60,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 2,
    });
    expect(order[0]).toBe('ai');
  });

  it('導入難易度の高依存・中リテラシーでも ai を選べる', () => {
    const org = createOrgState('default', true);
    const order = base({
      org: {
        ...org,
        aiDependency: 100,
        aiLiteracy: 60,
        techDebt: 0,
        seniorHp: 27,
        morale: 100,
        testCoverage: 60,
        quality: 60,
      },
      totals: totals({ delivered: 500, completed: 20 }),
      reviewQueuePeak: 16,
    });
    expect(order[0]).toBe('ai');
  });

  it('士気が低いなら culture を先頭にする', () => {
    const org = createOrgState('default', true);
    const order = base({
      org: {
        ...org,
        morale: 35,
        quality: 30,
        seniorHp: 80,
        techDebt: 10,
        testCoverage: 60,
        aiDependency: 10,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 2,
    });
    expect(order[0]).toBe('culture');
  });

  it('出荷が伸びていないなら dev を先頭にする', () => {
    const org = createOrgState('default', true);
    const order = base({
      org: {
        ...org,
        seniorHp: 80,
        morale: 70,
        techDebt: 10,
        testCoverage: 60,
        quality: 60,
        aiDependency: 10,
      },
      totals: totals({ delivered: 40, completed: 20 }),
      reviewQueuePeak: 2,
    });
    expect(order[0]).toBe('dev');
  });

  it('review を既に1ノード取っていれば同点帯では他ブランチへ曲がる', () => {
    const org = createOrgState('default', true);
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        seniorHp: 15,
        techDebt: 55,
        testCoverage: 30,
        morale: 70,
        quality: 60,
        aiDependency: 10,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 18,
      unlocked: ['review-1'],
    });
    expect(order[0]).toBe('quality');
  });

  it('review を既に2ノード取っていれば他ブランチへ曲がる', () => {
    const org = createOrgState('default', true);
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        seniorHp: 15,
        techDebt: 55,
        testCoverage: 30,
        morale: 70,
        quality: 60,
        aiDependency: 10,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 18,
      unlocked: ['review-1', 'review-2'],
    });
    expect(order[0]).toBe('quality');
  });
});
