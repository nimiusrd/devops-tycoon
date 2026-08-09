import type { IDBPDatabase } from 'idb';
import { defaultMeta, normalizeMeta, type MetaState } from './meta';
import {
  GAME_DB_NAME,
  META_RECORD_KEY,
  META_STORE_NAME,
  openGameDb,
  type GameDatabase,
} from './gameDb';

/** メタ進行の非同期永続化インターフェース。 */
export interface MetaStorage {
  load(): Promise<MetaState | null>;
  save(meta: MetaState): Promise<void>;
}

export interface MetaPersistenceBootstrap {
  meta: MetaState;
  storage: MetaStorage;
}

/** IndexedDB に単一の最新メタ状態を保存する。 */
export class IndexedDbMetaStorage implements MetaStorage {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly dbName: string = GAME_DB_NAME) {}

  private open(): Promise<IDBPDatabase<GameDatabase>> {
    return openGameDb(this.dbName);
  }

  async load(): Promise<MetaState | null> {
    await this.writes.catch(() => undefined);
    const db = await this.open();
    try {
      const stored = await db.get(META_STORE_NAME, META_RECORD_KEY);
      return stored === undefined ? null : normalizeMeta(stored);
    } finally {
      db.close();
    }
  }

  save(meta: MetaState): Promise<void> {
    const snapshot = structuredClone(meta);
    const write = this.writes.then(async () => {
      const db = await this.open();
      try {
        await db.put(META_STORE_NAME, snapshot, META_RECORD_KEY);
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
}

/**
 * IndexedDB からメタ状態を読み込む。空なら初期値で始める。
 *
 * 保存先は IndexedDB のみ。localStorage への移行・フォールバックは廃止した。
 * IndexedDB が使えない環境では初期値で起動し、保存は行われない
 * （`game.ts` の persistMeta が save の失敗を握りつぶす）。
 */
export async function initializeMetaPersistence(
  storage: MetaStorage = new IndexedDbMetaStorage(),
): Promise<MetaPersistenceBootstrap> {
  try {
    const persisted = await storage.load();
    return { meta: persisted ?? defaultMeta(), storage };
  } catch {
    return { meta: defaultMeta(), storage };
  }
}
