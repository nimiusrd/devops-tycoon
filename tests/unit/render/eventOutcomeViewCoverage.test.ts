import { describe, expect, it } from 'vitest';
import { getCard } from '../../../src/data/cards';
import type { GoalAdjustmentDef } from '../../../src/data/goalAdjustments';
import {
  formatCardEffectsTags,
  formatEventOutcomeTags,
  formatGoalAdjustmentTags,
  formatRelicPassiveTags,
  formatRelicTooltip,
} from '../../../src/render/eventOutcomeView';

function adjustment(overrides: Partial<GoalAdjustmentDef>): GoalAdjustmentDef {
  return {
    id: 'quality_pivot',
    label: '目標修正',
    description: '保存済みの目標修正',
    negotiator: 'customers',
    trustDelta: {},
    budgetDelta: 0,
    goalEffects: {},
    ...overrides,
  };
}

describe('効果タグの省略値と保存済みコンテンツ', () => {
  it('再採用失敗の獲得タグにも保存済み定義の名前を使う', () => {
    const card = { ...getCard('copilot')!, name: '保存当時の Copilot' };
    const relic = { id: 'saved-relic', name: '保存当時の文化', description: '' };

    expect(
      formatEventOutcomeTags(
        { grantRecruit: true, onRecruitFail: { grantRelic: relic.id, grantCard: card.id } },
        {
          getCard: (id) => (id === card.id ? card : undefined),
          getRelic: (id) => (id === relic.id ? relic : undefined),
        },
      ),
    ).toEqual([
      { label: '予算 -25', tone: 'negative' },
      { label: 'メンバー +1', tone: 'positive' },
      { label: '編成へ', tone: 'neutral' },
      { label: '失敗時 レリック獲得: 保存当時の文化', tone: 'positive' },
      { label: '失敗時 カード獲得: 保存当時の Copilot', tone: 'positive' },
    ]);
  });

  it('保存済み定義で解決できない報酬も ID で識別できる', () => {
    expect(
      formatEventOutcomeTags(
        { grantCard: 'copilot', grantRelic: 'archived-relic' },
        { getCard: () => undefined, getRelic: () => undefined },
      ),
    ).toEqual([
      { label: 'レリック獲得: archived-relic', tone: 'positive' },
      { label: 'カード獲得: copilot', tone: 'positive' },
    ]);
  });

  it('倍率 1 と加算 0 のカード効果はタグを作らない', () => {
    expect(
      formatCardEffectsTags({
        codingSpeedMul: 1,
        infraCostMul: 1,
        qualityAdd: 0,
        reworkRateAdd: 0,
      }),
    ).toEqual([]);
  });

  it('レリック枠は効果の正負を付けず、ゼロも表示する', () => {
    expect(
      formatRelicPassiveTags({
        moraleDamageMul: 1,
        restHealBonus: 0,
        shopDiscount: 0,
        relicSlots: 0,
      }),
    ).toEqual([{ label: 'レリック枠 0', tone: 'neutral' }]);
  });

  it('レリックの説明か効果だけがある場合は余計な区切りを出さない', () => {
    expect(
      formatRelicTooltip({ id: 'archived-culture', name: '文化', description: '保存当時の説明' }),
    ).toBe('保存当時の説明');
    expect(
      formatRelicTooltip({
        id: 'archived-culture',
        name: '文化',
        description: '',
        passives: { relicSlots: 2 },
      }),
    ).toBe('レリック枠 2');
  });
});

describe('目標修正の効果表示', () => {
  it.each([
    [100, 'Delivery目標 +100', 'negative'],
    [-100, 'Delivery目標 -100', 'positive'],
  ] as const)('Delivery 加算 %s は達成難度に応じたトーンで表示する', (deliveryAdd, label, tone) => {
    expect(formatGoalAdjustmentTags(adjustment({ goalEffects: { deliveryAdd } }))).toEqual([
      { label, tone },
    ]);
  });

  it('品質と士気の目標緩和、障害上限の引き締めを区別する', () => {
    expect(
      formatGoalAdjustmentTags(
        adjustment({
          goalEffects: {
            qualityAdd: -5,
            moraleAdd: -3,
            techDebtLimitAdd: -10,
            incidentLimitAdd: -1,
          },
        }),
      ),
    ).toEqual([
      { label: '品質目標 -5', tone: 'positive' },
      { label: '士気目標 -3', tone: 'positive' },
      { label: 'Tech Debt上限 -10', tone: 'negative' },
      { label: 'Incident上限 -1', tone: 'negative' },
    ]);
  });

  it('即時の組織品質改善を、次期目標とは別の正の効果として表示する', () => {
    expect(formatGoalAdjustmentTags(adjustment({ orgEffects: { qualityDelta: 5 } }))).toEqual([
      { label: '品質 +5', tone: 'positive' },
    ]);
  });

  it('次四半期の定型速度を独立した倍率として表示し、障害・手戻り増は負の効果にする', () => {
    expect(
      formatGoalAdjustmentTags(
        adjustment({
          nextQuarterEffects: {
            codingSpeedMul: 1.1,
            routineSpeedMul: 1.2,
            reviewEfficiencyMul: 0.9,
            reviewCapacityMul: 1.2,
            incidentRateMul: 1.25,
            reworkRateAdd: 0.05,
            qualityAdd: -2,
            techDebtDelta: 3,
            seniorHpDelta: -4,
          },
        }),
      ),
    ).toEqual([
      { label: '次四半期 出荷速度 +10%', tone: 'positive' },
      { label: '次四半期 定型速度 +20%', tone: 'positive' },
      { label: '次四半期 レビュー効率 -10%', tone: 'negative' },
      { label: '次四半期 レビュー容量 +20%', tone: 'positive' },
      { label: '次四半期 障害率 +25%', tone: 'negative' },
      { label: '次四半期 Rework +5pt', tone: 'negative' },
      { label: '次四半期 品質 -2/スプリント', tone: 'negative' },
      { label: '次四半期 Tech Debt +3/スプリント', tone: 'negative' },
      { label: '次四半期 シニアHP -4/スプリント', tone: 'negative' },
    ]);
  });
});
