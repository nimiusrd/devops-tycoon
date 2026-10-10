import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import {
  createRunDiagnosticInfo,
  serializeRunDiagnosticInfo,
} from '../../../src/state/diagnosticInfo';
import {
  EMPTY_HYPOTHESIS_NOTE,
  HYPOTHESIS_NOTE_MAX_LENGTH,
  commitHypothesisNote,
  consumeDraftRevision,
  editHypothesisDraft,
  hypothesisDraftConflict,
  hypothesisForRun,
  hypothesisNoteForExport,
  hypothesisRunKey,
  normalizeHypothesisNote,
  prepareHypothesis,
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
import { playRun } from '../helpers/runFlow';

const RUN = {
  runKind: 'normal' as const,
  dailyDate: undefined,
  seed: 'note-seed',
  difficulty: 'normal' as const,
  trials: ['b', 'a'],
  scenario: 'default' as const,
};

describe('仮説メモ', () => {
  it('入力を1行・上限内に整え、制御文字を落とす', () => {
    expect(sanitizeHypothesisText(' a\nb\tc ')).toBe(' a b c ');
    expect(sanitizeHypothesisText('x\u0000y')).toBe('xy');
    expect(sanitizeHypothesisText('あ'.repeat(HYPOTHESIS_NOTE_MAX_LENGTH + 5))).toHaveLength(
      HYPOTHESIS_NOTE_MAX_LENGTH,
    );
  });

  it('準備は下書きを消さず、同じ開始IDの本文は変えない', () => {
    const drafted = editHypothesisDraft(EMPTY_HYPOTHESIS_NOTE, '狙い', 1);
    const prepared = prepareHypothesis(drafted, 'run-a', 'start-1', {
      text: ' 狙い ',
      writtenAt: 1,
    });
    expect(prepared.draft?.text).toBe('狙い');
    expect(prepared.notes['start-1']?.beforeStart).toEqual({ text: '狙い', writtenAt: 1 });
    const changed = prepareHypothesis(prepared, 'run-a', 'start-1', {
      text: '別の本文',
      writtenAt: 9,
    });
    expect(changed).toBe(prepared);
  });

  it('振り返りは対象の開始IDだけを変え、別IDと開始前本文は残す', () => {
    const key = hypothesisRunKey(RUN);
    const withNotes = prepareHypothesis(
      prepareHypothesis(EMPTY_HYPOTHESIS_NOTE, key, 'start-1', { text: '狙い', writtenAt: 1 }),
      'other',
      'start-2',
      { text: '別', writtenAt: 2 },
    );
    const reflected = writeHypothesisReflection(withNotes, key, 'start-1', '振り返り', 3);
    expect(reflected.notes['start-1']).toEqual({
      runKey: key,
      beforeStart: { text: '狙い', writtenAt: 1 },
      reflection: { text: '振り返り', writtenAt: 3 },
    });
    expect(reflected.notes['start-2']).toBe(withNotes.notes['start-2']);
    expect(hypothesisForRun(reflected, key, 'start-1')?.reflection?.text).toBe('振り返り');
    expect(hypothesisForRun(reflected, key, 'start-2')).toBeNull();
    expect(hypothesisForRun(reflected, 'other', 'start-1')).toBeNull();
  });

  it('採用できた版の下書きだけを消し、待ち時間の編集は残す', () => {
    const drafted = editHypothesisDraft(EMPTY_HYPOTHESIS_NOTE, '仮説 A', 1);
    const revision = drafted.draftRevision;
    const typed = editHypothesisDraft(drafted, '仮説 A 追記 B', 2);
    expect(consumeDraftRevision(typed, revision)).toBe(typed);
    expect(consumeDraftRevision(drafted, revision).draft).toBeNull();
  });

  it('schemaVersion 1 の bound は startId があるときだけ移す', () => {
    const migrated = normalizeHypothesisNote({
      schemaVersion: 1,
      draft: { text: '下書き', writtenAt: 1 },
      bound: {
        runKey: 'run-a',
        startId: 'start-1',
        beforeStart: { text: '狙い', writtenAt: 2 },
        reflection: null,
      },
      generation: 4,
    });
    expect(migrated.draftRevision).toBe(4);
    expect(migrated.notes['start-1']?.beforeStart.text).toBe('狙い');
    expect(
      normalizeHypothesisNote({
        schemaVersion: 1,
        draft: null,
        bound: {
          runKey: 'run-a',
          startId: '',
          beforeStart: { text: '住所なし', writtenAt: 2 },
          reflection: null,
        },
        generation: 0,
      }).notes,
    ).toEqual({});
  });

  it('下書きの競合は版番号で見て、別の開始IDは変えない', () => {
    const base = prepareHypothesis(
      editHypothesisDraft(EMPTY_HYPOTHESIS_NOTE, '元', 1),
      'run-a',
      'start-1',
      { text: '元', writtenAt: 1 },
    );
    const local = editHypothesisDraft(base, 'このタブ', 2);
    const current = {
      ...editHypothesisDraft(base, '別タブ', 3),
      notes: {
        ...base.notes,
        'start-2': {
          runKey: 'run-b',
          beforeStart: { text: '別ラン', writtenAt: 4 },
          reflection: null,
        },
      },
    };
    expect(hypothesisDraftConflict(base, local, current)).toBe(true);
    const stored = commitHypothesisNote(base, local, current);
    expect(stored.draft?.text).toBe('別タブ');
    expect(stored.notes['start-1']?.beforeStart.text).toBe('元');
    expect(stored.notes['start-2']?.beforeStart.text).toBe('別ラン');
  });

  it('再現情報は選んだときだけメモを含め、開始レシピとラン進行は変えない', () => {
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
    expect(JSON.parse(serializeRunDiagnosticInfo(info))).not.toHaveProperty('hypothesisNote');
    const key = hypothesisRunKey(RUN);
    const note = hypothesisForRun(
      prepareHypothesis(EMPTY_HYPOTHESIS_NOTE, key, 'start-1', { text: '狙い', writtenAt: 1 }),
      key,
      'start-1',
    );
    const withNote = JSON.parse(serializeRunDiagnosticInfo(info, hypothesisNoteForExport(note!)));
    expect(withNote.hypothesisNote.beforeStart.text).toBe('狙い');
    const recipe = serializeStartRecipe({
      seed: RUN.seed,
      difficulty: 'normal',
      trials: [],
      scenario: 'default',
      preferredCardIds: [],
    });
    expect(recipe).not.toContain('狙い');

    const play = () => {
      const engine = new RunEngine({ seed: RUN.seed });
      engine.startRun('easy', [], RUN.seed);
      return JSON.stringify(playRun(engine));
    };
    const before = play();
    expect(play()).toBe(before);
  });
});

describe('仮説メモの保存', () => {
  it('入力中の書き込みをまとめ、最新の値だけを最後に保存する', async () => {
    const saved: string[] = [];
    let release: () => void = () => {};
    const storage: HypothesisNoteStorage = {
      load: async () => undefined,
      commit: async (local, base) => {
        saved.push(local.draft?.text ?? '');
        if (saved.length === 1) await new Promise<void>((resolve) => (release = resolve));
        return commitHypothesisNote(base, local, base);
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    store.update((record) => editHypothesisDraft(record, 'a', 1));
    store.update((record) => editHypothesisDraft(record, 'ab', 2));
    store.update((record) => editHypothesisDraft(record, 'abc', 3));
    release();
    await store.flush();
    expect(saved).toEqual(['a', 'abc']);
  });

  it('IndexedDB の専用ストアへ保存し、別の読み込みで復元できる', async () => {
    const dbName = `hypothesis-note-${Math.random()}`;
    const store = createHypothesisNoteStore(new IndexedDbHypothesisNoteStorage(dbName));
    await store.load();
    store.update((record) => editHypothesisDraft(record, '端末に残す', 10));
    await store.flush();
    const reloaded = createHypothesisNoteStore(new IndexedDbHypothesisNoteStorage(dbName));
    await reloaded.load();
    expect(reloaded.getSnapshot().record.draft).toEqual({ text: '端末に残す', writtenAt: 10 });
    expect(reloaded.getSnapshot().record.draftRevision).toBe(1);
  });

  it('読み込み完了前の準備は、保存済み下書きを消さずに仮説を足す', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 1,
      draft: { text: '保存済み', writtenAt: 4 },
      bound: null,
      generation: 2,
    };
    const store = createHypothesisNoteStore(memory);
    const saving = store.applyCommitted((record) =>
      prepareHypothesis(record, 'late', 'start-late', { text: '保存済み', writtenAt: 4 }),
    );
    await store.load();
    expect(await saving).toBe('saved');
    await store.flush();
    expect(store.getSnapshot().record.draft?.text).toBe('保存済み');
    expect(store.getSnapshot().record.notes['start-late']?.beforeStart.text).toBe('保存済み');
  });

  it('読み込み失敗では空の表示で端末を上書きせず、操作前の下書きを戻す', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    memory.value = {
      schemaVersion: 2,
      draft: { text: '保存済み', writtenAt: 1 },
      draftRevision: 1,
      notes: {},
    };
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
      prepareHypothesis(record, 'run-c', 'start-c', { text: '仮説 A', writtenAt: 2 }),
    );
    await loading;
    expect(await saving).toBe('failed');
    expect(store.getSnapshot().record.draft?.text).toBe('仮説 A');
    expect(store.getSnapshot().record.notes['start-c']).toBeUndefined();
    expect(normalizeHypothesisNote(memory.value).draft?.text).toBe('保存済み');
  });

  it('確定の失敗でも、その後に書いた下書きは残る', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const memory = new MemoryHypothesisNoteStorage();
    const storage: HypothesisNoteStorage = {
      load: () => memory.load(),
      commit: async (local, base) => {
        if (local.notes['start-c']) {
          await gate;
          throw new Error('quota');
        }
        return commitHypothesisNote(base, local, normalizeHypothesisNote(memory.value));
      },
    };
    const store = createHypothesisNoteStore(storage);
    await store.load();
    store.update((record) => editHypothesisDraft(record, '仮説 A', 1));
    await store.flush();
    const saving = store.applyCommitted((record) =>
      prepareHypothesis(record, 'run-c', 'start-c', { text: '仮説 A', writtenAt: 1 }),
    );
    store.update((record) => editHypothesisDraft(record, '仮説 A 追記 B', 2));
    release();
    expect(await saving).toBe('failed');
    await store.flush();
    expect(store.getSnapshot().record.draft?.text).toBe('仮説 A 追記 B');
    expect(store.getSnapshot().record.notes['start-c']).toBeUndefined();
  });

  it('別タブの下書きは、このタブの仮説を消さない', async () => {
    const memory = new MemoryHypothesisNoteStorage();
    const store = createHypothesisNoteStore(memory);
    await store.load();
    store.update((record) =>
      prepareHypothesis(editHypothesisDraft(record, '狙い', 1), 'run-a', 'start-1', {
        text: '狙い',
        writtenAt: 1,
      }),
    );
    await store.flush();
    const stored = normalizeHypothesisNote(memory.value);
    memory.value = commitHypothesisNote(stored, editHypothesisDraft(stored, '別タブ', 2), stored);
    store.update((record) => editHypothesisDraft(record, 'このタブ', 3));
    await store.flush();
    const next = normalizeHypothesisNote(memory.value);
    expect(next.draft?.text).toBe('別タブ');
    expect(next.notes['start-1']?.beforeStart.text).toBe('狙い');
    expect(store.getSnapshot().saveFailed).toBe(true);
    expect(store.getSnapshot().record.draft?.text).toBe('このタブ');
  });
});
