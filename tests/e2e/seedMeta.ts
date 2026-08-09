/**
 * E2E でメタ進行の初期状態を仕込むヘルパー。
 *
 * 以前は旧 localStorage キーへ書き、起動時の移行に載せて IndexedDB へ入れていた。
 * 移行の廃止に伴い、本番と同じ保存先（IndexedDB）へ直接書く。
 */
import type { Page } from '@playwright/test';
import type { MetaState } from '../../src/state/meta';
import {
  GAME_DB_NAME,
  GAME_DB_VERSION,
  META_RECORD_KEY,
  META_STORE_NAME,
  REPLAYS_STORE_NAME,
  RUN_STORE_NAME,
} from '../../src/state/gameDb';

interface SeedArgs {
  meta: Partial<MetaState>;
  dbName: string;
  dbVersion: number;
  metaStore: string;
  metaKey: string;
  otherStores: string[];
}

/**
 * ページ読み込み前に IndexedDB へメタ状態を書き込む。
 *
 * 部分指定でよい。読み出し側（IndexedDbMetaStorage.load）が normalizeMeta で
 * 現行スキーマの既定値を補完する。
 *
 * アプリ側と同じ version で開き、不足 store を作る（アプリが後から
 * version upgrade を要求してブロックされないようにする）。
 *
 * `addInitScript` は `page.reload()` でも再実行されるため、既にレコードが
 * ある場合は書かない。リロードを挟むテストで、途中の進行が初期値へ
 * 巻き戻らないようにするため。
 */
export async function seedMeta(page: Page, meta: Partial<MetaState>): Promise<void> {
  await page.addInitScript(
    (args: SeedArgs) => {
      const open = indexedDB.open(args.dbName, args.dbVersion);
      open.onupgradeneeded = () => {
        const db = open.result;
        for (const store of [args.metaStore, ...args.otherStores]) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(args.metaStore, 'readwrite');
        const store = tx.objectStore(args.metaStore);
        const existing = store.get(args.metaKey);
        existing.onsuccess = () => {
          if (existing.result === undefined) store.put(args.meta, args.metaKey);
        };
        tx.oncomplete = () => db.close();
      };
    },
    {
      meta,
      dbName: GAME_DB_NAME,
      dbVersion: GAME_DB_VERSION,
      metaStore: META_STORE_NAME,
      metaKey: META_RECORD_KEY,
      otherStores: [RUN_STORE_NAME, REPLAYS_STORE_NAME],
    } satisfies SeedArgs,
  );
}
