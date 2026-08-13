/**
 * 組織文化レリックの宣言的定義（SPEC 第8章）。
 *
 * カードが「毎ターン使う手」なら、レリックは「組織にしみついた性質」＝恒久パッシブ。
 * 効果は工程モデルに掛かる係数（`effects`）か、ラン全体の数値パッシブ（`passives`）で表す。
 * データ駆動（architecture §4.3）。追加はこのファイルの編集だけで完結する。
 */
import type { CardEffects, RunPassives } from '../sim/run/types';

export interface RelicDef {
  id: string;
  name: string;
  description: string;
  /** スプリントの確率モデルに掛かる係数（カードと同じ畳み込みに合流）。 */
  effects?: Partial<CardEffects>;
  /** ラン全体の数値パッシブ（イベント/ショップ/休息が読む）。 */
  passives?: Partial<RunPassives>;
}

export const RELIC_DEFS: RelicDef[] = [
  {
    id: 'psych-safety',
    name: '心理的安全性',
    description: '失敗を責めず、悪いニュースでも士気が崩れにくい',
    passives: { moraleDamageMul: 0.6 },
  },
  {
    id: 'postmortem',
    name: 'ポストモーテム文化',
    description: 'インシデントから学び、同じ轍を踏まない文化。セキュリティ水準も底上げする',
    // RI-87: 既存レリックへセキュリティ投資を載せる。
    effects: { incidentRateMul: 0.9, testCoverageAdd: 8, securityAdd: 6 },
  },
  {
    id: 'doc-driven',
    name: 'ドキュメント駆動',
    description: '仕様と設計を文書化し、AI の出力精度を底上げ',
    effects: { reworkRateAdd: -0.08, qualityAdd: 6 },
  },
  {
    id: 'small-pr',
    name: '小さく出す文化',
    description: 'PR を小さく切り、レビューを軽快に回す',
    effects: { reviewEfficiencyMul: 1.15 },
  },
  {
    id: 'strong-ci',
    name: '強い CI',
    description: 'CI が手戻りの一部を自動でブロック',
    effects: { reworkRateAdd: -0.12 },
  },
  {
    id: 'flow-first',
    name: 'フロー重視',
    description: 'レビュー待ちを減らし、休息での回復も厚くする',
    effects: { reviewCapacityMul: 1.2 },
    passives: { restHealBonus: 10 },
  },
  {
    id: 'no-friday-deploy',
    name: '金曜デプロイ禁止',
    description: '金曜のリリースを控え、週末前の事故を防ぐ。セキュリティ水準も守る',
    // RI-87: 既存レリックへセキュリティ投資を載せる。
    effects: { incidentRateMul: 0.85, securityAdd: 4 },
  },
  {
    id: 'primary-source',
    name: '一次情報主義',
    description: '一次情報とテストを重視し、品質の土台を固める',
    effects: { testCoverageAdd: 6, qualityAdd: 6 },
  },
  {
    id: 'budget-discipline',
    name: 'コスト意識',
    description: '調達とエージェント利用のコストを意識し、ショップとインフラ費用で得をする',
    // RI-88: 既存レリックへコスト最適化を載せる（新規はショップ抽選を壊すため避ける）。
    effects: { infraCostMul: 0.8 },
    passives: { shopDiscount: 0.2 },
  },
  {
    id: 'expectation-mgmt',
    name: '期待値マネジメント',
    description: 'ステークホルダーの期待を整え、悪い知らせでも士気を守る',
    passives: { moraleDamageMul: 0.75 },
  },
];

const BY_ID = new Map(RELIC_DEFS.map((r) => [r.id, r]));

/** レリック定義を ID で取得する（未知は undefined）。 */
export function getRelic(id: string): RelicDef | undefined {
  return BY_ID.get(id);
}
