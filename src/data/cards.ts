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
    description: ['Coding速度 +15%', '定型タスク処理速度 +30%', 'AI依存度 +5%'],
    base: { codingSpeedMul: 1.15, routineSpeedMul: 1.3, aiDependencyAdd: 5 },
  },
  {
    id: 'claude-code',
    name: 'Claude Code解禁',
    rarity: 'rare',
    cost: 20,
    description: ['通常タスク速度 +20%', '複雑タスク成功率 +5%', 'レビュー負荷 +10%'],
    base: { codingSpeedMul: 1.2, reworkRateAdd: -0.05, reviewEfficiencyMul: 0.9 },
  },
  {
    id: 'devin',
    name: 'Devin導入',
    rarity: 'legendary',
    cost: 35,
    description: ['並列実装力 +25%', 'タスク分割が悪いと迷走率 +15%', 'AI依存度 +8%'],
    base: { codingSpeedMul: 1.25, reworkRateAdd: 0.06, aiDependencyAdd: 8 },
  },
  {
    id: 'auto-test',
    name: '自動テスト強化',
    rarity: 'common',
    cost: 18,
    description: ['Rework率 -15%', 'Incident率 -20%', '短期出荷速度 -5%', '長期安定性 +20%'],
    base: { reworkRateAdd: -0.15, incidentRateMul: 0.8, codingSpeedMul: 0.95, qualityAdd: 10 },
  },
  {
    id: 'pr-size-limit',
    name: 'PRサイズ制限',
    rarity: 'common',
    cost: 8,
    description: ['レビュー効率 +15%', '巨大PR発生率 -30%', '開発者の不満 +5%'],
    base: { reviewEfficiencyMul: 1.15, reworkRateAdd: -0.05 },
  },
  {
    id: 'ai-guideline',
    name: 'AI利用ガイドライン',
    rarity: 'rare',
    cost: 12,
    description: ['AI Literacy +15', 'Rework率 -8%'],
    base: { aiLiteracyAdd: 15, reworkRateAdd: -0.08 },
  },
  {
    id: 'docs',
    name: 'ドキュメント整備',
    rarity: 'common',
    cost: 15,
    description: ['AI成功率 +10%（Incident -10%）', '品質 +5', '短期出荷速度 -8%'],
    base: { incidentRateMul: 0.9, qualityAdd: 5, codingSpeedMul: 0.92 },
  },
  {
    id: 'hire-senior',
    name: 'シニア採用',
    rarity: 'rare',
    cost: 40,
    description: ['レビュー容量 +30%', '設計判断力（品質）+12'],
    base: { reviewCapacityMul: 1.3, qualityAdd: 12 },
  },
  {
    id: 'review-bot',
    name: 'レビューBot導入',
    rarity: 'rare',
    cost: 22,
    description: ['小さなPRを自動レビュー（レビュー効率 +20%）', '誤検知でたまにノイズ'],
    base: { reviewEfficiencyMul: 1.2 },
  },
];

const BY_ID = new Map(CARD_DEFS.map((c) => [c.id, c]));

/** カード定義を ID で取得する（未知は undefined）。 */
export function getCard(id: string): CardDef | undefined {
  return BY_ID.get(id);
}
