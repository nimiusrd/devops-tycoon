/**
 * ゲーム用 IndexedDB の共有スキーマ（メタ / ランセーブ / リプレイ）。
 *
 * RI-57 で meta ストアを導入し、RI-58 / RI-61 で runSave・replays を追加する。
 * 各永続化モジュールはこの open を経由し、upgrade を一箇所に集約する。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { RunSaveBlob } from '../sim/run/hydrateState';
import type { MetaState } from './meta';
import type { ReplayBlob } from './replay';

export const GAME_DB_NAME = 'devops-tycoon';
/** meta=v1 → runSave/replays 追加で v2。 */
export const GAME_DB_VERSION = 2;

export const META_STORE_NAME = 'meta';
export const RUN_SAVE_STORE_NAME = 'runSave';
export const REPLAYS_STORE_NAME = 'replays';

export const META_RECORD_KEY = 'current';
export const RUN_SAVE_RECORD_KEY = 'current';

export interface GameDatabase extends DBSchema {
  meta: {
    key: typeof META_RECORD_KEY;
    value: MetaState;
  };
  runSave: {
    key: typeof RUN_SAVE_RECORD_KEY;
    value: RunSaveBlob;
  };
  replays: {
    key: string;
    value: ReplayBlob;
  };
}

/** 共有 DB を開き、不足ストアを upgrade で作成する。 */
export function openGameDb(dbName: string = GAME_DB_NAME): Promise<IDBPDatabase<GameDatabase>> {
  return openDB<GameDatabase>(dbName, GAME_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(RUN_SAVE_STORE_NAME)) {
        db.createObjectStore(RUN_SAVE_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(REPLAYS_STORE_NAME)) {
        db.createObjectStore(REPLAYS_STORE_NAME);
      }
    },
  });
}
