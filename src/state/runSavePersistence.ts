/**
 * ラン途中セーブの IndexedDB 永続化（RI-58）。
 */
import type { IDBPDatabase } from 'idb';
import {
  GAME_DB_NAME,
  openGameDb,
  RUN_SAVE_RECORD_KEY,
  RUN_SAVE_STORE_NAME,
  type GameDatabase,
} from './gameDb';
import { normalizeRunSave, type RunSaveBlob } from './runSave';

/** ランセーブの非同期永続化インターフェース。 */
export interface RunSaveStorage {
  load(): Promise<RunSaveBlob | null>;
  save(blob: RunSaveBlob): Promise<void>;
  clear(): Promise<void>;
}

/** IndexedDB に単一スロットのランセーブを保存する。 */
export class IndexedDbRunSaveStorage implements RunSaveStorage {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly dbName: string = GAME_DB_NAME) {}

  private open(): Promise<IDBPDatabase<GameDatabase>> {
    return openGameDb(this.dbName);
  }

  async load(): Promise<RunSaveBlob | null> {
    await this.writes.catch(() => undefined);
    const db = await this.open();
    try {
      const stored = await db.get(RUN_SAVE_STORE_NAME, RUN_SAVE_RECORD_KEY);
      return stored === undefined ? null : normalizeRunSave(stored);
    } finally {
      db.close();
    }
  }

  save(blob: RunSaveBlob): Promise<void> {
    const snapshot = structuredClone(blob);
    const write = this.writes.then(async () => {
      const db = await this.open();
      try {
        await db.put(RUN_SAVE_STORE_NAME, snapshot, RUN_SAVE_RECORD_KEY);
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  clear(): Promise<void> {
    const write = this.writes.then(async () => {
      const db = await this.open();
      try {
        await db.delete(RUN_SAVE_STORE_NAME, RUN_SAVE_RECORD_KEY);
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
}
