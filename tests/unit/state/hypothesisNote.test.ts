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
  editHypothesisDraft,
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

    const bound = bindHypothesisToRun(drafted, key);
    expect(bound.draft).toBeNull();
    expect(hypothesisForRun(bound, key)).toEqual({
      runKey: key,
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
    expect(hypothesisForRun(first, other)).toBeNull();
    expect(writeHypothesisReflection(first, other, '別ラン', 3)).toBe(first);

    const restarted = bindHypothesisToRun(first, key);
    expect(restarted.bound).toBeNull();
    expect(hypothesisForRun(restarted, key)).toBeNull();
    expect(hypothesisForRun(first, hypothesisRunKey({ ...RUN, scenario: 'copilot' }))).toBeNull();
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
      bound: { runKey: 'k', beforeStart: { text: '仮説', writtenAt: 2 }, reflection: null },
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
    expect(hypothesisForRun(record, key)).not.toBeNull();
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
    expect(
      commitHypothesisNote(base, reflected, { ...base, generation: 2 }).bound?.reflection,
    ).toEqual({ text: '振り返り', writtenAt: 5 });
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
