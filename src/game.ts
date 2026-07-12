/**
 * 決定論フック `window.game`（SPEC 第22.5）。
 *
 * Phase 3 ではラン（1四半期）全体を露出する。E2E / デバッグから、タイトル →
 * マップ → スプリント → リザルト → ドラフト → 進化 → ボス の各フェーズを
 * 一時停止つきで駆動でき、seed で再現できる（第22.3 / 22.5）。
 * ラン決着時にはメタ進行（localStorage）へ報酬を記録する（第17章）。
 */
import { getTrial } from './data/difficulties';
import { createRunEngine, type RunEngine } from './sim/run/engine';
import { resolveSeedFromLocation } from './sim/seed';
import type { ActionId, ActionTarget, CardPlayOutcome, InterventionOutcome } from './sim/types';
import type { DifficultyId, GoalAdjustmentId, RunState } from './sim/run/types';
import type { LaneAssignment } from './sim/member/types';
import type { RankingKind, ZoomLevel } from './sim/orgscale/types';
import {
  applyDailyRunReward,
  applyRunReward,
  dailySeed,
  DAILY_RUN_DIFFICULTY,
  DAILY_RUN_TRIALS,
  loadMeta,
  purchaseUnlock,
  saveMeta,
  unlockedContent,
  utcDateStr,
  type MetaState,
} from './state/meta';

export interface GameHandle {
  /** 自動進行を止める。 */
  pause(): void;
  /** 自動進行を再開する。 */
  resume(): void;
  /** 一時停止中か。 */
  isPaused(): boolean;
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
  /** ショップを出る。 */
  leaveShop(): RunState;
  /** 休息の選択（heal / repay / upgrade / recruit）。upgrade はデッキ位置を指定可能。 */
  restChoose(option: 'heal' | 'repay' | 'upgrade' | 'recruit', deckIndex?: number): RunState;
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
}

export function createGame(options: CreateGameOptions = {}): GameHandle {
  const seed = options.seed ?? resolveSeedFromLocation();
  const engine = createRunEngine({ seed, difficulty: options.difficulty, trials: options.trials });
  let paused = false;
  let meta = loadMeta();
  let recorded = false;
  let revision = 0;
  let activeDailyDate: string | null = null;

  /** 状態を変えた可能性のある操作の後に版番号を進める。 */
  const bump = (): void => {
    revision += 1;
  };

  /** 最新 meta から解放プールを engine へ反映する（ラン開始時に呼ぶ）。 */
  const applyUnlockedToEngine = (): void => {
    const content = unlockedContent(meta);
    engine.setUnlockedContent(content.cards, content.relics);
  };

  /** ラン決着を検知したら一度だけメタ進行へ報酬を記録する（第17章）。 */
  const recordIfFinished = (): void => {
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
    saveMeta(meta);
  };

  const after = (): RunState => {
    recordIfFinished();
    return engine.snapshot();
  };

  return {
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
    },
    isPaused() {
      return paused;
    },
    getState() {
      const state = engine.snapshot();
      // オートプレイやモンテカルロは snapshot を直接使うため、UI 経路だけで試算する。
      return { ...state, whatIf: engine.whatIfPreview() };
    },
    startRun(difficulty, trials, runSeed) {
      recorded = false;
      activeDailyDate = null;
      applyUnlockedToEngine();
      engine.startRun(difficulty, trials, runSeed, { kind: 'normal' });
      bump();
      return engine.snapshot();
    },
    startDailyRun(dateStr) {
      recorded = false;
      const day = dateStr ?? utcDateStr();
      activeDailyDate = day;
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
      return engine.snapshot();
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
      return engine.snapshot();
    },
    leaveShop() {
      engine.leaveShop();
      bump();
      return engine.snapshot();
    },
    restChoose(option, deckIndex) {
      engine.restChoose(option, deckIndex);
      bump();
      return engine.snapshot();
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
      return engine.snapshot();
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
      applyUnlockedToEngine();
      engine.toTitle(runSeed);
      bump();
      return engine.snapshot();
    },
    purchaseMetaUnlock(unlockId) {
      const result = purchaseUnlock(meta, unlockId);
      if (!result.ok) return { ok: false, reason: result.reason };
      meta = result.meta;
      saveMeta(meta);
      bump();
      return { ok: true };
    },
    getMeta() {
      return meta;
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
