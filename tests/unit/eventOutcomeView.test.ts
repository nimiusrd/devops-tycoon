import { describe, expect, it } from 'vitest';
import { EVENT_DEFS } from '../../src/data/events';
import { formatEventChoiceTags, formatEventOutcomeTags } from '../../src/render/eventOutcomeView';

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
