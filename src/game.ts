/**
 * 決定論フック `window.game`（SPEC 第22.5）。
 *
 * Phase 3 ではラン（1四半期）全体を露出する。E2E / デバッグから、タイトル →
 * マップ → スプリント → リザルト → ドラフト → 進化 → ボス の各フェーズを
 * 一時停止つきで駆動でき、seed で再現できる（第22.3 / 22.5）。
 * ラン決着時にはメタ進行を永続化する（第17章）。
 */
import { getTrial } from './data/difficulties';
import { createRunEngine, type RunEngine } from './sim/run/engine';
import { resolveSeedFromLocation } from './sim/seed';
import type { ActionId, ActionTarget, CardPlayOutcome, InterventionOutcome } from './sim/types';
import type { DifficultyId, GoalAdjustmentId, RunState, WhatIfState } from './sim/run/types';
import { computeWhatIfState, whatIfCacheKey, type WhatIfComputeInput } from './sim/run/whatIfState';
import { requestWhatIfState } from './sim/run/whatIfClient';
import type { LaneAssignment } from './sim/member/types';
import type { RankingKind, ZoomLevel } from './sim/orgscale/types';
import {
  applyDailyRunReward,
  applyRunReward,
  dailySeed,
  DAILY_RUN_DIFFICULTY,
  DAILY_RUN_TRIALS,
  defaultMeta,
  purchaseUnlock,
  unlockedContent,
  utcDateStr,
  type MetaState,
} from './state/meta';
import type { MetaStorage } from './state/metaPersistence';

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
  /** タイトルで選んだ難易度・試練でランを開始する。 */
  startRun(difficulty?: DifficultyId, trials?: string[], seed?: string): RunState;
  /** 本日（または指定 UTC 日）のデイリーランを開始する（第23章）。 */
  startDailyRun(dateStr?: string): RunState;
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
  /** チームへドリルダウンして現場へ着地する（第4.11）。 */
  focusTeam(id: string): RunState;
  /** 業界ランキングの種別タブを切り替える（第4.10）。 */
  setRankingKind(kind: RankingKind): RunState;
  /** 全社 / 部門レバーを発動する（四半期予算を消費。第4.8 / 第4.9）。 */
  applyOrgLever(leverId: string, deptId?: string): RunState;
  /** 四半期レビューを承認する（達成→won / 継続不能→lost）。 */
  acknowledgeQuarterReview(): RunState;
  /** 目標修正を選び次四半期へ進む。 */
  chooseGoalAdjustment(id: GoalAdjustmentId): RunState;
  /** 新しいランをタイトルから始める（seed を差し替え可能）。 */
  newRun(seed?: string): RunState;
  /** メタショップでコンテンツを永続解放する（points 消費）。 */
  purchaseMetaUnlock(unlockId: string): { ok: boolean; reason?: string };
  /** 現在のメタ進行（解放状況・実績）。 */
  getMeta(): MetaState;
  /** 起動時の非同期永続化を接続し、メタ更新を解禁する。 */
  attachMetaPersistence(meta: MetaState, storage: MetaStorage): void;
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
}

export function createGame(options: CreateGameOptions = {}): GameHandle {
  const seed = options.seed ?? resolveSeedFromLocation();
  const engine = createRunEngine({ seed, difficulty: options.difficulty, trials: options.trials });
  let paused = false;
  /** pause() の呼び出し回数。resume では進めない。 */
  let pauseEpoch = 0;
  let meta = options.initialMeta ?? defaultMeta();
  let metaStorage = options.metaStorage ?? null;
  let metaReady = options.metaReady ?? true;
  let recorded = false;
  let revision = 0;
  let activeDailyDate: string | null = null;
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

  /** 最新 meta から解放プールを engine へ反映する（ラン開始時に呼ぶ）。 */
  const applyUnlockedToEngine = (): void => {
    const content = unlockedContent(meta);
    engine.setUnlockedContent(content.cards, content.relics);
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
      score: s.org.deliveryScore,
      scoreMul,
      maxCombo: s.totals.maxCombo,
      quarterReviews: s.reviewHistory,
    };
    if (s.runKind === 'daily' && activeDailyDate) {
      meta = applyDailyRunReward(meta, { ...input, dateStr: activeDailyDate }).meta;
    } else {
      meta = applyRunReward(meta, input);
    }
    persistMeta();
  };

  const after = (): RunState => {
    recordIfFinished();
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
      // オートプレイやモンテカルロは snapshot を直接使うため、UI 経路だけで試算する。
      return { ...state, ...resolveWhatIf() };
    },
    startRun(difficulty, trials, runSeed) {
      recorded = false;
      activeDailyDate = null;
      clearWhatIfCache();
      applyUnlockedToEngine();
      engine.startRun(difficulty, trials, runSeed, { kind: 'normal' });
      bump();
      return engine.snapshot();
    },
    startDailyRun(dateStr) {
      recorded = false;
      const day = dateStr ?? utcDateStr();
      activeDailyDate = day;
      clearWhatIfCache();
      applyUnlockedToEngine();
      engine.startRun(DAILY_RUN_DIFFICULTY, [...DAILY_RUN_TRIALS], dailySeed(day), {
        kind: 'daily',
        dailyDate: day,
      });
      bump();
      return engine.snapshot();
    },
    beginSetupSprint() {
      engine.beginSetupSprint();
      bump();
      return after();
    },
    resolveBeat(choiceIndex) {
      engine.resolveBeat(choiceIndex);
      bump();
      return after();
    },
    step(ms) {
      engine.step(ms);
      bump();
      return after();
    },
    dispatch(id, target) {
      const outcome = engine.dispatch(id, target);
      bump();
      return outcome;
    },
    playCard(deckIndex) {
      const outcome = engine.playCard(deckIndex);
      bump();
      recordIfFinished();
      return outcome;
    },
    acknowledgeResult() {
      engine.acknowledgeResult();
      bump();
      return engine.snapshot();
    },
    chooseCard(defId) {
      engine.chooseCard(defId);
      bump();
      return after();
    },
    skipDraft() {
      engine.skipDraft();
      bump();
      return engine.snapshot();
    },
    unlockEvolution(id) {
      engine.unlockEvolution(id);
      bump();
      return engine.snapshot();
    },
    finishEvolution() {
      engine.finishEvolution();
      bump();
      return engine.snapshot();
    },
    buyShopCard(defId) {
      engine.buyShopCard(defId);
      bump();
      return after();
    },
    buyShopRelic() {
      engine.buyShopRelic();
      bump();
      return after();
    },
    buyShopRecruit() {
      engine.buyShopRecruit();
      bump();
      return after();
    },
    leaveShop() {
      engine.leaveShop();
      bump();
      return engine.snapshot();
    },
    restChoose(option, deckIndex) {
      engine.restChoose(option, deckIndex);
      bump();
      return after();
    },
    recruitChoose(option) {
      engine.recruitChoose(option);
      bump();
      return after();
    },
    assignMember(id, assignment) {
      engine.assignMember(id, assignment);
      bump();
      return engine.snapshot();
    },
    setMemberAi(id, on) {
      engine.setMemberAi(id, on);
      bump();
      return engine.snapshot();
    },
    zoomTo(level) {
      engine.zoomTo(level);
      bump();
      return engine.snapshot();
    },
    focusDept(id) {
      engine.focusDepartment(id);
      bump();
      return engine.snapshot();
    },
    focusTeam(id) {
      engine.focusTeam(id);
      bump();
      return engine.snapshot();
    },
    setRankingKind(kind) {
      engine.setRankingKind(kind);
      bump();
      return engine.snapshot();
    },
    applyOrgLever(leverId, deptId) {
      engine.applyOrgLever(leverId, deptId);
      bump();
      return after();
    },
    acknowledgeQuarterReview() {
      engine.acknowledgeQuarterReview();
      bump();
      return after();
    },
    chooseGoalAdjustment(id) {
      engine.chooseGoalAdjustment(id);
      bump();
      return engine.snapshot();
    },
    newRun(runSeed) {
      recorded = false;
      activeDailyDate = null;
      clearWhatIfCache();
      applyUnlockedToEngine();
      engine.toTitle(runSeed);
      bump();
      return engine.snapshot();
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
    getMeta() {
      return meta;
    },
    attachMetaPersistence(hydratedMeta, storage) {
      metaStorage = storage;
      meta = hydratedMeta;
      metaReady = true;
      recordIfFinished();
      bump();
    },
    phase() {
      return engine.currentPhase();
    },
    isSprintRunning() {
      return engine.sprintRunning();
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
