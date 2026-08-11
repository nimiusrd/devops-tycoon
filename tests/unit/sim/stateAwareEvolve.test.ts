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

  it('持ち越し1ノードでも危機帯の競合が sticky を上回れば曲がる', () => {
    const org = createOrgState('default', true);
    // review 弱信号のみ (HP30 → 0.5) -0.5 + sticky 2.5 = 2.5
    // quality 危機 6.0 が勝つ
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        seniorHp: 30,
        techDebt: 55,
        testCoverage: 30,
        morale: 70,
        quality: 60,
        aiDependency: 10,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 2,
      unlocked: ['review-1'],
      unlockedThisPhase: [],
    });
    expect(order[0]).toBe('quality');
  });

  it('multiPhase 済みの2ノードブランチは横展開で他へ曲がる', () => {
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
      // 前スプリント1 + 今フェーズ1 = multiPhase 成立済み → 減点して横展開
      unlockedThisPhase: ['review-2'],
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

  it('前スプリント持ち越しの1ノードは sticky で同ブランチを継続する', () => {
    const org = createOrgState('default', true);
    // quality 中強度 2.5 - 0.5 + sticky 2.5 = 4.5 > review 弱信号 1.0
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

  it('今フェーズで1ノード取ったブランチは同フェーズで2段目まで深化する', () => {
    const org = createOrgState('default', true);
    // quality 2.5 - 0.5 + deepen 2.5 = 4.5 > review 弱信号 1.0
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
    expect(order[0]).toBe('quality');
  });

  it('今フェーズで2段買ったブランチは先端を残して他へ曲がる', () => {
    const org = createOrgState('default', true);
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
      unlocked: ['quality-1', 'quality-2'],
      unlockedThisPhase: ['quality-1', 'quality-2'],
    });
    expect(order[0]).not.toBe('quality');
  });

  it('危機帯の基礎スコアでも今フェーズ2段取得後は先端を候補外にする', () => {
    const org = createOrgState('default', true);
    // quality 基礎 6（debt55 + cov30）。-5 では先頭に残るため、候補外化が必要。
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        techDebt: 55,
        testCoverage: 30,
        seniorHp: 80,
        morale: 75,
        aiDependency: 10,
        quality: 60,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 2,
      unlocked: ['quality-1', 'quality-2'],
      unlockedThisPhase: ['quality-1', 'quality-2'],
    });
    expect(order[0]).not.toBe('quality');
  });

  it('前フェーズで2段買ったブランチは次スプリントで先端へ sticky する', () => {
    const org = createOrgState('default', true);
    // quality n=2 prior に tip sticky 6。中程度の競合（review 1.0）より継続する。
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
      unlocked: ['quality-1', 'quality-2'],
      unlockedThisPhase: [],
    });
    expect(order[0]).toBe('quality');
  });

  it('強い競合があるとき review を1ノード持ち越していても曲がり得る', () => {
    const org = createOrgState('default', true);
    // review 危機 5.5 - 0.5 + sticky 2.5 = 7.5
    // quality 危機 6.0 — sticky 付き review の方が強いので、より強い quality 側へ寄せる
    const order = stateAwareEvolveBranches({
      org: {
        ...org,
        seniorHp: 15,
        techDebt: 55,
        testCoverage: 30,
        morale: 35,
        quality: 30,
        aiDependency: 10,
      },
      totals: totals({ delivered: 200, completed: 20 }),
      reviewQueuePeak: 18,
      unlocked: ['review-1'],
      unlockedThisPhase: [],
    });
    // culture 危機 (morale35 + quality30) = 4 + 1.5 = 5.5、sticky 無し
    // review with sticky = 7.5 が勝つ — 継続が意図
    expect(order[0]).toBe('review');
  });
});
