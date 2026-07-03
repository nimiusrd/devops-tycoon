import { describe, expect, it } from 'vitest';
import { getCard } from '../../src/data/cards';
import { getEvolutionNode } from '../../src/data/evolution';
import { EVENT_DEFS } from '../../src/data/events';
import { getRelic } from '../../src/data/relics';
import {
  formatCardDefTags,
  formatCardEffectsTags,
  formatCardTagsAtLevel,
  formatCardTooltip,
  formatEvolutionNodeTags,
  formatEventChoiceTags,
  formatEventOutcomeTags,
  formatRelicDefTags,
  formatRelicTooltip,
} from '../../src/render/eventOutcomeView';

describe('formatEventOutcomeTags（イベント効果タグ）', () => {
  it('プラス/マイナスの数値デルタを色付きタグに変換する', () => {
    const tags = formatEventOutcomeTags({ delivered: 30, morale: -15, seniorHp: -10 });
    expect(tags).toEqual([
      { label: '出荷 +30', tone: 'positive' },
      { label: '士気 -15', tone: 'negative' },
      { label: 'シニアHP -10', tone: 'negative' },
    ]);
  });

  it('ステークホルダー信頼を個別タグに展開する', () => {
    const tags = formatEventOutcomeTags({ trust: { management: -8 } });
    expect(tags).toEqual([{ label: '経営信頼 -8', tone: 'negative' }]);
  });

  it('レリック/カード付与は positive タグにする', () => {
    const relicTags = formatEventOutcomeTags({ grantRelic: 'expectation-mgmt' });
    expect(relicTags).toEqual([{ label: 'レリック獲得: 期待値マネジメント', tone: 'positive' }]);

    const cardTags = formatEventOutcomeTags({ grantCard: 'ai-guideline' });
    expect(cardTags).toEqual([{ label: 'カード獲得: AI利用ガイドライン', tone: 'positive' }]);
  });

  it('次スプリント効果と即時敗北をタグ化する', () => {
    const nextTags = formatEventOutcomeTags({
      seniorHp: -6,
      nextSprint: { reviewLoadAdd: 4, reworkRateAdd: 0.15, taskCountMul: 0.7 },
    });
    expect(nextTags).toContainEqual({ label: 'シニアHP -6', tone: 'negative' });
    expect(nextTags).toContainEqual({
      label: '次スプリント レビュー負荷 +4',
      tone: 'negative',
    });
    expect(nextTags).toContainEqual({ label: '次スプリント 手戻り率 +15%', tone: 'negative' });
    expect(nextTags).toContainEqual({ label: '次スプリント 出荷 -30%', tone: 'negative' });

    const loseTags = formatEventOutcomeTags({ forceLose: 'reviewFreeze' });
    expect(loseTags).toEqual([{ label: 'レビュー停止でラン終了', tone: 'negative' }]);
  });

  it('Tech Debt / AI依存度の増加は negative タグにする', () => {
    expect(formatEventOutcomeTags({ techDebt: 5 })).toEqual([
      { label: 'Tech Debt +5', tone: 'negative' },
    ]);
    expect(formatEventOutcomeTags({ aiDependency: 12, quality: -6 })).toEqual([
      { label: '品質 -6', tone: 'negative' },
      { label: 'AI依存度 +12', tone: 'negative' },
    ]);
  });

  it('空 outcome は空配列を返す', () => {
    expect(formatEventOutcomeTags({})).toEqual([]);
  });
});

describe('formatEventChoiceTags（選択肢＋画面遷移）', () => {
  it('leadsTo を neutral タグとして付与する', () => {
    const elite = EVENT_DEFS.find((e) => e.id === 'elite-offer')!.choices[0];
    expect(formatEventChoiceTags(elite)).toContainEqual({
      label: '高負荷スプリント',
      tone: 'neutral',
    });

    const shop = EVENT_DEFS.find((e) => e.id === 'shop-offer')!.choices[0];
    expect(formatEventChoiceTags(shop)).toContainEqual({ label: 'ショップへ', tone: 'neutral' });

    const rest = EVENT_DEFS.find((e) => e.id === 'rest-offer')!.choices[0];
    expect(formatEventChoiceTags(rest)).toEqual([
      { label: '次スプリント 出荷 -30%', tone: 'negative' },
      { label: '休息へ', tone: 'neutral' },
    ]);
  });

  it('通常スプリント遷移には追加タグを出さない', () => {
    const normal = EVENT_DEFS.find((e) => e.id === 'elite-offer')!.choices[1];
    expect(formatEventChoiceTags(normal)).toEqual([{ label: '経営信頼 -4', tone: 'negative' }]);
  });
});

describe('イベント定義とタグの整合', () => {
  it('urgent-demo の第1選択肢は実データと一致するタグを持つ', () => {
    const choice = EVENT_DEFS.find((e) => e.id === 'urgent-demo')!.choices[0];
    expect(formatEventChoiceTags(choice)).toEqual([
      { label: '出荷 +30', tone: 'positive' },
      { label: '士気 -15', tone: 'negative' },
      { label: 'シニアHP -10', tone: 'negative' },
    ]);
  });
});

describe('formatCardEffectsTags（カード係数タグ）', () => {
  it('Copilot カードの base 効果をタグ化する', () => {
    const def = getCard('copilot')!;
    expect(formatCardDefTags(def)).toEqual([
      { label: 'Coding速度 x1.15', tone: 'positive' },
      { label: '定型タスク速度 x1.30', tone: 'positive' },
      { label: 'AI依存度 +5', tone: 'negative' },
    ]);
  });

  it('Devin カードのデメリット付き効果を色分けする', () => {
    const def = getCard('devin')!;
    expect(formatCardDefTags(def)).toEqual([
      { label: 'Coding速度 x1.25', tone: 'positive' },
      { label: '手戻り率 +6%', tone: 'negative' },
      { label: 'AI依存度 +8', tone: 'negative' },
    ]);
  });

  it('Claude Code のレビュー負荷増は negative タグにする', () => {
    expect(
      formatCardEffectsTags({
        codingSpeedMul: 1.2,
        reworkRateAdd: -0.05,
        reviewEfficiencyMul: 0.9,
      }),
    ).toEqual([
      { label: 'Coding速度 x1.20', tone: 'positive' },
      { label: 'レビュー効率 x0.90', tone: 'negative' },
      { label: '手戻り率 -5%', tone: 'positive' },
    ]);
  });

  it('空効果は空配列を返す', () => {
    expect(formatCardEffectsTags({})).toEqual([]);
  });
});

describe('formatRelicDefTags（レリックタグ）', () => {
  it('心理的安全性の Morale ダメージ軽減をタグ化する', () => {
    const relic = getRelic('psych-safety')!;
    expect(formatRelicDefTags(relic)).toEqual([
      { label: 'Morale ダメージ x0.60', tone: 'positive' },
    ]);
  });

  it('コスト意識のショップ割引を positive タグにする', () => {
    const relic = getRelic('budget-discipline')!;
    expect(formatRelicDefTags(relic)).toEqual([{ label: 'ショップ割引 20%', tone: 'positive' }]);
  });

  it('effects と passives を合成する', () => {
    const relic = getRelic('flow-first')!;
    expect(formatRelicDefTags(relic)).toEqual([
      { label: 'レビュー容量 x1.20', tone: 'positive' },
      { label: '休息回復 +10', tone: 'positive' },
    ]);
  });
});

describe('formatEvolutionNodeTags（進化ノードタグ）', () => {
  it('Coding 枠ボーナスを positive タグにする', () => {
    const node = getEvolutionNode('dev-2')!;
    expect(formatEvolutionNodeTags(node)).toEqual([{ label: 'Coding枠 +1', tone: 'positive' }]);
  });

  it('集中力上限ボーナスを positive タグにする', () => {
    const node = getEvolutionNode('culture-1')!;
    expect(formatEvolutionNodeTags(node)).toEqual([{ label: '集中力上限 +2', tone: 'positive' }]);
  });

  it('係数効果とボーナスを合成する', () => {
    const node = getEvolutionNode('quality-3')!;
    expect(formatEvolutionNodeTags(node)).toEqual([
      { label: '手戻り率 -10%', tone: 'positive' },
      { label: '品質 +8', tone: 'positive' },
    ]);
  });
});

describe('formatCardTooltip / formatRelicTooltip（ツールチップ）', () => {
  it('カードの効果タグとフレーバー文を合成する', () => {
    const def = getCard('devin')!;
    expect(formatCardTooltip(def)).toBe(
      'Coding速度 x1.25 · 手戻り率 +6% · AI依存度 +8 — 自律型 AI エージェントを導入 / 並列実装は進むが、分割が下手だと迷走しやすい',
    );
  });

  it('レリックの効果タグとフレーバー文を合成する', () => {
    const relic = getRelic('flow-first')!;
    expect(formatRelicTooltip(relic)).toBe(
      'レビュー容量 x1.20 · 休息回復 +10 — レビュー待ちを減らし、休息での回復も厚くする',
    );
  });

  it('強化レベルを反映したカード tooltip を生成する', () => {
    const def = getCard('copilot')!;
    expect(formatCardTagsAtLevel(def, 2)).toEqual([
      { label: 'Coding速度 x1.22', tone: 'positive' },
      { label: '定型タスク速度 x1.45', tone: 'positive' },
      { label: 'AI依存度 +7.5', tone: 'negative' },
    ]);
    expect(formatCardTooltip(def, 2)).toContain('Coding速度 x1.22');
  });
});
