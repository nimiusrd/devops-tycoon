/**
 * 永続スナップショットを実際の hydrate 経路へ通して検証する。
 *
 * JSON の構造を型アサーションだけで受け入れると、必須配列が null でも
 * parser を通過してしまう。保存済みデータを変更せず、専用エンジンで
 * hydrate できるかだけを確認する。
 */
import { createRunEngine } from './engine';
import type { RunPersistState, RunReplayFrame } from './persist';

export function canHydratePersistState(state: RunPersistState): boolean {
  try {
    const engine = createRunEngine({
      seed: state.seed,
      difficulty: state.difficulty,
      trials: state.trials,
    });
    engine.hydratePersistState(state);
    return true;
  } catch {
    return false;
  }
}

export function canHydrateReplayFrame(frame: RunReplayFrame): boolean {
  try {
    const engine = createRunEngine({
      seed: frame.seed,
      difficulty: frame.difficulty,
      trials: frame.trials,
    });
    engine.hydrateReplayFrame(frame);
    return true;
  } catch {
    return false;
  }
}
