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
import type { ActionId, InterventionOutcome } from '../sim/types';
import type { DifficultyId, RunState } from '../sim/run/types';

/** 自動進行の更新間隔（ms）。 */
const FRAME_MS = 60;
/** 1 フレームで進めるシミュレーション時間（ms）= 固定ステップ 1 tick。 */
const SIM_STEP_MS = 100;

export interface UseRun {
  state: RunState;
  meta: MetaState;
  startRun: (difficulty: DifficultyId, trials: string[]) => void;
  enterNode: (id: string) => void;
  dispatch: (id: ActionId) => InterventionOutcome;
  acknowledgeResult: () => void;
  chooseCard: (defId: string) => void;
  skipDraft: () => void;
  unlockEvolution: (id: string) => void;
  finishEvolution: () => void;
  chooseEvent: (index: number) => void;
  buyShopCard: (defId: string) => void;
  buyShopRelic: () => void;
  leaveShop: () => void;
  restChoose: (option: 'heal' | 'repay' | 'upgrade') => void;
  newRun: () => void;
}

export function useRun(game: GameHandle): UseRun {
  const [state, setState] = useState<RunState>(() => game.getState());
  const [meta, setMeta] = useState<MetaState>(() => game.getMeta());

  useEffect(() => {
    let lastRev = game.revision();
    const id = window.setInterval(() => {
      // スプリント進行中は固定タイムステップで前進させる（版番号も進む）。
      if (game.isSprintRunning() && !game.isPaused()) game.step(SIM_STEP_MS);
      // 内部ステップでも window.game 経由の外部操作でも、変化時のみ読み直す。
      const rev = game.revision();
      if (rev === lastRev) return;
      lastRev = rev;
      const next = game.getState();
      setState(next);
      if (next.status !== 'playing') setMeta(game.getMeta());
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [game]);

  // ハンドラはエンジンを操作するだけ。UI への反映は上のポーリングが担う
  // （内部進行と window.game 経由の外部操作を同一経路で扱うため）。
  const startRun = useCallback(
    (difficulty: DifficultyId, trials: string[]) => void game.startRun(difficulty, trials),
    [game],
  );
  const enterNode = useCallback((id: string) => void game.enterNode(id), [game]);
  const dispatch = useCallback((id: ActionId) => game.dispatch(id), [game]);
  const acknowledgeResult = useCallback(() => void game.acknowledgeResult(), [game]);
  const chooseCard = useCallback((defId: string) => void game.chooseCard(defId), [game]);
  const skipDraft = useCallback(() => void game.skipDraft(), [game]);
  const unlockEvolution = useCallback((id: string) => void game.unlockEvolution(id), [game]);
  const finishEvolution = useCallback(() => void game.finishEvolution(), [game]);
  const chooseEvent = useCallback((index: number) => void game.chooseEvent(index), [game]);
  const buyShopCard = useCallback((defId: string) => void game.buyShopCard(defId), [game]);
  const buyShopRelic = useCallback(() => void game.buyShopRelic(), [game]);
  const leaveShop = useCallback(() => void game.leaveShop(), [game]);
  const restChoose = useCallback(
    (option: 'heal' | 'repay' | 'upgrade') => void game.restChoose(option),
    [game],
  );
  const newRun = useCallback(() => void game.newRun(), [game]);

  return {
    state,
    meta,
    startRun,
    enterNode,
    dispatch,
    acknowledgeResult,
    chooseCard,
    skipDraft,
    unlockEvolution,
    finishEvolution,
    chooseEvent,
    buyShopCard,
    buyShopRelic,
    leaveShop,
    restChoose,
    newRun,
  };
}
