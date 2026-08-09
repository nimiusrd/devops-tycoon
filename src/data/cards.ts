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
    focusCost: 2,
    description: ['コーディング補助 AI を全員に配布', '定型タスクは特に捗るが、依存度も上がる'],
    base: { codingSpeedMul: 1.15, routineSpeedMul: 1.3, aiDependencyAdd: 5 },
  },
  {
    id: 'claude-code',
    name: 'Claude Code解禁',
    rarity: 'rare',
    cost: 20,
    focusCost: 3,
    description: ['高度な AI コーディングを解禁', '複雑タスクは安定するが、レビュー負荷も増える'],
    base: { codingSpeedMul: 1.2, reworkRateAdd: -0.05, reviewEfficiencyMul: 0.9 },
  },
  {
    id: 'devin',
    name: 'Devin導入',
    rarity: 'legendary',
    cost: 35,
    focusCost: 4,
    description: ['自律型 AI エージェントを導入', '並列実装は進むが、分割が下手だと迷走しやすい'],
    base: { codingSpeedMul: 1.25, reworkRateAdd: 0.06, aiDependencyAdd: 8 },
  },
  {
    id: 'auto-test',
    name: '自動テスト強化',
    rarity: 'common',
    cost: 18,
    focusCost: 3,
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
    focusCost: 2,
    description: ['巨大 PR を抑え、レビューを回しやすくする', '制限に慣れるまで開発者の不満が出る'],
    base: { reviewEfficiencyMul: 1.15, reworkRateAdd: -0.05 },
  },
  {
    id: 'ai-guideline',
    name: 'AI利用ガイドライン',
    rarity: 'rare',
    cost: 12,
    focusCost: 3,
    description: ['AI 利用のルールと教育を整備', '効率的な利用が定着し、依存と手戻りが減る'],
    base: { aiLiteracyAdd: 20, aiDependencyAdd: -18, reworkRateAdd: -0.08 },
  },
  {
    id: 'docs',
    name: 'ドキュメント整備',
    rarity: 'common',
    cost: 15,
    focusCost: 2,
    description: ['設計・運用ドキュメントを整備', 'AI の精度は上がるが、短期の出荷は少し鈍る'],
    base: { incidentRateMul: 0.9, qualityAdd: 5, codingSpeedMul: 0.92 },
  },
  {
    id: 'hire-senior',
    name: 'シニア採用',
    rarity: 'rare',
    cost: 40,
    focusCost: 4,
    description: ['レビューと設計の専門家を1名追加', 'レビュー窓口が増え、品質判断が安定する'],
    base: { reviewCapacityMul: 1.3, qualityAdd: 12 },
  },
  {
    id: 'review-bot',
    name: 'レビューBot導入',
    rarity: 'rare',
    cost: 22,
    focusCost: 3,
    description: ['小さな PR を機械レビューで下支え', 'たまに誤検知でノイズが混じる'],
    base: { reviewEfficiencyMul: 1.2 },
  },
  // RI-81: 初期プール拡張（メタ解放なし）。ドラフト3枚の組み合わせに意味を出す。
  {
    id: 'static-analysis',
    name: '静的解析導入',
    rarity: 'common',
    cost: 12,
    focusCost: 2,
    description: ['CI で静的解析を回し手戻りを減らす', 'ルール整備のあいだ速度は少し落ちる'],
    base: { reworkRateAdd: -0.08, qualityAdd: 6, codingSpeedMul: 0.97 },
  },
  {
    id: 'feature-flags',
    name: 'フィーチャーフラグ',
    rarity: 'common',
    cost: 14,
    focusCost: 2,
    description: ['段階リリースで障害を抑えつつ進める', '実装は進むがフラグ管理のコストがある'],
    base: { incidentRateMul: 0.85, codingSpeedMul: 1.05 },
  },
  {
    id: 'code-owners',
    name: 'CODEOWNERS整備',
    rarity: 'rare',
    cost: 16,
    focusCost: 3,
    description: ['領域オーナーを明示してレビューを回す', '手戻りも少し減る'],
    base: { reviewEfficiencyMul: 1.18, reworkRateAdd: -0.04 },
  },
  {
    id: 'pair-programming',
    name: 'ペアプログラミング',
    rarity: 'common',
    cost: 10,
    focusCost: 2,
    description: [
      '重要タスクを二人で進め品質を守る',
      '単体のコーディング速度は落ちるが手戻りを減らす',
    ],
    base: { reworkRateAdd: -0.07, codingSpeedMul: 0.93, qualityAdd: 4 },
  },
];

const BY_ID = new Map(CARD_DEFS.map((c) => [c.id, c]));

/** カード定義を ID で取得する（未知は undefined）。 */
export function getCard(id: string): CardDef | undefined {
  return BY_ID.get(id);
}
