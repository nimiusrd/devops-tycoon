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
import type { ReplayFramePhase } from './sim/run/persist';
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
import { PersistenceTracker, type PersistenceNotice } from './state/persistenceStatus';
import { labelForReplayKeyframe } from './render/reviewHellReplayView';
import {
  buildReplayId,
  normalizeReplay,
  REPLAY_MAX_COUNT,
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
import { readPersistenceBackup } from './state/persistenceBackup';
import { findNextReplayKeyframeIndex } from './state/replayJump';
import {
  parseReplayShare,
  REPLAY_SHARE_REASON_MESSAGE,
  serializeReplay,
  type ReplayShareResult,
} from './state/replayShare';
import { assessResumeRisk, type ResumeRisk } from './state/resumeRisk';
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

export interface PersistenceAttachOptions<T> {
  /** 読込失敗でメモリへ切り替えた。既存の永続データへは書き戻さない。 */
  sessionOnly?: boolean;
  /** 再試行で読み直す、失敗した保存先。 */
  durableStorage?: T;
}

export interface GameHandle {
  /** 自動進行を止める。 */
  pause(): void;
  /** 自動進行を再開する。pause hold は解除しない。 */
  resume(): void;
  /**
   * pause epoch とは独立した停止。resume() では解けない。
   * 遊び方表示など、既存の一時停止が先に解けても止め続けたいときに使う。
   */
  acquirePauseHold(): void;
  /** acquirePauseHold の対。残りの保持がある間は isPaused() が true。 */
  releasePauseHold(): void;
  /** 一時停止中か。pause() 済み、または未解放の pause hold がある。 */
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
  attachMetaPersistence(
    meta: MetaState,
    storage: MetaStorage,
    options?: PersistenceAttachOptions<MetaStorage>,
  ): void;
  /** 起動時のランセーブ永続化を接続する（まだ hydrate しない）。 */
  attachRunPersistence(
    storage: RunStorage,
    save: RunSave | null,
    issue?: RunSaveCompatibilityIssue | null,
    options?: PersistenceAttachOptions<RunStorage>,
  ): void;
  /** タイトルから途中セーブを再開する（RI-58）。通常セーブは pending seed を保存済み seed へ更新する。 */
  resumeRun(): RunState | null;
  /** 再開可能なランセーブがあるか。 */
  hasResumableRun(): boolean;
  /** タイトル「続きから」用の要約（無い場合は null）。 */
  getRunSaveSummary(): RunSaveSummary | null;
  /** 再開前に示す燃え尽き／継続不能リスク（無い場合は null）。 */
  getResumeRisk(): ResumeRisk | null;
  /** ルールセット不一致・情報欠落で再開できないセーブの理由。 */
  getRunSaveIssue(): RunSaveCompatibilityIssue | null;
  /** 自動保存の表示状態（RI-145）。保存中・保存済み・失敗・セッション限り。 */
  getPersistenceStatus(): PersistenceNotice;
  /**
   * 失敗した自動保存を再試行する。
   * 起動時の読込失敗では既存データへ書き戻さず、保存先の再読込だけを行う。
   * 永続先が空のときだけ、メモリ上のランセーブを移す。
   */
  retryPersistence(): Promise<void>;
  /** 復旧チップを閉じる。読み上げ文は残す。 */
  dismissPersistenceNotice(): void;
  /** ランセーブを破棄する。 */
  clearRunSave(): void;
  /** 現行の途中セーブを JSON 文字列にする（無い場合は null。RI-133）。 */
  exportRunSaveText(): string | null;
  /** 保存に失敗した完走リプレイを JSON 文字列にする（無い場合は null）。 */
  exportPendingReplayText(): string | null;
  /** 保存に失敗した完走リプレイを、ファイル名つきで全部返す。 */
  exportPendingReplayFiles(): { filename: string; text: string }[];
  /**
   * JSON から途中セーブを読み込む。成功時だけラン保存を置き換える。
   * 失敗時は既存セーブ・メタ進行・リプレイを触らない。
   */
  importRunSaveText(raw: string): Promise<RunSaveShareResult>;
  /** リプレイ永続化を接続し、一覧をキャッシュする（RI-61）。 */
  attachReplay(
    storage: ReplayStorage,
    options?: PersistenceAttachOptions<ReplayStorage>,
  ): Promise<void>;
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
  /**
   * 閲覧中リプレイで、現在キーフレームより後の指定フェーズへジャンプする。
   * 該当キーフレームが無ければ null。
   */
  jumpReplayToPhase(phase: ReplayFramePhase): RunState | null;
  /** ジャンプ先キーフレーム index。対象が無ければ null。 */
  findReplayJumpIndex(phase: ReplayFramePhase): number | null;
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
  /** 現在のズーム階層（スナップショットを作らない軽量アクセサ）。 */
  zoomLevel(): ZoomLevel;
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

/** 空確認の直後に現れた永続記録。上書きせず、呼び出し側で採用可否を決める。 */
class ForeignDurableRecord extends Error {
  readonly record: unknown;

  constructor(record: unknown) {
    super('durable record appeared');
    this.name = 'ForeignDurableRecord';
    this.record = record;
  }
}

export function createGame(options: CreateGameOptions = {}): GameHandle {
  const seed = options.seed ?? resolveSeedFromLocation();
  const engine = createRunEngine({ seed, difficulty: options.difficulty, trials: options.trials });
  /**
   * タイトルの次の通常ランに使う seed。
   * Daily 開始やリプレイ閲覧では上書きせず、通常セーブ再開時は保存済み seed を反映する。
   */
  let pendingSeed = seed;
  let paused = false;
  /** pause() の呼び出し回数。resume では進めない。 */
  let pauseEpoch = 0;
  /** resume() では解けない停止の数。遊び方表示などが使う。 */
  let pauseHolds = 0;
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
  let durableMeta: MetaStorage | null = null;
  let durableRun: RunStorage | null = null;
  let durableReplay: ReplayStorage | null = null;
  /** 端末へ書き終わるまで保持する完走リプレイ。次ランの keyframes とは別物。 */
  const pendingReplays: ReplayBlob[] = [];
  const tracker = new PersistenceTracker();
  /** 復旧の await 中に進んだメタ／ランを、古いスナップショットで成功扱いにしない。 */
  let metaRevision = 0;
  /** セッション限りになった時点のメタ世代。再試行前の更新を既存データで戻さない。 */
  let metaRevisionAtSession = 0;
  let runRevision = 0;
  /** セッション限りになった時点のラン世代。再試行前の完走や破棄を既存セーブで戻さない。 */
  let runRevisionAtSession = 0;
  /** セーブ取り込みの非同期書込みが終わるまで、移行を確定しない。 */
  let runImportDepth = 0;
  /** リプレイ取り込みの世代。最終一覧のあとでも、途中の取り込みを既存データにしない。 */
  let replayRevision = 0;
  let replayImportDepth = 0;
  let replayImportWrites: Promise<void> = Promise.resolve();
  /** 明示取り込み。移行先の上限削除でもこの id を残す。 */
  const pinnedReplayIds = new Set<string>();
  /** リプレイがセッション限りになった時点の一覧。それより後の完走は永続先へ移す。 */
  let replayIdsAtSession = new Set<string>();
  /** セッション復旧の再試行。二重クリックでも並行させない。 */
  let persistenceRetry: Promise<void> | null = null;
  /** 空だった永続先へ途中まで書いた記録。次回は既存データとして採用しない。 */
  let metaMigrationOpen = false;
  let runMigrationOpen = false;
  /** このセッションが空の永続先へ書けた最後のスナップショット。別タブの記録とは区別する。 */
  let metaMigrationWritten: string | null = null;
  let runMigrationWritten: string | null = null;
  let replayMigrationOpen = false;
  /** 保存処理中の完走リプレイ。再試行では重ねて送らない。 */
  const replaySavesInFlight = new Set<ReplayBlob>();
  /** 進行中の保存。移行側は完了を待ってからセッションを外す。 */
  const replaySavePromises = new Map<ReplayBlob, Promise<void>>();
  if (resumableSave) tracker.noteDurableAt('run', resumableSave.savedAt);
  let cachedReplays: ReplayBlob[] = [];
  let keyframes: ReplayKeyframe[] = [];
  let replayMode = false;
  /** 閲覧中リプレイの id。非リプレイ時は null。 */
  let activeReplayId: string | null = null;
  /** 閲覧中キーフレームの index。非リプレイ時は -1。 */
  let activeReplayKeyframeIndex = -1;
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
  /** 進行中リクエストの世代。引き直し後の古い完了を捨てる。 */
  let whatIfRequestGen = 0;

  /** 状態を変えた可能性のある操作の後に版番号を進める。 */
  const bump = (): void => {
    revision += 1;
  };

  const clearWhatIfCache = (): void => {
    whatIfCache = null;
    whatIfPendingKey = null;
    whatIfRequestGen += 1;
  };

  const applyWhatIfResult = (gen: number, key: string, value: WhatIfState | null): void => {
    if (gen !== whatIfRequestGen) return;
    if (whatIfPendingKey !== key) return;
    whatIfCache = { key, value };
    whatIfPendingKey = null;
    bump();
  };

  const clearRunSaveInternal = (): void => {
    latestImportedSave = null;
    resumableSave = null;
    runSaveIssue = null;
    runRevision += 1;
    if (!runStorage) return;
    trackWrite('run', runStorage.clear(), undefined, false);
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
      cachedReplays = replayListWithPending(await replayStorage.list());
      bump();
      return true;
    } catch {
      bump();
      return false;
    }
  };

  /** ストレージ一覧で置き換えても、まだ pending の完走は一覧に残す。 */
  const replayListWithPending = (listed: readonly ReplayBlob[]): ReplayBlob[] => {
    const listedIds = new Set(listed.map((item) => item.id));
    const unsaved = pendingReplays.filter((item) => !listedIds.has(item.id));
    if (unsaved.length === 0) return [...listed];
    return selectReplaysWithinMax(
      [...listed, ...unsaved.map((item) => structuredClone(item))],
      unsaved.map((item) => item.id),
    );
  };

  const publishUnsavedReplay = (blob: ReplayBlob): void => {
    if (cachedReplays.some((item) => item.id === blob.id)) return;
    cachedReplays = selectReplaysWithinMax([...cachedReplays, structuredClone(blob)], blob.id);
    bump();
  };

  const saveReplayBlob = (blob: ReplayBlob, extraProtectIds?: readonly string[]): Promise<void> => {
    const storage = replayStorage;
    if (!storage) return Promise.resolve();
    // 古い finishedAt でも、この完走自体は上限削除から残す。明示取り込みも同時に守る。
    // 再試行の一括では、まだ保存していない他の未保存も同じ上限から守る。
    const protectIds = [...new Set([...pinnedReplayIds, ...(extraProtectIds ?? [])])];
    return storage
      .save(blob, { pin: true, protectIds })
      .then(async () => {
        const stored = await storage.list();
        if (!stored.some((item) => item.id === blob.id)) {
          throw new Error('replay evicted');
        }
        const listed = await refreshReplayCache();
        if (listed) return;
        throw new Error('replay list failed');
      })
      .catch((error: unknown) => {
        publishUnsavedReplay(blob);
        throw error;
      });
  };

  /** 保存完了した blob を外す。未保存が残っていれば true。 */
  const completePendingReplay = (blob: ReplayBlob): boolean => {
    const index = pendingReplays.indexOf(blob);
    if (index >= 0) pendingReplays.splice(index, 1);
    return pendingReplays.length > 0;
  };

  /** セッション開始後にメモリへ残った完走。開始時点の一覧は端末側にある。 */
  const sessionOnlyReplayBlobs = (): ReplayBlob[] => {
    if (!tracker.isSession('replay')) return [];
    return cachedReplays.filter((item) => !replayIdsAtSession.has(item.id));
  };

  /** 未保存と、セッション限りでメモリに残った完走。通知の書き出し対象。 */
  const exportableReplayBlobs = (): ReplayBlob[] => {
    const seen = new Set<string>();
    const blobs: ReplayBlob[] = [];
    for (const blob of [...pendingReplays, ...sessionOnlyReplayBlobs()]) {
      if (seen.has(blob.id)) continue;
      seen.add(blob.id);
      blobs.push(blob);
    }
    return blobs;
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
    pendingReplays.push(blob);
    // 完走時点で共有配列から切り離す。非同期完了で次ランのフレームを消さない。
    keyframes = [];
    trackWrite('replay', beginReplaySave(blob), () => completePendingReplay(blob));
  };

  /** 完走リプレイの保存を追跡する。移行中も、この Promise が残る間は確定しない。 */
  const beginReplaySave = (
    blob: ReplayBlob,
    extraProtectIds?: readonly string[],
  ): Promise<void> => {
    replaySavesInFlight.add(blob);
    const work = saveReplayBlob(blob, extraProtectIds).finally(() => {
      replaySavesInFlight.delete(blob);
      replaySavePromises.delete(blob);
    });
    replaySavePromises.set(blob, work);
    return work;
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
    runRevision += 1;
    trackWrite('run', runStorage.save(save));
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
      const gen = ++whatIfRequestGen;
      void requestWhatIfState(requestInput)
        .then((value) => {
          applyWhatIfResult(gen, key, value);
        })
        .catch(() => {
          applyWhatIfResult(gen, key, computeWhatIfState(requestInput));
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

  /**
   * 保存失敗でゲーム進行を止めない。
   * セッション限りの保存先は端末へ成功したことにしない。
   * 直列化はストレージ実装へ委ねる。
   * onSuccess が true を返したときは、同じチャネルに未保存が残っている。
   */
  const trackWrite = (
    channel: 'meta' | 'run' | 'replay',
    work: Promise<void>,
    onSuccess?: () => boolean | void,
    recordDurableAt = true,
  ): void => {
    if (tracker.isSession(channel)) {
      void work.then(() => onSuccess?.()).catch(() => undefined);
      return;
    }
    const generation = tracker.begin(channel);
    void work
      .then(() => {
        const stillPending = onSuccess?.() === true;
        if (stillPending) {
          if (tracker.fail(channel, generation, new Error('unsaved replay'), true)) bump();
          return;
        }
        if (tracker.succeed(channel, generation, recordDurableAt ? Date.now() : null)) {
          bump();
          return;
        }
        if (
          channel === 'replay' &&
          pendingReplays.length === 0 &&
          tracker.settleCurrent(channel, Date.now())
        ) {
          bump();
        }
      })
      .catch((error: unknown) => {
        const preserveQuota =
          channel === 'replay' && pendingReplays.length > 0 && tracker.keepsQuota(channel);
        if (tracker.fail(channel, generation, error, preserveQuota)) bump();
      });
  };

  const persistMeta = (): void => {
    if (!metaStorage) return;
    metaRevision += 1;
    trackWrite('meta', metaStorage.save(meta));
  };

  const retryWrite = (
    channel: 'meta' | 'run' | 'replay',
    work: Promise<void>,
    onSuccess?: () => boolean | void,
    recordDurableAt = true,
  ): Promise<void> => {
    const generation = tracker.begin(channel);
    bump();
    return work
      .then(() => {
        const stillPending = onSuccess?.() === true;
        if (stillPending) {
          tracker.fail(channel, generation, new Error('unsaved replay'), true);
          return;
        }
        tracker.succeed(channel, generation, recordDurableAt ? Date.now() : null);
      })
      .catch((error: unknown) => {
        const preserveQuota =
          channel === 'replay' && pendingReplays.length > 0 && tracker.keepsQuota(channel);
        tracker.fail(channel, generation, error, preserveQuota);
        throw error;
      })
      .finally(() => {
        bump();
      });
  };

  /** このセッションが書いたスナップショットと、後から現れた永続記録を区別する。 */
  const persistedRecordKey = (value: unknown): string => JSON.stringify(value);

  /**
   * 永続先が空のとき、await の前後でスナップショットが変わっていなければ保存先を切り替える。
   * 変わっていれば最新を書き直す。途中の版では打ち切らず、成功が確定してから切り替える。
   */
  const migrateEmptyDurable = async <T>(
    revision: () => number,
    read: () => T,
    write: (snapshot: T) => Promise<void>,
    unchanged: (seen: number, snapshot: T) => boolean,
    adopt: () => void,
  ): Promise<void> => {
    for (;;) {
      const seen = revision();
      const snapshot = read();
      await write(snapshot);
      if (unchanged(seen, snapshot)) {
        adopt();
        return;
      }
    }
  };

  const canAdoptDurableRun = (): boolean => !replayMode && engine.currentPhase() === 'title';

  /**
   * 読込失敗後の再試行。
   * 既存の保存データは上書きしない。永続先が空で、メモリ上にランセーブがあるときだけそれを移す。
   */
  const recoverDurableLoads = async (): Promise<void> => {
    const runRevisionAtStart = runRevision;
    if (tracker.isSession('meta') && durableMeta) {
      try {
        const seenMetaRevision = metaRevision;
        const loaded = await durableMeta.load();
        const metaMoved =
          metaRevision !== seenMetaRevision || metaRevision !== metaRevisionAtSession;
        const loadedKey = loaded ? persistedRecordKey(loaded) : null;
        const ownPartial =
          metaMigrationOpen && loadedKey !== null && loadedKey === metaMigrationWritten;
        if (loaded && !ownPartial) {
          // 読込中だけでなく、再試行前の報酬や設定も古い永続データで置き換えない。
          // 移行の失敗後に現れた別の記録も、このセッションの途中書き込みとしては扱わない。
          metaMigrationOpen = false;
          metaMigrationWritten = null;
          if (!metaMoved) {
            meta = loaded;
            metaStorage = durableMeta;
            tracker.clearSession('meta');
          }
        } else {
          const target = durableMeta;
          metaMigrationOpen = true;
          try {
            await migrateEmptyDurable(
              () => metaRevision,
              () => meta,
              async (snapshot) => {
                if (metaMigrationWritten === null && target.insertIfAbsent) {
                  const existing = await target.insertIfAbsent(snapshot);
                  if (existing) throw new ForeignDurableRecord(existing);
                } else if (target.replaceIfMatches) {
                  const expected =
                    metaMigrationWritten === null
                      ? null
                      : (JSON.parse(metaMigrationWritten) as MetaState);
                  const existing = await target.replaceIfMatches(expected, snapshot);
                  if (existing) throw new ForeignDurableRecord(existing);
                } else {
                  await target.save(snapshot);
                }
                metaMigrationWritten = persistedRecordKey(snapshot);
              },
              (seen, snapshot) => seen === metaRevision && meta === snapshot,
              () => {
                metaMigrationOpen = false;
                metaMigrationWritten = null;
                metaStorage = target;
                tracker.noteDurableAt('meta', Date.now());
                tracker.clearSession('meta');
              },
            );
          } catch (error) {
            /* 空の永続先へ移せなければ、セッション限りのまま現在のメタを残す */
            if (
              error instanceof ForeignDurableRecord &&
              error.record &&
              typeof error.record === 'object'
            ) {
              metaMigrationOpen = false;
              metaMigrationWritten = null;
              if (metaRevision === metaRevisionAtSession) {
                meta = error.record as MetaState;
                metaStorage = target;
                tracker.clearSession('meta');
              }
            }
          }
        }
      } catch {
        /* 読めなければ初期値を書き戻さない */
      }
    }
    if (tracker.isSession('run') && durableRun) {
      try {
        const loaded = await durableRun.load();
        const importedAhead = latestImportedSave !== null;
        const importMoved =
          runImportDepth > 0 ||
          runRevision !== runRevisionAtStart ||
          runRevision !== runRevisionAtSession ||
          importedAhead;
        const loadedKey = loaded ? persistedRecordKey(loaded) : null;
        const ownPartial =
          runMigrationOpen && loadedKey !== null && loadedKey === runMigrationWritten;
        if (loaded && !ownPartial) {
          // 進行中ランの保存先は切り替えない。読込中の取り込みも、既存セーブでは置き換えない。
          // 移行の失敗後に現れた別のセーブも、このセッションの途中書き込みとしては扱わない。
          runMigrationOpen = false;
          runMigrationWritten = null;
          if (!importMoved && canAdoptDurableRun()) {
            const issue = getRunSaveCompatibilityIssue(loaded);
            runStorage = durableRun;
            runSaveIssue = issue ? structuredClone(issue) : null;
            resumableSave = issue ? null : loaded;
            if (resumableSave) tracker.noteDurableAt('run', resumableSave.savedAt);
            tracker.clearSession('run');
          }
        } else if (!resumableSave && !runMigrationOpen && !importMoved) {
          runStorage = durableRun;
          runSaveIssue = null;
          tracker.clearSession('run');
        } else {
          const target = durableRun;
          runMigrationOpen = true;
          try {
            if (runImportDepth > 0) await runSaveImportWrites;
            await migrateEmptyDurable(
              () => runRevision,
              () => resumableSave,
              async (snapshot) => {
                if (runMigrationWritten === null && target.insertIfAbsent) {
                  const existing = await target.insertIfAbsent(snapshot);
                  if (existing) throw new ForeignDurableRecord(existing);
                } else if (target.replaceIfMatches) {
                  const expected =
                    runMigrationWritten === null
                      ? null
                      : (JSON.parse(runMigrationWritten) as RunSave | null);
                  const existing = await target.replaceIfMatches(expected, snapshot);
                  if (existing) throw new ForeignDurableRecord(existing);
                } else if (snapshot) {
                  await target.save(snapshot);
                } else {
                  await target.clear();
                }
                runMigrationWritten = persistedRecordKey(snapshot);
              },
              (seen, snapshot) =>
                runImportDepth === 0 && seen === runRevision && resumableSave === snapshot,
              () => {
                runMigrationOpen = false;
                runMigrationWritten = null;
                runStorage = target;
                runSaveIssue = null;
                if (resumableSave) tracker.noteDurableAt('run', Date.now());
                tracker.clearSession('run');
              },
            );
          } catch (error) {
            /* 空の永続先へ移せなければ、セッション限りのまま現在ランを残す */
            if (
              error instanceof ForeignDurableRecord &&
              error.record &&
              typeof error.record === 'object'
            ) {
              runMigrationOpen = false;
              runMigrationWritten = null;
              const importMovedNow =
                runImportDepth > 0 ||
                runRevision !== runRevisionAtStart ||
                runRevision !== runRevisionAtSession ||
                latestImportedSave !== null;
              if (!importMovedNow && canAdoptDurableRun()) {
                const loaded = error.record as RunSave;
                const issue = getRunSaveCompatibilityIssue(loaded);
                runStorage = target;
                runSaveIssue = issue ? structuredClone(issue) : null;
                resumableSave = issue ? null : loaded;
                if (resumableSave) tracker.noteDurableAt('run', resumableSave.savedAt);
                tracker.clearSession('run');
              }
            }
          }
        }
      } catch {
        /* 読めなければ空のセーブを書き戻さない */
      }
    }
    if (tracker.isSession('replay') && durableReplay) {
      const previous = replayStorage;
      const target = durableReplay;
      const readMemoryReplays = async (): Promise<ReplayBlob[]> => {
        if (previous && previous !== target) {
          try {
            return await previous.list();
          } catch {
            return cachedReplays.map((item) => structuredClone(item));
          }
        }
        return cachedReplays.map((item) => structuredClone(item));
      };
      const shouldCopyReplay = (id: string): boolean =>
        !replayIdsAtSession.has(id) || pinnedReplayIds.has(id);
      const saveOntoDurable = (blob: ReplayBlob, cohort: readonly string[]): Promise<void> =>
        target.save(structuredClone(blob), {
          pin: true,
          protectIds: [...new Set([...pinnedReplayIds, ...cohort])],
        });
      let durableList: ReplayBlob[];
      try {
        durableList = await target.list();
      } catch {
        return;
      }
      // 既存リプレイは消さない。セッション開始後の完走は、再試行前のものも含めて足してから切り替える。
      if (durableList.length > 0 && !replayMigrationOpen) {
        try {
          for (;;) {
            if (replaySavePromises.size > 0) {
              await Promise.allSettled([...replaySavePromises.values()]);
              continue;
            }
            if (replayImportDepth > 0) {
              await replayImportWrites;
              continue;
            }
            const memoryNow = await readMemoryReplays();
            if (replaySavePromises.size > 0 || replayImportDepth > 0) continue;
            const durableById = new Map(durableList.map((item) => [item.id, item]));
            const sameReplay = (left: ReplayBlob, right: ReplayBlob): boolean =>
              JSON.stringify(left) === JSON.stringify(right);
            const needsDurableWrite = (blob: ReplayBlob): boolean => {
              if (!shouldCopyReplay(blob.id)) return false;
              const durable = durableById.get(blob.id);
              return !durable || !sameReplay(durable, blob);
            };
            for (const blob of [...pendingReplays]) {
              const durable = durableById.get(blob.id);
              if (durable && sameReplay(durable, blob)) completePendingReplay(blob);
            }
            const byId = new Map<string, ReplayBlob>();
            for (const item of memoryNow) {
              if (needsDurableWrite(item)) byId.set(item.id, item);
            }
            for (const blob of pendingReplays) {
              const durable = durableById.get(blob.id);
              if (!durable || !sameReplay(durable, blob)) byId.set(blob.id, blob);
            }
            const newcomers = [...byId.values()];
            if (newcomers.length > 0) {
              const cohort = newcomers.map((item) => item.id);
              for (const blob of newcomers) await saveOntoDurable(blob, cohort);
              durableList = await target.list();
              for (const blob of newcomers) {
                const kept = durableList.find((row) => row.id === blob.id);
                if (!kept || JSON.stringify(kept) !== JSON.stringify(blob)) {
                  throw new Error('session replay was not kept');
                }
                if (pendingReplays.includes(blob)) completePendingReplay(blob);
              }
              continue;
            }
            if (pendingReplays.length > 0 || replaySavesInFlight.size > 0) continue;
            const listed = await target.list();
            if (
              pendingReplays.length > 0 ||
              replaySavesInFlight.size > 0 ||
              replaySavePromises.size > 0 ||
              replayImportDepth > 0
            ) {
              continue;
            }
            const confirm = await readMemoryReplays();
            if (
              confirm.some((item) => {
                if (!shouldCopyReplay(item.id)) return false;
                const row = listed.find((stored) => stored.id === item.id);
                return !row || JSON.stringify(row) !== JSON.stringify(item);
              })
            ) {
              continue;
            }
            replayStorage = target;
            cachedReplays = listed;
            bump();
            tracker.noteDurableAt('replay', Date.now());
            tracker.clearSession('replay');
            return;
          }
        } catch {
          return;
        }
      }
      // 空の永続先へ移す間はメモリのままにする。その間の完走失敗も pending に残し、書き終えてから外す。
      replayMigrationOpen = true;
      try {
        for (;;) {
          if (replaySavePromises.size > 0) {
            await Promise.allSettled([...replaySavePromises.values()]);
            continue;
          }
          if (replayImportDepth > 0) {
            await replayImportWrites;
            continue;
          }
          const memoryReplays = await readMemoryReplays();
          if (replaySavePromises.size > 0) continue;
          const memoryIds = new Set(memoryReplays.map((item) => item.id));
          const extras = pendingReplays.filter((blob) => !memoryIds.has(blob.id));
          const toSave = [...memoryReplays, ...extras];
          const writtenIds = new Set(toSave.map((blob) => blob.id));
          const cohort = [...writtenIds];
          for (const blob of toSave) await saveOntoDurable(blob, cohort);
          const kept = await target.list();
          for (const blob of toSave) {
            if (!kept.some((row) => row.id === blob.id)) {
              throw new Error('session replay was not kept');
            }
            if (pendingReplays.includes(blob)) completePendingReplay(blob);
          }
          if (pendingReplays.length > 0 || replaySavesInFlight.size > 0) continue;
          const confirm = await readMemoryReplays();
          if (pendingReplays.length > 0 || replaySavesInFlight.size > 0) continue;
          if (confirm.some((item) => !writtenIds.has(item.id))) continue;
          const seenReplayRevision = replayRevision;
          const listed = await target.list();
          if (
            pendingReplays.length > 0 ||
            replaySavesInFlight.size > 0 ||
            replaySavePromises.size > 0 ||
            replayImportDepth > 0 ||
            replayRevision !== seenReplayRevision
          ) {
            continue;
          }
          const confirmAfterList = await readMemoryReplays();
          if (
            pendingReplays.length > 0 ||
            replaySavesInFlight.size > 0 ||
            replaySavePromises.size > 0 ||
            replayImportDepth > 0 ||
            replayRevision !== seenReplayRevision ||
            confirmAfterList.some((item) => !writtenIds.has(item.id))
          ) {
            continue;
          }
          replayStorage = target;
          cachedReplays = listed;
          replayMigrationOpen = false;
          tracker.noteDurableAt('replay', Date.now());
          tracker.clearSession('replay');
          bump();
          return;
        }
      } catch {
        // 途中まで書いていても、未保存の完走が残る間はセッション限りのままにする。
      }
    }
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

  const openReplayById = (id: string, keyframeIndex = -1): RunState | null => {
    const replay = cachedReplays.find((item) => item.id === id);
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
    activeReplayId = id;
    activeReplayKeyframeIndex = index;
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
  };

  const findReplayJumpIndex = (phase: ReplayFramePhase): number | null => {
    if (!replayMode || !activeReplayId) return null;
    const replay = cachedReplays.find((item) => item.id === activeReplayId);
    if (!replay) return null;
    return findNextReplayKeyframeIndex(replay.keyframes, activeReplayKeyframeIndex, phase);
  };

  return {
    pause() {
      paused = true;
      pauseEpoch += 1;
    },
    resume() {
      paused = false;
    },
    acquirePauseHold() {
      pauseHolds += 1;
    },
    releasePauseHold() {
      pauseHolds = Math.max(0, pauseHolds - 1);
    },
    isPaused() {
      return paused || pauseHolds > 0;
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
      activeReplayId = null;
      activeReplayKeyframeIndex = -1;
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
      activeReplayId = null;
      activeReplayKeyframeIndex = -1;
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
      clearWhatIfCache();
      bump();
      const persisted = after();
      return { ...persisted, ...resolveWhatIf() };
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
      activeReplayId = null;
      activeReplayKeyframeIndex = -1;
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
    attachMetaPersistence(hydratedMeta, storage, options) {
      metaStorage = storage;
      meta = hydratedMeta;
      metaReady = true;
      if (options?.sessionOnly) {
        durableMeta = options.durableStorage ?? null;
        metaRevisionAtSession = metaRevision;
        tracker.markSession('meta');
      }
      recordIfFinished();
      bump();
    },
    attachRunPersistence(storage, save, issue = null, options) {
      runStorage = storage;
      const derivedIssue = save ? getRunSaveCompatibilityIssue(save) : null;
      const nextIssue = save ? derivedIssue : issue;
      runSaveIssue = nextIssue ? structuredClone(nextIssue) : null;
      resumableSave = runSaveIssue ? null : save;
      if (options?.sessionOnly) {
        durableRun = options.durableStorage ?? null;
        runRevisionAtSession = runRevision;
        tracker.markSession('run');
      } else if (resumableSave) {
        tracker.noteDurableAt('run', resumableSave.savedAt);
      }
      bump();
    },
    getPersistenceStatus() {
      return tracker.notice(resumableSave !== null || exportableReplayBlobs().length > 0);
    },
    dismissPersistenceNotice() {
      if (tracker.dismissTransientBanner()) bump();
    },
    async retryPersistence() {
      if (persistenceRetry) return persistenceRetry;
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      persistenceRetry = current;
      try {
        if (tracker.isSession()) await recoverDurableLoads();
        const tasks: Promise<void>[] = [];
        if (!tracker.isSession('meta') && tracker.isFailed('meta') && metaStorage) {
          tasks.push(retryWrite('meta', metaStorage.save(meta)));
        }
        if (!tracker.isSession('run') && tracker.isFailed('run') && runStorage) {
          tasks.push(
            retryWrite(
              'run',
              resumableSave ? runStorage.save(resumableSave) : runStorage.clear(),
              undefined,
              resumableSave !== null,
            ),
          );
        }
        if (!tracker.isSession('replay') && tracker.isFailed('replay') && replayStorage) {
          const blobs = pendingReplays.filter((blob) => !replaySavesInFlight.has(blob));
          if (blobs.length > 0) {
            const cohort = blobs.map((blob) => blob.id);
            tasks.push(
              (async () => {
                for (const blob of blobs) {
                  await retryWrite('replay', beginReplaySave(blob, cohort), () =>
                    completePendingReplay(blob),
                  );
                }
              })(),
            );
          }
        }
        try {
          await Promise.all(tasks);
        } catch {
          // 失敗は tracker に残り、画面の再試行案内を維持する。
        }
        bump();
      } finally {
        if (persistenceRetry === current) persistenceRetry = null;
        release();
      }
    },
    resumeRun() {
      if (replayMode || runSaveIssue || !resumableSave) return null;
      latestImportedSave = null;
      recorded = false;
      lastRunReward = null;
      clearWhatIfCache();
      const save = resumableSave;
      if (save.summary.runKind !== 'daily') {
        pendingSeed = save.summary.seed;
      }
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
    getResumeRisk() {
      if (!resumableSave) return null;
      return assessResumeRisk({
        org: resumableSave.state.org,
        totals: resumableSave.state.totals,
        budget: resumableSave.state.budget,
      });
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
    exportPendingReplayText() {
      const blobs = exportableReplayBlobs();
      const blob = blobs[blobs.length - 1];
      return blob ? serializeReplay(blob) : null;
    },
    exportPendingReplayFiles() {
      const blobs = exportableReplayBlobs();
      return blobs.map((blob, index) => ({
        filename:
          blobs.length === 1
            ? 'devops-tycoon-replay.json'
            : `devops-tycoon-replay-${index + 1}.json`,
        text: serializeReplay(blob),
      }));
    },
    async importRunSaveText(raw) {
      const loaded = parseRunSaveShare(raw);
      if (!loaded.ok) return loaded;
      const intended = loaded.save;
      latestImportedSave = intended;
      runImportDepth += 1;
      runRevision += 1;
      const write = runSaveImportWrites.then(async () => {
        try {
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
          runRevision += 1;
          if (
            runStorage &&
            !tracker.isSession('run') &&
            !tracker.settleCurrent('run', Date.now())
          ) {
            tracker.noteDurableAt('run', Date.now());
          }
          bump();
        } finally {
          runImportDepth -= 1;
        }
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
    async attachReplay(storage, options) {
      replayStorage = storage;
      const sessionOnly = options?.sessionOnly === true;
      if (sessionOnly) {
        durableReplay = options.durableStorage ?? null;
        tracker.markSession('replay');
      }
      await refreshReplayCache();
      if (sessionOnly) {
        replayIdsAtSession = new Set(cachedReplays.map((item) => item.id));
      }
    },
    listReplays() {
      return cachedReplays.map((r) => structuredClone(r));
    },
    exportReplayText(id) {
      const replay = cachedReplays.find((item) => item.id === id);
      return replay ? serializeReplay(replay) : null;
    },
    async importReplayText(
      raw: string,
      batch?: { protectIds: readonly string[]; retainPin: boolean },
    ) {
      const backup = readPersistenceBackup(raw);
      if (backup && !batch) {
        if (backup.replays.length === 0) {
          return {
            ok: false,
            reason: 'corrupt',
            message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
          };
        }
        const parsed = backup.replays.map((source) => ({
          source,
          result: parseReplayShare(source),
        }));
        const invalid = parsed.find((item) => !item.result.ok);
        if (invalid && !invalid.result.ok) return invalid.result;
        // ファイル自体は全件を残す。端末へ戻すのは上限に収まる新しい順だけにする。
        const ranked = parsed
          .flatMap((item) =>
            item.result.ok ? [{ source: item.source, replay: item.result.replay }] : [],
          )
          .sort((a, b) => b.replay.finishedAt - a.replay.finishedAt)
          .slice(0, REPLAY_MAX_COUNT);
        const cohort = ranked.map((item) => item.replay.id);
        const snapshot = replayStorage ? await replayStorage.list() : [];
        const restoreSnapshot = async (): Promise<void> => {
          const storage = replayStorage;
          if (!storage) return;
          try {
            if (storage.revertBatch) await storage.revertBatch(snapshot, cohort);
            else {
              await storage.clear();
              for (const blob of snapshot) await storage.save(structuredClone(blob));
            }
            await refreshReplayCache();
          } catch {
            /* 戻せなくても、取り込み失敗はそのまま返す */
          }
        };
        for (const id of cohort) pinnedReplayIds.add(id);
        try {
          let last: ReplayShareResult = {
            ok: false,
            reason: 'corrupt',
            message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
          };
          for (const item of ranked) {
            last = await this.importReplayText(item.source, {
              protectIds: cohort,
              retainPin: true,
            });
            if (!last.ok) {
              await restoreSnapshot();
              return last;
            }
          }
          const listed = replayStorage ? await replayStorage.list() : [];
          if (cohort.some((id) => !listed.some((row) => row.id === id))) {
            await restoreSnapshot();
            return {
              ok: false,
              reason: 'corrupt',
              message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
            };
          }
          const matched = pendingReplays.filter((item) => cohort.includes(item.id));
          for (const blob of matched) completePendingReplay(blob);
          if (matched.length > 0 && pendingReplays.length === 0 && !tracker.isSession('replay')) {
            tracker.settleCurrent('replay', Date.now());
          }
          bump();
          return last;
        } finally {
          for (const id of cohort) pinnedReplayIds.delete(id);
        }
      }
      const loaded = parseReplayShare(raw);
      if (!loaded.ok) return loaded;
      if (!replayStorage) {
        return {
          ok: false,
          reason: 'corrupt',
          message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
        };
      }
      const storage = replayStorage;
      pinnedReplayIds.add(loaded.replay.id);
      replayImportDepth += 1;
      replayRevision += 1;
      const write = replayImportWrites.then(async () => {
        try {
          await storage.save(loaded.replay, {
            pin: true,
            protectIds: batch?.protectIds ? [...batch.protectIds] : undefined,
          });
          // 保存できた取り込みは、以後の通常完走で上限枠を占有しない。
          // まとめファイルの途中では、バッチが終わるまで pin を残す。
          if (!batch?.retainPin) pinnedReplayIds.delete(loaded.replay.id);
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
            replayRevision += 1;
            return loaded;
          }
          if (!cachedReplays.some((item) => item.id === loaded.replay.id)) {
            return {
              ok: false as const,
              reason: 'corrupt' as const,
              message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
            };
          }
          if (!batch?.retainPin) {
            const matched = pendingReplays.filter((item) => item.id === loaded.replay.id);
            for (const blob of matched) completePendingReplay(blob);
            if (matched.length > 0 && pendingReplays.length === 0 && !tracker.isSession('replay')) {
              tracker.settleCurrent('replay', Date.now());
            }
          }
          replayRevision += 1;
          bump();
          return loaded;
        } catch {
          return {
            ok: false as const,
            reason: 'corrupt' as const,
            message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
          };
        } finally {
          replayImportDepth -= 1;
        }
      });
      replayImportWrites = write.then(
        () => undefined,
        () => undefined,
      );
      return write;
    },
    openReplay(id, keyframeIndex = -1) {
      return openReplayById(id, keyframeIndex);
    },
    jumpReplayToPhase(phase) {
      const index = findReplayJumpIndex(phase);
      if (index === null || !activeReplayId) return null;
      return openReplayById(activeReplayId, index);
    },
    findReplayJumpIndex,
    exitReplay() {
      replayMode = false;
      activeReplayDiagnosis = null;
      activeReplayInfo = null;
      activeReplayId = null;
      activeReplayKeyframeIndex = -1;
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
    zoomLevel() {
      return engine.zoomLevel();
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
