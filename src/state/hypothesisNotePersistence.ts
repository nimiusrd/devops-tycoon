/**
 * 仮説メモの保存（RI-295）。
 *
 * メタ進行・途中セーブとは別の object store に1件だけ置く。中身は下書き1件と、
 * 開始 ID ごとの仮説。保存に失敗してもゲームの進行は止めず、このセッションの
 * 入力は画面に残したまま失敗を伝える。読み込めていない空の表示では端末を上書きしない。
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
  hypothesisDraftConflict,
  normalizeHypothesisNote,
  type HypothesisNoteRecord,
} from './hypothesisNote';

export interface HypothesisNoteStorage {
  load(): Promise<unknown>;
  /** 端末上の最新と突き合わせ、変えた下書き版と startId だけを書く。 */
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

type NoteChange = (record: HypothesisNoteRecord) => HypothesisNoteRecord;

export interface HypothesisNoteStore {
  getSnapshot(): HypothesisNoteSnapshot;
  subscribe(listener: () => void): () => void;
  /** 初回だけ端末から読み込む。読み込み前の操作は、読んだ内容の上に重ねる。 */
  load(): Promise<void>;
  update(change: NoteChange): void;
  /** 書き込み待ちが無くなるまで待つ（テスト用）。 */
  flush(): Promise<void>;
  /**
   * この変更の保存結果だけを返す。後続の下書き保存や、以前の失敗表示とは混ぜない。
   */
  applyCommitted(change: NoteChange): Promise<'unchanged' | 'saved' | 'failed'>;
  /** 保存できなかった操作があることを画面へ出す。端末へは書かない。 */
  abandonUnpersistedStart(): void;
}

export function createHypothesisNoteStore(storage: HypothesisNoteStorage): HypothesisNoteStore {
  let snapshot: HypothesisNoteSnapshot = { record: EMPTY_HYPOTHESIS_NOTE, saveFailed: false };
  let baseRecord = EMPTY_HYPOTHESIS_NOTE;
  let loading: Promise<void> | null = null;
  let loaded = false;
  let pending: Array<{ change: NoteChange; opId?: number }> = [];
  let writing: Promise<void> | null = null;
  let dirty = false;
  let captureChanges = false;
  let nextOpId = 1;
  const opState = new Map<number, 'pending' | 'saved' | 'failed' | 'unchanged'>();
  let activeOpIds: number[] = [];
  let queuedDuringWrite: Array<{ change: NoteChange; opId?: number }> = [];
  const opWaiters = new Map<number, () => void>();
  const recordBeforeOp = new Map<number, HypothesisNoteRecord>();
  const changesAfterOp = new Map<number, Array<{ change: NoteChange; opId?: number }>>();
  const listeners = new Set<() => void>();

  const publish = (next: HypothesisNoteSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const applyQueued = (record: HypothesisNoteRecord, queued: NoteChange[]) =>
    queued.reduce((current, change) => change(current), record);

  const finishOp = (id: number, status: 'saved' | 'failed' | 'unchanged') => {
    if (opState.get(id) !== 'pending') return;
    opState.set(id, status);
    const wake = opWaiters.get(id);
    opWaiters.delete(id);
    wake?.();
  };

  const settleOps = (ids: number[], status: 'saved' | 'failed' | 'unchanged') => {
    for (const id of ids) finishOp(id, status);
  };

  const displayAfterCommit = (
    base: HypothesisNoteRecord,
    local: HypothesisNoteRecord,
    stored: HypothesisNoteRecord,
  ): { record: HypothesisNoteRecord; saveFailed: boolean } => {
    if (!hypothesisDraftConflict(base, local, stored)) {
      return { record: stored, saveFailed: false };
    }
    const notes = { ...stored.notes };
    for (const [id, note] of Object.entries(local.notes)) {
      if (base.notes[id] !== note && JSON.stringify(base.notes[id]) !== JSON.stringify(note)) {
        notes[id] = note;
      }
    }
    return {
      record: {
        ...stored,
        draft: local.draft,
        draftRevision: local.draftRevision,
        notes,
      },
      saveFailed: true,
    };
  };

  const persist = (): Promise<void> => {
    dirty = true;
    if (writing) return writing;
    writing = (async () => {
      while (dirty) {
        dirty = false;
        if (!loaded) break;
        const local = snapshot.record;
        const base = baseRecord;
        const ops = activeOpIds;
        activeOpIds = [];
        captureChanges = true;
        try {
          const stored = await storage.commit(local, base);
          const queued = queuedDuringWrite;
          queuedDuringWrite = [];
          captureChanges = false;
          const display = displayAfterCommit(base, local, stored);
          const record =
            queued.length > 0
              ? applyQueued(
                  display.record,
                  queued.map((item) => item.change),
                )
              : display.record;
          baseRecord = stored;
          settleOps(ops, 'saved');
          activeOpIds = [
            ...queued.flatMap((item) => (item.opId === undefined ? [] : [item.opId])),
            ...activeOpIds,
          ];
          publish({ record, saveFailed: display.saveFailed });
          if (queued.length > 0) dirty = true;
        } catch {
          captureChanges = false;
          const follow = queuedDuringWrite;
          queuedDuringWrite = [];
          settleOps(ops, 'failed');
          const failedOp = ops.find((id) => recordBeforeOp.has(id));
          const foundation =
            (failedOp === undefined ? null : recordBeforeOp.get(failedOp)) ?? local;
          const afterFailed = (failedOp === undefined ? [] : (changesAfterOp.get(failedOp) ?? []))
            .filter((item) => item.opId === undefined || !ops.includes(item.opId))
            .map((item) => item.change);
          for (const id of ops) {
            recordBeforeOp.delete(id);
            changesAfterOp.delete(id);
          }
          const record = applyQueued(
            applyQueued(foundation, afterFailed),
            follow.map((item) => item.change),
          );
          publish({ record, saveFailed: true });
          if (follow.length > 0) {
            activeOpIds = [
              ...follow.flatMap((item) => (item.opId === undefined ? [] : [item.opId])),
              ...activeOpIds,
            ];
            dirty = true;
          }
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
      let applied = stored;
      for (let index = 0; index < queued.length; index += 1) {
        const item = queued[index];
        if (item?.opId !== undefined) {
          recordBeforeOp.set(item.opId, applied);
          changesAfterOp.set(item.opId, queued.slice(index + 1));
        }
        if (item) applied = item.change(applied);
      }
      loaded = true;
      if (loading === attemptGate.current) loading = null;
      const queuedOps = queued.flatMap((item) => (item.opId === undefined ? [] : [item.opId]));
      publish({ ...snapshot, record: applied });
      if (applied !== stored) {
        activeOpIds = [...queuedOps, ...activeOpIds];
        void persist();
      } else {
        settleOps(queuedOps, 'unchanged');
      }
    })();
    attemptGate.current = attempt;
    loading = attempt;
    return attempt;
  };

  const load = (): Promise<void> => {
    if (!loading) return startLoad();
    return loading.then(() => startLoad());
  };

  const update = (change: NoteChange, opId?: number) => {
    if (!loaded) {
      if (opId !== undefined) recordBeforeOp.set(opId, snapshot.record);
      pending.push({ change, opId });
      const next = change(snapshot.record);
      if (next !== snapshot.record) publish({ ...snapshot, record: next });
      if (!loading) void load();
      return;
    }
    const next = change(snapshot.record);
    if (opId !== undefined) recordBeforeOp.set(opId, snapshot.record);
    if (next === snapshot.record) {
      if (opId !== undefined) {
        recordBeforeOp.delete(opId);
        finishOp(opId, 'unchanged');
      }
      return;
    }
    if (captureChanges) queuedDuringWrite.push({ change, opId });
    else if (opId !== undefined) activeOpIds.push(opId);
    publish({ ...snapshot, record: next });
    void persist();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    update,
    async flush() {
      await loading;
      while (writing) await writing;
    },
    async applyCommitted(change) {
      const opId = nextOpId++;
      opState.set(opId, 'pending');
      let wake = () => {};
      const settled = new Promise<void>((resolve) => {
        wake = resolve;
      });
      opWaiters.set(opId, wake);
      update(change, opId);
      await load();
      if (!loaded) {
        const before = recordBeforeOp.get(opId);
        pending = pending.filter((item) => item.opId !== opId);
        if (before) {
          publish({
            ...snapshot,
            record: applyQueued(
              before,
              pending.map((item) => item.change),
            ),
            saveFailed: true,
          });
        }
        opState.delete(opId);
        opWaiters.delete(opId);
        recordBeforeOp.delete(opId);
        changesAfterOp.delete(opId);
        return 'failed';
      }
      if (opState.get(opId) === 'pending') await settled;
      const status = opState.get(opId) ?? 'unchanged';
      opState.delete(opId);
      opWaiters.delete(opId);
      recordBeforeOp.delete(opId);
      changesAfterOp.delete(opId);
      if (status === 'saved') return 'saved';
      if (status === 'failed') return 'failed';
      return 'unchanged';
    },
    abandonUnpersistedStart() {
      publish({ ...snapshot, saveFailed: true });
    },
  };
}

function defaultStorage(): HypothesisNoteStorage {
  return typeof indexedDB === 'undefined'
    ? new MemoryHypothesisNoteStorage()
    : new IndexedDbHypothesisNoteStorage();
}

export const hypothesisNoteStore: HypothesisNoteStore = createHypothesisNoteStore(defaultStorage());
