import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_META_STORAGE_KEY, defaultMeta, type MetaState } from '../../src/state/meta';
import { META_RECORD_KEY, META_STORE_NAME, openGameDb } from '../../src/state/gameDb';
import {
  IndexedDbMetaStorage,
  initializeMetaPersistence,
  type LegacyMetaStorage,
  type MetaStorage,
} from '../../src/state/metaPersistence';

const databases: string[] = [];

function indexedDbStorageEntry(): { name: string; storage: IndexedDbMetaStorage } {
  const name = `devops-tycoon-test-${databases.length}`;
  databases.push(name);
  return { name, storage: new IndexedDbMetaStorage(name) };
}

function indexedDbStorage(): IndexedDbMetaStorage {
  return indexedDbStorageEntry().storage;
}

function legacyStorage(raw?: string): LegacyMetaStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (raw !== undefined) data.set(LEGACY_META_STORAGE_KEY, raw);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

describe('IndexedDB メタ永続化（RI-57）', () => {
  it('保存を直列化し、最後の状態を往復できる', async () => {
    const storage = indexedDbStorage();
    const first = { ...defaultMeta(), points: 10 };
    const latest = { ...defaultMeta(), points: 25, achievements: ['first-clear'] };

    await Promise.all([storage.save(first), storage.save(latest)]);

    expect(await storage.load()).toEqual(latest);
  });

  it('IndexedDB が空なら旧 localStorage を補完して移行し、旧キーを削除する', async () => {
    const storage = indexedDbStorage();
    const legacy = legacyStorage(
      JSON.stringify({
        points: 42,
        unlockedDifficulties: ['easy', 'normal'],
        achievements: ['first-clear'],
      }),
    );

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual({
      ...defaultMeta(),
      points: 42,
      achievements: ['first-clear'],
    });
    expect(await storage.load()).toEqual(initialized.meta);
    expect(legacy.data.has(LEGACY_META_STORAGE_KEY)).toBe(false);
  });

  it('IndexedDB にデータがあれば旧データを捨てて旧キーを削除する', async () => {
    const storage = indexedDbStorage();
    const persisted = { ...defaultMeta(), points: 80, unlockedCards: ['devin'] };
    await storage.save(persisted);
    const legacy = legacyStorage(JSON.stringify({ ...defaultMeta(), points: 999 }));

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual(persisted);
    expect(legacy.data.has(LEGACY_META_STORAGE_KEY)).toBe(false);
  });

  it('IndexedDB 上の壊れたメタは初期値に正規化し、旧データで上書きしない', async () => {
    const { name, storage } = indexedDbStorageEntry();
    const db = await openGameDb(name);
    await db.put(META_STORE_NAME, 'corrupted-meta' as unknown as MetaState, META_RECORD_KEY);
    db.close();
    const legacy = legacyStorage(JSON.stringify({ ...defaultMeta(), points: 999 }));

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual(defaultMeta());
    expect(await storage.load()).toEqual(defaultMeta());
    expect(legacy.data.has(LEGACY_META_STORAGE_KEY)).toBe(false);
  });

  it('壊れた旧 JSON は初期値として移行し、起動ごとに再処理しない', async () => {
    const storage = indexedDbStorage();
    const legacy = legacyStorage('{invalid-json');

    const first = await initializeMetaPersistence(storage, legacy);
    const second = await initializeMetaPersistence(storage, legacy);

    expect(first.meta).toEqual(defaultMeta());
    expect(second.meta).toEqual(defaultMeta());
    expect(await storage.load()).toEqual(defaultMeta());
    expect(legacy.data.has(LEGACY_META_STORAGE_KEY)).toBe(false);
  });

  it('旧キー削除が失敗しても移行済みメタで起動し、IndexedDB 保存を優先する', async () => {
    const storage = indexedDbStorage();
    const expected = { ...defaultMeta(), points: 64 };
    const legacy = legacyStorage(JSON.stringify(expected));
    legacy.removeItem = () => {
      throw new Error('legacy storage is locked');
    };

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual(expected);
    expect(await storage.load()).toEqual(expected);
    expect(legacy.data.get(LEGACY_META_STORAGE_KEY)).toBe(JSON.stringify(expected));
  });

  it('既存 IndexedDB があり旧キーが無い場合は旧削除を呼ばず保存済みメタを返す', async () => {
    const storage = indexedDbStorage();
    const persisted = { ...defaultMeta(), points: 88 };
    await storage.save(persisted);
    let removeCalls = 0;
    const legacy: LegacyMetaStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('unexpected setItem');
      },
      removeItem: () => {
        removeCalls += 1;
      },
    };

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual(persisted);
    expect(removeCalls).toBe(0);
  });

  it('IndexedDB が空で旧キーも無い場合は保存せず初期値で起動する', async () => {
    let saveCalls = 0;
    const storage: MetaStorage = {
      load: async () => null,
      save: async () => {
        saveCalls += 1;
      },
    };
    const legacy = legacyStorage();

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual(defaultMeta());
    expect(initialized.storage).toBe(storage);
    expect(saveCalls).toBe(0);
    expect(legacy.data.has(LEGACY_META_STORAGE_KEY)).toBe(false);
  });

  it('既定のブラウザ旧ストレージを移行元として使う', async () => {
    const storage = indexedDbStorage();
    const expected = { ...defaultMeta(), points: 53 };
    const legacy = legacyStorage(JSON.stringify(expected));
    vi.stubGlobal('window', { localStorage: legacy });

    const initialized = await initializeMetaPersistence(storage);

    expect(initialized.meta).toEqual(expected);
    expect(await storage.load()).toEqual(expected);
    expect(legacy.data.has(LEGACY_META_STORAGE_KEY)).toBe(false);
  });

  it('IndexedDB の読み込み失敗時は旧セーブで起動し、旧キーを残す', async () => {
    const failure = new Error('IndexedDB unavailable');
    const storage: MetaStorage = {
      load: async () => {
        throw failure;
      },
      save: async () => {
        throw failure;
      },
    };
    const expected: MetaState = { ...defaultMeta(), points: 12 };
    const legacy = legacyStorage(JSON.stringify(expected));

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual(expected);
    expect(legacy.data.has(LEGACY_META_STORAGE_KEY)).toBe(true);
    await initialized.storage.save({ ...expected, points: 24 });
    expect(JSON.parse(legacy.data.get(LEGACY_META_STORAGE_KEY)!)).toMatchObject({ points: 24 });
    expect(await initialized.storage.load()).toMatchObject({ points: 24 });
  });

  it('旧セーブの IndexedDB 保存に失敗した場合も旧キーを残す', async () => {
    const storage: MetaStorage = {
      load: async () => null,
      save: async () => {
        throw new Error('quota exceeded');
      },
    };
    const expected = { ...defaultMeta(), points: 30 };
    const legacy = legacyStorage(JSON.stringify(expected));

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual(expected);
    expect(legacy.data.has(LEGACY_META_STORAGE_KEY)).toBe(true);
    await initialized.storage.save({ ...expected, points: 45 });
    expect(JSON.parse(legacy.data.get(LEGACY_META_STORAGE_KEY)!)).toMatchObject({ points: 45 });
  });

  it('IndexedDB 失敗かつ旧キーが無い場合は fallback 先の旧ストレージから null を読める', async () => {
    const storage: MetaStorage = {
      load: async () => {
        throw new Error('IndexedDB unavailable');
      },
      save: async () => {
        throw new Error('unexpected save');
      },
    };
    const legacy = legacyStorage();

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual(defaultMeta());
    expect(initialized.storage).not.toBe(storage);
    expect(await initialized.storage.load()).toBeNull();
    await initialized.storage.save({ ...defaultMeta(), points: 7 });
    expect(await initialized.storage.load()).toMatchObject({ points: 7 });
  });

  it('IndexedDB 失敗かつ legacyStorage が無い場合は元 storage と初期値で起動する', async () => {
    const storage: MetaStorage = {
      load: async () => {
        throw new Error('IndexedDB unavailable');
      },
      save: async () => {
        throw new Error('still unavailable');
      },
    };

    const initialized = await initializeMetaPersistence(storage, null);

    expect(initialized.meta).toEqual(defaultMeta());
    expect(initialized.storage).toBe(storage);
  });

  it('旧ストレージ読み込みが例外なら旧データ無しとして扱い、移行保存しない', async () => {
    let saveCalls = 0;
    const storage: MetaStorage = {
      load: async () => null,
      save: async () => {
        saveCalls += 1;
      },
    };
    const legacy: LegacyMetaStorage = {
      getItem: () => {
        throw new Error('legacy read denied');
      },
      setItem: () => {
        throw new Error('unexpected setItem');
      },
      removeItem: () => {
        throw new Error('unexpected removeItem');
      },
    };

    const initialized = await initializeMetaPersistence(storage, legacy);

    expect(initialized.meta).toEqual(defaultMeta());
    expect(initialized.storage).toBe(storage);
    expect(saveCalls).toBe(0);
  });
});
