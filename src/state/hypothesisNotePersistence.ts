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
  EMPTY_HYPOTHESIS_NOTE,
  normalizeHypothesisNote,
  type HypothesisNoteRecord,
} from './hypothesisNote';

export interface HypothesisNoteStorage {
  load(): Promise<unknown>;
  save(record: HypothesisNoteRecord): Promise<void>;
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

  async save(record: HypothesisNoteRecord): Promise<void> {
    const db = await openGameDb(this.dbName);
    try {
      await db.put(HYPOTHESIS_NOTE_STORE_NAME, record, HYPOTHESIS_NOTE_RECORD_KEY);
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

  async save(record: HypothesisNoteRecord): Promise<void> {
    this.value = record;
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
  /** 初回だけ端末から読み込む。読み込み前に編集があれば、その編集を優先する。 */
  load(): Promise<void>;
  update(change: (record: HypothesisNoteRecord) => HypothesisNoteRecord): void;
  /** 書き込み待ちが無くなるまで待つ（テスト用）。 */
  flush(): Promise<void>;
}

export function createHypothesisNoteStore(storage: HypothesisNoteStorage): HypothesisNoteStore {
  let snapshot: HypothesisNoteSnapshot = { record: EMPTY_HYPOTHESIS_NOTE, saveFailed: false };
  let loading: Promise<void> | null = null;
  let editedBeforeLoad = false;
  let writing: Promise<void> | null = null;
  let dirty = false;
  const listeners = new Set<() => void>();

  const publish = (next: HypothesisNoteSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  // 入力のたびに書き込みを積まず、書き込み中の変更は最新の1件だけを後から書く。
  const persist = (): Promise<void> => {
    dirty = true;
    if (writing) return writing;
    writing = (async () => {
      while (dirty) {
        dirty = false;
        const record = snapshot.record;
        try {
          await storage.save(record);
          if (snapshot.saveFailed && !dirty) publish({ ...snapshot, saveFailed: false });
        } catch {
          if (!snapshot.saveFailed) publish({ ...snapshot, saveFailed: true });
        }
      }
      writing = null;
    })();
    return writing;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load() {
      loading ??= (async () => {
        let raw: unknown;
        try {
          raw = await storage.load();
        } catch {
          return;
        }
        if (editedBeforeLoad) return;
        publish({ ...snapshot, record: normalizeHypothesisNote(raw) });
      })();
      return loading;
    },
    update(change) {
      const next = change(snapshot.record);
      if (next === snapshot.record) return;
      editedBeforeLoad = true;
      publish({ ...snapshot, record: next });
      void persist();
    },
    async flush() {
      await loading;
      while (writing) await writing;
    },
  };
}

function defaultStorage(): HypothesisNoteStorage {
  return typeof indexedDB === 'undefined'
    ? new MemoryHypothesisNoteStorage()
    : new IndexedDbHypothesisNoteStorage();
}

export const hypothesisNoteStore: HypothesisNoteStore = createHypothesisNoteStore(defaultStorage());
