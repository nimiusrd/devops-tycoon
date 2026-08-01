/**
 * RI-91-B4: src/state/runPersistence.ts の Survived / NoCoverage mutation を潰す。
 * 共有の runPersistence テストは触らず、単位専用ファイルで exact 断言する。
 */
import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createRunEngine } from '../../src/sim/run/engine';
import { openGameDb, RUN_RECORD_KEY, RUN_STORE_NAME } from '../../src/state/gameDb';
import {
  IndexedDbRunStorage,
  MemoryRunStorage,
  initializeRunPersistence,
  parseRunSave,
  toRunSave,
  type RunSave,
} from '../../src/state/runPersistence';

const databases: string[] = [];

function indexedDbName(): string {
  const name = `devops-tycoon-ri91-b4-${databases.length}`;
  databases.push(name);
  return name;
}

function makeRunSave(
  seed: string,
  options: {
    difficulty?: 'easy' | 'normal' | 'hard' | 'nightmare';
    trials?: string[];
  } = {},
): RunSave {
  const difficulty = options.difficulty ?? 'easy';
  const trials = options.trials ?? [];
  const engine = createRunEngine({ seed });
  engine.startRun(difficulty, trials, seed, { kind: 'daily', dailyDate: '2026-08-01' });
  const state = engine.exportPersistState();
  if (!state) throw new Error('failed to export run save fixture');
  return toRunSave(state, 5678);
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

describe('RI-91-B4 runPersistence survived mutants', () => {
  describe('difficulty / trials 正常系', () => {
    it('difficulty normal / nightmare を受け入れ、非空 trials を clone する', () => {
      for (const difficulty of ['normal', 'nightmare'] as const) {
        const valid = makeRunSave(`ri91-b4-${difficulty}`, {
          difficulty,
          trials: ['low-focus', 'half-budget'],
        });
        const parsed = parseRunSave(valid);
        expect(parsed).not.toBeNull();
        expect(parsed?.summary.difficulty).toBe(difficulty);
        expect(parsed?.state.difficulty).toBe(difficulty);
        expect(parsed?.summary.trials).toEqual(['low-focus', 'half-budget']);
        expect(parsed?.summary.trials).not.toBe(valid.summary.trials);
        expect(parsed?.state.trials).toEqual(['low-focus', 'half-budget']);

        valid.summary.trials.push('after-parse');
        expect(parsed?.summary.trials).toEqual(['low-focus', 'half-budget']);
      }
    });

    it('toRunSave は非空 trials を clone する', () => {
      const engine = createRunEngine({ seed: 'ri91-b4-to-save' });
      engine.startRun('normal', ['flammable', 'review-cap'], 'ri91-b4-to-save');
      const state = engine.exportPersistState();
      if (!state) throw new Error('export failed');

      const save = toRunSave(state, 42);
      expect(save.summary.trials).toEqual(['flammable', 'review-cap']);
      expect(save.summary.trials).not.toBe(state.trials);
      expect(save.state.trials).toEqual(['flammable', 'review-cap']);
      expect(save.state.trials).not.toBe(state.trials);

      state.trials.push('mutated');
      expect(save.summary.trials).toEqual(['flammable', 'review-cap']);
      expect(save.state.trials).toEqual(['flammable', 'review-cap']);
    });
  });

  describe('parseRunSave の1項目壊れ', () => {
    it('savedAt / summary / state の片側壊れと status / phase / seed を拒否する', () => {
      const valid = makeRunSave('ri91-b4-broken-fields', {
        difficulty: 'normal',
        trials: ['low-focus'],
      });
      const withSummary = (summary: Record<string, unknown>) => ({
        ...valid,
        summary: { ...valid.summary, ...summary },
      });
      const withState = (state: Record<string, unknown>) => ({
        ...valid,
        state: { ...valid.state, ...state },
      });

      expect(parseRunSave({ ...valid, savedAt: '5678' })).toBeNull();
      expect(parseRunSave({ ...valid, summary: null })).toBeNull();
      expect(parseRunSave({ ...valid, state: null })).toBeNull();
      expect(parseRunSave({ ...valid, summary: 1 })).toBeNull();
      expect(parseRunSave({ ...valid, state: 'broken' })).toBeNull();

      // Logical || → && は throw になりうる。必ず null で終わることを保証する。
      expect(() => parseRunSave({ ...valid, summary: null })).not.toThrow();
      expect(() => parseRunSave({ ...valid, state: null })).not.toThrow();

      expect(parseRunSave(withSummary({ status: 'lost' }))).toBeNull();
      expect(parseRunSave(withState({ status: 'won' }))).toBeNull();
      expect(parseRunSave(withSummary({ phase: 12 }))).toBeNull();
      expect(parseRunSave(withState({ phase: false }))).toBeNull();
      expect(parseRunSave(withState({ seed: 99 }))).toBeNull();
      expect(
        parseRunSave({
          ...valid,
          summary: { ...valid.summary, phase: 'setup' },
          state: { ...valid.state, phase: 'shop' },
        }),
      ).toBeNull();
    });
  });

  describe('IndexedDB load / initializeRunPersistence', () => {
    it('空ストアは null を返し、壊れたレコードは delete して消える', async () => {
      const name = indexedDbName();
      const storage = new IndexedDbRunStorage(name);

      expect(await storage.load()).toBeNull();

      const db = await openGameDb(name);
      await db.put(
        RUN_STORE_NAME,
        { schemaVersion: 999, savedAt: 1, summary: {}, state: {} },
        RUN_RECORD_KEY,
      );
      db.close();

      expect(await storage.load()).toBeNull();

      const after = await openGameDb(name);
      expect(await after.get(RUN_STORE_NAME, RUN_RECORD_KEY)).toBeUndefined();
      after.close();
    });

    it('initializeRunPersistence 成功時は save と同一 storage を返す', async () => {
      const save = makeRunSave('ri91-b4-init-ok', {
        difficulty: 'nightmare',
        trials: ['frontier-dependency'],
      });
      const storage = new MemoryRunStorage();
      await storage.save(save);

      const boot = await initializeRunPersistence(storage);
      expect(boot.storage).toBe(storage);
      expect(boot.save).toEqual(save);
      expect(boot).toEqual({ save, storage });
    });
  });
});
