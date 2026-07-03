/**
 * 組織進化ツリーの宣言的定義（SPEC 第4.5 / 第11章）。
 *
 * 出荷で得た進化ポイントを割り振り、組織能力を恒久的に伸ばすラン内ビルド要素。
 * 5 ブランチ（開発力 / レビュー体制 / 品質保証 / AI活用 / 文化）。各ノードは
 * 直前ノードを前提（`requires`）にした直線で、データ駆動で増減できる（architecture §4.3）。
 */
import type { CardEffects } from '../sim/run/types';

/** ツリーのブランチ識別子。 */
export type EvolutionBranch = 'dev' | 'review' | 'quality' | 'ai' | 'culture';

export interface EvolutionNodeDef {
  id: string;
  branch: EvolutionBranch;
  name: string;
  description: string;
  /** 解放コスト（進化ポイント）。 */
  cost: number;
  /** 前提ノード（同ブランチの直前。無指定はブランチ起点）。 */
  requires?: string;
  /** スプリントの確率モデルに掛かる係数。 */
  effects?: Partial<CardEffects>;
  /** 集中力上限への加算。 */
  focusBonus?: number;
  /** 並列実装枠への加算。 */
  codingSlotBonus?: number;
}

export const BRANCH_LABEL: Record<EvolutionBranch, string> = {
  dev: '開発力',
  review: 'レビュー体制',
  quality: '品質保証',
  ai: 'AI活用',
  culture: '文化',
};

/** ブランチごとに上から順に解放していく（`requires` で直列化）。 */
export const EVOLUTION_NODES: EvolutionNodeDef[] = [
  // 開発力
  {
    id: 'dev-1',
    branch: 'dev',
    name: 'Coding 速度向上',
    description: '実装スループットを底上げする基盤整備',
    cost: 1,
    effects: { codingSpeedMul: 1.12 },
  },
  {
    id: 'dev-2',
    branch: 'dev',
    name: '並列実装枠 +1',
    description: '同時に進められる Coding 枠を増やす',
    cost: 2,
    requires: 'dev-1',
    codingSlotBonus: 1,
  },
  {
    id: 'dev-3',
    branch: 'dev',
    name: '定型処理の自動化',
    description: 'ルーティン作業を自動化し、定型タスクを速く回す',
    cost: 2,
    requires: 'dev-2',
    effects: { routineSpeedMul: 1.3 },
  },
  // レビュー体制
  {
    id: 'review-1',
    branch: 'review',
    name: 'レビュー容量増強',
    description: 'レビュアーの受入容量を拡大する',
    cost: 1,
    effects: { reviewCapacityMul: 1.2 },
  },
  {
    id: 'review-2',
    branch: 'review',
    name: '自動レビュー解放',
    description: '機械レビューで小さな PR を先回りする',
    cost: 2,
    requires: 'review-1',
    effects: { reviewEfficiencyMul: 1.18 },
  },
  {
    id: 'review-3',
    branch: 'review',
    name: '割り込みレビュー強化',
    description: '割り込みレビュー体制をさらに強化する',
    cost: 2,
    requires: 'review-2',
    effects: { reviewCapacityMul: 1.2 },
  },
  // 品質保証
  {
    id: 'quality-1',
    branch: 'quality',
    name: 'Test Coverage 効率',
    description: 'テスト資産を増やし、安全性を底上げ',
    cost: 1,
    effects: { testCoverageAdd: 12 },
  },
  {
    id: 'quality-2',
    branch: 'quality',
    name: '防御バリア常設',
    description: 'インシデントを未然に弾く防御線を常設',
    cost: 2,
    requires: 'quality-1',
    effects: { incidentRateMul: 0.82 },
  },
  {
    id: 'quality-3',
    branch: 'quality',
    name: 'Incident 耐性',
    description: '手戻り耐性と品質文化を底上げ',
    cost: 2,
    requires: 'quality-2',
    effects: { reworkRateAdd: -0.1, qualityAdd: 8 },
  },
  // AI活用
  {
    id: 'ai-1',
    branch: 'ai',
    name: 'AI 成功率向上',
    description: 'AI 活用の精度を上げ、手戻りを抑える',
    cost: 1,
    effects: { reworkRateAdd: -0.1 },
  },
  {
    id: 'ai-2',
    branch: 'ai',
    name: 'AI Literacy 逓増',
    description: 'チーム全体の AI リテラシーを底上げ',
    cost: 2,
    requires: 'ai-1',
    effects: { aiLiteracyAdd: 18 },
  },
  {
    id: 'ai-3',
    branch: 'ai',
    name: 'Devin 枠',
    description: '自律型 AI の実装枠を組織に組み込む',
    cost: 3,
    requires: 'ai-2',
    effects: { codingSpeedMul: 1.2 },
  },
  // 文化
  {
    id: 'culture-1',
    branch: 'culture',
    name: '集中力上限 +2',
    description: 'マネジメント集中力の上限を引き上げる',
    cost: 1,
    focusBonus: 2,
  },
  {
    id: 'culture-2',
    branch: 'culture',
    name: '品質文化',
    description: '品質を重視する文化を根付かせる',
    cost: 2,
    requires: 'culture-1',
    effects: { qualityAdd: 10 },
  },
  {
    id: 'culture-3',
    branch: 'culture',
    name: '集中力上限 +3',
    description: '集中力の余裕をさらに確保する',
    cost: 2,
    requires: 'culture-2',
    focusBonus: 3,
  },
];

const BY_ID = new Map(EVOLUTION_NODES.map((n) => [n.id, n]));

/** 進化ノード定義を ID で取得する（未知は undefined）。 */
export function getEvolutionNode(id: string): EvolutionNodeDef | undefined {
  return BY_ID.get(id);
}
