/**
 * 決定論フック `window.game`（SPEC 第22.5）。
 *
 * ラン（1〜複数四半期）全体を露出する。E2E / デバッグから、タイトル → スプリント →
 * リザルト → ドラフト → 進化 → ボス → 四半期レビューの各フェーズを
 * 一時停止つきで駆動でき、seed で再現できる（第22.3 / 22.5）。
 * ラン決着時にはメタ進行を永続化する（第17章）。
 */
import { getTrial } from './data/difficulties';
import { createRunEngine, type RunEngine } from './sim/run/engine';
import { resolveSeedFromLocation } from './sim/seed';
import type {
  ActionId,
  ActionTarget,
  CardPlayOutcome,
  InterventionOutcome,
  ScenarioId,
} from './sim/types';
import type {
  DiagnosisType,
  DifficultyId,
  GoalAdjustmentId,
  RunState,
  WhatIfState,
} from './sim/run/types';
import { computeWhatIfState, whatIfCacheKey, type WhatIfComputeInput } from './sim/run/whatIfState';
import { requestWhatIfState } from './sim/run/whatIfClient';
import type { LaneAssignment } from './sim/member/types';
import type { RankingKind, ZoomLevel } from './sim/orgscale/types';
import {
  applyDailyRunReward,
  applyRunReward,
  computeRunRewardBreakdown,
  dailySeed,
  DAILY_RUN_DIFFICULTY,
  DAILY_RUN_TRIALS,
  defaultMeta,
  purchaseUnlock,
  TUTORIAL_CONTENT_VERSION,
  unlockedContent,
  utcDateStr,
  type MetaState,
  type RunRewardBreakdown,
  withPreferredCardIds,
  withSoundMuted,
} from './state/meta';
import type { MetaStorage } from './state/metaPersistence';
import { labelForReplayKeyframe } from './render/reviewHellReplayView';
import {
  buildReplayId,
  normalizeReplay,
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  selectReplaysWithinMax,
  type ReplayBlob,
  type ReplayContentSnapshot,
  type ReplayKeyframe,
  type ReplayRulesetIdentity,
} from './state/replay';
import type { ReplayStorage } from './state/replayPersistence';
import {
  CURRENT_RUN_RULESET,
  getRunSaveCompatibilityIssue,
  toRunSave,
  type RunSave,
  type RunSaveCompatibilityIssue,
  type RunSaveSummary,
  type RunRulesetIdentity,
  type RunStorage,
} from './state/runPersistence';
import {
  parseReplayShare,
  REPLAY_SHARE_REASON_MESSAGE,
  serializeReplay,
  type ReplayShareResult,
} from './state/replayShare';
import {
  parseRunSaveShare,
  RUN_SAVE_SHARE_REASON_MESSAGE,
  serializeRunSave,
  type RunSaveShareResult,
} from './state/runSaveShare';
import { createRunDiagnosticInfo, type RunDiagnosticInfo } from './state/diagnosticInfo';

export interface ActiveReplayInfo {
  ruleset: ReplayRulesetIdentity | null;
  contentSnapshot: ReplayContentSnapshot | null;
}

export interface GameHandle {
  /** 自動進行を止める。 */
  pause(): void;
  /** 自動進行を再開する。 */
  resume(): void;
  /** 一時停止中か。 */
  isPaused(): boolean;
  /**
   * pause() の呼び出し回数（所有権判定用）。
   * lazy 読込中の一時 pause が、後続の外部 pause を誤って解除しないために使う。
   */
  getPauseEpoch(): number;
  /** 現在のラン状態のスナップショット。 */
  getState(): RunState;
  /** 不具合再現用のseed・ルールセット・開始条件を返す（RI-121）。 */
  getDiagnosticInfo(): RunDiagnosticInfo;
  /** タイトルで選んだ難易度・試練でランを開始する。seed 省略時はタイトル用 pending seed。 */
  startRun(
    difficulty?: DifficultyId,
    trials?: string[],
    seed?: string,
    scenario?: ScenarioId,
  ): RunState;
  /** 本日（または指定 UTC 日）のデイリーランを開始する（第23章）。 */
  startDailyRun(dateStr?: string): RunState;
  /**
   * ラン開始ごとに増える世代番号（RI-60）。
   * `currentSprintId` はランを跨いで再利用されるため、ガイド再表示判定にはこちらを使う。
   */
  getRunEpoch(): number;
  /** 編成フェーズ（setup / setup-pre）から次スプリントを開始する。 */
  beginSetupSprint(): RunState;
  /** 提示中ビートを解決する（判定は引数なし、選択は index）。 */
  resolveBeat(choiceIndex?: number): RunState;
  /** 指定 ms ぶんスプリントを手動で前進させる。 */
  step(ms: number): RunState;
  /** 介入アクションを発動する（第6章）。target は差配/分割の対象指定（RI-30）。 */
  dispatch(id: ActionId, target?: ActionTarget): InterventionOutcome;
  /** 手札からカードを発動する（deckIndex。RI-30 / SPEC 第7.1）。 */
  playCard(deckIndex: number): CardPlayOutcome;
  /** リザルトを確認してドラフトへ進む。 */
  acknowledgeResult(): RunState;
  /** ドラフトでカードを選ぶ。 */
  chooseCard(defId: string): RunState;
  /** ドラフトをスキップする。 */
  skipDraft(): RunState;
  /** ドラフトを予算コストで引き直す（RI-81）。 */
  mulliganDraft(): RunState;
  /** 進化ノードを解放する。 */
  unlockEvolution(id: string): RunState;
  /** 進化フェーズを終えて次のビートへ進む。 */
  finishEvolution(): RunState;
  /** ショップでカードを買う。 */
  buyShopCard(defId: string): RunState;
  /** ショップでレリックを買う。 */
  buyShopRelic(): RunState;
  /** ショップでメンバーを採用する（RI-26）。 */
  buyShopRecruit(): RunState;
  /** ショップを出る。 */
  leaveShop(): RunState;
  /** 休息の選択（heal / repay / upgrade / recruit）。upgrade はデッキ位置を指定可能。 */
  restChoose(option: 'heal' | 'repay' | 'upgrade' | 'recruit', deckIndex?: number): RunState;
  /** 採用フェーズの選択（hire / skip）。RI-26。 */
  recruitChoose(option: 'hire' | 'skip'): RunState;
  /** メンバーをレーンへ配置する（編成。第12章）。 */
  assignMember(id: string, assignment: LaneAssignment): RunState;
  /** メンバーへの AI 配布を切り替える（編成。第12章）。 */
  setMemberAi(id: string, on: boolean): RunState;
  /** ズーム階層を切り替える（業界 ▸ 全社 ▸ 部署 ▸ 現場。第4.7）。 */
  zoomTo(level: ZoomLevel): RunState;
  /** 部門をフォーカスして部署ビューへ（ドリルダウン。第4.9）。 */
  focusDept(id: string): RunState;
  /** チームを状態確認する（選択中なら現場、他は部署。第4.11 / RI-64）。 */
  focusTeam(id: string): RunState;
  /** 特定チームへ入り込む（集中力コスト・期間拘束。RI-64）。 */
  enterTeam(id: string): RunState;
  /** 業界ランキングの種別タブを切り替える（第4.10）。 */
  setRankingKind(kind: RankingKind): RunState;
  /** 全社 / 部門 / チームレバーを発動する（四半期予算を消費。第4.8 / 第4.9 / RI-64）。 */
  applyOrgLever(leverId: string, deptId?: string, teamId?: string): RunState;
  /** 四半期レビューを承認する（達成→won / 継続不能→lost）。 */
  acknowledgeQuarterReview(): RunState;
  /** 目標修正を選び次四半期へ進む。 */
  chooseGoalAdjustment(id: GoalAdjustmentId): RunState;
  /** タイトルへ戻る。seed 省略時は Daily / リプレイで汚していない pending seed に戻す。 */
  newRun(seed?: string): RunState;
  /** メタショップでコンテンツを永続解放する（points 消費）。 */
  purchaseMetaUnlock(unlockId: string): { ok: boolean; reason?: string };
  /** サウンドミュートを永続化する（RI-59）。 */
  setSoundMuted(muted: boolean): void;
  /**
   * 研修方針（優先施策）を永続化する（RI-34⁗）。
   * 解放済みカードのみ。最大 2 枚。ラン中プールは開始時スナップショットのまま。
   */
  setPreferredCardIds(cardIds: readonly string[]): void;
  /** 初見向け段階ガイドを表示済みにする（RI-60）。 */
  markTutorialSeen(): void;
  /** 現在のメタ進行（解放状況・実績）。 */
  getMeta(): MetaState;
  /** 直近ランで付与したメタ進行ポイント内訳（未決着時は null）。 */
  getLastRunReward(): RunRewardBreakdown | null;
  /** 起動時の非同期永続化を接続し、メタ更新を解禁する。 */
  attachMetaPersistence(meta: MetaState, storage: MetaStorage): void;
  /** 起動時のランセーブ永続化を接続する（まだ hydrate しない）。 */
  attachRunPersistence(
    storage: RunStorage,
    save: RunSave | null,
    issue?: RunSaveCompatibilityIssue | null,
  ): void;
  /** タイトルから途中セーブを再開する（RI-58）。 */
  resumeRun(): RunState | null;
  /** 再開可能なランセーブがあるか。 */
  hasResumableRun(): boolean;
  /** タイトル「続きから」用の要約（無い場合は null）。 */
  getRunSaveSummary(): RunSaveSummary | null;
  /** ルールセット不一致・情報欠落で再開できないセーブの理由。 */
  getRunSaveIssue(): RunSaveCompatibilityIssue | null;
  /** ランセーブを破棄する。 */
  clearRunSave(): void;
  /** 現行の途中セーブを JSON 文字列にする（無い場合は null。RI-133）。 */
  exportRunSaveText(): string | null;
  /**
   * JSON から途中セーブを読み込む。成功時だけラン保存を置き換える。
   * 失敗時は既存セーブ・メタ進行・リプレイを触らない。
   */
  importRunSaveText(raw: string): Promise<RunSaveShareResult>;
  /** リプレイ永続化を接続し、一覧をキャッシュする（RI-61）。 */
  attachReplay(storage: ReplayStorage): Promise<void>;
  /** 保存済みリプレイ一覧（新しい順）。 */
  listReplays(): ReplayBlob[];
  /** 指定リプレイを JSON 文字列にする（無い場合は null。RI-133）。 */
  exportReplayText(id: string): string | null;
  /**
   * JSON からリプレイを読み込む。成功時だけ既存上限に従って保持する。
   * 失敗時は既存リプレイ・メタ進行・途中セーブを触らない。
   */
  importReplayText(raw: string): Promise<ReplayShareResult>;
  /** リプレイのキーフレームを read-only で開く（失敗時 null）。 */
  openReplay(id: string, keyframeIndex?: number): RunState | null;
  /** リプレイ閲覧を終了してタイトルへ戻る。 */
  exitReplay(): RunState;
  /** リプレイ閲覧中か。 */
  isReplayMode(): boolean;
  /**
   * 閲覧中リプレイの終端診断（`ReplayBlob.outcome.diagnosis`）。
   * キーフレーム時点の `state.diagnosis` とは別に保持する（RI-34‴）。
   */
  getActiveReplayDiagnosis(): DiagnosisType | null;
  /** 閲覧中リプレイの記録時ルールセットと表示コンテンツ。 */
  getActiveReplayInfo(): ActiveReplayInfo | null;
  /**
   * リプレイを永続化層へ取り込みキャッシュを更新する（E2E / デバッグ用。RI-34‴）。
   * 正規化に失敗した場合は false。
   */
  importReplay(blob: unknown): Promise<boolean>;
  /** 現在のフェーズ（軽量アクセサ。スナップショットを作らない）。 */
  phase(): RunState['phase'];
  /** スプリントが進行中（自動ステップ対象）か。 */
  isSprintRunning(): boolean;
  /**
   * 状態変更ごとに増える版番号。React は毎フレームこれを見て、変化時のみ
   * スナップショットを読み直す。これにより window.game 経由の外部操作（E2E 等）も
   * UI に反映される。
   */
  revision(): number;
  /** 内部エンジン（高度なデバッグ用）。 */
  readonly engine: RunEngine;
}

export interface CreateGameOptions {
  seed?: string;
  difficulty?: DifficultyId;
  trials?: string[];
  /** 起動時に永続化層から復元済みのメタ進行。 */
  initialMeta?: MetaState;
  /** メタ進行の保存先。未指定時はメモリ上だけで進行する。 */
  metaStorage?: MetaStorage | null;
  /** 非同期起動中は false にして、復元前のメタ更新を防ぐ。 */
  metaReady?: boolean;
  /** ラン途中セーブの保存先。未指定時は保存しない。 */
  runStorage?: RunStorage | null;
  /** 起動時に読み込んだ再開可能セーブ（まだ hydrate しない）。 */
  initialRunSave?: RunSave | null;
}

export function createGame(options: CreateGameOptions = {}): GameHandle {
  const seed = options.seed ?? resolveSeedFromLocation();
  const engine = createRunEngine({ seed, difficulty: options.difficulty, trials: options.trials });
  /**
   * タイトルの次の通常ランに使う seed。
   * Daily 開始やリプレイ閲覧で engine.seed が変わっても、ここは上書きしない。
   */
  let pendingSeed = seed;
  let paused = false;
  /** pause() の呼び出し回数。resume では進めない。 */
  let pauseEpoch = 0;
  let meta = options.initialMeta ?? defaultMeta();
  let metaStorage = options.metaStorage ?? null;
  let metaReady = options.metaReady ?? true;
  let runStorage: RunStorage | null = options.runStorage ?? null;
  const initialRunSaveIssue = options.initialRunSave
    ? getRunSaveCompatibilityIssue(options.initialRunSave)
    : null;
  let resumableSave: RunSave | null = initialRunSaveIssue ? null : (options.initialRunSave ?? null);
  let runSaveIssue: RunSaveCompatibilityIssue | null = initialRunSaveIssue;
  let latestImportedSave: RunSave | null = null;
  let runSaveImportWrites: Promise<void> = Promise.resolve();
  let replayStorage: ReplayStorage | null = null;
  let cachedReplays: ReplayBlob[] = [];
  let keyframes: ReplayKeyframe[] = [];
  let replayMode = false;
  /** 閲覧中リプレイの終端診断（キーフレーム時点の diagnosis と独立。RI-34‴）。 */
  let activeReplayDiagnosis: DiagnosisType | null = null;
  /** 閲覧中リプレイの記録時ルールセットと表示コンテンツ。 */
  let activeReplayInfo: ActiveReplayInfo | null = null;
  let recorded = false;
  let lastRunReward: RunRewardBreakdown | null = null;
  let revision = 0;
  /** startRun / startDailyRun のたびに増やす（UI ガイドのセッション区切り）。 */
  let runEpoch = 0;
  let activeDailyDate: string | null = null;
  /** 実行中デイリーに適用されたルールセット。通常ランでは null。 */
  let activeDailyRuleset: RunRulesetIdentity | null = null;
  /** UI 向け what-if キャッシュ（Worker 完了後も同一キーなら即返却）。 */
  let whatIfCache: { key: string; value: WhatIfState | null } | null = null;
  /** 進行中の Worker リクエストのキャッシュキー。 */
  let whatIfPendingKey: string | null = null;

  /** 状態を変えた可能性のある操作の後に版番号を進める。 */
  const bump = (): void => {
    revision += 1;
  };

  const clearWhatIfCache = (): void => {
    whatIfCache = null;
    whatIfPendingKey = null;
  };

  const clearRunSaveInternal = (): void => {
    latestImportedSave = null;
    resumableSave = null;
    runSaveIssue = null;
    if (!runStorage) return;
    void runStorage.clear().catch(() => undefined);
  };

  const appendKeyframeIfNeeded = (): void => {
    if (replayMode) return;
    const frame = engine.exportReplayFrame();
    if (!frame) return;
    const diagnosis = engine.snapshot().diagnosis;
    const label = labelForReplayKeyframe(frame, diagnosis);
    const entry: ReplayKeyframe = {
      phase: frame.phase,
      frame: structuredClone(frame),
      ...(label ? { label } : {}),
    };
    const last = keyframes[keyframes.length - 1];
    if (last && last.phase === entry.phase) {
      keyframes[keyframes.length - 1] = entry;
      return;
    }
    keyframes.push(entry);
  };

  const refreshReplayCache = async (): Promise<boolean> => {
    if (!replayStorage) {
      cachedReplays = [];
      bump();
      return true;
    }
    try {
      cachedReplays = await replayStorage.list();
      bump();
      return true;
    } catch {
      bump();
      return false;
    }
  };

  const commitReplayIfFinished = (): void => {
    if (!replayStorage || keyframes.length === 0 || replayMode) return;
    const s = engine.snapshot();
    if (s.status !== 'won' && s.status !== 'lost') return;
    const finishedAt = Date.now();
    const blob: ReplayBlob = {
      schemaVersion: REPLAY_SCHEMA_VERSION,
      id: buildReplayId(s.seed, finishedAt),
      seed: s.seed,
      difficulty: s.difficulty,
      trials: [...s.trials],
      finishedAt,
      outcome: {
        status: s.status,
        winType: s.winType,
        loseReason: s.loseReason,
        diagnosis: s.diagnosis,
        score: s.totals.delivered,
      },
      keyframes: structuredClone(keyframes),
      ruleset: structuredClone(CURRENT_RUN_RULESET),
      contentSnapshot: snapshotReplayContent(keyframes),
    };
    keyframes = [];
    void replayStorage
      .save(blob)
      .then(() => refreshReplayCache())
      .catch(() => undefined);
  };

  /** 現在がセーブ可能フェーズならスナップショットを書き込む。 */
  const persistSaveableSnapshot = (): void => {
    if (replayMode || !runStorage) return;
    const exported = engine.exportPersistState();
    if (!exported) return;
    // 再開後も完走リプレイが前半を保持できるよう、収集済みキーフレームを同梱する。
    const save = toRunSave(exported, Date.now(), keyframes);
    resumableSave = save;
    runSaveIssue = null;
    void runStorage.save(save).catch(() => undefined);
  };

  /**
   * セーブ可能フェーズなら保存。sprint 中は直前セーブを維持。
   * title / won / lost では破棄する（RI-58）。
   * あわせてリプレイキーフレームを収集し、終端で commit する（RI-61）。
   */
  const persistRunIfNeeded = (): void => {
    if (replayMode) return;
    const phase = engine.currentPhase();
    appendKeyframeIfNeeded();
    if (phase === 'title' || phase === 'won' || phase === 'lost') {
      if (phase === 'won' || phase === 'lost') commitReplayIfFinished();
      clearRunSaveInternal();
      return;
    }
    if (phase === 'sprint') return;
    persistSaveableSnapshot();
  };

  /** Worker があれば非同期、なければ同期フォールバックで試算する（RI-13）。 */
  const resolveWhatIf = (): Pick<RunState, 'whatIf' | 'whatIfStatus'> => {
    const input = engine.whatIfComputeInput();
    if (!input) {
      clearWhatIfCache();
      return { whatIf: null, whatIfStatus: 'idle' };
    }
    const key = whatIfCacheKey(input);
    if (whatIfCache?.key === key) {
      return {
        whatIf: whatIfCache.value ? structuredClone(whatIfCache.value) : null,
        whatIfStatus: 'ready',
      };
    }

    // Vitest / Worker 不可環境では同期計算して既存契約を維持する。
    if (typeof Worker === 'undefined') {
      const value = computeWhatIfState(input);
      whatIfCache = { key, value };
      whatIfPendingKey = null;
      return {
        whatIf: value ? structuredClone(value) : null,
        whatIfStatus: 'ready',
      };
    }

    if (whatIfPendingKey !== key) {
      whatIfPendingKey = key;
      const requestInput: WhatIfComputeInput = input;
      void requestWhatIfState(requestInput).then((value) => {
        if (whatIfPendingKey !== key) return;
        whatIfCache = { key, value };
        whatIfPendingKey = null;
        bump();
      });
    }

    return { whatIf: null, whatIfStatus: 'computing' };
  };

  /**
   * 最新 meta から解放プールと研修方針を engine へ反映する（ラン開始時に呼ぶ）。
   * デイリーは同一日比較のため研修方針を適用しない（RI-34⁗）。
   */
  const applyUnlockedToEngine = (options?: { ignorePreferred?: boolean }): void => {
    const content = unlockedContent(meta);
    engine.setUnlockedContent(content.cards, content.relics);
    engine.setPreferredCards(options?.ignorePreferred ? [] : meta.preferredCardIds);
  };

  /** 保存失敗でゲーム進行を止めず、直列化はストレージ実装へ委ねる。 */
  const persistMeta = (): void => {
    if (!metaStorage) return;
    void metaStorage.save(meta).catch(() => undefined);
  };

  /** ラン決着を検知したら一度だけメタ進行へ報酬を記録する（第17章）。 */
  const recordIfFinished = (): void => {
    if (!metaReady) return;
    const s = engine.snapshot();
    if (recorded || (s.status !== 'won' && s.status !== 'lost')) return;
    recorded = true;
    const scoreMul = s.trials.reduce((m, id) => m * (getTrial(id)?.scoreMul ?? 1), 1);
    const input = {
      won: s.status === 'won',
      difficulty: s.difficulty,
      winType: s.winType,
      bossId: s.bossId,
      score: s.totals.delivered,
      scoreMul,
      maxCombo: s.totals.maxCombo,
      quarterReviews: s.reviewHistory,
      diagnosis: s.diagnosis,
    };
    if (s.runKind === 'daily' && activeDailyDate) {
      const daily = applyDailyRunReward(meta, {
        ...input,
        dateStr: activeDailyDate,
        ruleset: activeDailyRuleset ?? CURRENT_RUN_RULESET,
      });
      meta = daily.meta;
      lastRunReward = daily.breakdown;
    } else {
      lastRunReward = computeRunRewardBreakdown(input);
      meta = applyRunReward(meta, input);
    }
    persistMeta();
  };

  const after = (): RunState => {
    recordIfFinished();
    persistRunIfNeeded();
    return engine.snapshot();
  };

  /**
   * フェーズ非遷移の操作後（通常はセーブしない）。
   * ただし即時敗北などで終端へ落ちた場合はセーブを破棄する。
   */
  const afterLocal = (): RunState => {
    recordIfFinished();
    const phase = engine.currentPhase();
    if (phase === 'won' || phase === 'lost' || phase === 'title') {
      persistRunIfNeeded();
    }
    return engine.snapshot();
  };

  return {
    pause() {
      paused = true;
      pauseEpoch += 1;
    },
    resume() {
      paused = false;
    },
    isPaused() {
      return paused;
    },
    getPauseEpoch() {
      return pauseEpoch;
    },
    getState() {
      const state = engine.snapshot();
      if (replayMode) return state;
      // オートプレイやモンテカルロは snapshot を直接使うため、UI 経路だけで試算する。
      return { ...state, ...resolveWhatIf() };
    },
    startRun(difficulty, trials, runSeed, scenario) {
      if (replayMode) return engine.snapshot();
      latestImportedSave = null;
      recorded = false;
      lastRunReward = null;
      activeDailyDate = null;
      activeDailyRuleset = null;
      activeReplayInfo = null;
      keyframes = [];
      paused = false;
      clearWhatIfCache();
      applyUnlockedToEngine();
      runEpoch += 1;
      const nextSeed = runSeed ?? pendingSeed;
      pendingSeed = nextSeed;
      engine.startRun(difficulty, trials, nextSeed, { kind: 'normal', scenario });
      bump();
      return after();
    },
    startDailyRun(dateStr) {
      if (replayMode) return engine.snapshot();
      latestImportedSave = null;
      recorded = false;
      lastRunReward = null;
      activeReplayInfo = null;
      const day = dateStr ?? utcDateStr();
      activeDailyDate = day;
      activeDailyRuleset = { ...CURRENT_RUN_RULESET };
      keyframes = [];
      paused = false;
      clearWhatIfCache();
      applyUnlockedToEngine({ ignorePreferred: true });
      runEpoch += 1;
      engine.startRun(DAILY_RUN_DIFFICULTY, [...DAILY_RUN_TRIALS], dailySeed(day), {
        kind: 'daily',
        dailyDate: day,
      });
      bump();
      return after();
    },
    getRunEpoch() {
      return runEpoch;
    },
    beginSetupSprint() {
      if (replayMode) return engine.snapshot();
      // スプリント本体は保存しないが、突入直前の最新編成（setup）を残す。
      // キーフレームを先に更新してからランセーブへ書く（sprint 中はセーブ更新しないため）。
      appendKeyframeIfNeeded();
      persistSaveableSnapshot();
      engine.beginSetupSprint();
      bump();
      return after();
    },
    resolveBeat(choiceIndex) {
      if (replayMode) return engine.snapshot();
      // beat → sprint 直遷移でも直前の離散状態を残す。
      appendKeyframeIfNeeded();
      persistSaveableSnapshot();
      engine.resolveBeat(choiceIndex);
      bump();
      return after();
    },
    step(ms) {
      if (replayMode) return engine.snapshot();
      engine.step(ms);
      bump();
      return after();
    },
    dispatch(id, target) {
      if (replayMode) return { ok: false, reason: 'complete' };
      const outcome = engine.dispatch(id, target);
      bump();
      // 介入はスプリント中のみ。セーブは更新しない（セーブスカム抑制）。
      return outcome;
    },
    playCard(deckIndex) {
      if (replayMode) return { ok: false, reason: 'complete' };
      const outcome = engine.playCard(deckIndex);
      bump();
      recordIfFinished();
      persistRunIfNeeded();
      return outcome;
    },
    acknowledgeResult() {
      if (replayMode) return engine.snapshot();
      engine.acknowledgeResult();
      bump();
      return after();
    },
    chooseCard(defId) {
      if (replayMode) return engine.snapshot();
      engine.chooseCard(defId);
      bump();
      return after();
    },
    skipDraft() {
      if (replayMode) return engine.snapshot();
      engine.skipDraft();
      bump();
      return after();
    },
    mulliganDraft() {
      if (replayMode) return engine.snapshot();
      engine.mulliganDraft();
      bump();
      return after();
    },
    unlockEvolution(id) {
      if (replayMode) return engine.snapshot();
      engine.unlockEvolution(id);
      bump();
      // フェーズ非遷移のためセーブしない（リロードで消費前に戻る）。
      return afterLocal();
    },
    finishEvolution() {
      if (replayMode) return engine.snapshot();
      engine.finishEvolution();
      bump();
      return after();
    },
    buyShopCard(defId) {
      if (replayMode) return engine.snapshot();
      engine.buyShopCard(defId);
      bump();
      return afterLocal();
    },
    buyShopRelic() {
      if (replayMode) return engine.snapshot();
      engine.buyShopRelic();
      bump();
      return afterLocal();
    },
    buyShopRecruit() {
      if (replayMode) return engine.snapshot();
      engine.buyShopRecruit();
      bump();
      return afterLocal();
    },
    leaveShop() {
      if (replayMode) return engine.snapshot();
      engine.leaveShop();
      bump();
      return after();
    },
    restChoose(option, deckIndex) {
      if (replayMode) return engine.snapshot();
      engine.restChoose(option, deckIndex);
      bump();
      return after();
    },
    recruitChoose(option) {
      if (replayMode) return engine.snapshot();
      engine.recruitChoose(option);
      bump();
      return after();
    },
    assignMember(id, assignment) {
      if (replayMode) return engine.snapshot();
      engine.assignMember(id, assignment);
      bump();
      return afterLocal();
    },
    setMemberAi(id, on) {
      if (replayMode) return engine.snapshot();
      engine.setMemberAi(id, on);
      bump();
      return afterLocal();
    },
    zoomTo(level) {
      if (replayMode) return engine.snapshot();
      engine.zoomTo(level);
      bump();
      return afterLocal();
    },
    focusDept(id) {
      if (replayMode) return engine.snapshot();
      engine.focusDepartment(id);
      bump();
      return afterLocal();
    },
    focusTeam(id) {
      if (replayMode) return engine.snapshot();
      engine.focusTeam(id);
      bump();
      return afterLocal();
    },
    enterTeam(id) {
      if (replayMode) return engine.snapshot();
      const ok = engine.enterTeam(id);
      bump();
      // 入り込みは activeTeamId / ロスター / 拘束を変えるので通常セーブへ残す。
      return ok ? after() : afterLocal();
    },
    setRankingKind(kind) {
      if (replayMode) return engine.snapshot();
      engine.setRankingKind(kind);
      bump();
      return afterLocal();
    },
    applyOrgLever(leverId, deptId, teamId) {
      if (replayMode) return engine.snapshot();
      engine.applyOrgLever(leverId, deptId, teamId);
      bump();
      // レバーはフェーズ非遷移だが即時敗北の可能性がある。
      return after();
    },
    acknowledgeQuarterReview() {
      if (replayMode) return engine.snapshot();
      engine.acknowledgeQuarterReview();
      bump();
      return after();
    },
    chooseGoalAdjustment(id) {
      if (replayMode) return engine.snapshot();
      engine.chooseGoalAdjustment(id);
      bump();
      return after();
    },
    newRun(runSeed) {
      replayMode = false;
      activeReplayDiagnosis = null;
      activeReplayInfo = null;
      recorded = false;
      lastRunReward = null;
      activeDailyDate = null;
      activeDailyRuleset = null;
      keyframes = [];
      paused = false;
      clearWhatIfCache();
      applyUnlockedToEngine();
      if (runSeed !== undefined) pendingSeed = runSeed;
      engine.toTitle(pendingSeed);
      bump();
      return after();
    },
    purchaseMetaUnlock(unlockId) {
      if (!metaReady) return { ok: false, reason: 'not_ready' };
      const result = purchaseUnlock(meta, unlockId);
      if (!result.ok) return { ok: false, reason: result.reason };
      meta = result.meta;
      persistMeta();
      bump();
      return { ok: true };
    },
    setSoundMuted(muted) {
      if (!metaReady) return;
      const next = withSoundMuted(meta, muted);
      if (next === meta) return;
      meta = next;
      persistMeta();
      bump();
    },
    setPreferredCardIds(cardIds) {
      if (!metaReady) return;
      const next = withPreferredCardIds(meta, cardIds);
      if (next === meta) return;
      meta = next;
      persistMeta();
      bump();
    },
    markTutorialSeen() {
      if (!metaReady || meta.seenTutorialVersion >= TUTORIAL_CONTENT_VERSION) return;
      meta = {
        ...meta,
        seenTutorial: true,
        seenTutorialVersion: TUTORIAL_CONTENT_VERSION,
      };
      persistMeta();
      bump();
    },
    getMeta() {
      return meta;
    },
    getLastRunReward() {
      return lastRunReward;
    },
    attachMetaPersistence(hydratedMeta, storage) {
      metaStorage = storage;
      meta = hydratedMeta;
      metaReady = true;
      recordIfFinished();
      bump();
    },
    attachRunPersistence(storage, save, issue = null) {
      runStorage = storage;
      const derivedIssue = save ? getRunSaveCompatibilityIssue(save) : null;
      const nextIssue = save ? derivedIssue : issue;
      runSaveIssue = nextIssue ? structuredClone(nextIssue) : null;
      resumableSave = runSaveIssue ? null : save;
      bump();
    },
    resumeRun() {
      if (replayMode || runSaveIssue || !resumableSave) return null;
      latestImportedSave = null;
      recorded = false;
      lastRunReward = null;
      clearWhatIfCache();
      const save = resumableSave;
      activeDailyDate = save.summary.dailyDate ?? null;
      activeDailyRuleset =
        save.summary.runKind === 'daily' && save.ruleset ? { ...save.ruleset } : null;
      // リロード前に集めたキーフレームを引き継ぎ、完走リプレイが前半を欠かないようにする。
      keyframes = structuredClone(save.replayKeyframes ?? []);
      // ラン中の解放プール／研修方針はセーブ時点のものを優先（メタ変更で変えない）。
      engine.setUnlockedContent(
        new Set(save.state.extras.allowedCards),
        new Set(save.state.extras.allowedRelics),
      );
      engine.setPreferredCards(
        Array.isArray(save.state.extras.preferredCardIds) ? save.state.extras.preferredCardIds : [],
      );
      engine.hydratePersistState(save.state);
      bump();
      return after();
    },
    hasResumableRun() {
      return resumableSave !== null;
    },
    getRunSaveSummary() {
      if (resumableSave) return structuredClone(resumableSave.summary);
      return runSaveIssue ? structuredClone(runSaveIssue.summary) : null;
    },
    getRunSaveIssue() {
      return runSaveIssue ? structuredClone(runSaveIssue) : null;
    },
    clearRunSave() {
      clearRunSaveInternal();
      bump();
    },
    exportRunSaveText() {
      return resumableSave ? serializeRunSave(resumableSave) : null;
    },
    async importRunSaveText(raw) {
      const loaded = parseRunSaveShare(raw);
      if (!loaded.ok) return loaded;
      const intended = loaded.save;
      latestImportedSave = intended;
      const write = runSaveImportWrites.then(async () => {
        if (latestImportedSave !== intended) return;
        if (runStorage) await runStorage.save(intended);
        if (latestImportedSave !== intended) {
          if (runStorage && resumableSave && resumableSave !== intended) {
            await runStorage.save(resumableSave);
          } else if (runStorage && !resumableSave) {
            await runStorage.clear();
          }
          return;
        }
        resumableSave = structuredClone(intended);
        runSaveIssue = null;
        bump();
      });
      runSaveImportWrites = write.catch(() => undefined);
      try {
        await write;
      } catch {
        return {
          ok: false,
          reason: 'corrupt',
          message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
        };
      }
      return loaded;
    },
    async attachReplay(storage) {
      replayStorage = storage;
      await refreshReplayCache();
    },
    listReplays() {
      return cachedReplays.map((r) => structuredClone(r));
    },
    exportReplayText(id) {
      const replay = cachedReplays.find((item) => item.id === id);
      return replay ? serializeReplay(replay) : null;
    },
    async importReplayText(raw) {
      const loaded = parseReplayShare(raw);
      if (!loaded.ok) return loaded;
      if (!replayStorage) {
        return {
          ok: false,
          reason: 'corrupt',
          message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
        };
      }
      try {
        await replayStorage.save(loaded.replay, { pin: true });
        const listed = await refreshReplayCache();
        if (!listed) {
          cachedReplays = selectReplaysWithinMax(
            [
              ...cachedReplays.filter((item) => item.id !== loaded.replay.id),
              structuredClone(loaded.replay),
            ],
            loaded.replay.id,
          );
          bump();
          return loaded;
        }
        if (!cachedReplays.some((item) => item.id === loaded.replay.id)) {
          return {
            ok: false,
            reason: 'corrupt',
            message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
          };
        }
        return loaded;
      } catch {
        return {
          ok: false,
          reason: 'corrupt',
          message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
        };
      }
    },
    openReplay(id, keyframeIndex = -1) {
      const replay = cachedReplays.find((r) => r.id === id);
      if (!replay || replay.keyframes.length === 0) return null;
      const index =
        keyframeIndex < 0
          ? replay.keyframes.length - 1
          : Math.min(keyframeIndex, replay.keyframes.length - 1);
      const frame = replay.keyframes[index];
      if (!frame) return null;
      try {
        engine.hydrateReplayFrame(frame.frame);
      } catch {
        return null;
      }
      replayMode = true;
      activeReplayDiagnosis = replay.outcome.diagnosis;
      activeReplayInfo = {
        ruleset: replay.ruleset ? structuredClone(replay.ruleset) : null,
        contentSnapshot: replay.contentSnapshot ? structuredClone(replay.contentSnapshot) : null,
      };
      activeDailyDate = frame.frame.dailyDate ?? null;
      activeDailyRuleset = null;
      recorded = true;
      lastRunReward = null;
      clearWhatIfCache();
      paused = true;
      bump();
      return engine.snapshot();
    },
    exitReplay() {
      replayMode = false;
      activeReplayDiagnosis = null;
      activeReplayInfo = null;
      recorded = false;
      lastRunReward = null;
      activeDailyDate = null;
      activeDailyRuleset = null;
      keyframes = [];
      // openReplay で止めた自動進行を解除しないと、通常ラン再開後もスプリントが進まない。
      paused = false;
      clearWhatIfCache();
      engine.toTitle(pendingSeed);
      bump();
      return engine.snapshot();
    },
    isReplayMode() {
      return replayMode;
    },
    getActiveReplayDiagnosis() {
      return activeReplayDiagnosis;
    },
    getDiagnosticInfo() {
      const state = engine.snapshot();
      const ruleset = replayMode
        ? (activeReplayInfo?.ruleset ?? null)
        : (activeDailyRuleset ?? CURRENT_RUN_RULESET);
      return createRunDiagnosticInfo(state, ruleset, activeReplayDiagnosis ?? state.diagnosis);
    },
    getActiveReplayInfo() {
      return activeReplayInfo ? structuredClone(activeReplayInfo) : null;
    },
    async importReplay(blob) {
      if (!replayStorage) return false;
      const normalized = normalizeReplay(blob);
      if (!normalized) return false;
      try {
        await replayStorage.save(normalized);
        await refreshReplayCache();
        bump();
        return true;
      } catch {
        return false;
      }
    },
    phase() {
      return engine.currentPhase();
    },
    isSprintRunning() {
      return !replayMode && engine.sprintRunning();
    },
    revision() {
      return revision;
    },
    engine,
  };
}

declare global {
  interface Window {
    game?: GameHandle;
  }
}

/** `pauseBriefly` のキャンセル。タイマーを消し、所有 epoch なら resume する。 */
export type PauseBrieflyClear = () => void;

/**
 * 指定 ms だけ自動進行を一時停止する（RI-10 ボススローモ用）。
 *
 * 既に pause 済み（E2E 等）なら触らない。自分が pause した epoch のままなら
 * タイムアウト後に resume し、途中で外部が再 pause したら解除しない。
 * 戻り値の clear でタイマー取消＋所有時 resume（画面アンマウント用）。
 */
export function pauseBriefly(
  game: Pick<GameHandle, 'pause' | 'resume' | 'isPaused' | 'getPauseEpoch'>,
  ms: number,
): PauseBrieflyClear {
  if (game.isPaused()) return () => {};
  game.pause();
  const epoch = game.getPauseEpoch();
  const timer = globalThis.setTimeout(() => {
    if (game.getPauseEpoch() === epoch) game.resume();
  }, ms);
  return () => {
    globalThis.clearTimeout(timer);
    if (game.getPauseEpoch() === epoch) game.resume();
  };
}

/**
 * `window.game` を生成して公開する。アプリ起動時に一度だけ呼ぶ。
 */
export function installGame(options?: CreateGameOptions): GameHandle {
  const handle = createGame(options);
  if (typeof window !== 'undefined') {
    window.game = handle;
  }
  return handle;
}
