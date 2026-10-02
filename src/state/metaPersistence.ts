import type { IDBPDatabase } from 'idb';
import { defaultMeta, normalizeMeta, type MetaState } from './meta';
import {
  GAME_DB_NAME,
  GENERATION_STORE_NAME,
  META_RECORD_KEY,
  META_STORE_NAME,
  openGameDb,
  type GameDatabase,
} from './gameDb';
import { generationValue, type DurableWriteResult } from './tabConflict';

/** メタ進行の非同期永続化インターフェース。 */
export interface MetaStorage {
  load(): Promise<MetaState | null>;
  save(meta: MetaState): Promise<void>;
  /**
   * 空のときだけ書く。既にあればその記録を返し、上書きしない。
   * 空判定と書き込みは同一トランザクション。
   */
  insertIfAbsent?(meta: MetaState): Promise<MetaState | null>;
  /**
   * いまの記録が expected と一致するときだけ next を書く。
   * 記録が無いときは、途中で消えていても next を書く。
   * 別の記録ならそれを返し、上書きしない。比較と書き込みは同一トランザクション。
   * 書き込んだときは null。
   */
  replaceIfMatches?(expected: MetaState | null, next: MetaState): Promise<MetaState | null>;
  /**
   * この保存先が観測した世代と一致するときだけ書く。
   * 別タブが先に書いていたら、その記録を返して上書きしない。
   */
  compareAndSave?(
    meta: MetaState,
    expectedRunGeneration?: number,
  ): Promise<DurableWriteResult<MetaState>>;
}

export interface MetaPersistenceBootstrap {
  meta: MetaState;
  /** このセッションの保存先。読込失敗時はメモリ。 */
  storage: MetaStorage;
  /** 読込に失敗し、既存レコードへ初期値を書き戻さない。 */
  sessionOnly: boolean;
  /** 再試行で読み直す先。sessionOnly のときも失敗した保存先を残す。 */
  durableStorage: MetaStorage;
  /** 端末に記録があり、それを読んで起動した。空の初期値ではない。 */
  loadedFromDevice: boolean;
}

/** IndexedDB に単一の最新メタ状態を保存する。 */
export class IndexedDbMetaStorage implements MetaStorage {
  private writes: Promise<void> = Promise.resolve();
  /** load または自分の書き込みで観測した世代。未観測の初回書き込みは 0 だけを受け入れる。 */
  private observedGeneration = 0;
  private generationReady = false;
  /** 別タブの記録を見つけたあとは、このインスタンスから上書きしない。 */
  private foreignBlocked = false;

  constructor(private readonly dbName: string = GAME_DB_NAME) {}

  private open(): Promise<IDBPDatabase<GameDatabase>> {
    return openGameDb(this.dbName);
  }

  /** 未観測なら世代 0 だけを自分の初回書き込みとして認める。 */
  private acceptsGeneration(generation: number): boolean {
    if (!this.generationReady) return generation === 0;
    return generation === this.observedGeneration;
  }

  private async conflictResult(): Promise<DurableWriteResult<MetaState>> {
    const db = await this.open();
    try {
      const stored = await db.get(META_STORE_NAME, META_RECORD_KEY);
      return { ok: false, current: stored === undefined ? null : normalizeMeta(stored) };
    } finally {
      db.close();
    }
  }

  async load(): Promise<MetaState | null> {
    await this.writes.catch(() => undefined);
    const db = await this.open();
    try {
      const tx = db.transaction([META_STORE_NAME, GENERATION_STORE_NAME], 'readonly');
      const stored = await tx.objectStore(META_STORE_NAME).get(META_RECORD_KEY);
      const generation = generationValue(await tx.objectStore(GENERATION_STORE_NAME).get('meta'));
      await tx.done;
      this.observedGeneration = generation;
      this.generationReady = true;
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
        const tx = db.transaction([META_STORE_NAME, GENERATION_STORE_NAME], 'readwrite');
        const generation = tx.objectStore(GENERATION_STORE_NAME);
        await tx.objectStore(META_STORE_NAME).put(snapshot, META_RECORD_KEY);
        const next = generationValue(await generation.get('meta')) + 1;
        await generation.put(next, 'meta');
        await tx.done;
        this.observedGeneration = next;
        this.generationReady = true;
      } finally {
        db.close();
      }
    });
    this.writes = write.catch(() => undefined);
    return write;
  }

  compareAndSave(
    meta: MetaState,
    expectedRunGeneration?: number,
  ): Promise<DurableWriteResult<MetaState>> {
    const snapshot = structuredClone(meta);
    const write = this.writes.then(async () => {
      if (this.foreignBlocked) return this.conflictResult();
      const db = await this.open();
      try {
        const tx = db.transaction([META_STORE_NAME, GENERATION_STORE_NAME], 'readwrite');
        const metaStore = tx.objectStore(META_STORE_NAME);
        const generationStore = tx.objectStore(GENERATION_STORE_NAME);
        if (expectedRunGeneration !== undefined) {
          const runGeneration = generationValue(await generationStore.get('run'));
          if (runGeneration !== expectedRunGeneration) {
            const existing = await metaStore.get(META_RECORD_KEY);
            await tx.done;
            return {
              ok: false as const,
              current: existing === undefined ? null : normalizeMeta(existing),
            };
          }
        }
        const generation = generationValue(await generationStore.get('meta'));
        if (!this.acceptsGeneration(generation)) {
          const existing = await metaStore.get(META_RECORD_KEY);
          await tx.done;
          this.foreignBlocked = true;
          return {
            ok: false as const,
            current: existing === undefined ? null : normalizeMeta(existing),
          };
        }
        await metaStore.put(snapshot, META_RECORD_KEY);
        const next = generation + 1;
        await generationStore.put(next, 'meta');
        await tx.done;
        this.observedGeneration = next;
        this.generationReady = true;
        return { ok: true as const };
      } finally {
        db.close();
      }
    });
    this.writes = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  insertIfAbsent(meta: MetaState): Promise<MetaState | null> {
    const snapshot = structuredClone(meta);
    const write = this.writes.then(async () => {
      const db = await this.open();
      try {
        const tx = db.transaction([META_STORE_NAME, GENERATION_STORE_NAME], 'readwrite');
        const metaStore = tx.objectStore(META_STORE_NAME);
        const generationStore = tx.objectStore(GENERATION_STORE_NAME);
        const existing = await metaStore.get(META_RECORD_KEY);
        if (existing !== undefined) {
          await tx.done;
          return normalizeMeta(existing);
        }
        await metaStore.put(snapshot, META_RECORD_KEY);
        const next = generationValue(await generationStore.get('meta')) + 1;
        await generationStore.put(next, 'meta');
        await tx.done;
        this.observedGeneration = next;
        this.generationReady = true;
        return null;
      } finally {
        db.close();
      }
    });
    this.writes = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }

  replaceIfMatches(expected: MetaState | null, next: MetaState): Promise<MetaState | null> {
    const snapshot = structuredClone(next);
    const expectedKey = expected === null ? null : JSON.stringify(expected);
    const write = this.writes.then(async () => {
      const db = await this.open();
      try {
        const tx = db.transaction([META_STORE_NAME, GENERATION_STORE_NAME], 'readwrite');
        const metaStore = tx.objectStore(META_STORE_NAME);
        const generationStore = tx.objectStore(GENERATION_STORE_NAME);
        const existing = await metaStore.get(META_RECORD_KEY);
        if (existing !== undefined && JSON.stringify(existing) !== expectedKey) {
          await tx.done;
          return normalizeMeta(existing);
        }
        await metaStore.put(snapshot, META_RECORD_KEY);
        const next = generationValue(await generationStore.get('meta')) + 1;
        await generationStore.put(next, 'meta');
        await tx.done;
        this.observedGeneration = next;
        this.generationReady = true;
        return null;
      } finally {
        db.close();
      }
    });
    this.writes = write.then(
      () => undefined,
      () => undefined,
    );
    return write;
  }
}

/** メモリ上だけで動く MetaStorage（テスト / IDB 不可時）。 */
export class MemoryMetaStorage implements MetaStorage {
  private state: MetaState | null = null;

  async load(): Promise<MetaState | null> {
    return this.state ? structuredClone(this.state) : null;
  }

  async save(meta: MetaState): Promise<void> {
    this.state = structuredClone(meta);
  }

  async insertIfAbsent(meta: MetaState): Promise<MetaState | null> {
    if (this.state) return structuredClone(this.state);
    await this.save(meta);
    return null;
  }

  async replaceIfMatches(expected: MetaState | null, next: MetaState): Promise<MetaState | null> {
    if (this.state === null || JSON.stringify(this.state) === JSON.stringify(expected)) {
      await this.save(next);
      return null;
    }
    return structuredClone(this.state);
  }

  async compareAndSave(
    meta: MetaState,
    _expectedRunGeneration?: number,
  ): Promise<DurableWriteResult<MetaState>> {
    await this.save(meta);
    return { ok: true };
  }
}

/**
 * IndexedDB からメタ状態を読み込む。空なら初期値で始める。
 *
 * 保存先は IndexedDB のみ。localStorage への移行・フォールバックは廃止した。
 *
 * 読み込みに失敗したセッションでは、以降の保存先をメモリへ切り替える。
 * 一過性の失敗（トランザクション abort など）で初期値から再開したあと、
 * その初期値ベースの状態を既存レコードへ書き戻して進行を消さないため。
 * ラン／リプレイの永続化も同じ方針（MemoryRunStorage / MemoryReplayStorage）。
 */
export async function initializeMetaPersistence(
  storage: MetaStorage = new IndexedDbMetaStorage(),
): Promise<MetaPersistenceBootstrap> {
  try {
    const persisted = await storage.load();
    return {
      meta: persisted ?? defaultMeta(),
      storage,
      sessionOnly: false,
      durableStorage: storage,
      loadedFromDevice: persisted !== null,
    };
  } catch {
    return {
      meta: defaultMeta(),
      storage: new MemoryMetaStorage(),
      sessionOnly: true,
      durableStorage: storage,
      loadedFromDevice: false,
    };
  }
}
