/**
 * シミュレーションのドメイン型（SPEC 第4.1〜4.2 / 第5章）。
 *
 * 工程モデル（Task / Lane / OrgState）とスプリント状態・リザルトを定義する。
 * すべて描画非依存の純データで、seed付き決定論で更新される（第22.3）。
 */

/** 難易度・シナリオの識別子（SPEC 第16章）。 */
export type ScenarioId = string;

/** タスクが流れる工程（SPEC 第4.1: Backlog▸Coding▸Review▸Rework▸Done）。 */
export type Lane = 'backlog' | 'coding' | 'review' | 'rework' | 'done';

/** タスクの規模（SPEC 第4.1 の 小/中/大）。 */
export type TaskKind = 'routine' | 'normal' | 'complex';

/** 介入アクションの識別子（SPEC 第6.1 の表）。 */
export type ActionId =
  | 'interruptReview'
  | 'splitPr'
  | 'firefight'
  | 'assignTask'
  | 'aiThrottle'
  | 'overtime'
  | 'andon'
  | 'pairReview';

/** カードのレアリティ（SPEC 第7.1）。 */
export type CardRarity = 'common' | 'rare' | 'legendary';

/**
 * カード効果（SPEC 第7.2）。工程モデルに掛かる係数の集合。
 * `*Mul` は乗算（1 で無効果）、`*Add` は加算（0 で無効果）。
 * デッキ全体を畳み込んで 1 つの `CardEffects` に集約し、
 * スプリント中の確率モデルが読む（描画・状態は知らない。第22.2）。
 */
export interface CardEffects {
  /** Coding 速度倍率（高いほど速い）。 */
  codingSpeedMul: number;
  /** 定型タスクの追加 Coding 速度倍率。 */
  routineSpeedMul: number;
  /** Review スループット倍率。 */
  reviewEfficiencyMul: number;
  /** レビュー容量倍率（シニア採用など。reviewEfficiency と別軸）。 */
  reviewCapacityMul: number;
  /** Rework 率への加算（負で減少）。 */
  reworkRateAdd: number;
  /** Incident 率への乗算（1 で無効果）。 */
  incidentRateMul: number;
  /** スプリント開始時に加える AI Literacy。 */
  aiLiteracyAdd: number;
  /** スプリント開始時に加える AI依存度。 */
  aiDependencyAdd: number;
  /** スプリント開始時に加える品質。 */
  qualityAdd: number;
  /** スプリント開始時に加えるテストカバレッジ。 */
  testCoverageAdd: number;
}

/**
 * データ駆動のカード定義（SPEC 第7.2）。`src/data/cards` に宣言的に置き、
 * バランス調整をコード変更なしで行えるようにする（architecture §4.3）。
 */
export interface CardDef {
  id: string;
  name: string;
  rarity: CardRarity;
  /** 予算コスト（ショップ用。Phase 3 で接続）。 */
  cost: number;
  /** 表示用の効果説明（行単位）。 */
  description: string[];
  /** レベル 1 の効果（IDENTITY からの差分。指定キーのみ上書き）。 */
  base: Partial<CardEffects>;
}

/** デッキ内のカード 1 枚の実体（定義 + 強化レベル）。 */
export interface CardInstance {
  defId: string;
  /** 強化レベル（1 起点。強化で効果増・コスト減）。 */
  level: number;
}

/** 介入アクション発動の結果（SPEC 第6.1）。 */
export interface InterventionOutcome {
  ok: boolean;
  /** 失敗理由（集中力不足 / クールダウン中 / 対象なし / 完了済み）。 */
  reason?: 'no-focus' | 'cooldown' | 'no-target' | 'complete';
}

/** スプリント中に有効な時限モディファイア（介入アクションが設定する）。 */
export interface SprintModifiers {
  /** この tick 未満の間、Backlog からの流入を止める（アンドン）。 */
  andonUntilTick: number;
  /** この tick 未満の間、スループットをブーストする（残業号令）。 */
  overtimeUntilTick: number;
  /** この tick 未満の間、AI 流入を絞る（AIスロットル）。 */
  throttleUntilTick: number;
}

/**
 * 工程上を流れる 1 タスク（PR）。
 * 種類ごとの見た目（光る/赤/金/黒/炎上）は `aiAssisted` などのフラグから
 * 純関数で導出する（描画は状態を読むだけ。第22.2）。
 */
export interface Task {
  id: number;
  /** 規模（小/中/大）。見た目のサイズに対応。 */
  kind: TaskKind;
  /** 高価値タスク（金色）。 */
  highValue: boolean;
  /** AI を使って実装されたか（光る）。 */
  aiAssisted: boolean;
  /** 現在の工程。 */
  lane: Lane;
  /** 現工程内の進捗 0..1。 */
  progress: number;
  /** これまでに手戻りした回数。 */
  reworkAttempts: number;
  /** 一度でも手戻りを経験したか。 */
  wasReworked: boolean;
  /** 障害化して鎮火/対応中か（炎上エフェクト）。 */
  incident: boolean;
  /** 技術的負債化したか（黒）。 */
  debt: boolean;
  /** PR分割/タスク差配で「捌きやすく」された印（手戻り率を下げる。第6.1）。 */
  split?: boolean;
}

/**
 * 組織の状態（SPEC 第5章のリソース / 第4.2 のステータス）。
 * 数値は基本的に 0..100。`techDebt` と `deliveryScore` は累積カウント。
 */
export interface OrgState {
  /** AI 導入フラグ（本作のコア因果のスイッチ。第2章）。 */
  aiEnabled: boolean;
  /** AI依存度 0..100（雑な AI 利用ほど Rework/Incident を増やす）。 */
  aiDependency: number;
  /** AI を適切に使う能力 0..100。 */
  aiLiteracy: number;
  /** 自動テストによる安全性 0..100。 */
  testCoverage: number;
  /** ドキュメント量 0..100。 */
  documentation: number;
  /** 品質水準 0..100。 */
  quality: number;
  /** 士気 0..100。 */
  morale: number;
  /** シニアのレビュー余力 0..100。 */
  seniorHp: number;
  /** 技術的負債（累積）。 */
  techDebt: number;
  /** 出荷ポイント（累積）。 */
  deliveryScore: number;
}

/** スプリントの構成（タスク数・並列開発数・安全上限）。 */
export interface SprintConfig {
  /** スプリントに投入するタスク総数。 */
  taskCount: number;
  /** 同時に Coding できる開発者数（WIP 上限）。 */
  codingSlots: number;
  /** 無限ループ防止の最大 tick。超過時は残りを強制的に Done へ流す。 */
  maxTicks: number;
  /** マネジメント集中力の上限（毎スプリント満タンへ回復。第6.2）。 */
  focusMax: number;
}

/** スプリント進行中に積み上がる集計値（リザルトの素）。 */
export interface SprintMetrics {
  /** 出荷ポイント。 */
  delivered: number;
  /** Done になったタスク数。 */
  doneCount: number;
  /** 手戻り発生回数（延べ）。 */
  reworkCount: number;
  /** 障害（Incident）発生回数。 */
  incidentCount: number;
  /** 鎮火できた障害数。 */
  contained: number;
  /** 延焼した障害数。 */
  spread: number;
  /** AI 利用で Done に至ったタスク数。 */
  aiAssistedCompleted: number;
  /** Done に至ったタスク数（aiAssistedPct の母数）。 */
  completedCount: number;
  /** Review 待ち行列の最大長（渋滞の指標）。 */
  reviewQueueMax: number;
  /** 現在のクリーン出荷の連続数。 */
  combo: number;
  /** スプリント中の最大コンボ。 */
  maxCombo: number;
  /** スプリント開始時のシニア体力。 */
  seniorHpStart: number;
  /** 発動した介入アクションの回数（第6章）。 */
  interventionsUsed: number;
  /** 消費した集中力の累計。 */
  focusSpent: number;
}

/** スプリント全体の状態。 */
export interface SprintState {
  config: SprintConfig;
  /** 進行中の全タスク（Done を含む）。 */
  tasks: Task[];
  metrics: SprintMetrics;
  /** Review の小数スループットを溜めるアキュムレータ。 */
  reviewAccumulator: number;
  /** 次に採番するタスク ID。 */
  nextTaskId: number;
  /** スプリントが完了したか（盤面が捌け切る or 上限到達）。 */
  complete: boolean;
  /** マネジメント集中力の現在値（スプリント中は自然回復しない。第6.2）。 */
  focus: number;
  /** アクションごとの残りクールダウン tick（0 で Ready。第6.1）。 */
  cooldowns: Partial<Record<ActionId, number>>;
  /** 介入アクションが設定する時限モディファイア。 */
  modifiers: SprintModifiers;
  /** 連携ゲージ 0..1（適切な介入で溜まり、満タンで集中力が回復。第6.2）。 */
  comboGauge: number;
  /** デッキを畳み込んだカード効果（このスプリント中の確率モデルに掛かる）。 */
  cardEffects: CardEffects;
}

/** スプリントリザルト（SPEC 第4.6）。 */
export interface SprintResult {
  done: number;
  delivered: number;
  maxCombo: number;
  /** AI 利用率 0..100。 */
  aiAssistedPct: number;
  reviewQueueMax: number;
  rework: number;
  incidents: number;
  contained: number;
  spread: number;
  /** シニア体力の増減（end - start。多くは負）。 */
  seniorHpDelta: number;
  /** 評価（S/A/B/C/D）。 */
  grade: string;
  /** 称号（SPEC 第4.6 の例から導出）。 */
  title: string;
  /** 診断コメント。 */
  diagnosis: string;
}

/** シミュレーション全体の状態。 */
export interface SimState {
  /** 解決済みの seed 文字列。 */
  seed: string;
  /** 適用中のシナリオ。 */
  scenario: ScenarioId;
  /** 経過した固定ステップ数。 */
  tick: number;
  /** 経過シミュレーション時間（ms）。 */
  elapsedMs: number;
  /** 直近に消費した乱数（決定論の可視化・検証用）。 */
  lastRandom: number;
  /** AI 導入フラグ（UI から参照）。 */
  aiEnabled: boolean;
  /** 組織状態。 */
  org: OrgState;
  /** スプリント状態。 */
  sprint: SprintState;
  /** 何スプリント目か（0 起点。ドラフトで周回が進む。第7章）。 */
  sprintIndex: number;
  /** 所持カード（デッキ）。スプリント開始時に効果が掛かる。 */
  deck: CardInstance[];
  /** スプリント完了時に提示するドラフト候補（カード定義 ID×3）。未完了は null。 */
  draft: string[] | null;
}
