import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  defaultMeta,
  LEGACY_META_STORAGE_KEY,
  normalizeMeta,
  parseLegacyMeta,
  type MetaState,
} from './meta';

export const META_DB_NAME = 'devops-tycoon';
export const META_DB_VERSION = 1;
export const META_STORE_NAME = 'meta';
const META_RECORD_KEY = 'current';

interface MetaDatabase extends DBSchema {
  meta: {
    key: typeof META_RECORD_KEY;
    value: MetaState;
  };
}

/** メタ進行の非同期永続化インターフェース。 */
export interface MetaStorage {
  load(): Promise<MetaState | null>;
  save(meta: MetaState): Promise<void>;
}

export interface LegacyMetaStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

export interface MetaPersistenceBootstrap {
  meta: MetaState;
  storage: MetaStorage;
}

/** IndexedDB に単一の最新メタ状態を保存する。 */
export class IndexedDbMetaStorage implements MetaStorage {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly dbName: string = META_DB_NAME) {}

  private open(): Promise<IDBPDatabase<MetaDatabase>> {
    return openDB<MetaDatabase>(this.dbName, META_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(META_STORE_NAME)) {
          db.createObjectStore(META_STORE_NAME);
        }
      },
    });
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

function browserLegacyStorage(): LegacyMetaStorage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch {
    // Storage へのアクセス自体が拒否される環境がある。
  }
  return null;
}

function readLegacyMeta(storage: LegacyMetaStorage | null): {
  found: boolean;
  meta: MetaState | null;
} {
  if (!storage) return { found: false, meta: null };
  try {
    const raw = storage.getItem(LEGACY_META_STORAGE_KEY);
    return raw === null
      ? { found: false, meta: null }
      : { found: true, meta: parseLegacyMeta(raw) };
  } catch {
    return { found: false, meta: null };
  }
}

function removeLegacyMeta(storage: LegacyMetaStorage | null): void {
  try {
    storage?.removeItem(LEGACY_META_STORAGE_KEY);
  } catch {
    // IndexedDB への保存は完了しているため、削除失敗だけで起動を止めない。
  }
}

/**
 * IndexedDB を読み込み、空なら旧 localStorage を一度だけ移行する。
 * IndexedDB が既に存在する場合はそちらを正とし、旧データは破棄する。
 */
export async function initializeMetaPersistence(
  storage: MetaStorage = new IndexedDbMetaStorage(),
  legacyStorage: LegacyMetaStorage | null = browserLegacyStorage(),
): Promise<MetaPersistenceBootstrap> {
  const legacy = readLegacyMeta(legacyStorage);

  try {
    const persisted = await storage.load();
    if (persisted) {
      if (legacy.found) removeLegacyMeta(legacyStorage);
      return { meta: persisted, storage };
    }

    if (legacy.found) {
      const migrated = legacy.meta ?? defaultMeta();
      await storage.save(migrated);
      removeLegacyMeta(legacyStorage);
      return { meta: migrated, storage };
    }

    return { meta: defaultMeta(), storage };
  } catch {
    // IDB が使えない場合も旧セーブまたは初期値でゲームを起動する。
    return { meta: legacy.meta ?? defaultMeta(), storage };
  }
}
