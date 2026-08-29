import { describe, expect, it } from 'vitest';
import { getDifficulty, getTrial } from '../../../src/data/difficulties';
import { budgetHudTitle, trialBudgetHudDetail, trialHudViews } from '../../../src/render/trialView';

describe('trialHudViews', () => {
  it('既知の試練を定義順のラベル・説明で返す', () => {
    const half = getTrial('half-budget');
    const focus = getTrial('low-focus');
    expect(half).toBeDefined();
    expect(focus).toBeDefined();

    expect(trialHudViews(['low-focus', 'half-budget'])).toEqual([
      {
        id: 'low-focus',
        label: focus!.label,
        description: focus!.description,
        budgetMul: 1,
      },
      {
        id: 'half-budget',
        label: half!.label,
        description: half!.description,
        budgetMul: 0.5,
      },
    ]);
  });

  it('未知 ID はスキップし、空配列は空のまま', () => {
    expect(trialHudViews([])).toEqual([]);
    expect(trialHudViews(['not-a-real-trial', 'half-budget', 'also-missing'])).toEqual([
      expect.objectContaining({ id: 'half-budget', label: '予算半減', budgetMul: 0.5 }),
    ]);
  });

  it('resolver は記録時のラベルと予算倍率を優先する', () => {
    const recorded = (id: string) =>
      id === 'half-budget'
        ? {
            id: 'half-budget',
            label: '記録時の予算半減',
            description: '記録時の説明',
            budgetMul: 0.25,
          }
        : id === 'removed-trial'
          ? {
              id: 'removed-trial',
              label: '消えた試練',
              description: '記録時のみ',
              budgetMul: 1,
            }
          : undefined;

    expect(trialHudViews(['removed-trial', 'half-budget'], recorded)).toEqual([
      {
        id: 'removed-trial',
        label: '消えた試練',
        description: '記録時のみ',
        budgetMul: 1,
      },
      {
        id: 'half-budget',
        label: '記録時の予算半減',
        description: '記録時の説明',
        budgetMul: 0.25,
      },
    ]);
    expect(budgetHudTitle('15以下で注意', ['half-budget'], recorded)).toBe(
      '15以下で注意。試練「記録時の予算半減」で開始予算×0.25',
    );
  });
});

describe('trialBudgetHudDetail / budgetHudTitle', () => {
  it('予算倍率のない試練だけでは詳細を出さない', () => {
    expect(trialBudgetHudDetail(['low-focus'])).toBeUndefined();
    expect(budgetHudTitle('15以下で注意', ['low-focus'])).toBe('15以下で注意');
    expect(budgetHudTitle('15以下で注意', [])).toBe('15以下で注意');
  });

  it('予算半減は開始予算倍率を title に添える', () => {
    expect(trialBudgetHudDetail(['half-budget'])).toBe('試練「予算半減」で開始予算×0.5');
    expect(budgetHudTitle('15以下で注意', ['half-budget'])).toBe(
      '15以下で注意。試練「予算半減」で開始予算×0.5',
    );
  });

  it('Easy の開始予算は half-budget で半減する（適用側の契約）', () => {
    const startBudget = getDifficulty('easy').startBudget;
    expect(startBudget).toBe(60);
    expect(Math.round(startBudget * (getTrial('half-budget')?.budgetMul ?? 1))).toBe(30);
  });
});
