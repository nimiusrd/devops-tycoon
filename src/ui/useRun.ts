/**
 * ラン進行フック。
 *
 * `window.game`（決定論ラン エンジン）を仲介し、React に最新スナップショットを
 * 供給する。スプリント中のみ壁時計アキュムレータで自動進行し、一時停止中
 * （E2E が `pause()` した時 / プレイヤー Pause）は止まる（第22.5 / RI-62）。
 * 描画は状態を読むだけ（第22.2）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  pauseBriefly as pauseGameBriefly,
  type ActiveReplayInfo,
  type GameHandle,
  type PauseBrieflyClear,
} from '../game';
import type { RunDiagnosticInfo } from '../state/diagnosticInfo';
import type { MetaState, RunRewardBreakdown } from '../state/meta';
import type { ReplayBlob } from '../state/replay';
import type { ReplayShareResult } from '../state/replayShare';
import type { RunSaveCompatibilityIssue, RunSaveSummary } from '../state/runPersistence';
import type { RunSaveShareResult } from '../state/runSaveShare';
import type {
  ActionId,
  ActionTarget,
  CardPlayOutcome,
  InterventionOutcome,
  SprintState,
} from '../sim/types';
import type { DiagnosisType, DifficultyId, GoalAdjustmentId, RunState } from '../sim/run/types';
import type { ScenarioId } from '../sim/types';
import type { LaneAssignment } from '../sim/member/types';
import type { RankingKind, ZoomLevel } from '../sim/orgscale/types';
import {
  accumulateWallTime,
  FRAME_MS,
  isPlaybackPaused,
  shouldAutoAdvanceSprint,
  SIM_STEP_MS,
  ticksDueFromAccumulator,
  type PlaybackSpeed,
} from './sprintTempo';

export type { PlaybackSpeed } from './sprintTempo';

export interface UseRun {
  state: RunState;
  meta: MetaState;
  /** 不具合再現用のseed・ルールセット・開始条件。 */
  diagnosticInfo: RunDiagnosticInfo;
  /** 直近ランのメタ進行ポイント内訳（未決着時は null）。 */
  lastRunReward: RunRewardBreakdown | null;
  /** 再開可能なランセーブの要約（無い場合は null）。 */
  runSaveSummary: RunSaveSummary | null;
  /** ルールセット不一致・情報欠落で再開できないランセーブの理由。 */
  runSaveIssue: RunSaveCompatibilityIssue | null;
  /** ラン開始世代（RI-60）。`window.game.startRun` でも増える。 */
  runEpoch: number;
  /**
   * プレイヤー向け再生速度（RI-62）。0=一時停止 / 1=1x / 2=2x。
   * `game.pause()` とは独立（E2E・ボススローモの epoch と衝突しない）。
   */
  playbackSpeed: PlaybackSpeed;
  setPlaybackSpeed: (speed: PlaybackSpeed) => void;
  startRun: (
    difficulty: DifficultyId,
    trials: string[],
    scenario?: ScenarioId,
    seed?: string,
  ) => void;
  startDailyRun: (dateStr?: string) => void;
  resumeRun: () => void;
  beginSetupSprint: () => void;
  resolveBeat: (choiceIndex?: number) => void;
  dispatch: (id: ActionId, target?: ActionTarget) => InterventionOutcome;
  playCard: (deckIndex: number) => CardPlayOutcome;
  /** dispatch 直後のスプリント快照（盤面演出用）。 */
  getSprintSnapshot: () => SprintState | null;
  /**
   * 指定 ms だけ自動進行を止める（RI-10 ボススローモ）。
   * 既に pause 済みなら触らない。戻り値でキャンセルできる。
   */
  pauseBriefly: (ms: number) => PauseBrieflyClear;
  acknowledgeResult: () => void;
  chooseCard: (defId: string) => void;
  skipDraft: () => void;
  mulliganDraft: () => void;
  unlockEvolution: (id: string) => void;
  finishEvolution: () => void;
  buyShopCard: (defId: string) => void;
  buyShopRelic: () => void;
  buyShopRecruit: () => void;
  leaveShop: () => void;
  restChoose: (option: 'heal' | 'repay' | 'upgrade' | 'recruit', deckIndex?: number) => void;
  recruitChoose: (option: 'hire' | 'skip') => void;
  assignMember: (id: string, assignment: LaneAssignment) => void;
  setMemberAi: (id: string, on: boolean) => void;
  zoomTo: (level: ZoomLevel) => void;
  focusDept: (id: string) => void;
  focusTeam: (id: string) => void;
  enterTeam: (id: string) => void;
  setRankingKind: (kind: RankingKind) => void;
  applyOrgLever: (leverId: string, deptId?: string, teamId?: string) => void;
  acknowledgeQuarterReview: () => void;
  chooseGoalAdjustment: (id: GoalAdjustmentId) => void;
  newRun: () => void;
  clearRunSave: () => void;
  exportRunSaveText: () => string | null;
  importRunSaveText: (raw: string) => Promise<RunSaveShareResult>;
  exportReplayText: (id: string) => string | null;
  importReplayText: (raw: string) => Promise<ReplayShareResult>;
  replays: ReplayBlob[];
  isReplayMode: boolean;
  /** 閲覧中リプレイの終端診断（RI-34‴）。非リプレイ時は null。 */
  activeReplayDiagnosis: DiagnosisType | null;
  /** 閲覧中リプレイの記録時ルールセットと表示コンテンツ。 */
  activeReplayInfo: ActiveReplayInfo | null;
  openReplay: (id: string, keyframeIndex?: number) => boolean;
  exitReplay: () => void;
  purchaseMetaUnlock: (unlockId: string) => { ok: boolean; reason?: string };
  /** サウンドミュートを永続化する（RI-59）。 */
  setSoundMuted: (muted: boolean) => void;
  /** 研修方針（優先施策）を永続化する（RI-34⁗）。 */
  setPreferredCardIds: (cardIds: readonly string[]) => void;
  /** 初見向け段階ガイドを表示済みにする（RI-60）。 */
  markTutorialSeen: () => void;
}

export function useRun(game: GameHandle): UseRun {
  const [state, setState] = useState<RunState>(() => game.getState());
  const [meta, setMeta] = useState<MetaState>(() => game.getMeta());
  const [diagnosticInfo, setDiagnosticInfo] = useState<RunDiagnosticInfo>(() =>
    game.getDiagnosticInfo(),
  );
  const [lastRunReward, setLastRunReward] = useState<RunRewardBreakdown | null>(() =>
    game.getLastRunReward(),
  );
  const [runSaveSummary, setRunSaveSummary] = useState<RunSaveSummary | null>(() =>
    game.getRunSaveSummary(),
  );
  const [runSaveIssue, setRunSaveIssue] = useState<RunSaveCompatibilityIssue | null>(() =>
    game.getRunSaveIssue(),
  );
  const [runEpoch, setRunEpoch] = useState(() => game.getRunEpoch());
  const [replays, setReplays] = useState<ReplayBlob[]>(() => game.listReplays());
  const [isReplayMode, setIsReplayMode] = useState(() => game.isReplayMode());
  const [activeReplayDiagnosis, setActiveReplayDiagnosis] = useState<DiagnosisType | null>(() =>
    game.getActiveReplayDiagnosis(),
  );
  const [activeReplayInfo, setActiveReplayInfo] = useState<ActiveReplayInfo | null>(() =>
    game.getActiveReplayInfo(),
  );
  const [playbackSpeed, setPlaybackSpeedState] = useState<PlaybackSpeed>(1);
  const playbackSpeedRef = useRef<PlaybackSpeed>(1);
  const setPlaybackSpeed = useCallback((speed: PlaybackSpeed) => {
    playbackSpeedRef.current = speed;
    setPlaybackSpeedState(speed);
  }, []);

  // スプリント開始ごとに 1x へ戻す（前スプリントの Pause/2x を持ち越さない）。
  const lastSprintIdRef = useRef<string | null>(null);
  useEffect(() => {
    const sprintId = state.phase === 'sprint' ? state.currentSprintId : null;
    if (sprintId && sprintId !== lastSprintIdRef.current) {
      lastSprintIdRef.current = sprintId;
      setPlaybackSpeed(1);
    }
    if (!sprintId) lastSprintIdRef.current = null;
  }, [state.phase, state.currentSprintId, setPlaybackSpeed]);

  useEffect(() => {
    // 初回も必ず同期する。React の描画〜effect開始の間に window.game が操作されても取りこぼさない。
    let lastRev = -1;
    let accumulatedMs = 0;
    let lastWallMs = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const deltaMs = now - lastWallMs;
      lastWallMs = now;

      // スプリント進行中は壁時計アキュムレータで固定ステップ前進（RI-62）。
      // game.isPaused() は E2E / pauseBriefly / lazy 読込用。プレイヤー Pause は playbackSpeed=0。
      // 全社マップ等の俯瞰中は現場 sim を進めない（閲覧だけで KPI が進まない）。
      const speed = playbackSpeedRef.current;
      const fieldView = game.zoomLevel() === 'team';
      if (
        shouldAutoAdvanceSprint({
          sprintRunning: game.isSprintRunning(),
          paused: game.isPaused(),
          playbackSpeed: speed,
          fieldView,
        })
      ) {
        // タブ復帰などで delta が膨らんでも、1 フレーム分超の未消化時間は破棄する。
        accumulatedMs = accumulateWallTime(accumulatedMs, deltaMs, speed);
        const { ticks, consumedMs } = ticksDueFromAccumulator(accumulatedMs, speed);
        accumulatedMs -= consumedMs;
        for (let i = 0; i < ticks; i += 1) {
          if (
            !shouldAutoAdvanceSprint({
              sprintRunning: game.isSprintRunning(),
              paused: game.isPaused(),
              playbackSpeed: playbackSpeedRef.current,
              fieldView: game.zoomLevel() === 'team',
            })
          ) {
            break;
          }
          game.step(SIM_STEP_MS);
        }
      } else {
        accumulatedMs = 0;
      }

      // 内部ステップでも window.game 経由の外部操作でも、変化時のみ読み直す。
      const rev = game.revision();
      if (rev === lastRev) return;
      lastRev = rev;
      const next = game.getState();
      setState(next);
      setMeta(game.getMeta());
      setDiagnosticInfo(game.getDiagnosticInfo());
      setLastRunReward(game.getLastRunReward());
      setRunSaveSummary(game.getRunSaveSummary());
      setRunSaveIssue(game.getRunSaveIssue());
      setRunEpoch(game.getRunEpoch());
      setReplays(game.listReplays());
      setIsReplayMode(game.isReplayMode());
      setActiveReplayDiagnosis(game.getActiveReplayDiagnosis());
      setActiveReplayInfo(game.getActiveReplayInfo());
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [game]);

  // ハンドラはエンジンを操作するだけ。UI への反映は上のポーリングが担う
  // （内部進行と window.game 経由の外部操作を同一経路で扱うため）。
  const startRun = useCallback(
    (difficulty: DifficultyId, trials: string[], scenario?: ScenarioId, seed?: string) =>
      void game.startRun(difficulty, trials, seed, scenario),
    [game],
  );
  const startDailyRun = useCallback((dateStr?: string) => void game.startDailyRun(dateStr), [game]);
  const resumeRun = useCallback(() => void game.resumeRun(), [game]);
  const beginSetupSprint = useCallback(() => void game.beginSetupSprint(), [game]);
  const resolveBeat = useCallback(
    (choiceIndex?: number) => void game.resolveBeat(choiceIndex),
    [game],
  );
  const dispatch = useCallback(
    (id: ActionId, target?: ActionTarget) => game.dispatch(id, target),
    [game],
  );
  const playCard = useCallback(
    (deckIndex: number): CardPlayOutcome => {
      // プレイヤー Pause 中は手札解決を止める。E2E の game.playCard / game.pause は通す。
      if (isPlaybackPaused(playbackSpeedRef.current)) return { ok: false, reason: 'paused' };
      return game.playCard(deckIndex);
    },
    [game],
  );
  const getSprintSnapshot = useCallback(() => game.getState().sprint, [game]);
  const pauseBriefly = useCallback((ms: number) => pauseGameBriefly(game, ms), [game]);
  const acknowledgeResult = useCallback(() => void game.acknowledgeResult(), [game]);
  const chooseCard = useCallback((defId: string) => void game.chooseCard(defId), [game]);
  const skipDraft = useCallback(() => void game.skipDraft(), [game]);
  const mulliganDraft = useCallback(() => void game.mulliganDraft(), [game]);
  const unlockEvolution = useCallback((id: string) => void game.unlockEvolution(id), [game]);
  const finishEvolution = useCallback(() => void game.finishEvolution(), [game]);
  const buyShopCard = useCallback((defId: string) => void game.buyShopCard(defId), [game]);
  const buyShopRelic = useCallback(() => void game.buyShopRelic(), [game]);
  const buyShopRecruit = useCallback(() => void game.buyShopRecruit(), [game]);
  const leaveShop = useCallback(() => void game.leaveShop(), [game]);
  const restChoose = useCallback(
    (option: 'heal' | 'repay' | 'upgrade' | 'recruit', deckIndex?: number) =>
      void game.restChoose(option, deckIndex),
    [game],
  );
  const recruitChoose = useCallback(
    (option: 'hire' | 'skip') => void game.recruitChoose(option),
    [game],
  );
  const assignMember = useCallback(
    (id: string, assignment: LaneAssignment) => void game.assignMember(id, assignment),
    [game],
  );
  const setMemberAi = useCallback(
    (id: string, on: boolean) => void game.setMemberAi(id, on),
    [game],
  );
  const zoomTo = useCallback((level: ZoomLevel) => void game.zoomTo(level), [game]);
  const focusDept = useCallback((id: string) => void game.focusDept(id), [game]);
  const focusTeam = useCallback((id: string) => void game.focusTeam(id), [game]);
  const enterTeam = useCallback((id: string) => void game.enterTeam(id), [game]);
  const setRankingKind = useCallback((kind: RankingKind) => void game.setRankingKind(kind), [game]);
  const applyOrgLever = useCallback(
    (leverId: string, deptId?: string, teamId?: string) =>
      void game.applyOrgLever(leverId, deptId, teamId),
    [game],
  );
  const acknowledgeQuarterReview = useCallback(() => void game.acknowledgeQuarterReview(), [game]);
  const chooseGoalAdjustment = useCallback(
    (id: GoalAdjustmentId) => void game.chooseGoalAdjustment(id),
    [game],
  );
  const newRun = useCallback(() => void game.newRun(), [game]);
  const clearRunSave = useCallback(() => void game.clearRunSave(), [game]);
  const exportRunSaveText = useCallback(() => game.exportRunSaveText(), [game]);
  const importRunSaveText = useCallback((raw: string) => game.importRunSaveText(raw), [game]);
  const exportReplayText = useCallback((id: string) => game.exportReplayText(id), [game]);
  const importReplayText = useCallback((raw: string) => game.importReplayText(raw), [game]);
  const openReplay = useCallback(
    (id: string, keyframeIndex?: number) => {
      const opened = game.openReplay(id, keyframeIndex);
      if (!opened) return false;
      // ポーリング待ちだとタイトルオーバーレイが先に消え、前画面のスクロールが残る。
      setState(opened);
      setDiagnosticInfo(game.getDiagnosticInfo());
      setLastRunReward(game.getLastRunReward());
      setIsReplayMode(true);
      setActiveReplayDiagnosis(game.getActiveReplayDiagnosis());
      setActiveReplayInfo(game.getActiveReplayInfo());
      return true;
    },
    [game],
  );
  const exitReplay = useCallback(() => void game.exitReplay(), [game]);
  const purchaseMetaUnlock = useCallback(
    (unlockId: string) => game.purchaseMetaUnlock(unlockId),
    [game],
  );
  const setSoundMuted = useCallback((muted: boolean) => void game.setSoundMuted(muted), [game]);
  const setPreferredCardIds = useCallback(
    (cardIds: readonly string[]) => void game.setPreferredCardIds(cardIds),
    [game],
  );
  const markTutorialSeen = useCallback(() => void game.markTutorialSeen(), [game]);

  return {
    state,
    meta,
    diagnosticInfo,
    lastRunReward,
    runSaveSummary,
    runSaveIssue,
    runEpoch,
    replays,
    isReplayMode,
    activeReplayDiagnosis,
    activeReplayInfo,
    playbackSpeed,
    setPlaybackSpeed,
    startRun,
    startDailyRun,
    resumeRun,
    openReplay,
    exitReplay,
    beginSetupSprint,
    resolveBeat,
    dispatch,
    playCard,
    getSprintSnapshot,
    pauseBriefly,
    acknowledgeResult,
    chooseCard,
    skipDraft,
    mulliganDraft,
    unlockEvolution,
    finishEvolution,
    buyShopCard,
    buyShopRelic,
    buyShopRecruit,
    leaveShop,
    restChoose,
    recruitChoose,
    assignMember,
    setMemberAi,
    zoomTo,
    focusDept,
    focusTeam,
    enterTeam,
    setRankingKind,
    applyOrgLever,
    acknowledgeQuarterReview,
    chooseGoalAdjustment,
    newRun,
    clearRunSave,
    exportRunSaveText,
    importRunSaveText,
    exportReplayText,
    importReplayText,
    purchaseMetaUnlock,
    setSoundMuted,
    setPreferredCardIds,
    markTutorialSeen,
  };
}
