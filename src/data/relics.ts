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
    description: '悪いイベントによる Morale ダメージ -40%',
    passives: { moraleDamageMul: 0.6 },
  },
  {
    id: 'postmortem',
    name: 'ポストモーテム文化',
    description: 'Incident 率 -10%、Test Coverage を底上げ',
    effects: { incidentRateMul: 0.9, testCoverageAdd: 8 },
  },
  {
    id: 'doc-driven',
    name: 'ドキュメント駆動',
    description: 'AI 成功率の下限を底上げ（Rework -8% / 品質 +6）',
    effects: { reworkRateAdd: -0.08, qualityAdd: 6 },
  },
  {
    id: 'small-pr',
    name: '小さく出す文化',
    description: 'PR サイズを抑制し、レビュー効率 +15%',
    effects: { reviewEfficiencyMul: 1.15 },
  },
  {
    id: 'strong-ci',
    name: '強い CI',
    description: 'Rework の一部を自動で弾く防御バリア（Rework -12%）',
    effects: { reworkRateAdd: -0.12 },
  },
  {
    id: 'flow-first',
    name: 'フロー重視',
    description: 'レビュー容量 +20%、休息の回復が増える',
    effects: { reviewCapacityMul: 1.2 },
    passives: { restHealBonus: 10 },
  },
  {
    id: 'no-friday-deploy',
    name: '金曜デプロイ禁止',
    description: 'スプリント終盤の事故率を大幅減（Incident -15%）',
    effects: { incidentRateMul: 0.85 },
  },
  {
    id: 'primary-source',
    name: '一次情報主義',
    description: 'ドキュメント/テスト由来の効果が逓増（Test +6 / 品質 +6）',
    effects: { testCoverageAdd: 6, qualityAdd: 6 },
  },
  {
    id: 'budget-discipline',
    name: 'コスト意識',
    description: 'ショップ価格 -20%',
    passives: { shopDiscount: 0.2 },
  },
  {
    id: 'expectation-mgmt',
    name: '期待値マネジメント',
    description: 'イベントの Morale ダメージ -25%、予算に余裕',
    passives: { moraleDamageMul: 0.75 },
  },
];

const BY_ID = new Map(RELIC_DEFS.map((r) => [r.id, r]));

/** レリック定義を ID で取得する（未知は undefined）。 */
export function getRelic(id: string): RelicDef | undefined {
  return BY_ID.get(id);
}
