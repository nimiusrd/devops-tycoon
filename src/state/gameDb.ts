/**
 * ゲーム共通 IndexedDB（メタ進行 + ラン途中セーブ + リプレイ）。
 * RI-57 / RI-58 / RI-61 が同一 DB を共有し、version upgrade で store を追加する。
 *
 * runSave / replays の value 型は循環参照を避けるためここでは緩く定義し、
 * 読み書き時に各モジュールの normalize で厳密検証する。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { MetaState } from './meta';

export const GAME_DB_NAME = 'devops-tycoon';
/** v1=meta / v2=runSave（RI-58）/ v3=replays（RI-61）。 */
export const GAME_DB_VERSION = 3;
export const META_STORE_NAME = 'meta';
export const RUN_STORE_NAME = 'runSave';
export const REPLAYS_STORE_NAME = 'replays';
export const META_RECORD_KEY = 'current';
export const RUN_RECORD_KEY = 'current';

export interface GameDatabase extends DBSchema {
  meta: {
    key: typeof META_RECORD_KEY;
    value: MetaState;
  };
  runSave: {
    key: typeof RUN_RECORD_KEY;
    /** 厳密な形は `parseRunSave` で検証する（循環参照回避のためここは unknown）。 */
    value: unknown;
  };
  replays: {
    key: string;
    /** 厳密な形は `normalizeReplay` で検証する。 */
    value: unknown;
  };
}

/** 共通 DB を開き、不足している object store を upgrade で作成する。 */
export function openGameDb(dbName: string = GAME_DB_NAME): Promise<IDBPDatabase<GameDatabase>> {
  return openDB<GameDatabase>(dbName, GAME_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(RUN_STORE_NAME)) {
        db.createObjectStore(RUN_STORE_NAME);
      }
      if (!db.objectStoreNames.contains(REPLAYS_STORE_NAME)) {
        db.createObjectStore(REPLAYS_STORE_NAME);
      }
    },
  });
}
