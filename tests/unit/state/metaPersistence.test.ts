import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultMeta, type MetaState } from '../../../src/state/meta';
import {
  IndexedDbMetaStorage,
  initializeMetaPersistence,
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
});

describe('initializeMetaPersistence', () => {
  it('保存済みメタがあればそれを返し、追加保存はしない', async () => {
    const persisted = { ...defaultMeta(), points: 55 };
    const storage = fakeIdb({ load: persisted, save: 'ok' });

    await expect(initializeMetaPersistence(storage)).resolves.toEqual({
      meta: persisted,
      storage,
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

  it('IndexedDB が使えない環境でも throw せず初期値で起動する', async () => {
    // 保存先は IndexedDB のみなので、この環境では永続化されない。
    // 起動を止めないことと、渡した storage をそのまま返すことだけを保証する。
    const storage = fakeIdb({ load: 'throw', save: 'throw' });

    const initialized = await initializeMetaPersistence(storage);

    expect(initialized.meta).toEqual(defaultMeta());
    expect(initialized.storage).toBe(storage);
    expect(storage.saveCalls).toBe(0);
  });
});
