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

describe('stateAwareEvolveBranches (RI-86)', () => {
  it('レビュー詰まりなら review を先頭にする', () => {
    const org = createOrgState('default', true);
    const order = stateAwareEvolveBranches({
      org: { ...org, seniorHp: 35, techDebt: 10, morale: 70, testCoverage: 60, quality: 60 },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 12,
    });
    expect(order[0]).toBe('review');
  });

  it('技術的負債が高いなら quality を先頭にする', () => {
    const org = createOrgState('default', true);
    const order = stateAwareEvolveBranches({
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

  it('AI 依存が高くリテラシーも足りていれば ai を先頭にする', () => {
    const org = createOrgState('default', true);
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        aiDependency: 70,
        aiLiteracy: 60,
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

  it('士気が低いなら culture を先頭にする', () => {
    const org = createOrgState('default', true);
    const order = stateAwareEvolveBranches({
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
    const order = stateAwareEvolveBranches({
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
});
