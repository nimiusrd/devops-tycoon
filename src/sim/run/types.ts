/**
 * ラン（1四半期）の周回構造のドメイン型（SPEC 第3章 / 第4.4〜4.6 / 第8〜17章）。
 *
 * Phase 2 までのスプリント（`src/sim/types.ts`）の上に、ローグライクの
 * 入れ子——マップ → スプリント → リザルト → ドラフト → 進化 ——を載せる。
 * すべて描画非依存の純データで、seed付き決定論で更新される（第22.3）。
 */
import type { CardEffects, CardInstance, OrgState, SprintResult, SprintState } from '../types';
import type { GrowthOutcome, RosterState } from '../member/types';
import type { IndustryState, OrgScaleState, RankingKind, ZoomState } from '../orgscale/types';

// 周回レイヤのデータ定義（src/data/*）が参照しやすいよう、コア型を再エクスポートする。
export type { CardEffects, CardInstance } from '../types';
export type { RosterState, GrowthOutcome } from '../member/types';

/**
 * スプリント種別（通常 / 高負荷＝elite / ボス）。
 * 旧 `MapNode.type` の代替で、トラック上のスプリント 1 件の性質を表す。
 */
export type SprintKind = 'normal' | 'elite' | 'boss';

/** ランの進行フェーズ（XState の状態と一致させる。第3章）。 */
export type RunPhase =
  | 'title'
  | 'setup'
  | 'sprint'
  | 'result'
  | 'draft'
  | 'evolution'
  | 'beat'
  | 'shop'
  | 'rest'
  | 'quarterReview'
  | 'won'
  | 'lost';

/**
 * 次スプリント限定の一時効果（一回消費。org の恒久変化とは別軸）。
 * 判定/選択イベントが `EventOutcome.nextSprint` で積み、`beginSprint` が消費する。
 */
export interface SprintModifierDelta {
  /** レビュー待ちの初期負荷加算（巨大 AI 生成 PR など）。 */
  reviewLoadAdd?: number;
  /** 手戻り率の加算（誤生成など。0..1）。 */
  reworkRateAdd?: number;
  /** タスク数の倍率（休息で出荷を手放す等。1 未満で減少）。 */
  taskCountMul?: number;
}

/**
 * 組織状態の信号（イベント重み付けのトリガ。第4節）。
 * org/totals から 0..1 の強度で算出し、イベント定義の `triggers` でスケールする。
 */
export type EventSignal =
  | 'techDebtHigh'
  | 'aiDependencyHigh'
  | 'aiLiteracyLow'
  | 'seniorHpLow'
  | 'moraleLow'
  | 'qualityLow'
  | 'testCoverageHigh'
  | 'documentationHigh';

/** 提示中のビート（スプリント間イベント）。 */
export interface BeatState {
  eventId: string;
  kind: 'judgment' | 'decision';
}

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
  | 'incidentCascade'
  | 'aiDependency'
  | 'bossFailed'
  | 'trustExhausted'
  | 'reorgRequired';

/** ステークホルダー ID（四半期レビュー / SPEC 第4.6.1）。 */
export type StakeholderId = 'management' | 'customers' | 'team';

/** 四半期目標（Delivery / Quality / Tech Debt / Morale / Incident）。 */
export interface QuarterGoal {
  deliveryTarget: number;
  qualityTarget: number;
  techDebtLimit: number;
  moraleTarget: number;
  incidentLimit: number;
  aiAdoptionTarget?: number;
}

/** ステークホルダー信頼（0..100）。 */
export interface StakeholderTrust {
  management: number;
  customers: number;
  team: number;
}

/** 四半期レビューの結果種別。 */
export type QuarterOutcome =
  | 'exceeded'
  | 'met'
  | 'missed_adjustable'
  | 'missed_crisis'
  | 'reorg_required'
  | 'shutdown';

/** 目標修正アクション ID。 */
export type GoalAdjustmentId =
  | 'cut_scope'
  | 'extend_deadline'
  | 'quality_pivot'
  | 'request_budget'
  | 'pause_ai_rollout'
  | 'reorg_teams';

/** KPI ごとの達成状況（レビュー UI 用）。 */
export interface GoalKpiProgress {
  id: string;
  label: string;
  target: number;
  actual: number;
  /** exceeded=超過達成, met=達成, missed=未達。 */
  status: 'exceeded' | 'met' | 'missed';
}

/** 四半期レビューのスナップショット。 */
export interface QuarterReview {
  goal: QuarterGoal;
  outcome: QuarterOutcome;
  trust: StakeholderTrust;
  progress: GoalKpiProgress[];
  missedReasons: string[];
  availableAdjustments: GoalAdjustmentId[];
  bossCleared: boolean;
}

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

/** 開始オプション（デイリーラン等）。 */
export interface StartRunOptions {
  kind?: RunKind;
  dailyDate?: string;
}

/** what-if 試算で表示する 1 指標の期待値と seed 掃引の観測レンジ。 */
export interface WhatIfMetric {
  mean: number;
  min: number;
  max: number;
}

/** 次スプリントを seed 掃引したリスク幅プレビュー（RI-46）。 */
export interface WhatIfPreview {
  /** 集計した決定論試行数。 */
  trials: number;
  /** 完了したタスクの見込み。 */
  delivered: WhatIfMetric;
  /** 延焼件数の見込み。 */
  spread: WhatIfMetric;
  /** カード採用時点で即時敗北する場合。次スプリント試算は行わない。 */
  immediateLose?: LoseReason;
}

/** 現在の状態に対する次スプリント試算。ドラフト時は候補カード別にも提供する。 */
export interface WhatIfState {
  current: WhatIfPreview;
  draftCandidates: Record<string, WhatIfPreview>;
}

/** ランの種別（通常 / デイリー）。 */
export type RunKind = 'normal' | 'daily';

/**
 * ラン全体の状態（スナップショット）。
 * React/レンダラはこれを読むだけ（第22.2）。
 */
export interface RunState {
  seed: string;
  difficulty: DifficultyId;
  /** 適用中の試練（ランモディファイア。第16章）。 */
  trials: string[];
  /** 通常ランかデイリーランか（第23章）。 */
  runKind: RunKind;
  /** デイリーランの UTC 日付（runKind=daily のときのみ）。 */
  dailyDate?: string;
  phase: RunPhase;
  status: RunStatus;
  /** 勝敗が確定したときのみ設定。 */
  winType?: WinType;
  loseReason?: LoseReason;

  /** このランのボス（四半期最終スプリント）。 */
  bossId: string;
  /** 1 四半期あたりのスプリント数（最終インデックスがボス）。 */
  sprintsPerQuarter: number;
  /** 当四半期で進行中／直近に開始したスプリントの 1 起点インデックス（0=未開始）。 */
  sprintIndexInQuarter: number;
  /** 提示中のビート（beat フェーズのみ。null=非提示）。 */
  beat: BeatState | null;
  /** 次スプリントの種別（ビートの選択／ボス強制で確定。一回消費）。 */
  pendingSprintKind: SprintKind;
  /** 進行中スプリントの種別（完了時の評価・進化ポイントまで保持）。 */
  currentSprintKind: SprintKind;
  /** 次スプリント限定の一時効果（beginSprint で消費）。 */
  pendingSprintModifiers: SprintModifierDelta;

  org: OrgState;
  deck: CardInstance[];
  /** 獲得済みレリック ID（恒久パッシブ。第8章）。 */
  relics: string[];
  /** 直近にボス突破報酬として獲得したレリック ID。 */
  bossRelicReward?: string;
  evolution: EvolutionState;
  /** 個体メンバーのロスター = 編成状態（第12章）。 */
  roster: RosterState;
  /** 直近スプリントの成長結果（昇格・休職・育成。result/draft で表示）。 */
  lastGrowth: GrowthOutcome | null;
  /** 予算（ショップ・採用に使う。第4.4 / 第4.7）。 */
  budget: number;

  /** 進行中スプリントの合成 ID（例: `q1-s3`。RNG キー・表示用）。 */
  currentSprintId: string | null;
  /** 進行中スプリント状態（sprint フェーズのみ）。 */
  sprint: SprintState | null;
  /** 進行中スプリントの現在 tick（sprint フェーズ外は 0）。RI-50 モディファイア表示用。 */
  sprintTick: number;
  /** 直近スプリントのリザルト（result/draft フェーズで表示）。 */
  lastResult: SprintResult | null;
  /** ドラフト候補（draft フェーズのみ）。 */
  draft: string[] | null;
  /** setup / draft でのみ公開する次スプリントの確率試算。 */
  whatIf: WhatIfState | null;
  /** ショップの陳列（shop フェーズのみ）。 */
  shop: ShopOffer | null;
  /** 現在の組織タイプ診断（第13章）。 */
  diagnosis: DiagnosisType;

  /** これまでに完了したスプリント数。 */
  sprintsPlayed: number;
  /** ランを通じての累積メトリクス（診断・勝敗の母数）。 */
  totals: RunTotals;
  /** 当四半期のみの累積メトリクス（四半期レビュー KPI・進捗表示の母数）。 */
  quarterTotals: RunTotals;
  /** 残業号令・アンドンを一度でも使ったか（ノーダメ勝利判定。第14章）。 */
  usedHeavyActions: boolean;

  /** 現在の四半期番号（1 起点）。 */
  quarterNumber: number;
  /** 今四半期の目標。 */
  quarterGoal: QuarterGoal;
  /** ステークホルダー信頼。 */
  stakeholderTrust: StakeholderTrust;
  /** 四半期レビュー画面用（quarterReview フェーズのみ）。 */
  quarterReview: QuarterReview | null;
  /** これまでに選んだ目標修正（次期制約・メタ報酬用）。 */
  goalAdjustmentsTaken: GoalAdjustmentId[];
  /** 四半期レビュー履歴（メタ進行報酬用）。 */
  reviewHistory: QuarterOutcome[];

  /** ズーム階層の現在地（業界 ▸ 全社 ▸ 部署 ▸ 現場。第4.7）。 */
  zoom: ZoomState;
  /** 業界ランキングで選択中の種別タブ（第4.10）。 */
  rankingKind: RankingKind;
  /** 全社マップ集約（zoom が現場以外のときのみ生成。null=未表示）。 */
  orgScale: OrgScaleState | null;
  /** 業界ランキング（zoom が業界のときのみ生成。null=未表示）。 */
  industry: IndustryState | null;
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
  /** 延焼を伴う Incident が続いたスプリントの連続数（即時敗北判定用）。 */
  consecutiveIncidentSprints?: number;
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
