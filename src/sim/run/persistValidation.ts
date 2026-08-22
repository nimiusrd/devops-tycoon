/**
 * 永続スナップショットを実際の hydrate 経路へ通して検証する。
 *
 * JSON の構造を型アサーションだけで受け入れると、必須配列が null でも
 * parser を通過してしまう。保存済みデータを変更せず、専用エンジンで
 * hydrate できるかだけを確認する。
 */
import { createRunEngine } from './engine';
import type { RunPersistState, RunReplayFrame } from './persist';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** フェーズ画面が要求する保存済みデータの存在を検証する。 */
export function hasRequiredPersistPhaseState(
  state: Pick<
    RunPersistState | RunReplayFrame,
    'phase' | 'lastResult' | 'draft' | 'beat' | 'shop' | 'quarterReview'
  >,
): boolean {
  switch (state.phase) {
    case 'result':
      return isObject(state.lastResult);
    case 'draft':
      return Array.isArray(state.draft);
    case 'beat':
      return isObject(state.beat);
    case 'shop':
      return isObject(state.shop);
    case 'quarterReview':
      return isObject(state.quarterReview);
    default:
      return true;
  }
}

export function canHydratePersistState(state: RunPersistState): boolean {
  try {
    if (!hasRequiredPersistPhaseState(state)) return false;
    const engine = createRunEngine({
      seed: state.seed,
      difficulty: state.difficulty,
      trials: state.trials,
    });
    engine.hydratePersistState(state);
    engine.snapshot();
    return true;
  } catch {
    return false;
  }
}

export function canHydrateReplayFrame(frame: RunReplayFrame): boolean {
  try {
    if (!hasRequiredPersistPhaseState(frame)) return false;
    const engine = createRunEngine({
      seed: frame.seed,
      difficulty: frame.difficulty,
      trials: frame.trials,
    });
    engine.hydrateReplayFrame(frame);
    engine.snapshot();
    return true;
  } catch {
    return false;
  }
}
