/**
 * スプリント自動進行フック。
 *
 * `window.game`（決定論エンジン）を固定タイムステップで前進させ、React に
 * 最新スナップショットを供給する。描画は状態を読むだけ（第22.2）。
 * 一時停止中（E2E が `window.game.pause()` した時）は前進しないため、
 * Playwright から seed＋手動 step でフレームを固定できる（第22.5）。
 */
import { useCallback, useEffect, useState } from 'react';
import type { GameHandle } from '../game';
import type { SimState, SprintResult } from '../sim/types';

/** 自動進行の更新間隔（ms）。 */
const FRAME_MS = 60;
/** 1 フレームで進めるシミュレーション時間（ms）= 固定ステップ 1 tick。 */
const SIM_STEP_MS = 100;

export interface UseSprint {
  state: SimState;
  complete: boolean;
  result: SprintResult | null;
  aiEnabled: boolean;
  setAiEnabled: (enabled: boolean) => void;
  restart: () => void;
}

export function useSprint(game: GameHandle): UseSprint {
  const [state, setState] = useState<SimState>(() => game.getState());

  useEffect(() => {
    const id = window.setInterval(() => {
      if (game.isPaused() || game.isComplete()) return;
      setState(game.step(SIM_STEP_MS));
    }, FRAME_MS);
    return () => window.clearInterval(id);
  }, [game]);

  const setAiEnabled = useCallback(
    (enabled: boolean) => {
      setState(game.setAiEnabled(enabled));
    },
    [game],
  );

  const restart = useCallback(() => {
    setState(game.loadState(state.seed, state.scenario, state.aiEnabled));
  }, [game, state.seed, state.scenario, state.aiEnabled]);

  const complete = state.sprint.complete;
  const result = complete ? game.result() : null;

  return {
    state,
    complete,
    result,
    aiEnabled: state.aiEnabled,
    setAiEnabled,
    restart,
  };
}
