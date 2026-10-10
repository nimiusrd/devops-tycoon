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
  appendAbandonedHypothesisDraft,
  commitStoredHypothesis,
  EMPTY_HYPOTHESIS_NOTE,
  hypothesisCommitDroppedSessionBound,
  hypothesisCommitKeptForeignBound,
  normalizeHypothesisNote,
  type HypothesisNoteEntry,
  type HypothesisNoteRecord,
} from './hypothesisNote';

export interface HypothesisNoteStorage {
  load(): Promise<unknown>;
  /**
   * 端末上の最新と、このタブが読み込んだ世代を突き合わせ、変えた欄だけを書く。
   * 返り値は実際に残したレコード。
   */
  commit(
    local: HypothesisNoteRecord,
    base: HypothesisNoteRecord,
    options?: { restoreBound?: boolean },
  ): Promise<HypothesisNoteRecord>;
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
    options?: { restoreBound?: boolean },
  ): Promise<HypothesisNoteRecord> {
    const db = await openGameDb(this.dbName);
    try {
      const tx = db.transaction(HYPOTHESIS_NOTE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(HYPOTHESIS_NOTE_STORE_NAME);
      const current = normalizeHypothesisNote(await store.get(HYPOTHESIS_NOTE_RECORD_KEY));
      const next = commitStoredHypothesis(base, local, current, options);
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
    options?: { restoreBound?: boolean },
  ): Promise<HypothesisNoteRecord> {
    const next = commitStoredHypothesis(base, local, normalizeHypothesisNote(this.value), options);
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
    options?: { restoreBound?: boolean },
  ): Promise<'unchanged' | 'saved' | 'failed'>;
  /** 永続値がまだ解除状態のときだけ、以前の仮説を戻す。 */
  restoreBoundIfDetached(
    bound: HypothesisNoteRecord['bound'],
  ): Promise<'unchanged' | 'saved' | 'failed'>;
  /** 保存できなかった開始分を、このセッションの表示から外す。端末へは書かない。 */
  abandonUnpersistedStart(): void;
  /**
   * 開始の保存を諦める。進行中の書き込みが後から成功しても、渡したレコードを端末へ戻す。
   */
  revertAbandonedStart(record: HypothesisNoteRecord): void;
}

export function createHypothesisNoteStore(storage: HypothesisNoteStorage): HypothesisNoteStore {
  let snapshot: HypothesisNoteSnapshot = { record: EMPTY_HYPOTHESIS_NOTE, saveFailed: false };
  let baseRecord = EMPTY_HYPOTHESIS_NOTE;
  let loading: Promise<void> | null = null;
  let loaded = false;
  let pending: Array<{
    change: (record: HypothesisNoteRecord) => HypothesisNoteRecord;
    opId?: number;
  }> = [];
  let writing: Promise<void> | null = null;
  let dirty = false;
  /** 書き込みの await 中に来た操作。返ったレコードへ重ね直す。 */
  let captureChanges = false;
  let nextOpId = 1;
  const opState = new Map<number, 'pending' | 'saved' | 'failed' | 'unchanged'>();
  let activeOpIds: number[] = [];
  let queuedDuringWrite: Array<{
    change: (record: HypothesisNoteRecord) => HypothesisNoteRecord;
    opId?: number;
  }> = [];
  let persistSeq = 0;
  /** この番号までの開始保存は、成功しても画面と端末を戻す。 */
  let discardThroughSeq = -1;
  let revertRecord: HypothesisNoteRecord | null = null;
  let revertSourceDraft: HypothesisNoteEntry | null = null;
  let revertTypedDraft: HypothesisNoteEntry | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: HypothesisNoteSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const applyQueued = (
    record: HypothesisNoteRecord,
    queued: Array<(record: HypothesisNoteRecord) => HypothesisNoteRecord>,
  ) => queued.reduce((current, change) => change(current), record);

  const opWaiters = new Map<number, () => void>();
  const restoreBoundOps = new Set<number>();
  const recordBeforeOp = new Map<number, HypothesisNoteRecord>();

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

  const isAbandonedOp = (opId: number | undefined) =>
    opId !== undefined && opState.get(opId) === 'failed';

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
        const ops = activeOpIds;
        activeOpIds = [];
        captureChanges = true;
        try {
          const stored = await storage.commit(
            local,
            base,
            ops.some((id) => restoreBoundOps.has(id)) ? { restoreBound: true } : undefined,
          );
          const queued = queuedDuringWrite.filter((item) => !isAbandonedOp(item.opId));
          const queuedChanges = queued.map((item) => item.change);
          const followOps = queued.flatMap((item) => (item.opId === undefined ? [] : [item.opId]));
          queuedDuringWrite = [];
          captureChanges = false;
          if (revertRecord && seq <= discardThroughSeq) {
            const reverted = revertRecord;
            let restored =
              queuedChanges.length > 0 ? applyQueued(reverted, queuedChanges) : reverted;
            // 待ち時間の追記は絶対値で書き直すので、つないだ下書きをその追記だけで上書きしない。
            if (
              revertTypedDraft &&
              sameDraft(restored.draft, revertTypedDraft) &&
              !sameDraft(reverted.draft, revertTypedDraft)
            ) {
              restored = { ...restored, draft: reverted.draft };
            }
            const consumedByLaterStart =
              !stored.draft &&
              !!stored.bound &&
              stored.bound.startId !== local.bound?.startId &&
              sameDraft(stored.bound.beforeStart, revertSourceDraft) &&
              (sameDraft(reverted.draft, restored.draft) ||
                sameDraft(restored.draft, revertSourceDraft) ||
                sameDraft(restored.draft, revertTypedDraft));
            if (consumedByLaterStart) {
              // 後発開始が消費した本文は戻さない。待ち時間の追記だけ残す。
              restored = { ...restored, draft: revertTypedDraft };
            } else if (
              stored.draft &&
              sameDraft(reverted.draft, restored.draft) &&
              !sameDraft(reverted.draft, stored.draft)
            ) {
              // 待ち時間に別タブが書いた下書きは、この開始が消そうとした下書きと違うなら残す。
              restored = { ...restored, draft: stored.draft };
            }
            // この開始が書いた bound だけを外す。次のマージは、別タブの後発 bound を消さない。
            if (local.bound && stored.bound?.startId === local.bound.startId) {
              restored = { ...restored, bound: null };
            }
            revertRecord = null;
            revertSourceDraft = null;
            revertTypedDraft = null;
            baseRecord = stored;
            settleOps(ops, 'failed');
            activeOpIds = followOps;
            publish({ record: restored, saveFailed: true });
            dirty = true;
          } else if (hypothesisCommitDroppedSessionBound(base, local, stored)) {
            const display = queuedChanges.length > 0 ? applyQueued(local, queuedChanges) : local;
            publish({ record: display, saveFailed: true });
            // 競合で残せなかった振り返りは失敗のままにする。保存できた下書きだけ基準を進め、
            // 開始で消した下書きを未変更と見なして復活させない。
            if (sameDraft(local.draft, stored.draft)) {
              baseRecord = { ...base, draft: stored.draft };
            }
            settleOps(ops, 'failed');
            if (queuedChanges.length > 0) dirty = true;
            activeOpIds = [...followOps, ...activeOpIds];
          } else if (hypothesisCommitKeptForeignBound(base, local, stored)) {
            const merged = queuedChanges.length > 0 ? applyQueued(local, queuedChanges) : local;
            const display = withoutDraftConsumedByLaterStart(merged, stored);
            publish({ record: display, saveFailed: false });
            // 表示上の解除は残す。このタブが書いた下書きだけ基準を進め、
            // 開始で消した下書きを「未変更」と見なして復活させない。
            // 世代と bound は解除前のままにし、次の下書き保存が後発ランの解除にならないようにする。
            if (sameDraft(local.draft, stored.draft)) {
              baseRecord = { ...base, draft: stored.draft };
            }
            if (queuedChanges.length > 0) dirty = true;
            settleOps(ops, 'saved');
            activeOpIds = [...followOps, ...activeOpIds];
          } else {
            baseRecord = stored;
            settleOps(ops, 'saved');
            activeOpIds = [...followOps, ...activeOpIds];
            if (queuedChanges.length > 0) {
              publish({ ...snapshot, record: applyQueued(stored, queuedChanges) });
              dirty = true;
            } else if (!dirty) {
              publish({ record: stored, saveFailed: false });
            }
          }
        } catch {
          captureChanges = false;
          const follow = queuedDuringWrite.filter((item) => !isAbandonedOp(item.opId));
          const followOps = follow.flatMap((item) => (item.opId === undefined ? [] : [item.opId]));
          const followChanges = follow.map((item) => item.change);
          queuedDuringWrite = [];
          settleOps(ops, 'failed');
          // 失敗した確定操作だけを外す。それより前から残っている未保存の下書きは保持する。
          if (ops.length > 0) {
            const foundation =
              ops.reduce<HypothesisNoteRecord | null>(
                (found, id) => found ?? recordBeforeOp.get(id) ?? null,
                null,
              ) ?? local;
            for (const id of ops) recordBeforeOp.delete(id);
            const kept = ops.some((id) => restoreBoundOps.has(id)) ? local : foundation;
            publish({ record: applyQueued(kept, followChanges), saveFailed: true });
          }
          if (follow.length > 0) {
            activeOpIds = [...followOps, ...activeOpIds];
            dirty = true;
          }
          if (revertRecord && seq <= discardThroughSeq) {
            publish({ ...snapshot, record: revertRecord, saveFailed: true });
            revertRecord = null;
            revertSourceDraft = null;
            revertTypedDraft = null;
          } else if (!snapshot.saveFailed) {
            publish({ ...snapshot, saveFailed: true });
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
      const queuedChanges = queued.map((item) => item.change);
      const queuedOps = queued.flatMap((item) => (item.opId === undefined ? [] : [item.opId]));
      if (revertRecord) {
        const record =
          queuedChanges.length > 0 ? applyQueued(revertRecord, queuedChanges) : revertRecord;
        revertRecord = null;
        loaded = true;
        if (loading === attemptGate.current) loading = null;
        settleOps(queuedOps, 'failed');
        publish({ record, saveFailed: true });
        void persist();
        return;
      }
      // 保存値へ重ねる直前を残す。commit が失敗しても、確定前の下書きへ戻せる。
      let applied = stored;
      for (const item of queued) {
        if (item.opId !== undefined) recordBeforeOp.set(item.opId, applied);
        applied = item.change(applied);
      }
      const record = applied;
      loaded = true;
      if (loading === attemptGate.current) loading = null;
      publish({ ...snapshot, record });
      if (record !== stored) {
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
    const inflight = loading;
    return inflight.then(() => startLoad());
  };

  const update = (
    change: (record: HypothesisNoteRecord) => HypothesisNoteRecord,
    opId?: number,
  ) => {
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
    if (captureChanges) {
      queuedDuringWrite.push({ change, opId });
    } else if (opId !== undefined) {
      activeOpIds.push(opId);
    }
    publish({ ...snapshot, record: next });
    void persist();
  };

  const flush = async () => {
    await loading;
    while (writing) await writing;
  };

  const applyCommitted = async (
    change: (record: HypothesisNoteRecord) => HypothesisNoteRecord,
    options?: { restoreBound?: boolean },
  ): Promise<'unchanged' | 'saved' | 'failed'> => {
    const opId = nextOpId++;
    if (options?.restoreBound) restoreBoundOps.add(opId);
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
      restoreBoundOps.delete(opId);
      recordBeforeOp.delete(opId);
      return snapshot.saveFailed ? 'failed' : 'unchanged';
    }
    if (opState.get(opId) === 'pending') await settled;
    const status = opState.get(opId) ?? 'unchanged';
    opState.delete(opId);
    opWaiters.delete(opId);
    restoreBoundOps.delete(opId);
    recordBeforeOp.delete(opId);
    if (status === 'saved') return 'saved';
    if (status === 'failed') return 'failed';
    return 'unchanged';
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
    abandonUnpersistedStart() {
      publish({
        ...snapshot,
        record: { ...snapshot.record, bound: null },
        saveFailed: true,
      });
    },
    revertAbandonedStart(record) {
      discardThroughSeq = persistSeq;
      for (const [id, status] of opState) {
        if (status === 'pending') finishOp(id, 'failed');
      }
      queuedDuringWrite = queuedDuringWrite.filter((item) => !isAbandonedOp(item.opId));
      pending = pending.filter((item) => !isAbandonedOp(item.opId));
      if (!loaded) {
        // 初回読込前の空 snapshot で、保存済みメモを上書きしない。
        revertRecord = null;
        revertSourceDraft = null;
        revertTypedDraft = null;
        publish({ ...snapshot, saveFailed: true });
        return;
      }
      const current = snapshot.record;
      const typed = current.draft && !sameDraft(current.draft, record.draft) ? current.draft : null;
      revertSourceDraft = record.draft;
      revertTypedDraft = typed;
      const draft = appendAbandonedHypothesisDraft(record.draft, typed);
      const next = { ...record, draft };
      revertRecord = next;
      publish({ ...snapshot, record: next, saveFailed: true });
    },
    restoreBoundIfDetached(bound) {
      if (!bound) return Promise.resolve('unchanged');
      return applyCommitted((record) => (record.bound ? record : { ...record, bound }), {
        restoreBound: true,
      });
    },
  };
}

function sameDraft(a: HypothesisNoteRecord['draft'], b: HypothesisNoteRecord['draft']): boolean {
  return a && b ? a.text === b.text && a.writtenAt === b.writtenAt : a === b;
}

/** 後発開始が消費した下書きを、このタブの表示へ戻さない。 */
function withoutDraftConsumedByLaterStart(
  display: HypothesisNoteRecord,
  stored: HypothesisNoteRecord,
): HypothesisNoteRecord {
  if (
    display.draft &&
    !stored.draft &&
    stored.bound &&
    stored.bound.startId !== display.bound?.startId &&
    sameDraft(stored.bound.beforeStart, display.draft)
  ) {
    return { ...display, draft: null };
  }
  return display;
}

function defaultStorage(): HypothesisNoteStorage {
  return typeof indexedDB === 'undefined'
    ? new MemoryHypothesisNoteStorage()
    : new IndexedDbHypothesisNoteStorage();
}

export const hypothesisNoteStore: HypothesisNoteStore = createHypothesisNoteStore(defaultStorage());
