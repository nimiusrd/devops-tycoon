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
 * ドラッグ等でプレイヤーが指定する介入ターゲット（RI-30 / SPEC 第6.1）。
 * `assignTask` / `splitPr` で使用。省略時は従来の自動選択。
 */
export interface ActionTarget {
  /** 対象タスク ID。 */
  taskId: number;
  /**
   * assignTask の差配先レーン。
   * 省略時はタスクの現レーン上で加速のみ。
   */
  lane?: Extract<Lane, 'backlog' | 'coding' | 'review'>;
  /**
   * assignTask の担当スタイル。
   * `senior` = 人間実装（aiAssisted=false）、`ai` = AI 利用（aiAssisted=true）。
   */
  assignee?: 'ai' | 'senior';
}

/**
 * スプリント局所の手札山（RI-30 / SPEC 第7.1）。
 * ラン永続の `deck` はコレクション＋強化対象。ここは毎スプリントの配布・発動用。
 */
export interface SprintCardPiles {
  /** まだ引いていない山札（`deck` インデックス。先頭が次に引く）。 */
  drawOrder: number[];
  /** 今スプリントの手札（`deck` インデックス）。 */
  hand: number[];
  /** 発動済み / 未使用で捨てたカード。 */
  discard: number[];
  /** このスプリントで発動し `cardEffects` に入ったもの。 */
  played: number[];
}

/** 手札からのカード発動結果（RI-30）。 */
export interface CardPlayOutcome {
  ok: boolean;
  reason?: 'no-focus' | 'no-card' | 'complete' | 'invalid';
  /** 成功時に消費した集中力。 */
  focusCost?: number;
  /** 発動したデッキ位置。 */
  deckIndex?: number;
}

/**
 * カード効果（SPEC 第7.2）。工程モデルに掛かる係数の集合。
 * `*Mul` は乗算（1 で無効果）、`*Add` は加算（0 で無効果）。
 * スプリント中に発動したカードとレリック等パッシブを畳み込んだ結果を
 * 確率モデルが読む（描画・状態は知らない。第22.2）。
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
  /** ショップで支払う予算コスト。 */
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
  /**
   * 加算系 baseline を既に反映した強化レベル（RI-30 / レガシー）。
   * チーム別マップが無い旧セーブ向け。新規適用は `baselineAppliedByTeam` を正とする。
   */
  baselineAppliedLevel?: number;
  /**
   * チームごとの加算系 baseline 適用レベル（RI-64）。
   * 独立チームへ同じカードを持ち込んだとき、チーム別に恒久加算する。
   */
  baselineAppliedByTeam?: Record<string, number>;
}

/** 時限モディファイアの種別（介入アクションが設定する）。 */
export type InterventionModifierKind = 'andon' | 'overtime' | 'throttle';

/** 介入アクション成功時の効果ペイロード（RI-49）。UI 演出・ログはこれを読む。 */
export interface InterventionEffect {
  actionId: ActionId;
  /** 影響を受けたタスク ID 一覧。 */
  affectedTaskIds?: number[];
  /** Review で捌いた件数。 */
  reviewedCount?: number;
  /** 鎮火したタスク ID。 */
  containedTaskId?: number;
  /** 消費したシニアHP（追加コスト分）。 */
  hpCost?: number;
  /** 消費した士気。 */
  moraleCost?: number;
  /** 獲得した AI Literacy。 */
  literacyGain?: number;
  /** 消費した集中力（⚡）。 */
  focusCost: number;
  /** 連携ゲージ増加量（0..1）。 */
  gaugeGain: number;
  /** 連携ゲージ満タンによる集中力還元。 */
  focusRefund?: number;
  /** 時限モディファイア（アンドン / 残業 / スロットル）。 */
  modifier?: { kind: InterventionModifierKind; untilTick: number };
}

/** 介入アクション発動の結果（SPEC 第6.1）。 */
export interface InterventionOutcome {
  ok: boolean;
  /** 失敗理由（集中力不足 / クールダウン中 / 対象なし / 完了済み）。 */
  reason?: 'no-focus' | 'cooldown' | 'no-target' | 'complete';
  /** 成功時のみ。各アクションの適用内容。 */
  effect?: InterventionEffect;
}

/** スプリント内イベントの種別（RI-52/53。文言は持たず UI がフォーマットする）。 */
export type SprintEventKind =
  | 'intervention'
  | 'combo-break'
  | 'ignite'
  | 'auto-contain'
  | 'spread'
  | 'contain';

/** コンボ途切れの理由。 */
export type ComboBreakReason = 'rework' | 'auto-contain' | 'spread';

/** 点火の原因（RI-34′。「なぜ燃えたか」区別用）。 */
export type IgniteSource = 'review' | 'spread';

/**
 * スプリント中に記録する構造化イベント（RI-52）。
 * seed 決定論の範囲で append のみ。演出・文言は描画層が読む。
 */
export type SprintEvent =
  | {
      tick: number;
      kind: 'intervention';
      effect: InterventionEffect;
      /** 発動直後のコンボ（鎮火継続表示用）。 */
      combo: number;
    }
  | {
      tick: number;
      kind: 'combo-break';
      reason: ComboBreakReason;
      taskId?: number;
    }
  | {
      tick: number;
      kind: 'ignite';
      taskId: number;
      /** Review 落ちか延焼連鎖か（RI-34′）。 */
      source: IgniteSource;
    }
  | {
      tick: number;
      kind: 'auto-contain';
      taskId: number;
      hpCost: number;
    }
  | {
      tick: number;
      kind: 'spread';
      taskId: number;
      /** 燃え移った先のタスク ID（無い場合あり）。 */
      spreadToTaskId?: number;
    }
  | {
      tick: number;
      kind: 'contain';
      taskId: number;
      /** 鎮火後も維持されたコンボ。 */
      combo: number;
    };

/** 炎上因果ログ用イベント（RI-34′。ring buffer とは独立して全件保持）。 */
export type FireSprintEvent = Extract<
  SprintEvent,
  { kind: 'ignite' | 'contain' | 'auto-contain' | 'spread' }
>;

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
  /**
   * 炎上タイマーの残り tick（第6.3）。点火時に設定され、0 になる前に
   * 緊急対応で鎮火しないと自動鎮火（シニアHP大量消費）か延焼へ至る。
   * 燃えていないタスクでは undefined。
   */
  burnTicksLeft?: number;
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
  /** 自動鎮火回数（RI-54。ring buffer 非依存の累計）。 */
  autoContainCount: number;
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
  /** アクション種別ごとの発動回数（リザルトの介入内訳・称号判定用。第4.6）。 */
  actionCounts: Partial<Record<ActionId, number>>;
  /**
   * タスク差配の偏り（RI-30）。理想差配以外が続くと士気コストが増える。
   */
  assignmentSkew?: {
    /** 連続ミスマッチ回数。 */
    mismatchStreak: number;
  };
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
  /**
   * パッシブ（レリック等）＋発動済みカードを畳み込んだ係数
   * （このスプリント中の確率モデルに掛かる。RI-30）。
   */
  cardEffects: CardEffects;
  /** 手札山（スプリント開始時にデッキから配布。RI-30 / SPEC 第7.1）。 */
  cardPiles: SprintCardPiles;
  /**
   * このスプリントの実 AI 採用率（0..1）。コーディング流入時に各タスクが AI を
   * 使う確率。編成（AIを配ったコーダーの割合）で決まり、誰も配らなければ 0 になる。
   */
  aiAdoption: number;
  /**
   * スプリント内イベントログ（RI-52）。上限付き ring buffer（ティッカー表示用）。
   * 点火・鎮火・延焼・コンボ途切れなど直近 N 件を保持する。
   */
  events: SprintEvent[];
  /**
   * 介入イベントの全履歴（RI-53）。リザルトのタイムラインマーカー用。
   * `events` の ring buffer とは独立し、件数制限で落とさない。
   */
  interventionEvents: Array<Extract<SprintEvent, { kind: 'intervention' }>>;
  /**
   * 炎上関連イベントの全履歴（RI-34′）。リザルトの「なぜ燃えたか」解説用。
   * `events` の ring buffer とは独立し、件数制限で落とさない。
   */
  fireEvents: FireSprintEvent[];
  /**
   * tick ごとの時系列サンプル（RI-53）。Review 待ち・燃焼数・コンボ・シニアHP。
   * 介入マーカーは `interventionEvents` から抽出する。
   */
  timeline: TimelineSample[];
}

/** スプリント時系列の 1 サンプル（RI-53）。 */
export interface TimelineSample {
  tick: number;
  /** Review 待ち行列長。 */
  reviewQueue: number;
  /** 燃焼中（炎上）タスク数。 */
  burningCount: number;
  /** 現在コンボ。 */
  combo: number;
  /** シニアHP。 */
  seniorHp: number;
}

/** 同じ開始条件から無介入で再実行した推定値（RI-55）。 */
export interface SprintBaselineResult {
  delivered: number;
  spread: number;
  maxCombo: number;
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
  /** アクション種別ごとの発動回数（介入内訳の表示用。第4.6）。 */
  actionCounts: Partial<Record<ActionId, number>>;
  /** 評価（S/A/B/C/D）。 */
  grade: string;
  /** 称号（SPEC 第4.6 の例から導出）。 */
  title: string;
  /** 診断コメント。 */
  diagnosis: string;
  /** tick 時系列（RI-53。リザルトのスパークライン用）。 */
  timeline: TimelineSample[];
  /** 介入イベント全件（RI-53。タイムラインマーカー用。ring buffer 非適用）。 */
  events: SprintEvent[];
  /** 炎上関連イベント全件（RI-34′。「なぜ燃えたか」解説用。ring buffer 非適用）。 */
  fireEvents: FireSprintEvent[];
  /** スプリント終了時の集中力残量（RI-54）。 */
  focusRemaining: number;
  /** マネジメント集中力の上限（RI-54）。 */
  focusMax: number;
  /** 自動鎮火回数（RI-54。緊急対応を打てなかった炎上の受動対応）。 */
  autoContainCount: number;
  /** 同一 seed・同一開始条件から無介入で再実行した推定値（RI-55）。 */
  baseline?: SprintBaselineResult;
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
