/**
 * AI導入施策カードの宣言的定義（SPEC 第7.2）。
 *
 * カードはデータ駆動（architecture §4.3）。`base` はレベル 1 の効果差分で、
 * 工程モデルに掛かる係数（`CardEffects`）の一部だけを指定する。
 * バランス調整・カード追加はこのファイルの編集だけで完結する。
 */
import type { CardDef, CardRarity } from '../sim/types';

/** レアリティの並び順・表示ラベル。 */
export const RARITY_LABEL: Record<CardRarity, string> = {
  common: 'コモン',
  rare: 'レア',
  legendary: 'レジェンダリ',
};

/** ドラフト抽選のレアリティ重み（コモンが出やすい）。 */
export const RARITY_WEIGHT: Record<CardRarity, number> = {
  common: 6,
  rare: 3,
  legendary: 1,
};

export const CARD_DEFS: CardDef[] = [
  {
    id: 'copilot',
    name: 'Copilot全員配布',
    rarity: 'common',
    cost: 10,
    description: ['コーディング補助 AI を全員に配布', '定型タスクは特に捗るが、依存度も上がる'],
    base: { codingSpeedMul: 1.15, routineSpeedMul: 1.3, aiDependencyAdd: 5 },
  },
  {
    id: 'claude-code',
    name: 'Claude Code解禁',
    rarity: 'rare',
    cost: 20,
    description: ['高度な AI コーディングを解禁', '複雑タスクは安定するが、レビュー負荷も増える'],
    base: { codingSpeedMul: 1.2, reworkRateAdd: -0.05, reviewEfficiencyMul: 0.9 },
  },
  {
    id: 'devin',
    name: 'Devin導入',
    rarity: 'legendary',
    cost: 35,
    description: ['自律型 AI エージェントを導入', '並列実装は進むが、分割が下手だと迷走しやすい'],
    base: { codingSpeedMul: 1.25, reworkRateAdd: 0.06, aiDependencyAdd: 8 },
  },
  {
    id: 'auto-test',
    name: '自動テスト強化',
    rarity: 'common',
    cost: 18,
    description: [
      'テスト基盤を強化して品質を底上げ',
      '短期の出荷は少し鈍るが、事故と手戻りを抑える',
    ],
    base: { reworkRateAdd: -0.15, incidentRateMul: 0.8, codingSpeedMul: 0.95, qualityAdd: 10 },
  },
  {
    id: 'pr-size-limit',
    name: 'PRサイズ制限',
    rarity: 'common',
    cost: 8,
    description: ['巨大 PR を抑え、レビューを回しやすくする', '制限に慣れるまで開発者の不満が出る'],
    base: { reviewEfficiencyMul: 1.15, reworkRateAdd: -0.05 },
  },
  {
    id: 'ai-guideline',
    name: 'AI利用ガイドライン',
    rarity: 'rare',
    cost: 12,
    description: ['AI 利用のルールと学習を整備', '使い方が定まり、手戻りが減る'],
    base: { aiLiteracyAdd: 15, reworkRateAdd: -0.08 },
  },
  {
    id: 'docs',
    name: 'ドキュメント整備',
    rarity: 'common',
    cost: 15,
    description: ['設計・運用ドキュメントを整備', 'AI の精度は上がるが、短期の出荷は少し鈍る'],
    base: { incidentRateMul: 0.9, qualityAdd: 5, codingSpeedMul: 0.92 },
  },
  {
    id: 'hire-senior',
    name: 'シニア採用',
    rarity: 'rare',
    cost: 40,
    description: ['レビューと設計の専門家を1名追加', 'レビュー窓口が増え、品質判断が安定する'],
    base: { reviewCapacityMul: 1.3, qualityAdd: 12 },
  },
  {
    id: 'review-bot',
    name: 'レビューBot導入',
    rarity: 'rare',
    cost: 22,
    description: ['小さな PR を機械レビューで下支え', 'たまに誤検知でノイズが混じる'],
    base: { reviewEfficiencyMul: 1.2 },
  },
];

const BY_ID = new Map(CARD_DEFS.map((c) => [c.id, c]));

/** カード定義を ID で取得する（未知は undefined）。 */
export function getCard(id: string): CardDef | undefined {
  return BY_ID.get(id);
}
