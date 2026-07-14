import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { LEGACY_META_STORAGE_KEY, defaultMeta, type MetaState } from '../../src/state/meta';
import {
  IndexedDbMetaStorage,
  initializeMetaPersistence,
  type LegacyMetaStorage,
  type MetaStorage,
} from '../../src/state/metaPersistence';

const databases: string[] = [];

function indexedDbStorage(): IndexedDbMetaStorage {
  const name = `devops-tycoon-test-${databases.length}`;
  databases.push(name);
  return new IndexedDbMetaStorage(name);
}

function legacyStorage(raw?: string): LegacyMetaStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (raw !== undefined) data.set(LEGACY_META_STORAGE_KEY, raw);
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    removeItem: (key) => void data.delete(key),
  };
}

afterEach(async () => {
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
  });
});
