/**
 * RI-86: 盤面依存の進化ブランチ選択が、状態に応じて先頭ブランチを変えること。
 */
import { describe, expect, it } from 'vitest';
import { createOrgState } from '../../../src/sim/org';
import { stateAwareEvolveBranches } from '../../playtest/harness';
import { totals } from '../helpers/orgFixtures';

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

  it('強い競合があるとき review を1ノード取っていれば他ブランチへ曲がる', () => {
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

  it('中強度の quality 信号なら1ノード既得でも同ブランチを継続する', () => {
    const org = createOrgState('default', true);
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        techDebt: 30,
        testCoverage: 50,
        seniorHp: 80,
        morale: 75,
        aiDependency: 10,
        quality: 60,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 2,
      unlocked: ['quality-1'],
    });
    expect(order[0]).toBe('quality');
  });

  it('中強度の culture 信号なら1ノード既得でも同ブランチを継続する', () => {
    const org = createOrgState('default', true);
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        morale: 60,
        quality: 55,
        seniorHp: 80,
        techDebt: 10,
        testCoverage: 60,
        aiDependency: 10,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 2,
      unlocked: ['culture-1'],
    });
    expect(order[0]).toBe('culture');
  });

  it('中強度の ai 信号なら1ノード既得でも同ブランチを継続する', () => {
    const org = createOrgState('default', true);
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        aiDependency: 60,
        aiLiteracy: 50,
        techDebt: 5,
        seniorHp: 80,
        morale: 75,
        testCoverage: 60,
        quality: 60,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 2,
      unlocked: ['ai-1'],
    });
    expect(order[0]).toBe('ai');
  });

  it('前スプリント持ち越しの中強度 sticky なら弱い競合でも同ブランチを継続する', () => {
    const org = createOrgState('default', true);
    // quality 中強度 (techDebt 30 → +2.5) + sticky 1.5 - 0.5 = 3.5
    // review 弱信号 (HP 30 → +0.5, queue 14 → +0.5) = 1.0
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        techDebt: 30,
        testCoverage: 50,
        seniorHp: 30,
        morale: 75,
        aiDependency: 10,
        quality: 60,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 14,
      unlocked: ['quality-1'],
      unlockedThisPhase: [],
    });
    expect(order[0]).toBe('quality');
  });

  it('今フェーズで取ったばかりのブランチは同フェーズ深化せず他へ曲がる', () => {
    const org = createOrgState('default', true);
    // quality 中強度 2.5 - 0.5 - 2.5(same-phase) = -0.5
    // review 弱信号 1.0 が先頭になる
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        techDebt: 30,
        testCoverage: 50,
        seniorHp: 30,
        morale: 75,
        aiDependency: 10,
        quality: 60,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 14,
      unlocked: ['quality-1'],
      unlockedThisPhase: ['quality-1'],
    });
    expect(order[0]).not.toBe('quality');
  });

  it('危機帯の既得ブランチには sticky を付けず強い競合へ曲がる', () => {
    const org = createOrgState('default', true);
    // review 危機 (HP15 + queue18 = 5.5) は sticky 対象外 → -0.5 = 5.0
    // quality 危機 (debt55 + cov30 = 6.0) が勝つ
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
      unlockedThisPhase: [],
    });
    expect(order[0]).toBe('quality');
  });
});
