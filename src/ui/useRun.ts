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
    const id = window.setInterval(() => {
      const s = game.getState();
      if (s.phase !== 'sprint' || game.isPaused()) return;
      if (s.sprint && s.sprint.complete) return;
      const next = game.step(SIM_STEP_MS);
      setState(next);
      // ボススプリントが自動進行で決着したらメタ進行（解放/実績）も同期する。
      if (next.status !== 'playing') setMeta(game.getMeta());
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [game]);

  const sync = useCallback(
    (next: RunState) => {
      setState(next);
      setMeta(game.getMeta());
    },
    [game],
  );

  const startRun = useCallback(
    (difficulty: DifficultyId, trials: string[]) => sync(game.startRun(difficulty, trials)),
    [game, sync],
  );
  const enterNode = useCallback((id: string) => sync(game.enterNode(id)), [game, sync]);
  const dispatch = useCallback(
    (id: ActionId) => {
      const outcome = game.dispatch(id);
      sync(game.getState());
      return outcome;
    },
    [game, sync],
  );
  const acknowledgeResult = useCallback(() => sync(game.acknowledgeResult()), [game, sync]);
  const chooseCard = useCallback((defId: string) => sync(game.chooseCard(defId)), [game, sync]);
  const skipDraft = useCallback(() => sync(game.skipDraft()), [game, sync]);
  const unlockEvolution = useCallback((id: string) => sync(game.unlockEvolution(id)), [game, sync]);
  const finishEvolution = useCallback(() => sync(game.finishEvolution()), [game, sync]);
  const chooseEvent = useCallback((index: number) => sync(game.chooseEvent(index)), [game, sync]);
  const buyShopCard = useCallback((defId: string) => sync(game.buyShopCard(defId)), [game, sync]);
  const buyShopRelic = useCallback(() => sync(game.buyShopRelic()), [game, sync]);
  const leaveShop = useCallback(() => sync(game.leaveShop()), [game, sync]);
  const restChoose = useCallback(
    (option: 'heal' | 'repay' | 'upgrade') => sync(game.restChoose(option)),
    [game, sync],
  );
  const newRun = useCallback(() => sync(game.newRun()), [game, sync]);

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
