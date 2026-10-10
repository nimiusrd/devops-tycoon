/**
 * 仮説メモの保存（RI-295）。
 *
 * メタ進行・途中セーブとは別の object store に1件だけ置く。保存に失敗しても
 * ゲームの進行は止めず、このセッション中のメモは画面に残したまま失敗を伝える。
 */
import {
  GAME_DB_NAME,
  HYPOTHESIS_NOTE_RECORD_KEY,
  HYPOTHESIS_NOTE_STORE_NAME,
  openGameDb,
} from './gameDb';
import {
  commitHypothesisNote,
  EMPTY_HYPOTHESIS_NOTE,
  hypothesisCommitDroppedSessionBound,
  hypothesisCommitKeptForeignBound,
  normalizeHypothesisNote,
  type HypothesisNoteRecord,
} from './hypothesisNote';

export interface HypothesisNoteStorage {
  load(): Promise<unknown>;
  /**
   * 端末上の最新と、このタブが読み込んだ世代を突き合わせ、変えた欄だけを書く。
   * 返り値は実際に残したレコード。
   */
  commit(local: HypothesisNoteRecord, base: HypothesisNoteRecord): Promise<HypothesisNoteRecord>;
}

export class IndexedDbHypothesisNoteStorage implements HypothesisNoteStorage {
  constructor(private readonly dbName: string = GAME_DB_NAME) {}

  async load(): Promise<unknown> {
    const db = await openGameDb(this.dbName);
    try {
      return await db.get(HYPOTHESIS_NOTE_STORE_NAME, HYPOTHESIS_NOTE_RECORD_KEY);
    } finally {
      db.close();
    }
  }

  async commit(
    local: HypothesisNoteRecord,
    base: HypothesisNoteRecord,
  ): Promise<HypothesisNoteRecord> {
    const db = await openGameDb(this.dbName);
    try {
      const tx = db.transaction(HYPOTHESIS_NOTE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(HYPOTHESIS_NOTE_STORE_NAME);
      const current = normalizeHypothesisNote(await store.get(HYPOTHESIS_NOTE_RECORD_KEY));
      const next = commitHypothesisNote(base, local, current);
      await store.put(next, HYPOTHESIS_NOTE_RECORD_KEY);
      await tx.done;
      return next;
    } finally {
      db.close();
    }
  }
}

export class MemoryHypothesisNoteStorage implements HypothesisNoteStorage {
  value: unknown = undefined;

  async load(): Promise<unknown> {
    return this.value;
  }

  async commit(
    local: HypothesisNoteRecord,
    base: HypothesisNoteRecord,
  ): Promise<HypothesisNoteRecord> {
    const next = commitHypothesisNote(base, local, normalizeHypothesisNote(this.value));
    this.value = next;
    return next;
  }
}

export interface HypothesisNoteSnapshot {
  record: HypothesisNoteRecord;
  /** 最後の書き込みが失敗し、端末へ残っていない変更がある。 */
  saveFailed: boolean;
}

export interface HypothesisNoteStore {
  getSnapshot(): HypothesisNoteSnapshot;
  subscribe(listener: () => void): () => void;
  /** 初回だけ端末から読み込む。読み込み前の操作は、読んだ内容の上に重ねる。 */
  load(): Promise<void>;
  update(change: (record: HypothesisNoteRecord) => HypothesisNoteRecord): void;
  /** 書き込み待ちが無くなるまで待つ（テスト用）。 */
  flush(): Promise<void>;
  /**
   * 変更を保存し終える。変化がなければ既存の失敗表示とは切り離して unchanged を返す。
   */
  applyCommitted(
    change: (record: HypothesisNoteRecord) => HypothesisNoteRecord,
  ): Promise<'unchanged' | 'saved' | 'failed'>;
}

export function createHypothesisNoteStore(storage: HypothesisNoteStorage): HypothesisNoteStore {
  let snapshot: HypothesisNoteSnapshot = { record: EMPTY_HYPOTHESIS_NOTE, saveFailed: false };
  let baseRecord = EMPTY_HYPOTHESIS_NOTE;
  let loading: Promise<void> | null = null;
  let loaded = false;
  let pending: Array<(record: HypothesisNoteRecord) => HypothesisNoteRecord> = [];
  let writing: Promise<void> | null = null;
  let dirty = false;
  /** 書き込みの await 中に来た操作。返ったレコードへ重ね直す。 */
  let queuedDuringWrite: Array<(record: HypothesisNoteRecord) => HypothesisNoteRecord> = [];
  let captureChanges = false;
  let persistSeq = 0;
  let lastPersistSeq = 0;
  let lastPersistOk = true;
  const listeners = new Set<() => void>();

  const publish = (next: HypothesisNoteSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const applyQueued = (
    record: HypothesisNoteRecord,
    queued: Array<(record: HypothesisNoteRecord) => HypothesisNoteRecord>,
  ) => queued.reduce((current, change) => change(current), record);

  // 入力のたびに書き込みを積まず、書き込み中の変更は最新の1件だけを後から書く。
  const persist = (): Promise<void> => {
    dirty = true;
    if (writing) return writing;
    writing = (async () => {
      while (dirty) {
        dirty = false;
        const local = snapshot.record;
        const base = baseRecord;
        const seq = ++persistSeq;
        captureChanges = true;
        try {
          const stored = await storage.commit(local, base);
          const queued = queuedDuringWrite;
          queuedDuringWrite = [];
          captureChanges = false;
          lastPersistSeq = seq;
          if (hypothesisCommitDroppedSessionBound(base, local, stored)) {
            lastPersistOk = false;
            publish({
              record: queued.length > 0 ? applyQueued(local, queued) : local,
              saveFailed: true,
            });
          } else if (hypothesisCommitKeptForeignBound(base, local, stored)) {
            publish({
              record: queued.length > 0 ? applyQueued(local, queued) : local,
              saveFailed: false,
            });
            lastPersistOk = true;
          } else {
            baseRecord = stored;
            lastPersistOk = true;
            if (queued.length > 0) {
              publish({ ...snapshot, record: applyQueued(stored, queued) });
              dirty = true;
            } else if (!dirty) {
              publish({ record: stored, saveFailed: false });
            }
          }
        } catch {
          captureChanges = false;
          queuedDuringWrite = [];
          lastPersistSeq = seq;
          lastPersistOk = false;
          if (!snapshot.saveFailed) publish({ ...snapshot, saveFailed: true });
        }
      }
      writing = null;
    })();
    return writing;
  };

  const startLoad = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (loading) return loading;
    const attemptGate: { current: Promise<void> | null } = { current: null };
    const attempt = (async () => {
      let raw: unknown;
      try {
        raw = await storage.load();
      } catch {
        if (loading === attemptGate.current) loading = null;
        if (pending.length > 0) publish({ ...snapshot, saveFailed: true });
        return;
      }
      const stored = normalizeHypothesisNote(raw);
      baseRecord = stored;
      const queued = pending;
      pending = [];
      const record = applyQueued(stored, queued);
      loaded = true;
      if (loading === attemptGate.current) loading = null;
      publish({ ...snapshot, record });
      if (record !== stored) void persist();
    })();
    attemptGate.current = attempt;
    loading = attempt;
    return attempt;
  };

  const load = (): Promise<void> => {
    if (!loading) return startLoad();
    const inflight = loading;
    return inflight.then(() => startLoad());
  };

  const update = (change: (record: HypothesisNoteRecord) => HypothesisNoteRecord) => {
    if (!loaded) {
      pending.push(change);
      const next = change(snapshot.record);
      if (next !== snapshot.record) publish({ ...snapshot, record: next });
      if (!loading) void load();
      return;
    }
    const next = change(snapshot.record);
    if (next === snapshot.record) return;
    if (captureChanges) queuedDuringWrite.push(change);
    publish({ ...snapshot, record: next });
    void persist();
  };

  const flush = async () => {
    await loading;
    while (writing) await writing;
  };

  const applyCommitted = async (
    change: (record: HypothesisNoteRecord) => HypothesisNoteRecord,
  ): Promise<'unchanged' | 'saved' | 'failed'> => {
    const seq = persistSeq;
    update(change);
    await load();
    await flush();
    if (!loaded) return snapshot.saveFailed ? 'failed' : 'unchanged';
    if (lastPersistSeq <= seq) return 'unchanged';
    return lastPersistOk ? 'saved' : 'failed';
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    update,
    flush,
    applyCommitted,
  };
}

function defaultStorage(): HypothesisNoteStorage {
  return typeof indexedDB === 'undefined'
    ? new MemoryHypothesisNoteStorage()
    : new IndexedDbHypothesisNoteStorage();
}

export const hypothesisNoteStore: HypothesisNoteStore = createHypothesisNoteStore(defaultStorage());
