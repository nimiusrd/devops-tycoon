/**
 * リプレイ保存（RI-61）のスキーマと正規化。
 *
 * ラン中のフェーズ境界キーフレームを終了時にまとめて保存し、閲覧時は
 * RunEngine.hydrateReplayFrame で read-only 表示する。純入力ログ再生は非スコープ。
 */
import { isReplayFramePhase, type RunReplayFrame, type ReplayFramePhase } from '../sim/run/persist';
import type {
  DiagnosisType,
  DifficultyId,
  LoseReason,
  RunPhase,
  RunStatus,
  WinType,
} from '../sim/run/types';

/** リプレイスキーマ版。非互換時は破棄する。 */
export const REPLAY_SCHEMA_VERSION = 1;

/** 保持するリプレイ件数の上限（古いものから削除）。 */
export const REPLAY_MAX_COUNT = 10;

export interface ReplayOutcome {
  status: Extract<RunStatus, 'won' | 'lost'>;
  winType?: WinType;
  loseReason?: LoseReason;
  diagnosis: DiagnosisType;
  score: number;
}

export interface ReplayKeyframe {
  phase: ReplayFramePhase;
  label?: string;
  frame: RunReplayFrame;
}

/** IndexedDB に保存するリプレイ本体。 */
export interface ReplayBlob {
  schemaVersion: typeof REPLAY_SCHEMA_VERSION;
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

function isReplayFrame(value: unknown): value is RunReplayFrame {
  if (!isObject(value)) return false;
  if (typeof value.phase !== 'string' || !isReplayFramePhase(value.phase as RunPhase)) {
    return false;
  }
  if (typeof value.seed !== 'string' || !isObject(value.extras)) return false;
  if (!Array.isArray(value.extras.allowedCards) || !Array.isArray(value.extras.allowedRelics)) {
    return false;
  }
  return true;
}

/** 壊れた／非互換リプレイは null。 */
export function normalizeReplay(value: unknown): ReplayBlob | null {
  if (!isObject(value)) return null;
  if (value.schemaVersion !== REPLAY_SCHEMA_VERSION) return null;
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
    if (!isReplayFramePhase(raw.phase as RunPhase)) return null;
    if (!isReplayFrame(raw.frame)) return null;
    keyframes.push({
      phase: raw.phase as ReplayFramePhase,
      label: typeof raw.label === 'string' ? raw.label : undefined,
      frame: structuredClone(raw.frame),
    });
  }

  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
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

/** リプレイ ID を組み立てる。 */
export function buildReplayId(seed: string, finishedAt: number): string {
  return `${seed}:${finishedAt}`;
}
