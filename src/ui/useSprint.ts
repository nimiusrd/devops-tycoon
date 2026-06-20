/**
 * スプリント自動進行フック。
 *
 * `window.game`（決定論エンジン）を固定タイムステップで前進させ、React に
 * 最新スナップショットを供給する。描画は状態を読むだけ（第22.2）。
 * 一時停止中（E2E が `window.game.pause()` した時）は前進しないため、
 * Playwright から seed＋手動 step でフレームを固定できる（第22.5）。
 * Phase 2 では介入アクションの発動とドラフト（カード選択）も仲介する。
 */
import { useCallback, useEffect, useState } from 'react';
import type { GameHandle } from '../game';
import type {
  ActionId,
  CardInstance,
  InterventionOutcome,
  SimState,
  SprintResult,
} from '../sim/types';

/** 自動進行の更新間隔（ms）。 */
const FRAME_MS = 60;
/** 1 フレームで進めるシミュレーション時間（ms）= 固定ステップ 1 tick。 */
const SIM_STEP_MS = 100;

export interface UseSprint {
  state: SimState;
  complete: boolean;
  result: SprintResult | null;
  aiEnabled: boolean;
  /** 現在のデッキ。 */
  deck: CardInstance[];
  /** スプリント完了時のドラフト候補（カード定義 ID）。未完了は null。 */
  draft: string[] | null;
  setAiEnabled: (enabled: boolean) => void;
  /** 介入アクションを発動する（第6章）。 */
  dispatch: (id: ActionId) => InterventionOutcome;
  /** ドラフトでカードを選び、次スプリントを開始する。 */
  chooseCard: (defId: string) => void;
  /** ドラフトをスキップして次スプリントを開始する。 */
  skipDraft: () => void;
  /** 同じ条件で最初からやり直す（ラン初期化）。 */
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

  const dispatch = useCallback(
    (id: ActionId) => {
      const outcome = game.dispatch(id);
      // 発動結果を即座に反映（一時停止中でも手応えが出る）。
      setState(game.getState());
      return outcome;
    },
    [game],
  );

  const chooseCard = useCallback(
    (defId: string) => {
      setState(game.chooseCard(defId));
    },
    [game],
  );

  const skipDraft = useCallback(() => {
    setState(game.skipDraft());
  }, [game]);

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
    deck: state.deck,
    draft: state.draft,
    setAiEnabled,
    dispatch,
    chooseCard,
    skipDraft,
    restart,
  };
}
