import { describe, expect, it } from 'vitest';
import {
  F1_COMPOSITE_POLICY,
  F1_DIFFICULTIES,
  F1_SINGLE_POLICIES,
  evaluateF1,
  evaluateF7,
} from '../../../scripts/playtest-f1f7.mjs';

function run(difficulty: string, policy: string, seed: number, won: boolean) {
  return {
    difficulty,
    policy,
    seed: `pt-${seed + 1}`,
    meta: 'fresh',
    status: won ? 'won' : 'lost',
  };
}

function f1Runs(singleWins = 2, compositeWins = 2) {
  return F1_DIFFICULTIES.flatMap((difficulty) =>
    [F1_COMPOSITE_POLICY, ...F1_SINGLE_POLICIES].flatMap((policy) =>
      Array.from({ length: 10 }, (_, seed) =>
        run(
          difficulty,
          policy,
          seed,
          seed < (policy === F1_COMPOSITE_POLICY ? compositeWins : singleWins),
        ),
      ),
    ),
  );
}

describe('F-1 / F-7 プレイテスト合否', () => {
  it('全8単一介入が熟練複合を上回らなければ F-1 を受理する', () => {
    const result = evaluateF1(f1Runs());
    expect(result.sampleOk).toBe(true);
    expect(result.accepted).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('onlyPair を含む単一介入の上振れを F-1 違反にする', () => {
    const runs = f1Runs(1, 2);
    for (const item of runs) {
      if (item.difficulty === 'normal' && item.policy === 'onlyPair') {
        item.status = Number(item.seed.slice(3)) <= 3 ? 'won' : 'lost';
      }
    }
    const result = evaluateF1(runs);
    expect(result.accepted).toBe(false);
    expect(result.violations).toContainEqual({
      difficulty: 'normal',
      policy: 'onlyPair',
      singleWins: 3,
      compositeWins: 2,
    });
  });

  it('naive / easy は10 seed中2〜3勝だけを F-7 として受理する', () => {
    const sample = (wins: number) =>
      Array.from({ length: 10 }, (_, seed) => run('easy', 'naive', seed, seed < wins));
    expect(evaluateF7(sample(2)).accepted).toBe(true);
    expect(evaluateF7(sample(3)).accepted).toBe(true);
    expect(evaluateF7(sample(1)).accepted).toBe(false);
    expect(evaluateF7(sample(4)).accepted).toBe(false);
  });
});
