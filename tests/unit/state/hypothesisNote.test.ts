import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  createRunDiagnosticInfo,
  serializeRunDiagnosticInfo,
} from '../../../src/state/diagnosticInfo';
import {
  EMPTY_HYPOTHESIS_NOTE,
  HYPOTHESIS_NOTE_MAX_LENGTH,
  bindHypothesisToRun,
  commitHypothesisNote,
  detachHypothesisNote,
  undoAbandonedBind,
  editHypothesisDraft,
  hypothesisCommitDroppedSessionBound,
  hypothesisForRun,
  hypothesisNoteForExport,
  hypothesisRunKey,
  normalizeHypothesisNote,
  sanitizeHypothesisText,
  writeHypothesisReflection,
} from '../../../src/state/hypothesisNote';
import {
  IndexedDbHypothesisNoteStorage,
  MemoryHypothesisNoteStorage,
  createHypothesisNoteStore,
  type HypothesisNoteStorage,
} from '../../../src/state/hypothesisNotePersistence';
import { serializeStartRecipe } from '../../../src/state/startRecipe';
import { RunEngine } from '../../../src/sim/run/engine';
import { playRun } from '../helpers/runFlow';

const RUN = {
  runKind: 'normal' as const,
  dailyDate: undefined,
  seed: 'note-seed',
  difficulty: 'normal' as const,
  trials: ['b', 'a'],
  scenario: 'default' as const,
};

describe('開始前の仮説メモ（RI-295）', () => {
  it('入力を1行・上限内に整え、制御文字を落とす', () => {
    expect(sanitizeHypothesisText('育成\n優先\t<b>士気</b>\u0007')).toBe('育成 優先 <b>士気</b>');
    const long = 'あ'.repeat(HYPOTHESIS_NOTE_MAX_LENGTH + 10);
    expect(Array.from(sanitizeHypothesisText(long))).toHaveLength(HYPOTHESIS_NOTE_MAX_LENGTH);
    expect(Array.from(sanitizeHypothesisText('😀'.repeat(200)))).toHaveLength(
      HYPOTHESIS_NOTE_MAX_LENGTH,
    );
  });

  it('開始時に下書きを仮説として固定し、開始後の振り返りは別欄に残す', () => {
    const key = hypothesisRunKey(RUN);
    expect(key).toBe(hypothesisRunKey({ ...RUN, trials: ['a', 'b'] }));
    const drafted = editHypothesisDraft(EMPTY_HYPOTHESIS_NOTE, ' 採用より育成 ', 1000);
    expect(drafted.draft).toEqual({ text: ' 採用より育成 ', writtenAt: 1000 });

    const bound = bindHypothesisToRun(drafted, key, 'start-1');
    expect(bound.draft).toBeNull();
    expect(hypothesisForRun(bound, key, 'start-1')).toEqual({
      runKey: key,
      startId: 'start-1',
      beforeStart: { text: '採用より育成', writtenAt: 1000 },
      reflection: null,
    });

    const reflected = writeHypothesisReflection(
      bound,
      key,
      '育成は効いた。次は難易度を上げる',
      5000,
    );
    expect(reflected.bound?.beforeStart).toEqual(bound.bound?.beforeStart);
    expect(reflected.bound?.reflection).toEqual({
      text: '育成は効いた。次は難易度を上げる',
      writtenAt: 5000,
    });

    const exported = hypothesisNoteForExport(reflected.bound!);
    expect(exported.beforeStart).toEqual({
      text: '採用より育成',
      writtenAt: new Date(1000).toISOString(),
    });
    expect(exported.reflection?.writtenAt).toBe(new Date(5000).toISOString());
  });

  it('空欄で開始すると前回の仮説を外し、別ランには振り返りを書けない', () => {
    const key = hypothesisRunKey(RUN);
    const first = bindHypothesisToRun(editHypothesisDraft(EMPTY_HYPOTHESIS_NOTE, '狙い', 1), key);
    expect(editHypothesisDraft(first, '   ', 2).draft).toBeNull();

    const other = hypothesisRunKey({ ...RUN, seed: 'other' });
    expect(hypothesisForRun(first, other, first.bound?.startId ?? null)).toBeNull();
    expect(hypothesisForRun(first, key, 'other-start')).toBeNull();
    expect(hypothesisForRun(first, key, first.bound?.startId ?? null)).toBe(first.bound);
    expect(writeHypothesisReflection(first, other, '別ラン', 3)).toBe(first);

    const restarted = bindHypothesisToRun(first, key);
    expect(restarted.bound).toBeNull();
    expect(hypothesisForRun(restarted, key, null)).toBeNull();
    expect(
      hypothesisForRun(
        first,
        hypothesisRunKey({ ...RUN, scenario: 'copilot' }),
        first.bound?.startId ?? null,
      ),
    ).toBeNull();
    expect(detachHypothesisNote(first).bound).toBeNull();
    expect(detachHypothesisNote(restarted)).toBe(restarted);
  });

  it('読めない保存値は空のメモとして扱う', () => {
    expect(normalizeHypothesisNote(null)).toEqual(EMPTY_HYPOTHESIS_NOTE);
    expect(normalizeHypothesisNote({ schemaVersion: 2 })).toEqual(EMPTY_HYPOTHESIS_NOTE);
    expect(
      normalizeHypothesisNote({
        schemaVersion: 1,
        draft: { text: 'x'.repeat(500), writtenAt: 1 },
        bound: { runKey: '', beforeStart: { text: 'a', writtenAt: 1 } },
      }),
    ).toEqual({
      schemaVersion: 1,
      draft: { text: 'x'.repeat(HYPOTHESIS_NOTE_MAX_LENGTH), writtenAt: 1 },
      bound: null,
      generation: 0,
    });
    expect(
      normalizeHypothesisNote({
        schemaVersion: 1,
        draft: { text: 'a', writtenAt: Number.NaN },
        bound: {
          runKey: 'k',
          beforeStart: { text: ' 仮説 ', writtenAt: 2 },
          reflection: { text: 3, writtenAt: 4 },
        },
      }),
    ).toEqual({
      schemaVersion: 1,
      draft: null,
      bound: {
        runKey: 'k',
        startId: '',
        beforeStart: { text: '仮説', writtenAt: 2 },
        reflection: null,
      },
      generation: 0,
    });
  });

  it('再現情報は選んだときだけメモを末尾に含め、開始レシピには含めない', () => {
    const info = createRunDiagnosticInfo(
      {
        seed: RUN.seed,
        runKind: 'normal',
        dailyDate: undefined,
        difficulty: 'normal',
        trials: [],
        phase: 'won',
        status: 'won',
        diagnosis: 'healthyAcceleration',
      },
      null,
    );
    const plain = serializeRunDiagnosticInfo(info);
    expect(JSON.parse(plain)).not.toHaveProperty('hypothesisNote');
    const key = hypothesisRunKey(RUN);
    const note = bindHypothesisToRun(
      editHypothesisDraft(EMPTY_HYPOTHESIS_NOTE, '狙い', 1),
      key,
    ).bound!;
    const withNote = JSON.parse(serializeRunDiagnosticInfo(info, hypothesisNoteForExport(note)));
    expect(withNote.hypothesisNote.beforeStart.text).toBe('狙い');
    expect(Object.keys(withNote).at(-1)).toBe('hypothesisNote');

    const recipe = serializeStartRecipe({
      seed: RUN.seed,
      difficulty: 'normal',
      trials: [],
      scenario: 'default',
      preferredCardIds: [],
    });
    expect(recipe).not.toContain('狙い');
  });

  it('メモの読み書きは同じseedのランの進行を変えない', () => {
    const play = () => {
      const engine = new RunEngine({ seed: RUN.seed });
      engine.startRun('easy', [], RUN.seed);
      const end = playRun(engine);
      expect(['won', 'lost']).toContain(end.status);
      return JSON.stringify(end);
    };
    const before = play();
    const key = hypothesisRunKey(RUN);
    const record = writeHypothesisReflection(
      bindHypothesisToRun(editHypothesisDraft(EMPTY_HYPOTHESIS_NOTE, '狙い', 1), key),
      key,
      '振り返り',
      2,
    );
    expect(hypothesisForRun(record, key, record.bound?.startId ?? null)).not.toBeNull();
    expect(hypothesisForRun(record, key, 'other-start')).toBeNull();
    expect(play()).toBe(before);
  });
});

describe('仮説メモの保存', () => {
  it('入力中の書き込みをまとめ、最新の値だけを最後に保存する', async () => {
    const saved: string[] = [];
    let release: () => void = () => {};
    const storage: HypothesisNoteStorage = {
      load: async () => undefined,
      commit: async (local) => {
        saved.push(local.draft?.text ?? '');
        if (saved.length === 1) await new Promise<void>((resolve) => (release = resolve));
        return { ...local, generation: local.generation + 1 };
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    store.update((r) => editHypothesisDraft(r, 'a', 1));
    store.update((r) => editHypothesisDraft(r, 'ab', 2));
    store.update((r) => editHypothesisDraft(r, 'abc', 3));
    release();
    await store.flush();
    expect(saved).toEqual(['a', 'abc']);
  });

  it('保存失敗を伝え、次の保存成功で解除する。読み込み前の編集は上書きしない', async () => {
    let fail = true;
    const storage: HypothesisNoteStorage = {
      load: async () => ({
        schemaVersion: 1,
        draft: { text: '古い', writtenAt: 1 },
        bound: {
          runKey: 'kept',
          beforeStart: { text: '残す', writtenAt: 1 },
          reflection: null,
        },
        generation: 2,
      }),
      commit: async (local) => {
        if (fail) throw new Error('quota');
        return { ...local, generation: local.generation + 1 };
      },
    };
    const store = createHypothesisNoteStore(storage);
    let notified = 0;
    store.subscribe(() => (notified += 1));
    store.update((r) => editHypothesisDraft(r, '新しい', 2));
    await store.load();
    await store.flush();
    expect(store.getSnapshot()).toMatchObject({
      saveFailed: true,
      record: { draft: { text: '新しい' }, bound: { runKey: 'kept' } },
    });
    fail = false;
    store.update((r) => editHypothesisDraft(r, '新しい!', 3));
    await store.flush();
    expect(store.getSnapshot().saveFailed).toBe(false);
    expect(notified).toBeGreaterThan(0);
  });

  it('読み込み失敗でも空のメモで続ける', async () => {
    const store = createHypothesisNoteStore({
      load: async () => {
        throw new Error('blocked');
      },
      commit: async (local) => local,
    });
    await store.load();
    expect(store.getSnapshot()).toEqual({ record: EMPTY_HYPOTHESIS_NOTE, saveFailed: false });
  });

  it('IndexedDB の専用ストアへ保存し、別の読み込みで復元できる', async () => {
    const dbName = `hypothesis-note-${Math.random()}`;
    const store = createHypothesisNoteStore(new IndexedDbHypothesisNoteStorage(dbName));
    await store.load();
    store.update((r) => editHypothesisDraft(r, '端末に残す', 10));
    await store.flush();

    const reloaded = createHypothesisNoteStore(new IndexedDbHypothesisNoteStorage(dbName));
    await reloaded.load();
    expect(reloaded.getSnapshot().record).toMatchObject({
      draft: { text: '端末に残す', writtenAt: 10 },
      generation: 1,
    });
  });

  it('読み込み完了前の開始は、保存済み下書きを仮説にする', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '保存済み', writtenAt: 4 },
      bound: null,
      generation: 2,
    };
    const store = createHypothesisNoteStore(memory);
    store.update((record) => bindHypothesisToRun(record, 'late'));
    await store.load();
    await store.flush();
    expect(store.getSnapshot().record.draft).toBeNull();
    expect(store.getSnapshot().record.bound?.beforeStart.text).toBe('保存済み');
    expect(normalizeHypothesisNote(memory.value).generation).toBe(3);
  });

  it('読み込み前の解除は、空の表示でも保存済みの仮説へ適用する', async () => {
    let release: () => void = () => {};
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      bound: {
        runKey: 'local',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
      generation: 2,
    };
    const storage: HypothesisNoteStorage = {
      load: async () => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return memory.load();
      },
      commit: (local, base) => memory.commit(local, base),
    };
    const store = createHypothesisNoteStore(storage);
    const loading = store.load();
    store.update((record) => detachHypothesisNote(record));
    release();
    await loading;
    await store.flush();
    expect(store.getSnapshot().record.bound).toBeNull();
    expect(normalizeHypothesisNote(memory.value).bound).toBeNull();
  });

  it('別ランの振り返りは、後から始まったランの仮説を戻さない', () => {
    const base = {
      ...EMPTY_HYPOTHESIS_NOTE,
      generation: 1,
      bound: {
        runKey: 'run-a',
        startId: 'start-a',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
    };
    const reflected = {
      ...base,
      bound: {
        ...base.bound,
        reflection: { text: '振り返り', writtenAt: 5 },
      },
    };
    const laterRun = {
      ...EMPTY_HYPOTHESIS_NOTE,
      generation: 2,
      bound: {
        runKey: 'run-b',
        startId: 'start-b',
        beforeStart: { text: '別の狙い', writtenAt: 3 },
        reflection: null,
      },
    };
    expect(commitHypothesisNote(base, reflected, laterRun).bound).toEqual(laterRun.bound);
    const sameKeyOtherHypothesis = {
      ...laterRun,
      bound: {
        ...laterRun.bound,
        runKey: base.bound.runKey,
      },
    };
    expect(commitHypothesisNote(base, reflected, sameKeyOtherHypothesis).bound).toEqual(
      sameKeyOtherHypothesis.bound,
    );
    const sameTextOtherStart = {
      ...base,
      generation: 2,
      bound: { ...base.bound, startId: 'start-other' },
    };
    expect(commitHypothesisNote(base, reflected, sameTextOtherStart).bound).toEqual(
      sameTextOtherStart.bound,
    );
    expect(
      commitHypothesisNote(base, reflected, { ...base, generation: 2 }).bound?.reflection,
    ).toEqual({ text: '振り返り', writtenAt: 5 });
  });

  it('開始時の下書き削除は、別タブが更新した下書きを消さない', () => {
    const base = {
      ...EMPTY_HYPOTHESIS_NOTE,
      generation: 1,
      draft: { text: '古い', writtenAt: 1 },
    };
    const local = bindHypothesisToRun(base, 'run-a', 'start-a');
    const newer = {
      ...base,
      generation: 2,
      draft: { text: '新しい', writtenAt: 3 },
    };
    const kept = commitHypothesisNote(base, local, newer);
    expect(kept.draft?.text).toBe('新しい');
    expect(kept.bound?.beforeStart.text).toBe('古い');
    expect(commitHypothesisNote(base, local, { ...base, generation: 2 }).draft).toBeNull();
  });

  it('後発開始が消費した下書きは、タイムアウト復元で復活させない', () => {
    const draft = { text: '狙い', writtenAt: 1 };
    const base = {
      ...EMPTY_HYPOTHESIS_NOTE,
      generation: 2,
      draft: null,
      bound: {
        runKey: 'run-a',
        startId: 'start-a',
        beforeStart: draft,
        reflection: null,
      },
    };
    const local = { ...base, draft, bound: null };
    const later = {
      ...base,
      generation: 3,
      bound: {
        runKey: 'run-b',
        startId: 'start-b',
        beforeStart: draft,
        reflection: null,
      },
    };
    const kept = commitHypothesisNote(base, local, later);
    expect(kept.draft).toBeNull();
    expect(kept.bound?.startId).toBe('start-b');
  });

  it('古いタブの解除は、後発ランの仮説を消さない', () => {
    const base = {
      ...EMPTY_HYPOTHESIS_NOTE,
      generation: 1,
      bound: {
        runKey: 'run-a',
        startId: 'old',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
    };
    const local = detachHypothesisNote(base);
    const later = {
      ...base,
      generation: 2,
      bound: {
        runKey: 'run-b',
        startId: 'new',
        beforeStart: { text: '後', writtenAt: 4 },
        reflection: null,
      },
    };
    expect(commitHypothesisNote(base, local, later).bound).toEqual(later.bound);
    expect(commitHypothesisNote(base, local, { ...base, generation: 2 }).bound).toBeNull();
  });

  it('競合した後も先発ランの振り返りを画面に残す', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 1,
      bound: {
        runKey: 'run-a',
        startId: 'a',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
    };
    const store = createHypothesisNoteStore(memory);
    await store.load();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 2,
      bound: {
        runKey: 'run-b',
        startId: 'b',
        beforeStart: { text: '別', writtenAt: 2 },
        reflection: null,
      },
    };
    store.update((record) => writeHypothesisReflection(record, 'run-a', '振り返り', 5));
    await store.flush();
    expect(store.getSnapshot().saveFailed).toBe(true);
    expect(store.getSnapshot().record.bound).toMatchObject({
      startId: 'a',
      reflection: { text: '振り返り' },
    });
    expect(normalizeHypothesisNote(memory.value).bound?.startId).toBe('b');
    expect(
      hypothesisCommitDroppedSessionBound(
        {
          ...EMPTY_HYPOTHESIS_NOTE,
          generation: 1,
          bound: {
            runKey: 'run-a',
            startId: 'a',
            beforeStart: { text: '狙い', writtenAt: 1 },
            reflection: null,
          },
        },
        store.getSnapshot().record,
        normalizeHypothesisNote(memory.value),
      ),
    ).toBe(true);
  });

  it('振り返りの競合後に保存した下書きは、開始で消費される', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 1,
      bound: {
        runKey: 'run-a',
        startId: 'a',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
    };
    const store = createHypothesisNoteStore(memory);
    await store.load();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 2,
      bound: {
        runKey: 'run-b',
        startId: 'b',
        beforeStart: { text: '別', writtenAt: 2 },
        reflection: null,
      },
    };
    store.update((record) => writeHypothesisReflection(record, 'run-a', '振り返り', 5));
    await store.flush();
    expect(store.getSnapshot().saveFailed).toBe(true);
    store.update((record) => editHypothesisDraft(record, '次回', 9));
    await store.flush();
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('次回');
    expect(normalizeHypothesisNote(memory.value).bound?.startId).toBe('b');
    store.update((record) => bindHypothesisToRun(record, 'run-c', 'start-c'));
    await store.flush();
    const stored = normalizeHypothesisNote(memory.value);
    expect(stored.draft).toBeNull();
    expect(stored.bound).toMatchObject({ startId: 'start-c', beforeStart: { text: '次回' } });
    expect(store.getSnapshot().record.draft).toBeNull();
  });

  it('先行する保存の失敗は、待ち行列の解除を失敗にしない', async () => {
    let release = () => {};
    let gate = Promise.resolve();
    const arm = () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    let failNext = false;
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '狙い', writtenAt: 1 },
      generation: 1,
      bound: {
        runKey: 'run-a',
        startId: 'a',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
    };
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        await gate;
        if (failNext) {
          failNext = false;
          throw new Error('quota');
        }
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    arm();
    failNext = true;
    store.update((record) => editHypothesisDraft(record, '変更', 2));
    const saving = store.applyCommitted((record) => detachHypothesisNote(record));
    release();
    expect(await saving).toBe('saved');
    await store.flush();
    expect(store.getSnapshot().record.bound).toBeNull();
    expect(normalizeHypothesisNote(memory.value).bound).toBeNull();
  });

  it('進行中の読み込みが失敗したあとの再呼び出しは、もう一度読む', async () => {
    let calls = 0;
    let release: () => void = () => {};
    const storage: HypothesisNoteStorage = {
      load: async () => {
        calls += 1;
        if (calls === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          throw new Error('blocked');
        }
        return {
          schemaVersion: 1,
          draft: { text: '保存済み', writtenAt: 1 },
          bound: null,
          generation: 1,
        };
      },
      commit: async (local) => local,
    };
    const store = createHypothesisNoteStore(storage);
    const first = store.load();
    const second = store.load();
    release();
    await second;
    await first;
    expect(calls).toBe(2);
    expect(store.getSnapshot().record.draft?.text).toBe('保存済み');
  });

  it('下書きだけの保存は、後発ランを振り返りの消失にしない', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 1,
      bound: {
        runKey: 'run-a',
        startId: 'a',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
    };
    const store = createHypothesisNoteStore(memory);
    await store.load();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 2,
      bound: {
        runKey: 'run-b',
        startId: 'b',
        beforeStart: { text: '別', writtenAt: 2 },
        reflection: null,
      },
    };
    store.update((record) => editHypothesisDraft(record, '次回', 9));
    await store.flush();
    expect(store.getSnapshot().saveFailed).toBe(false);
    expect(store.getSnapshot().record.bound?.startId).toBe('b');
    expect(store.getSnapshot().record.draft?.text).toBe('次回');
  });

  it('取り込み側は競合する後発仮説を表示しない', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 1,
      bound: {
        runKey: 'run-a',
        startId: 'old',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
    };
    const store = createHypothesisNoteStore(memory);
    await store.load();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 2,
      bound: {
        runKey: 'run-b',
        startId: 'new',
        beforeStart: { text: '後', writtenAt: 4 },
        reflection: null,
      },
    };
    const detached = await store.applyCommitted((record) => detachHypothesisNote(record));
    expect(detached).toBe('saved');
    expect(store.getSnapshot().record.bound).toBeNull();
    expect(store.getSnapshot().saveFailed).toBe(false);
    expect(normalizeHypothesisNote(memory.value).bound?.startId).toBe('new');
  });

  it('競合する解除のあと、このタブが保存した下書きは開始で消費される', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 1,
      bound: {
        runKey: 'run-a',
        startId: 'old',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
    };
    const store = createHypothesisNoteStore(memory);
    await store.load();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 2,
      bound: {
        runKey: 'run-b',
        startId: 'new',
        beforeStart: { text: '後', writtenAt: 4 },
        reflection: null,
      },
    };
    expect(await store.applyCommitted((record) => detachHypothesisNote(record))).toBe('saved');
    store.update((record) => editHypothesisDraft(record, '次回', 9));
    await store.flush();
    expect(store.getSnapshot().record.bound).toBeNull();
    expect(normalizeHypothesisNote(memory.value).bound?.startId).toBe('new');
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('次回');
    store.update((record) => bindHypothesisToRun(record, 'run-c', 'start-c'));
    await store.flush();
    const stored = normalizeHypothesisNote(memory.value);
    expect(stored.draft).toBeNull();
    expect(stored.bound).toMatchObject({ startId: 'start-c', beforeStart: { text: '次回' } });
    expect(store.getSnapshot().record.draft).toBeNull();
  });

  it('開始保存を諦めたあとの成功は、開始前の下書きを端末へ戻す', async () => {
    let release = () => {};
    let gate = Promise.resolve();
    const arm = () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const memory = new MemoryHypothesisNoteStorage();
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        await gate;
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    arm();
    store.update((record) => editHypothesisDraft(record, '残す仮説', 3));
    release();
    await store.flush();
    const before = store.getSnapshot().record;
    arm();
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    store.revertAbandonedStart(before);
    release();
    await saving;
    await store.flush();
    const stored = normalizeHypothesisNote(memory.value);
    expect(stored.draft?.text).toBe('残す仮説');
    expect(stored.bound).toBeNull();
    expect(store.getSnapshot().record.draft?.text).toBe('残す仮説');
    expect(store.getSnapshot().record.bound).toBeNull();
  });

  it('開始保存のタイムアウトは、打ち切った仮説に待ち時間の追記をつなげる', async () => {
    let release = () => {};
    let gate = Promise.resolve();
    const arm = () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const memory = new MemoryHypothesisNoteStorage();
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        await gate;
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    arm();
    store.update((record) => editHypothesisDraft(record, '仮説 A', 3));
    release();
    await store.flush();
    const before = store.getSnapshot().record;
    arm();
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    store.update((record) => editHypothesisDraft(record, '追記 B', 8));
    store.revertAbandonedStart(before);
    release();
    await saving;
    await store.flush();
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('仮説 A追記 B');
    expect(normalizeHypothesisNote(memory.value).bound).toBeNull();
    expect(store.getSnapshot().record.draft?.text).toBe('仮説 A追記 B');
  });

  it('固定の成功は、直後の下書き保存失敗では失敗にしない', async () => {
    let release = () => {};
    let gate = Promise.resolve();
    const arm = () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    let failDraft = false;
    const memory = new MemoryHypothesisNoteStorage();
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        await gate;
        if (failDraft && local.draft?.text === '次回') throw new Error('quota');
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    arm();
    store.update((record) => editHypothesisDraft(record, '狙い', 1));
    release();
    await store.flush();
    arm();
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    failDraft = true;
    store.update((record) => editHypothesisDraft(record, '次回', 4));
    release();
    expect(await saving).toBe('saved');
    await store.flush();
    expect(store.getSnapshot().saveFailed).toBe(true);
    expect(store.getSnapshot().record.bound?.startId).toBe('start-c');
    expect(normalizeHypothesisNote(memory.value).bound?.startId).toBe('start-c');
  });

  it('開始保存のタイムアウトは、書き込み待ちの固定をやり直さない', async () => {
    let release = () => {};
    let gate = Promise.resolve();
    const arm = () => {
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const memory = new MemoryHypothesisNoteStorage();
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        await gate;
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    arm();
    store.update((record) => editHypothesisDraft(record, '残す仮説', 2));
    const before = store.getSnapshot().record;
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    store.revertAbandonedStart(before);
    release();
    await saving;
    await store.flush();
    expect(store.getSnapshot().record.draft?.text).toBe('残す仮説');
    expect(store.getSnapshot().record.bound).toBeNull();
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('残す仮説');
    expect(normalizeHypothesisNote(memory.value).bound).toBeNull();
  });

  it('仮説が無い解除は、以前の保存失敗で失敗にしない', async () => {
    let fail = true;
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '下書き', writtenAt: 1 },
      bound: null,
      generation: 1,
    };
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        if (fail) throw new Error('quota');
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    store.update((record) => editHypothesisDraft(record, '変更', 2));
    await store.flush();
    expect(store.getSnapshot().saveFailed).toBe(true);
    fail = false;
    expect(await store.applyCommitted((record) => detachHypothesisNote(record))).toBe('unchanged');
  });

  it('別タブの下書き編集は、先に始まったランの仮説を消さない', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = { ...editHypothesisDraft(EMPTY_HYPOTHESIS_NOTE, 'abc', 1), generation: 1 };
    const first = createHypothesisNoteStore(memory);
    const second = createHypothesisNoteStore(memory);
    await first.load();
    await second.load();
    first.update((record) => bindHypothesisToRun(record, 'run-a'));
    await first.flush();
    second.update((record) => editHypothesisDraft(record, 'abcd', 2));
    await second.flush();
    const stored = normalizeHypothesisNote(memory.value);
    expect(stored.draft?.text).toBe('abcd');
    expect(stored.bound).toMatchObject({ runKey: 'run-a', beforeStart: { text: 'abc' } });
  });

  it('読み込み失敗後の開始は、再読込した下書きを仮説にし、失敗中は端末を上書きしない', async () => {
    let fail = true;
    let commits = 0;
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '保存済み', writtenAt: 4 },
      bound: null,
      generation: 2,
    };
    const storage: HypothesisNoteStorage = {
      load: async () => {
        if (fail) throw new Error('blocked');
        return memory.load();
      },
      commit: async (local, base) => {
        commits += 1;
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    store.update((record) => bindHypothesisToRun(record, 'late'));
    await store.flush();
    expect(commits).toBe(0);
    expect(store.getSnapshot().saveFailed).toBe(true);
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('保存済み');

    fail = false;
    await store.load();
    await store.flush();
    expect(store.getSnapshot().saveFailed).toBe(false);
    expect(store.getSnapshot().record.draft).toBeNull();
    expect(store.getSnapshot().record.bound?.beforeStart.text).toBe('保存済み');
  });

  it('失敗として返した開始は、後の読み込みで下書きを消費しない', async () => {
    let fail = true;
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '保存済み', writtenAt: 4 },
      bound: null,
      generation: 2,
    };
    const storage: HypothesisNoteStorage = {
      load: async () => {
        if (fail) throw new Error('blocked');
        return memory.load();
      },
      commit: async (local, base) => memory.commit(local, base),
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    expect(
      await store.applyCommitted((record) => bindHypothesisToRun(record, 'late', 'ghost')),
    ).toBe('failed');
    fail = false;
    await store.load();
    await store.flush();
    expect(store.getSnapshot().record.draft?.text).toBe('保存済み');
    expect(store.getSnapshot().record.bound).toBeNull();
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('保存済み');
    expect(normalizeHypothesisNote(memory.value).bound).toBeNull();
  });

  it('保留した入力を保存値へ重ねても、渡した記入時刻を変えない', async () => {
    let release = () => {};
    const storage: HypothesisNoteStorage = {
      load: () =>
        new Promise((resolve) => {
          release = () => resolve(undefined);
        }),
      commit: async (local) => local,
    };
    const store = createHypothesisNoteStore(storage);
    const loading = store.load();
    store.update((record) => editHypothesisDraft(record, '狙い', 1234));
    release();
    await loading;
    await store.flush();
    expect(store.getSnapshot().record.draft).toEqual({ text: '狙い', writtenAt: 1234 });
  });

  it('固定が確定したら、後続の下書き保存を待たずに結果を返す', async () => {
    let releaseDraft = () => {};
    const draftGate = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    const memory = new MemoryHypothesisNoteStorage();
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        if (local.draft?.text === '次回') await draftGate;
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    store.update((record) => editHypothesisDraft(record, '狙い', 1));
    await store.flush();
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    store.update((record) => editHypothesisDraft(record, '次回', 4));
    const result = await Promise.race([
      saving,
      new Promise<string>((resolve) => {
        setTimeout(() => resolve('still-waiting'), 50);
      }),
    ]);
    expect(result).toBe('saved');
    releaseDraft();
    await store.flush();
    expect(store.getSnapshot().record.bound?.startId).toBe('start-c');
    expect(store.getSnapshot().record.draft?.text).toBe('次回');
  });

  it('開始保存のタイムアウトは、別タブの新しい下書きを戻さない', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '古い', writtenAt: 1 },
      bound: null,
      generation: 1,
    };
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        await gate;
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    const before = store.getSnapshot().record;
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    store.revertAbandonedStart(before);
    memory.value = {
      schemaVersion: 1,
      draft: { text: '新しい', writtenAt: 9 },
      bound: null,
      generation: 2,
    };
    release();
    await saving;
    await store.flush();
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('新しい');
    expect(normalizeHypothesisNote(memory.value).bound).toBeNull();
  });

  it('開始保存のタイムアウトは、別タブの後発仮説を戻さない', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = {
      runKey: 'run-old',
      startId: 'old',
      beforeStart: { text: '前', writtenAt: 1 },
      reflection: null,
    };
    const later = {
      runKey: 'run-new',
      startId: 'later',
      beforeStart: { text: '後', writtenAt: 8 },
      reflection: null,
    };
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '前', writtenAt: 1 },
      bound: previous,
      generation: 1,
    };
    let replaced = false;
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        await gate;
        const result = await memory.commit(local, base);
        if (!replaced) {
          replaced = true;
          memory.value = {
            schemaVersion: 1,
            draft: null,
            bound: later,
            generation: result.generation + 1,
          };
        }
        return result;
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    const before = store.getSnapshot().record;
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    store.revertAbandonedStart(before);
    release();
    await saving;
    await store.flush();
    expect(normalizeHypothesisNote(memory.value).bound?.startId).toBe('later');
  });

  it('開始保存のタイムアウトは、後発開始が消費した下書きを戻さない', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const draft = { text: '狙い', writtenAt: 1 };
    const later = {
      runKey: 'run-new',
      startId: 'later',
      beforeStart: draft,
      reflection: null,
    };
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = { schemaVersion: 1, draft, bound: null, generation: 1 };
    let replaced = false;
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        await gate;
        const result = await memory.commit(local, base);
        if (!replaced) {
          replaced = true;
          memory.value = {
            schemaVersion: 1,
            draft: null,
            bound: later,
            generation: result.generation + 1,
          };
        }
        return result;
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    const before = store.getSnapshot().record;
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    store.revertAbandonedStart(before);
    release();
    await saving;
    await store.flush();
    const stored = normalizeHypothesisNote(memory.value);
    expect(stored.draft).toBeNull();
    expect(stored.bound?.startId).toBe('later');
    expect(store.getSnapshot().record.draft).toBeNull();
  });

  it('初回読込前のタイムアウトは、保存済みメモを消さない', async () => {
    let release = () => {};
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '保存済み', writtenAt: 4 },
      bound: null,
      generation: 1,
    };
    const storage: HypothesisNoteStorage = {
      load: () =>
        new Promise((resolve) => {
          release = () => resolve(memory.value);
        }),
      commit: async (local, base) => memory.commit(local, base),
    };
    const store = createHypothesisNoteStore(storage);
    const loading = store.load();
    const saving = store.applyCommitted((record) => bindHypothesisToRun(record, 'late', 'ghost'));
    store.revertAbandonedStart(store.getSnapshot().record);
    release();
    await loading;
    await saving;
    await store.flush();
    expect(store.getSnapshot().record.draft?.text).toBe('保存済み');
    expect(store.getSnapshot().record.bound).toBeNull();
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('保存済み');
    expect(normalizeHypothesisNote(memory.value).bound).toBeNull();
  });

  it('初回読込中の確定失敗では、操作前の下書きを戻す', async () => {
    let release = () => {};
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '保存済み', writtenAt: 1 },
      bound: null,
      generation: 1,
    };
    const storage: HypothesisNoteStorage = {
      load: () =>
        new Promise((resolve) => {
          release = () => resolve(memory.value);
        }),
      commit: async () => {
        throw new Error('quota');
      },
    };
    const store = createHypothesisNoteStore(storage);
    const loading = store.load();
    store.update((record) => editHypothesisDraft(record, '狙い', 2));
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    release();
    await loading;
    expect(await saving).toBe('failed');
    store.abandonUnpersistedStart();
    expect(store.getSnapshot().record.draft?.text).toBe('狙い');
    expect(store.getSnapshot().record.bound).toBeNull();
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('保存済み');
  });

  it('読み込み失敗の確定では、操作前の下書きを戻す', async () => {
    const storage: HypothesisNoteStorage = {
      load: async () => {
        throw new Error('blocked');
      },
      commit: async () => {
        throw new Error('quota');
      },
    };
    const store = createHypothesisNoteStore(storage);
    const loading = store.load();
    store.update((record) => editHypothesisDraft(record, '仮説 A', 2));
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    await loading;
    expect(await saving).toBe('failed');
    store.abandonUnpersistedStart();
    expect(store.getSnapshot().record.draft?.text).toBe('仮説 A');
    expect(store.getSnapshot().record.bound).toBeNull();
  });

  it('解除の復元は、別タブの後発仮説を上書きしない', async () => {
    const oldBound = {
      runKey: 'run-old',
      startId: 'old',
      beforeStart: { text: '前', writtenAt: 1 },
      reflection: null,
    };
    const later = {
      runKey: 'run-new',
      startId: 'later',
      beforeStart: { text: '後', writtenAt: 2 },
      reflection: null,
    };
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = { schemaVersion: 1, draft: null, bound: oldBound, generation: 1 };
    const store = createHypothesisNoteStore(memory);
    await store.load();
    await store.applyCommitted((record) => detachHypothesisNote(record));
    memory.value = { schemaVersion: 1, draft: null, bound: later, generation: 3 };
    await store.restoreBoundIfDetached(oldBound);
    expect(normalizeHypothesisNote(memory.value).bound?.startId).toBe('later');
  });

  it('開始の取消は、待ち時間に書いた下書きを戻さない', () => {
    const before = {
      ...EMPTY_HYPOTHESIS_NOTE,
      draft: { text: '消費前', writtenAt: 1 },
    };
    const typed = {
      ...before,
      draft: { text: '入力中', writtenAt: 2 },
      bound: {
        runKey: 'run-c',
        startId: 'start-c',
        beforeStart: { text: '消費前', writtenAt: 1 },
        reflection: null,
      },
    };
    const undone = undoAbandonedBind(typed, before, 'start-c');
    expect(undone.draft?.text).toBe('入力中');
    expect(undone.bound).toBeNull();
  });

  it('確定の失敗は、それより前の未保存下書きを戻さない', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: null,
      generation: 1,
      bound: {
        runKey: 'run-a',
        startId: 'keep',
        beforeStart: { text: '狙い', writtenAt: 1 },
        reflection: null,
      },
    };
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        if (local.draft?.text === '未保存') throw new Error('quota');
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    store.update((record) => editHypothesisDraft(record, '未保存', 2));
    await store.flush();
    expect(store.getSnapshot().saveFailed).toBe(true);
    expect(store.getSnapshot().record.draft?.text).toBe('未保存');
    expect(await store.applyCommitted((record) => detachHypothesisNote(record))).toBe('failed');
    expect(store.getSnapshot().record.draft?.text).toBe('未保存');
    expect(store.getSnapshot().record.bound?.startId).toBe('keep');
  });

  it('失敗した固定は、待ち時間の下書きと一緒に保存しない', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const memory = new MemoryHypothesisNoteStorage();
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        if (local.bound?.startId === 'start-c') {
          await gate;
          throw new Error('quota');
        }
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    store.update((record) => editHypothesisDraft(record, '狙い', 1));
    await store.flush();
    const saving = store.applyCommitted((record) =>
      bindHypothesisToRun(record, 'run-c', 'start-c'),
    );
    store.update((record) => editHypothesisDraft(record, '次回', 4));
    release();
    expect(await saving).toBe('failed');
    await store.flush();
    expect(normalizeHypothesisNote(memory.value).bound).toBeNull();
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('次回');
  });

  it('保存中の追加入力は、別タブが先に書いた仮説を消さない', async () => {
    let release: () => void = () => {};
    let commits = 0;
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = { ...editHypothesisDraft(EMPTY_HYPOTHESIS_NOTE, 'abc', 1), generation: 1 };
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        commits += 1;
        if (commits === 1) {
          const current = normalizeHypothesisNote(memory.value);
          memory.value = commitHypothesisNote(
            current,
            bindHypothesisToRun(current, 'other'),
            current,
          );
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return memory.commit(local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    store.update((record) => editHypothesisDraft(record, 'abcd', 2));
    store.update((record) => editHypothesisDraft(record, 'abcde', 3));
    release();
    await store.flush();
    const stored = normalizeHypothesisNote(memory.value);
    expect(stored.draft?.text).toBe('abcde');
    expect(stored.bound).toMatchObject({ runKey: 'other', beforeStart: { text: 'abc' } });
  });
});
