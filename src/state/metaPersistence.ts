import type { IDBPDatabase } from 'idb';
import {
  defaultMeta,
  LEGACY_META_STORAGE_KEY,
  normalizeMeta,
  parseLegacyMeta,
  type MetaState,
} from './meta';
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

export interface LegacyMetaStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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

/** IndexedDB が利用できない環境で旧キーへの保存を継続する。 */
class LocalStorageMetaStorage implements MetaStorage {
  constructor(private readonly storage: LegacyMetaStorage) {}

  async load(): Promise<MetaState | null> {
    const raw = this.storage.getItem(LEGACY_META_STORAGE_KEY);
    return raw === null ? null : parseLegacyMeta(raw);
  }

  async save(meta: MetaState): Promise<void> {
    this.storage.setItem(LEGACY_META_STORAGE_KEY, JSON.stringify(meta));
  }
}

function browserLegacyStorage(): LegacyMetaStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Storage へのアクセス自体が拒否される環境がある。
  }
  return null;
}

/**
 * IndexedDB からメタ状態を読み込む。空なら初期値で始める。
 *
 * 旧 localStorage からの移行は完了済みのため行わない（移行は #166 で導入し、
 * その後の起動で消化された）。IndexedDB が使えない環境では localStorage へ
 * 保存を継続する。
 */
export async function initializeMetaPersistence(
  storage: MetaStorage = new IndexedDbMetaStorage(),
  legacyStorage: LegacyMetaStorage | null = browserLegacyStorage(),
): Promise<MetaPersistenceBootstrap> {
  try {
    const persisted = await storage.load();
    return { meta: persisted ?? defaultMeta(), storage };
  } catch {
    // IDB が使えない環境では localStorage が唯一の保存先なので、既存の保存を読んで継続する。
    if (!legacyStorage) return { meta: defaultMeta(), storage };
    const fallback = new LocalStorageMetaStorage(legacyStorage);
    return { meta: (await fallback.load()) ?? defaultMeta(), storage: fallback };
  }
}
