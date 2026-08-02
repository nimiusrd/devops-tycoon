/**
 * ラン途中セーブの永続化（RI-58 / SPEC 第17・22章）。
 *
 * 保存形式は RunEngine のスナップショット直列化（案 A）。
 * seed＋入力ログ再生（案 B）は RI-61 のリプレイ用に切り出す。
 * フェーズ遷移時のみ保存し、スプリント tick 中は更新しない。
 */
import { isRunSavePhase, type RunPersistState, type RunSavePhase } from '../sim/run/persist';
import type { DifficultyId, RunKind, RunPhase, RunStatus } from '../sim/run/types';
import { GAME_DB_NAME, openGameDb, RUN_RECORD_KEY, RUN_STORE_NAME } from './gameDb';
import { normalizeReplayKeyframes, type ReplayKeyframe } from './replay';

export type { RunPersistState, RunPersistExtras, RunSavePhase } from '../sim/run/persist';
export { isRunSavePhase } from '../sim/run/persist';

/** RI-68: Delivery 目標が四半期累計スケールになったため v1/v2 は非互換。 */
export const RUN_SAVE_SCHEMA_VERSION = 3 as const;

/** タイトル「続きから」表示用の要約。 */
export interface RunSaveSummary {
  seed: string;
  difficulty: DifficultyId;
  trials: string[];
  runKind: RunKind;
  dailyDate?: string;
  phase: RunSavePhase;
  quarterNumber: number;
  sprintIndexInQuarter: number;
  sprintsPlayed: number;
  status: RunStatus;
}

/** IndexedDB に載せるレコード。 */
export interface RunSave {
  schemaVersion: typeof RUN_SAVE_SCHEMA_VERSION;
  savedAt: number;
  summary: RunSaveSummary;
  state: RunPersistState;
  /**
   * 再開後も完走リプレイが前半を保持できるよう、収集済みキーフレームを同梱する（RI-61）。
   * 旧セーブでは欠落しうる（その場合は空配列）。
   */
  replayKeyframes: ReplayKeyframe[];
}

export interface RunStorage {
  load(): Promise<RunSave | null>;
  save(save: RunSave): Promise<void>;
  clear(): Promise<void>;
}

export interface RunPersistenceBootstrap {
  save: RunSave | null;
  storage: RunStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDifficulty(value: unknown): value is DifficultyId {
  return value === 'easy' || value === 'normal' || value === 'hard' || value === 'nightmare';
}

function isRunKind(value: unknown): value is RunKind {
  return value === 'normal' || value === 'daily';
}

function isRunStatus(value: unknown): value is RunStatus {
  return value === 'playing' || value === 'won' || value === 'lost';
}

/** 構造が壊れている／非互換なセーブは null（呼び出し側で clear）。 */
export function parseRunSave(raw: unknown): RunSave | null {
  if (!isRecord(raw)) return null;
  // v1/v2 → v3: Delivery KPI スケール変更により旧セーブは破棄する（RI-68）。
  const schema = raw.schemaVersion;
  if (schema !== RUN_SAVE_SCHEMA_VERSION) return null;
  if (typeof raw.savedAt !== 'number' || !Number.isFinite(raw.savedAt)) return null;
  if (!isRecord(raw.summary) || !isRecord(raw.state)) return null;

  const summary = raw.summary;
  const state = raw.state;
  if (typeof summary.seed !== 'string') return null;
  if (!isDifficulty(summary.difficulty)) return null;
  if (!Array.isArray(summary.trials) || !summary.trials.every((t) => typeof t === 'string')) {
    return null;
  }
  if (!isRunKind(summary.runKind)) return null;
  if (summary.dailyDate !== undefined && typeof summary.dailyDate !== 'string') return null;
  if (typeof summary.phase !== 'string' || !isRunSavePhase(summary.phase as RunPhase)) return null;
  if (typeof summary.quarterNumber !== 'number') return null;
  if (typeof summary.sprintIndexInQuarter !== 'number') return null;
  if (typeof summary.sprintsPlayed !== 'number') return null;
  if (!isRunStatus(summary.status) || summary.status !== 'playing') return null;

  if (typeof state.phase !== 'string' || !isRunSavePhase(state.phase as RunPhase)) return null;
  if (state.phase !== summary.phase) return null;
  if (!isRunStatus(state.status) || state.status !== 'playing') return null;
  if (typeof state.seed !== 'string' || state.seed !== summary.seed) return null;
  if (!isRecord(state.extras)) return null;
  if (!Array.isArray(state.extras.allowedCards)) return null;
  if (!Array.isArray(state.extras.allowedRelics)) return null;
  if (!isRecord(state.extras.baseConfig)) return null;
  if (!isRecord(state.extras.orgAdjust)) return null;

  // セーブ時は sprint を落とす契約。残っていても復元側で無視する。
  return {
    schemaVersion: RUN_SAVE_SCHEMA_VERSION,
    savedAt: raw.savedAt,
    summary: {
      seed: summary.seed,
      difficulty: summary.difficulty,
      trials: [...summary.trials],
      runKind: summary.runKind,
      dailyDate: summary.dailyDate,
      phase: summary.phase as RunSavePhase,
      quarterNumber: summary.quarterNumber,
      sprintIndexInQuarter: summary.sprintIndexInQuarter,
      sprintsPlayed: summary.sprintsPlayed,
      status: 'playing',
    },
    state: state as unknown as RunPersistState,
    replayKeyframes: normalizeReplayKeyframes(raw.replayKeyframes),
  };
}

/** PersistState から IndexedDB レコードを組み立てる。 */
export function toRunSave(
  state: RunPersistState,
  savedAt: number = Date.now(),
  replayKeyframes: readonly ReplayKeyframe[] = [],
): RunSave {
  return {
    schemaVersion: RUN_SAVE_SCHEMA_VERSION,
    savedAt,
    summary: {
      seed: state.seed,
      difficulty: state.difficulty,
      trials: [...state.trials],
      runKind: state.runKind,
      dailyDate: state.dailyDate,
      phase: state.phase,
      quarterNumber: state.quarterNumber,
      sprintIndexInQuarter: state.sprintIndexInQuarter,
      sprintsPlayed: state.sprintsPlayed,
      status: state.status,
    },
    state: structuredClone(state),
    replayKeyframes: structuredClone(replayKeyframes) as ReplayKeyframe[],
  };
}

/** IndexedDB に単一の最新ランセーブを保存する。 */
export class IndexedDbRunStorage implements RunStorage {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly dbName: string = GAME_DB_NAME) {}

  async load(): Promise<RunSave | null> {
    await this.writes.catch(() => undefined);
    const db = await openGameDb(this.dbName);
    try {
      const stored = await db.get(RUN_STORE_NAME, RUN_RECORD_KEY);
      if (stored === undefined) return null;
      const parsed = parseRunSave(stored);
      if (!parsed) {
        await db.delete(RUN_STORE_NAME, RUN_RECORD_KEY);
        return null;
      }
      return parsed;
    } finally {
      db.close();
    }
  }

  save(save: RunSave): Promise<void> {
    const snapshot = structuredClone(save);
    const write = this.writes.then(async () => {
      const db = await openGameDb(this.dbName);
      try {
        await db.put(RUN_STORE_NAME, snapshot, RUN_RECORD_KEY);
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  clear(): Promise<void> {
    const write = this.writes.then(async () => {
      const db = await openGameDb(this.dbName);
      try {
        await db.delete(RUN_STORE_NAME, RUN_RECORD_KEY);
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
}

/** メモリ上だけで動く RunStorage（テスト / IDB 不可時）。 */
export class MemoryRunStorage implements RunStorage {
  private saveState: RunSave | null = null;

  async load(): Promise<RunSave | null> {
    return this.saveState ? structuredClone(this.saveState) : null;
  }

  async save(save: RunSave): Promise<void> {
    this.saveState = structuredClone(save);
  }

  async clear(): Promise<void> {
    this.saveState = null;
  }
}

/**
 * ランセーブを読み込む。非互換・破損時は破棄して null。
 * IndexedDB が使えない場合は空の MemoryRunStorage で続行する。
 */
export async function initializeRunPersistence(
  storage: RunStorage = new IndexedDbRunStorage(),
): Promise<RunPersistenceBootstrap> {
  try {
    const save = await storage.load();
    return { save, storage };
  } catch {
    return { save: null, storage: new MemoryRunStorage() };
  }
}
