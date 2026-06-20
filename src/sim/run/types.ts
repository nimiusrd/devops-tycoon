/**
 * ラン（1四半期）の周回構造のドメイン型（SPEC 第3章 / 第4.4〜4.6 / 第8〜17章）。
 *
 * Phase 2 までのスプリント（`src/sim/types.ts`）の上に、ローグライクの
 * 入れ子——マップ → スプリント → リザルト → ドラフト → 進化 ——を載せる。
 * すべて描画非依存の純データで、seed付き決定論で更新される（第22.3）。
 */
import type { CardEffects, CardInstance, OrgState, SprintResult, SprintState } from '../types';
import type { GrowthOutcome, RosterState } from '../member/types';

// 周回レイヤのデータ定義（src/data/*）が参照しやすいよう、コア型を再エクスポートする。
export type { CardEffects, CardInstance } from '../types';
export type { RosterState, GrowthOutcome } from '../member/types';

/** マップのノード種別（SPEC 第4.4 の表）。高負荷＝elite。 */
export type NodeType = 'normal' | 'elite' | 'event' | 'shop' | 'rest' | 'boss';

/** ランの進行フェーズ（XState の状態と一致させる。第3章）。 */
export type RunPhase =
  | 'title'
  | 'map'
  | 'sprint'
  | 'result'
  | 'draft'
  | 'evolution'
  | 'event'
  | 'shop'
  | 'rest'
  | 'won'
  | 'lost';

/** ランの決着（第14 / 第15章）。 */
export type RunStatus = 'playing' | 'won' | 'lost';

/** 勝利の種別（SPEC 第14章）。 */
export type WinType =
  | 'normal'
  | 'healthy'
  | 'aiSuccess'
  | 'management'
  | 'happiness'
  | 'chaos'
  | 'noDamage';

/** 敗北の理由（SPEC 第15章）。 */
export type LoseReason =
  | 'seniorBurnout'
  | 'techDebt'
  | 'moraleCollapse'
  | 'reviewFreeze'
  | 'bossFailed';

/** 難易度（SPEC 第16章）。 */
export type DifficultyId = 'easy' | 'normal' | 'hard' | 'nightmare';

/** 組織タイプ診断の種別（SPEC 第13章）。 */
export type DiagnosisType =
  | 'healthyAcceleration'
  | 'reviewHell'
  | 'aiOverproduction'
  | 'reworkSpiral'
  | 'seniorSacrifice'
  | 'documentationKingdom';

/** マップ上の 1 ノード。層（col）と行（row）で配置し、`next` で次層へつなぐ。 */
export interface MapNode {
  id: string;
  type: NodeType;
  /** 層（0 起点。最終層はボス）。 */
  col: number;
  /** 層内の行位置（描画用）。 */
  row: number;
  /** 次の層で接続するノード ID 群（分岐ルート）。 */
  next: string[];
}

/** 生成済みのランマップ（層状の有向非巡回グラフ）。 */
export interface RunMap {
  nodes: MapNode[];
  /** 層数（ボス層を含む）。 */
  columns: number;
}

/** 進化ツリーの解放状態（SPEC 第4.5 / 第11章）。 */
export interface EvolutionState {
  /** 未割り振りの進化ポイント。 */
  points: number;
  /** 解放済みノード ID 集合。 */
  unlocked: Record<string, true>;
}

/** ショップで売られている 1 枚（カード）と購入済みフラグ。 */
export interface ShopCardOffer {
  defId: string;
  cost: number;
  bought: boolean;
}

/** ショップの陳列（SPEC 第4.4 の $ノード）。 */
export interface ShopOffer {
  cards: ShopCardOffer[];
  relic?: { id: string; cost: number; bought: boolean };
}

/**
 * ラン全体の状態（スナップショット）。
 * React/レンダラはこれを読むだけ（第22.2）。
 */
export interface RunState {
  seed: string;
  difficulty: DifficultyId;
  /** 適用中の試練（ランモディファイア。第16章）。 */
  trials: string[];
  phase: RunPhase;
  status: RunStatus;
  /** 勝敗が確定したときのみ設定。 */
  winType?: WinType;
  loseReason?: LoseReason;

  map: RunMap;
  /** このランのボス（マップ表示用）。 */
  bossId: string;
  /** 現在地のノード ID（未進入は null）。 */
  position: string | null;
  /** 通過済みノード ID。 */
  visited: string[];
  /** 次に選べるノード ID（分岐）。 */
  available: string[];

  org: OrgState;
  deck: CardInstance[];
  /** 獲得済みレリック ID（恒久パッシブ。第8章）。 */
  relics: string[];
  evolution: EvolutionState;
  /** 個体メンバーのロスター = 編成状態（第12章 / MVP4）。 */
  roster: RosterState;
  /** 直近スプリントの成長結果（昇格・休職・育成。result/draft で表示）。 */
  lastGrowth: GrowthOutcome | null;
  /** 予算（ショップ・採用に使う。第4.4 / 第4.7）。 */
  budget: number;

  /** 進行中スプリントのノード ID（sprint フェーズのみ）。 */
  activeNodeId: string | null;
  /** 進行中スプリント状態（sprint フェーズのみ）。 */
  sprint: SprintState | null;
  /** 直近スプリントのリザルト（result/draft フェーズで表示）。 */
  lastResult: SprintResult | null;
  /** ドラフト候補（draft フェーズのみ）。 */
  draft: string[] | null;
  /** 進入中のイベント ID（event フェーズのみ）。 */
  eventId: string | null;
  /** ショップの陳列（shop フェーズのみ）。 */
  shop: ShopOffer | null;
  /** 現在の組織タイプ診断（第13章）。 */
  diagnosis: DiagnosisType;

  /** これまでに完了したスプリント数。 */
  sprintsPlayed: number;
  /** ランを通じての累積メトリクス（診断・勝敗の母数）。 */
  totals: RunTotals;
  /** 残業号令・アンドンを一度でも使ったか（ノーダメ勝利判定。第14章）。 */
  usedHeavyActions: boolean;
}

/** ランを通じて積み上がる集計（複数スプリントの合算）。 */
export interface RunTotals {
  delivered: number;
  done: number;
  rework: number;
  incidents: number;
  contained: number;
  spread: number;
  aiAssisted: number;
  completed: number;
  reviewQueuePeak: number;
  maxCombo: number;
}

/** デッキ・レリック・進化を畳み込んだ、このスプリントに掛かる係数とコンフィグ補正。 */
export interface RunEffects {
  effects: CardEffects;
  /** 集中力上限への加算（文化ブランチ等）。 */
  focusBonus: number;
  /** 並列実装枠への加算（開発力ブランチ等）。 */
  codingSlotBonus: number;
}

/** レリック・イベント・ショップ等が読む、ラン全体の数値パッシブ。 */
export interface RunPassives {
  /** イベントの Morale ダメージ倍率（心理的安全性で減少。第8章）。 */
  moraleDamageMul: number;
  /** 休息での回復量ボーナス。 */
  restHealBonus: number;
  /** ショップ価格の割引率 0..1。 */
  shopDiscount: number;
  /** 同時所持できるレリック枠（表示用）。 */
  relicSlots: number;
}
