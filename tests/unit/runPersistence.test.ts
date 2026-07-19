import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../../src/game';
import { createRunEngine } from '../../src/sim/run/engine';
import { openGameDb, RUN_RECORD_KEY, RUN_STORE_NAME } from '../../src/state/gameDb';
import {
  IndexedDbRunStorage,
  MemoryRunStorage,
  initializeRunPersistence,
  parseRunSave,
  toRunSave,
  RUN_SAVE_SCHEMA_VERSION,
} from '../../src/state/runPersistence';

const databases: string[] = [];

function indexedDbStorage(): IndexedDbRunStorage {
  const name = `devops-tycoon-run-test-${databases.length}`;
  databases.push(name);
  return new IndexedDbRunStorage(name);
}

/** fire-and-forget の IndexedDB 書き込みが完了するまで待つ。 */
async function flushSave(storage: IndexedDbRunStorage | MemoryRunStorage): Promise<void> {
  // Memory は同期完了。IDB は writes チェーンを load 待ちで吸収する。
  await storage.load();
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

describe('ラン途中セーブ永続化（RI-58）', () => {
  it('export → save → load → hydrate で setup 状態を往復できる', async () => {
    const engine = createRunEngine({ seed: 'ri58-roundtrip' });
    engine.startRun('easy', [], 'ri58-roundtrip');
    const exported = engine.exportPersistState();
    expect(exported).not.toBeNull();
    expect(exported!.phase).toBe('setup');
    expect(exported!.sprint).toBeNull();

    const storage = indexedDbStorage();
    const save = toRunSave(exported!);
    await storage.save(save);
    const loaded = await storage.load();
    expect(loaded).toEqual(save);

    const restored = createRunEngine({ seed: 'other' });
    restored.hydratePersistState(loaded!.state);
    const snap = restored.snapshot();
    expect(snap.phase).toBe('setup');
    expect(snap.seed).toBe('ri58-roundtrip');
    expect(snap.difficulty).toBe('easy');
    expect(snap.budget).toBe(exported!.budget);
    expect(snap.org).toEqual(exported!.org);
    expect(snap.roster).toEqual(exported!.roster);
  });

  it('保存を直列化し、最後の状態を往復できる', async () => {
    const storage = indexedDbStorage();
    const engine = createRunEngine({ seed: 'ri58-serial' });
    engine.startRun('normal', [], 'ri58-serial');
    const first = toRunSave(engine.exportPersistState()!);
    const other = createRunEngine({ seed: 'ri58-serial-b' });
    other.startRun('hard', [], 'ri58-serial-b');
    const latest = toRunSave(other.exportPersistState()!);

    await Promise.all([storage.save(first), storage.save(latest)]);
    expect(await storage.load()).toEqual(latest);
  });

  it('schemaVersion 不一致と壊れたレコードは破棄する', async () => {
    const engine = createRunEngine({ seed: 'ri58-bad' });
    engine.startRun('easy', [], 'ri58-bad');
    const valid = toRunSave(engine.exportPersistState()!);

    expect(parseRunSave({ ...valid, schemaVersion: RUN_SAVE_SCHEMA_VERSION + 1 })).toBeNull();
    expect(parseRunSave({ ...valid, summary: { ...valid.summary, phase: 'sprint' } })).toBeNull();
    expect(parseRunSave('{invalid')).toBeNull();

    const name = `devops-tycoon-run-test-bad-${databases.length}`;
    databases.push(name);
    const badStorage = new IndexedDbRunStorage(name);
    const badDb = await openGameDb(name);
    await badDb.put(
      RUN_STORE_NAME,
      { schemaVersion: 999, savedAt: 1, summary: {}, state: {} },
      RUN_RECORD_KEY,
    );
    badDb.close();
    expect(await badStorage.load()).toBeNull();
  });

  it('sprint フェーズでは export せず、result 到達後に export できる', () => {
    const engine = createRunEngine({ seed: 'ri58-sprint' });
    engine.startRun('easy', [], 'ri58-sprint');
    expect(engine.exportPersistState()?.phase).toBe('setup');

    engine.beginSetupSprint();
    expect(engine.currentPhase()).toBe('sprint');
    expect(engine.exportPersistState()).toBeNull();

    let guard = 0;
    while (engine.sprintRunning() && guard++ < 20_000) {
      engine.step(100);
    }
    expect(engine.currentPhase()).toBe('result');
    const exported = engine.exportPersistState();
    expect(exported?.phase).toBe('result');
    expect(exported?.sprint).toBeNull();
    expect(exported?.lastResult).not.toBeNull();
  });

  it('export→hydrate 後も以降の進行が対照実行と一致する', () => {
    const seed = 'ri58-determinism';
    const control = createRunEngine({ seed });
    control.startRun('easy', [], seed);
    control.beginSetupSprint();
    let guard = 0;
    while (control.sprintRunning() && guard++ < 20_000) control.step(100);
    control.acknowledgeResult();
    control.skipDraft();
    const controlBeforeFinish = control.snapshot();
    control.finishEvolution();
    const controlAfter = control.snapshot();

    const subject = createRunEngine({ seed });
    subject.startRun('easy', [], seed);
    subject.beginSetupSprint();
    guard = 0;
    while (subject.sprintRunning() && guard++ < 20_000) subject.step(100);
    subject.acknowledgeResult();
    subject.skipDraft();
    const exported = subject.exportPersistState();
    expect(exported).not.toBeNull();

    const restored = createRunEngine({ seed: 'tmp' });
    restored.hydratePersistState(exported!);
    expect(restored.snapshot()).toMatchObject({
      phase: controlBeforeFinish.phase,
      seed,
      budget: controlBeforeFinish.budget,
      sprintsPlayed: controlBeforeFinish.sprintsPlayed,
      evolution: controlBeforeFinish.evolution,
    });
    restored.finishEvolution();
    expect(restored.snapshot()).toMatchObject({
      phase: controlAfter.phase,
      beat: controlAfter.beat,
      pendingSprintKind: controlAfter.pendingSprintKind,
    });
  });

  it('game 経由でフェーズ遷移時に保存し、resume で復帰できる', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({
      seed: 'ri58-game',
      runStorage: storage,
      metaReady: true,
    });
    game.attachRunPersistence(storage, null);

    game.startRun('easy', [], 'ri58-game');
    await flushSave(storage);
    expect(await storage.load()).toMatchObject({
      summary: { phase: 'setup', seed: 'ri58-game' },
    });

    game.beginSetupSprint();
    await flushSave(storage);
    // sprint 中は直前の setup セーブを維持する。
    expect(await storage.load()).toMatchObject({
      summary: { phase: 'setup' },
    });

    let guard = 0;
    while (game.isSprintRunning() && guard++ < 20_000) game.step(100);
    expect(game.phase()).toBe('result');
    await flushSave(storage);
    expect(await storage.load()).toMatchObject({
      summary: { phase: 'result', sprintsPlayed: 1 },
    });

    const save = await storage.load();
    const resumed = createGame({ seed: 'fresh', runStorage: storage, metaReady: true });
    resumed.attachRunPersistence(storage, save);
    expect(resumed.hasResumableRun()).toBe(true);
    expect(resumed.phase()).toBe('title');
    const state = resumed.resumeRun();
    expect(state?.phase).toBe('result');
    expect(state?.seed).toBe('ri58-game');
    expect(state?.sprintsPlayed).toBe(1);
  });

  it('won/lost/title ではセーブを破棄する', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ seed: 'ri58-clear', runStorage: storage, metaReady: true });
    game.attachRunPersistence(storage, null);
    game.startRun('easy', [], 'ri58-clear');
    await flushSave(storage);
    expect(await storage.load()).not.toBeNull();

    game.newRun('ri58-clear-2');
    expect(game.phase()).toBe('title');
    await flushSave(storage);
    expect(await storage.load()).toBeNull();
    expect(game.hasResumableRun()).toBe(false);
  });

  it('initializeRunPersistence は IDB 失敗時も空セーブで起動できる', async () => {
    const boot = await initializeRunPersistence({
      load: async () => {
        throw new Error('unavailable');
      },
      save: async () => {
        throw new Error('unavailable');
      },
      clear: async () => {
        throw new Error('unavailable');
      },
    });
    expect(boot.save).toBeNull();
    await expect(boot.storage.load()).resolves.toBeNull();
  });
});
