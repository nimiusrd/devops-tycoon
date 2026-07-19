/**
 * リプレイの IndexedDB 永続化（RI-61）。
 */
import { GAME_DB_NAME, openGameDb, REPLAYS_STORE_NAME } from './gameDb';
import { normalizeReplay, REPLAY_MAX_COUNT, type ReplayBlob } from './replay';

/** リプレイ一覧の非同期永続化インターフェース。 */
export interface ReplayStorage {
  list(): Promise<ReplayBlob[]>;
  get(id: string): Promise<ReplayBlob | null>;
  save(blob: ReplayBlob): Promise<void>;
  clear(): Promise<void>;
}

/** IndexedDB にリプレイを複数件保存する（上限超過は古いものから削除）。 */
export class IndexedDbReplayStorage implements ReplayStorage {
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly dbName: string = GAME_DB_NAME) {}

  async list(): Promise<ReplayBlob[]> {
    await this.writes.catch(() => undefined);
    const db = await openGameDb(this.dbName);
    try {
      const all = await db.getAll(REPLAYS_STORE_NAME);
      return all
        .map((raw) => normalizeReplay(raw))
        .filter((blob): blob is ReplayBlob => blob !== null)
        .sort((a, b) => b.finishedAt - a.finishedAt);
    } finally {
      db.close();
    }
  }

  async get(id: string): Promise<ReplayBlob | null> {
    await this.writes.catch(() => undefined);
    const db = await openGameDb(this.dbName);
    try {
      const stored = await db.get(REPLAYS_STORE_NAME, id);
      return stored === undefined ? null : normalizeReplay(stored);
    } finally {
      db.close();
    }
  }

  save(blob: ReplayBlob): Promise<void> {
    const snapshot = structuredClone(blob);
    const write = this.writes.then(async () => {
      const db = await openGameDb(this.dbName);
      try {
        await db.put(REPLAYS_STORE_NAME, snapshot, snapshot.id);
        const all = await db.getAll(REPLAYS_STORE_NAME);
        const normalized = all
          .map((raw) => normalizeReplay(raw))
          .filter((item): item is ReplayBlob => item !== null)
          .sort((a, b) => b.finishedAt - a.finishedAt);
        if (normalized.length > REPLAY_MAX_COUNT) {
          for (const stale of normalized.slice(REPLAY_MAX_COUNT)) {
            await db.delete(REPLAYS_STORE_NAME, stale.id);
          }
        }
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  clear(): Promise<void> {
    const write = this.writes.then(async () => {
      const db = await openGameDb(this.dbName);
      try {
        await db.clear(REPLAYS_STORE_NAME);
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }
}

/** メモリ上だけで動く ReplayStorage（テスト / IDB 不可時）。 */
export class MemoryReplayStorage implements ReplayStorage {
  private items = new Map<string, ReplayBlob>();

  async list(): Promise<ReplayBlob[]> {
    return [...this.items.values()]
      .map((b) => structuredClone(b))
      .sort((a, b) => b.finishedAt - a.finishedAt);
  }

  async get(id: string): Promise<ReplayBlob | null> {
    const found = this.items.get(id);
    return found ? structuredClone(found) : null;
  }

  async save(blob: ReplayBlob): Promise<void> {
    this.items.set(blob.id, structuredClone(blob));
    const ordered = [...this.items.values()].sort((a, b) => b.finishedAt - a.finishedAt);
    for (const stale of ordered.slice(REPLAY_MAX_COUNT)) {
      this.items.delete(stale.id);
    }
  }

  async clear(): Promise<void> {
    this.items.clear();
  }
}
