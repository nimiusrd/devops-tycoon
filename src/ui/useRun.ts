/**
 * ラン進行フック。
 *
 * `window.game`（決定論ラン エンジン）を仲介し、React に最新スナップショットを
 * 供給する。スプリント中のみ固定タイムステップで自動進行し、一時停止中
 * （E2E が `pause()` した時）は止まる（第22.5）。描画は状態を読むだけ（第22.2）。
 */
import { useCallback, useEffect, useState } from 'react';
import type { GameHandle } from '../game';
import type { MetaState } from '../state/meta';
import type {
  ActionId,
  ActionTarget,
  CardPlayOutcome,
  InterventionOutcome,
  SprintState,
} from '../sim/types';
import type { DifficultyId, GoalAdjustmentId, RunState } from '../sim/run/types';
import type { LaneAssignment } from '../sim/member/types';
import type { RankingKind, ZoomLevel } from '../sim/orgscale/types';

/** 自動進行の更新間隔（ms）。 */
const FRAME_MS = 60;
/** 1 フレームで進めるシミュレーション時間（ms）= 固定ステップ 1 tick。 */
const SIM_STEP_MS = 100;

export interface UseRun {
  state: RunState;
  meta: MetaState;
  startRun: (difficulty: DifficultyId, trials: string[]) => void;
  startDailyRun: (dateStr?: string) => void;
  beginSetupSprint: () => void;
  resolveBeat: (choiceIndex?: number) => void;
  dispatch: (id: ActionId, target?: ActionTarget) => InterventionOutcome;
  playCard: (deckIndex: number) => CardPlayOutcome;
  /** dispatch 直後のスプリント快照（盤面演出用）。 */
  getSprintSnapshot: () => SprintState | null;
  acknowledgeResult: () => void;
  chooseCard: (defId: string) => void;
  skipDraft: () => void;
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
  setRankingKind: (kind: RankingKind) => void;
  applyOrgLever: (leverId: string, deptId?: string) => void;
  acknowledgeQuarterReview: () => void;
  chooseGoalAdjustment: (id: GoalAdjustmentId) => void;
  newRun: () => void;
  purchaseMetaUnlock: (unlockId: string) => { ok: boolean; reason?: string };
}

export function useRun(game: GameHandle): UseRun {
  const [state, setState] = useState<RunState>(() => game.getState());
  const [meta, setMeta] = useState<MetaState>(() => game.getMeta());

  useEffect(() => {
    // 初回も必ず同期する。React の描画〜effect開始の間に window.game が操作されても取りこぼさない。
    let lastRev = -1;
    const id = window.setInterval(() => {
      // スプリント進行中は固定タイムステップで前進させる（版番号も進む）。
      if (game.isSprintRunning() && !game.isPaused()) game.step(SIM_STEP_MS);
      // 内部ステップでも window.game 経由の外部操作でも、変化時のみ読み直す。
      const rev = game.revision();
      if (rev === lastRev) return;
      lastRev = rev;
      const next = game.getState();
      setState(next);
      setMeta(game.getMeta());
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [game]);

  // ハンドラはエンジンを操作するだけ。UI への反映は上のポーリングが担う
  // （内部進行と window.game 経由の外部操作を同一経路で扱うため）。
  const startRun = useCallback(
    (difficulty: DifficultyId, trials: string[]) => void game.startRun(difficulty, trials),
    [game],
  );
  const startDailyRun = useCallback((dateStr?: string) => void game.startDailyRun(dateStr), [game]);
  const beginSetupSprint = useCallback(() => void game.beginSetupSprint(), [game]);
  const resolveBeat = useCallback(
    (choiceIndex?: number) => void game.resolveBeat(choiceIndex),
    [game],
  );
  const dispatch = useCallback(
    (id: ActionId, target?: ActionTarget) => game.dispatch(id, target),
    [game],
  );
  const playCard = useCallback((deckIndex: number) => game.playCard(deckIndex), [game]);
  const getSprintSnapshot = useCallback(() => game.getState().sprint, [game]);
  const acknowledgeResult = useCallback(() => void game.acknowledgeResult(), [game]);
  const chooseCard = useCallback((defId: string) => void game.chooseCard(defId), [game]);
  const skipDraft = useCallback(() => void game.skipDraft(), [game]);
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
  const setRankingKind = useCallback((kind: RankingKind) => void game.setRankingKind(kind), [game]);
  const applyOrgLever = useCallback(
    (leverId: string, deptId?: string) => void game.applyOrgLever(leverId, deptId),
    [game],
  );
  const acknowledgeQuarterReview = useCallback(() => void game.acknowledgeQuarterReview(), [game]);
  const chooseGoalAdjustment = useCallback(
    (id: GoalAdjustmentId) => void game.chooseGoalAdjustment(id),
    [game],
  );
  const newRun = useCallback(() => void game.newRun(), [game]);
  const purchaseMetaUnlock = useCallback(
    (unlockId: string) => game.purchaseMetaUnlock(unlockId),
    [game],
  );

  return {
    state,
    meta,
    startRun,
    startDailyRun,
    beginSetupSprint,
    resolveBeat,
    dispatch,
    playCard,
    getSprintSnapshot,
    acknowledgeResult,
    chooseCard,
    skipDraft,
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
    setRankingKind,
    applyOrgLever,
    acknowledgeQuarterReview,
    chooseGoalAdjustment,
    newRun,
    purchaseMetaUnlock,
  };
}
