/**
 * リプレイの IndexedDB 永続化（RI-61）。
 */
import { GAME_DB_NAME, openGameDb, REPLAYS_STORE_NAME } from './gameDb';
import {
  normalizeReplay,
  REPLAY_MAX_COUNT,
  selectReplaysWithinMax,
  type ReplayBlob,
} from './replay';

/** リプレイ保存時の上限処理オプション。 */
export interface ReplaySaveOptions {
  /** ファイル取り込みで明示した件を、古い finishedAt でも上限削除から残す。 */
  pin?: boolean;
  /** この保存でも上限削除から残す、ほかの明示取り込み。 */
  protectIds?: readonly string[];
  /** この保存が上限で消した id。巻き戻しは、ここにある欠落だけを戻す。 */
  evictedIds?: Set<string>;
}

function replayPinIds(savedId: string, options?: ReplaySaveOptions): string[] | undefined {
  const ids = new Set(options?.protectIds ?? []);
  if (options?.pin) ids.add(savedId);
  if (ids.size === 0) return undefined;
  return [...ids];
}

function keepSavedReplays(
  items: readonly ReplayBlob[],
  savedId: string,
  options?: ReplaySaveOptions,
): ReplayBlob[] {
  return selectReplaysWithinMax(
    items,
    replayPinIds(savedId, options),
    REPLAY_MAX_COUNT,
    options?.pin ? savedId : undefined,
  );
}

/** リプレイ一覧の非同期永続化インターフェース。 */
export interface ReplayStorage {
  list(): Promise<ReplayBlob[]>;
  get(id: string): Promise<ReplayBlob | null>;
  save(blob: ReplayBlob, options?: ReplaySaveOptions): Promise<void>;
  clear(): Promise<void>;
  /**
   * 取り込みバッチの失敗を戻す。
   * このバッチが書いた内容と今の記録が一致するときだけ、追加分を消し、開始時の内容へ戻す。
   * 別内容へ変わった記録と、開始時に無かった別の記録は消さない。
   * 欠落は、このバッチが上限で消した id だけを戻す。
   * 比較と書き戻しは同一トランザクション。
   */
  revertBatch?(
    snapshot: readonly ReplayBlob[],
    written: readonly ReplayBlob[],
    evictedIds?: ReadonlySet<string>,
  ): Promise<void>;
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

  save(blob: ReplayBlob, options?: ReplaySaveOptions): Promise<void> {
    const snapshot = structuredClone(blob);
    const write = this.writes.then(async () => {
      const db = await openGameDb(this.dbName);
      try {
        await db.put(REPLAYS_STORE_NAME, snapshot, snapshot.id);
        const all = await db.getAll(REPLAYS_STORE_NAME);
        const normalized = all
          .map((raw) => normalizeReplay(raw))
          .filter((item): item is ReplayBlob => item !== null);
        const keep = keepSavedReplays(normalized, snapshot.id, options);
        const keepIds = new Set(keep.map((item) => item.id));
        for (const item of normalized) {
          if (!keepIds.has(item.id)) {
            await db.delete(REPLAYS_STORE_NAME, item.id);
            options?.evictedIds?.add(item.id);
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

  revertBatch(
    snapshot: readonly ReplayBlob[],
    written: readonly ReplayBlob[],
    evictedIds?: ReadonlySet<string>,
  ): Promise<void> {
    const writtenById = new Map(written.map((blob) => [blob.id, structuredClone(blob)]));
    const snapshotById = new Map(snapshot.map((blob) => [blob.id, structuredClone(blob)]));
    const write = this.writes.then(async () => {
      const db = await openGameDb(this.dbName);
      try {
        const tx = db.transaction(REPLAYS_STORE_NAME, 'readwrite');
        const rawAll = await tx.store.getAll();
        const current = new Map<string, unknown>();
        for (const raw of rawAll) {
          if (!raw || typeof raw !== 'object' || !('id' in raw)) continue;
          const id = raw.id;
          if (typeof id !== 'string') continue;
          current.set(id, raw);
        }
        const matchesWritten = (id: string): boolean => {
          const now = current.get(id);
          const writtenBlob = writtenById.get(id);
          return (
            now !== undefined &&
            writtenBlob !== undefined &&
            JSON.stringify(now) === JSON.stringify(writtenBlob)
          );
        };
        for (const id of writtenById.keys()) {
          if (snapshotById.has(id) || !matchesWritten(id)) continue;
          await tx.store.delete(id);
        }
        for (const [id, blob] of snapshotById) {
          const now = current.get(id);
          if (now === undefined) {
            if (evictedIds && !evictedIds.has(id)) continue;
            await tx.store.put(blob, id);
            continue;
          }
          if (JSON.stringify(now) === JSON.stringify(blob)) continue;
          if (!matchesWritten(id)) continue;
          await tx.store.put(blob, id);
        }
        await tx.done;
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

  async save(blob: ReplayBlob, options?: ReplaySaveOptions): Promise<void> {
    this.items.set(blob.id, structuredClone(blob));
    const keep = keepSavedReplays([...this.items.values()], blob.id, options);
    const keepIds = new Set(keep.map((item) => item.id));
    for (const id of [...this.items.keys()]) {
      if (!keepIds.has(id)) {
        this.items.delete(id);
        options?.evictedIds?.add(id);
      }
    }
  }

  async clear(): Promise<void> {
    this.items.clear();
  }

  async revertBatch(
    snapshot: readonly ReplayBlob[],
    written: readonly ReplayBlob[],
    evictedIds?: ReadonlySet<string>,
  ): Promise<void> {
    const writtenById = new Map(written.map((blob) => [blob.id, blob]));
    const snapshotById = new Map(snapshot.map((blob) => [blob.id, blob]));
    const matchesWritten = (id: string): boolean => {
      const current = this.items.get(id);
      const writtenBlob = writtenById.get(id);
      return (
        current !== undefined &&
        writtenBlob !== undefined &&
        JSON.stringify(current) === JSON.stringify(writtenBlob)
      );
    };
    for (const id of writtenById.keys()) {
      if (!snapshotById.has(id) && matchesWritten(id)) this.items.delete(id);
    }
    for (const [id, blob] of snapshotById) {
      const current = this.items.get(id);
      if (!current) {
        if (evictedIds && !evictedIds.has(id)) continue;
        this.items.set(id, structuredClone(blob));
        continue;
      }
      if (JSON.stringify(current) === JSON.stringify(blob)) continue;
      if (!matchesWritten(id)) continue;
      this.items.set(id, structuredClone(blob));
    }
  }
}

export interface ReplayPersistenceBootstrap {
  /** このセッションの保存先。読込失敗時はメモリ。 */
  storage: ReplayStorage;
  /** 読込に失敗し、既存リプレイを別データで上書きしない。 */
  sessionOnly: boolean;
  /** 再試行で読み直す先。sessionOnly のときも失敗した保存先を残す。 */
  durableStorage: ReplayStorage;
}

/**
 * リプレイ保存先を用意する。IndexedDB が使えない場合は MemoryReplayStorage へ切替。
 */
export async function initializeReplayPersistence(
  storage: ReplayStorage = new IndexedDbReplayStorage(),
): Promise<ReplayPersistenceBootstrap> {
  try {
    await storage.list();
    return { storage, sessionOnly: false, durableStorage: storage };
  } catch {
    return {
      storage: new MemoryReplayStorage(),
      sessionOnly: true,
      durableStorage: storage,
    };
  }
}
