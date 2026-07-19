/**
 * ラン途中セーブ（RI-58）の正規化。
 *
 * 型定義は `src/sim/run/hydrateState.ts`。壊れた／非互換セーブは null（切り捨て）。
 */
import type { RunPhase } from '../sim/run/types';
import {
  isSaveablePhase,
  RUN_SAVE_ENGINE_VERSION,
  RUN_SAVE_SCHEMA_VERSION,
  type RunSaveBlob,
} from '../sim/run/hydrateState';

export type {
  RunSaveBlob,
  RunSaveGame,
  RunSavePrivate,
  RunSaveState,
} from '../sim/run/hydrateState';
export {
  isSaveablePhase,
  RUN_SAVE_ENGINE_VERSION,
  RUN_SAVE_SCHEMA_VERSION,
} from '../sim/run/hydrateState';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 壊れた／非互換セーブは null（切り捨て）。 */
export function normalizeRunSave(value: unknown): RunSaveBlob | null {
  if (!isObject(value)) return null;
  if (value.schemaVersion !== RUN_SAVE_SCHEMA_VERSION) return null;
  if (value.engineVersion !== RUN_SAVE_ENGINE_VERSION) return null;
  if (!isFiniteNumber(value.savedAt)) return null;

  const priv = value.private;
  const state = value.state;
  const game = value.game;
  if (!isObject(priv) || !isObject(state) || !isObject(game)) return null;

  if (!isStringArray(priv.allowedCards) || !isStringArray(priv.allowedRelics)) return null;
  if (!isObject(priv.baseConfig) || !isObject(priv.orgAdjust)) return null;
  if (
    !(priv.nextBudgetCap === null || isFiniteNumber(priv.nextBudgetCap)) ||
    !(priv.pauseAiDebuffQuarter === null || isFiniteNumber(priv.pauseAiDebuffQuarter))
  ) {
    return null;
  }
  if (!(priv.winEvalOrg === null || isObject(priv.winEvalOrg))) return null;

  if (typeof state.seed !== 'string' || typeof state.difficulty !== 'string') return null;
  if (!isStringArray(state.trials)) return null;
  if (typeof state.phase !== 'string' || !isSaveablePhase(state.phase as RunPhase)) return null;
  if (typeof state.status !== 'string') return null;
  if (typeof state.bossId !== 'string') return null;
  if (!isObject(state.org) || !Array.isArray(state.deck) || !isStringArray(state.relics)) {
    return null;
  }
  if (!isObject(state.evolution) || !isObject(state.roster)) return null;
  if (!isFiniteNumber(state.budget) || !isFiniteNumber(state.sprintsPlayed)) return null;
  if (!isObject(state.totals) || !isObject(state.quarterTotals)) return null;
  if (!isObject(state.quarterGoal) || !isObject(state.stakeholderTrust)) return null;
  if (!isObject(state.zoom) || typeof state.rankingKind !== 'string') return null;
  if (!Array.isArray(state.goalAdjustmentsTaken) || !Array.isArray(state.reviewHistory)) {
    return null;
  }

  if (typeof game.recorded !== 'boolean') return null;
  if (!(game.activeDailyDate === null || typeof game.activeDailyDate === 'string')) return null;

  return structuredClone(value) as RunSaveBlob;
}
