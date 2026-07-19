/**
 * リプレイ保存（RI-61）のスキーマと正規化。
 *
 * ラン中のフェーズ境界キーフレームを終了時にまとめて保存し、閲覧時は
 * RunEngine.hydrate で read-only 表示する。純入力ログ再生は非スコープ。
 */
import type {
  DiagnosisType,
  DifficultyId,
  LoseReason,
  RunPhase,
  RunStatus,
  WinType,
} from '../sim/run/types';
import {
  RUN_SAVE_ENGINE_VERSION,
  RUN_SAVE_SCHEMA_VERSION,
  type RunSaveBlob,
} from '../sim/run/hydrateState';
import { normalizeRunSave } from './runSave';

/** リプレイスキーマ版。非互換時は破棄する。 */
export const REPLAY_SCHEMA_VERSION = 1;

/** 保持するリプレイ件数の上限（古いものから削除）。 */
export const REPLAY_MAX_COUNT = 10;

/** キーフレームとして残すフェーズ（容量抑制）。 */
export const REPLAY_KEYFRAME_PHASES: ReadonlySet<RunPhase> = new Set([
  'setup',
  'result',
  'quarterReview',
  'won',
  'lost',
]);

export interface ReplayOutcome {
  status: Extract<RunStatus, 'won' | 'lost'>;
  winType?: WinType;
  loseReason?: LoseReason;
  diagnosis: DiagnosisType;
  score: number;
}

export interface ReplayKeyframe {
  phase: RunPhase;
  label?: string;
  save: RunSaveBlob;
}

/** IndexedDB に保存するリプレイ本体。 */
export interface ReplayBlob {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
  engineVersion: typeof RUN_SAVE_ENGINE_VERSION;
  id: string;
  seed: string;
  difficulty: DifficultyId;
  trials: string[];
  finishedAt: number;
  outcome: ReplayOutcome;
  keyframes: ReplayKeyframe[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 壊れた／非互換リプレイは null。 */
export function normalizeReplay(value: unknown): ReplayBlob | null {
  if (!isObject(value)) return null;
  if (value.schemaVersion !== REPLAY_SCHEMA_VERSION) return null;
  if (value.engineVersion !== RUN_SAVE_ENGINE_VERSION) return null;
  if (typeof value.id !== 'string' || typeof value.seed !== 'string') return null;
  if (typeof value.difficulty !== 'string') return null;
  if (!Array.isArray(value.trials) || !value.trials.every((t) => typeof t === 'string')) {
    return null;
  }
  if (typeof value.finishedAt !== 'number' || !Number.isFinite(value.finishedAt)) return null;
  if (!isObject(value.outcome)) return null;
  if (value.outcome.status !== 'won' && value.outcome.status !== 'lost') return null;
  if (typeof value.outcome.diagnosis !== 'string') return null;
  if (typeof value.outcome.score !== 'number' || !Number.isFinite(value.outcome.score)) {
    return null;
  }
  if (!Array.isArray(value.keyframes) || value.keyframes.length === 0) return null;

  const keyframes: ReplayKeyframe[] = [];
  for (const raw of value.keyframes) {
    if (!isObject(raw) || typeof raw.phase !== 'string') return null;
    const save = normalizeRunSave(raw.save);
    if (!save) return null;
    keyframes.push({
      phase: raw.phase as RunPhase,
      label: typeof raw.label === 'string' ? raw.label : undefined,
      save,
    });
  }

  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    engineVersion: RUN_SAVE_ENGINE_VERSION,
    id: value.id,
    seed: value.seed,
    difficulty: value.difficulty as DifficultyId,
    trials: [...value.trials],
    finishedAt: value.finishedAt,
    outcome: {
      status: value.outcome.status,
      winType: value.outcome.winType as WinType | undefined,
      loseReason: value.outcome.loseReason as LoseReason | undefined,
      diagnosis: value.outcome.diagnosis as DiagnosisType,
      score: value.outcome.score,
    },
    keyframes,
  };
}

/** リプレイ ID を決定論的に組み立てる（同一終了なら上書きしやすい）。 */
export function buildReplayId(seed: string, finishedAt: number): string {
  return `${seed}:${finishedAt}`;
}

export { RUN_SAVE_SCHEMA_VERSION };
