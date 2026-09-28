import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { META_RECORD_KEY, META_STORE_NAME, openGameDb } from '../../../src/state/gameDb';
import { defaultMeta, type MetaState } from '../../../src/state/meta';
import {
  IndexedDbMetaStorage,
  initializeMetaPersistence,
  MemoryMetaStorage,
  type MetaStorage,
} from '../../../src/state/metaPersistence';

import 'fake-indexeddb/auto';

const databases: string[] = [];

function indexedDbStorageEntry(): { name: string; storage: IndexedDbMetaStorage } {
  const name = `devops-tycoon-test-${databases.length}`;
  databases.push(name);
  return { name, storage: new IndexedDbMetaStorage(name) };
}

function indexedDbStorage(): IndexedDbMetaStorage {
  return indexedDbStorageEntry().storage;
}

function fakeIdb(options: {
  load?: 'throw' | 'null' | MetaState;
  save?: 'ok' | 'throw';
}): MetaStorage & { saveCalls: number } {
  const storage: MetaStorage & { saveCalls: number } = {
    saveCalls: 0,
    load: async () => {
      if (options.load === 'throw') throw new Error('IndexedDB unavailable');
      if (options.load === 'null' || options.load === undefined) return null;
      return options.load;
    },
    save: async () => {
      storage.saveCalls += 1;
      if (options.save === 'throw') throw new Error('quota exceeded');
    },
  };
  return storage;
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

  it('insertIfAbsent は空のときだけ書き、既存レコードは上書きしない', async () => {
    const storage = indexedDbStorage();
    const first = { ...defaultMeta(), points: 10 };
    expect(await storage.insertIfAbsent(first)).toBeNull();
    expect(await storage.load()).toEqual(first);

    const other = { ...defaultMeta(), points: 99 };
    expect((await storage.insertIfAbsent(other))?.points).toBe(10);
    expect((await storage.load())?.points).toBe(10);
  });

  it('replaceIfMatches は一致する記録だけを替え、消えた記録には次を書く', async () => {
    const { name: dbName, storage } = indexedDbStorageEntry();
    const first = { ...defaultMeta(), points: 10 };
    const second = { ...defaultMeta(), points: 20 };
    const third = { ...defaultMeta(), points: 30 };
    const fourth = { ...defaultMeta(), points: 40 };

    expect(await storage.replaceIfMatches(null, first)).toBeNull();
    expect(await storage.load()).toEqual(first);
    expect(await storage.replaceIfMatches(first, second)).toBeNull();
    expect((await storage.load())?.points).toBe(20);
    expect((await storage.replaceIfMatches(first, third))?.points).toBe(20);
    expect((await storage.load())?.points).toBe(20);

    const opened = await openGameDb(dbName);
    await opened.delete(META_STORE_NAME, META_RECORD_KEY);
    opened.close();
    expect(await storage.replaceIfMatches(second, fourth)).toBeNull();
    expect((await storage.load())?.points).toBe(40);
  });

  it('メモリの replaceIfMatches は一致したときだけ save し、別の記録は残す', async () => {
    const storage = new MemoryMetaStorage();
    const first = { ...defaultMeta(), points: 10 };
    const second = { ...defaultMeta(), points: 20 };
    const foreign = { ...defaultMeta(), points: 77 };
    expect(await storage.replaceIfMatches(null, first)).toBeNull();
    expect(await storage.replaceIfMatches(first, second)).toBeNull();
    expect((await storage.load())?.points).toBe(20);
    await storage.save(foreign);
    expect((await storage.replaceIfMatches(second, first))?.points).toBe(77);
    expect((await storage.load())?.points).toBe(77);
  });
});

describe('initializeMetaPersistence', () => {
  it('保存済みメタがあればそれを返し、追加保存はしない', async () => {
    const persisted = { ...defaultMeta(), points: 55 };
    const storage = fakeIdb({ load: persisted, save: 'ok' });

    await expect(initializeMetaPersistence(storage)).resolves.toEqual({
      meta: persisted,
      storage,
      sessionOnly: false,
      durableStorage: storage,
    });
    expect(storage.saveCalls).toBe(0);
  });

  it('保存が空なら初期値で起動し、保存はしない', async () => {
    const storage = fakeIdb({ load: 'null', save: 'ok' });

    const initialized = await initializeMetaPersistence(storage);

    expect(initialized.meta).toEqual(defaultMeta());
    expect(initialized.storage).toBe(storage);
    expect(storage.saveCalls).toBe(0);
  });

  it('読み込みに失敗したら初期値で起動し、保存先をメモリへ切り替える', async () => {
    // 一過性の失敗で初期値から再開したあと、その状態を既存レコードへ
    // 書き戻さないよう、読めなかった storage は以降の保存に使わない。
    const storage = fakeIdb({ load: 'throw', save: 'ok' });

    const initialized = await initializeMetaPersistence(storage);

    expect(initialized.meta).toEqual(defaultMeta());
    expect(initialized.storage).not.toBe(storage);
    expect(initialized.storage).toBeInstanceOf(MemoryMetaStorage);

    await initialized.storage.save({ ...defaultMeta(), points: 3 });
    expect(storage.saveCalls).toBe(0);
    expect(await initialized.storage.load()).toEqual({ ...defaultMeta(), points: 3 });
  });
});
