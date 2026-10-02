import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { createRunEngine } from '../../../src/sim/run/engine';
import { defaultMeta } from '../../../src/state/meta';
import {
  IndexedDbMetaStorage,
  initializeMetaPersistence,
} from '../../../src/state/metaPersistence';
import {
  IndexedDbRunStorage,
  initializeRunPersistence,
  toRunSave,
} from '../../../src/state/runPersistence';
import { TabConflictError } from '../../../src/state/tabConflict';

import 'fake-indexeddb/auto';

const databases: string[] = [];
let sequence = 0;

function databaseName(): string {
  sequence += 1;
  const name = `devops-tycoon-multi-tab-${sequence}`;
  databases.push(name);
  return name;
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

async function waitFor(check: () => Promise<void>): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
  throw last;
}

describe('複数タブの保存（RI-144）', () => {
  it('古いタブの音設定と研修方針では、購入した進行を巻き戻さない', async () => {
    const name = databaseName();
    const seeded = new IndexedDbMetaStorage(name);
    await seeded.save({
      ...defaultMeta(),
      points: 100,
      achievements: ['review-exceeded'],
    });
    const [bootA, bootB] = await Promise.all([
      initializeMetaPersistence(new IndexedDbMetaStorage(name)),
      initializeMetaPersistence(new IndexedDbMetaStorage(name)),
    ]);
    const gameA = createGame({ seed: 'tab-a', metaReady: false });
    const gameB = createGame({ seed: 'tab-b', metaReady: false });
    const attach = (
      game: ReturnType<typeof createGame>,
      boot: Awaited<ReturnType<typeof initializeMetaPersistence>>,
    ) => {
      game.attachMetaPersistence(boot.meta, boot.storage, {
        loadedFromDevice: boot.loadedFromDevice,
      });
    };
    attach(gameA, bootA);
    attach(gameB, bootB);

    expect(gameA.purchaseMetaUnlock('unlock-devin')).toEqual({ ok: true });
    const reader = new IndexedDbMetaStorage(name);
    await waitFor(async () => {
      expect(await reader.load()).toMatchObject({ points: 50, unlockedCards: ['devin'] });
    });

    gameB.setSoundMuted(false);
    await waitFor(async () => {
      expect(gameB.hasTabConflict()).toBe(true);
    });
    expect(await reader.load()).toMatchObject({
      points: 50,
      unlockedCards: ['devin'],
      soundMuted: true,
    });
    expect(gameB.getMeta()).toMatchObject({
      points: 50,
      unlockedCards: ['devin'],
      soundMuted: true,
    });

    gameB.setPreferredCardIds(['docs']);
    gameB.setSoundMuted(false);
    expect(gameB.purchaseMetaUnlock('unlock-devin')).toEqual({ ok: false, reason: 'other_tab' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await reader.load()).toMatchObject({
      points: 50,
      unlockedCards: ['devin'],
      soundMuted: true,
      preferredCardIds: [],
    });

    gameA.setSoundMuted(false);
    await waitFor(async () => {
      expect(await reader.load()).toMatchObject({ soundMuted: false, points: 50 });
    });
    expect(gameA.hasTabConflict()).toBe(false);

    const bootC = await initializeMetaPersistence(new IndexedDbMetaStorage(name));
    const gameC = createGame({ seed: 'tab-c', metaReady: false });
    attach(gameC, bootC);
    gameC.setPreferredCardIds(['docs']);
    await waitFor(async () => {
      expect(await reader.load()).toMatchObject({
        points: 50,
        unlockedCards: ['devin'],
        soundMuted: false,
        preferredCardIds: ['docs'],
      });
    });
    expect(gameC.hasTabConflict()).toBe(false);
  });

  it('古いタブの破棄では、もう一方が更新した途中セーブを消さない', async () => {
    const name = databaseName();
    const [runA, runB] = await Promise.all([
      initializeRunPersistence(new IndexedDbRunStorage(name)),
      initializeRunPersistence(new IndexedDbRunStorage(name)),
    ]);
    const [metaA, metaB] = await Promise.all([
      initializeMetaPersistence(new IndexedDbMetaStorage(name)),
      initializeMetaPersistence(new IndexedDbMetaStorage(name)),
    ]);
    const gameA = createGame({ seed: 'run-tab', metaReady: false });
    const gameB = createGame({ seed: 'run-tab-old', metaReady: false });
    gameA.attachMetaPersistence(metaA.meta, metaA.storage, {
      loadedFromDevice: metaA.loadedFromDevice,
    });
    gameB.attachMetaPersistence(metaB.meta, metaB.storage, {
      loadedFromDevice: metaB.loadedFromDevice,
    });
    gameA.attachRunPersistence(runA.storage, runA.save, runA.issue);
    gameB.attachRunPersistence(runB.storage, runB.save, runB.issue);

    gameA.startRun('easy', [], 'run-tab');
    const reader = new IndexedDbRunStorage(name);
    await waitFor(async () => {
      expect((await reader.load())?.summary.seed).toBe('run-tab');
    });

    gameB.clearRunSave();
    await waitFor(async () => {
      expect(gameB.hasTabConflict()).toBe(true);
    });
    expect((await reader.load())?.summary.seed).toBe('run-tab');
    expect(gameB.hasResumableRun()).toBe(false);

    const resumed = await initializeRunPersistence(new IndexedDbRunStorage(name));
    const gameC = createGame({ seed: 'run-tab-next', metaReady: false });
    gameC.attachRunPersistence(resumed.storage, resumed.save, resumed.issue);
    expect(gameC.hasResumableRun()).toBe(true);
    gameC.clearRunSave();
    await waitFor(async () => {
      expect(await reader.load()).toBeNull();
    });
    expect(gameC.hasTabConflict()).toBe(false);
  });

  it('競合したタブの取り込みでは、最新の途中セーブを上書きしない', async () => {
    const engine = createRunEngine({ seed: 'import-block' });
    engine.startRun('easy', [], 'import-block');
    const exported = engine.exportPersistState();
    expect(exported).not.toBeNull();
    const current = toRunSave(exported!, 2_000);
    const stale = toRunSave(exported!, 1_000);
    const imported = toRunSave({ ...exported!, seed: 'imported-over-current' }, 3_000);
    const name = databaseName();
    const writer = new IndexedDbRunStorage(name);
    const reader = new IndexedDbRunStorage(name);
    await writer.save(stale);
    await reader.load();
    await writer.save(current);
    expect((await reader.compareAndSave(stale)).ok).toBe(false);

    await expect(reader.saveIfMatches(current, imported)).rejects.toBeInstanceOf(TabConflictError);
    await expect(reader.clear()).rejects.toBeInstanceOf(TabConflictError);
    expect((await writer.load())?.savedAt).toBe(2_000);
    expect((await writer.load())?.state.seed).toBe('import-block');

    const [bootA, bootB] = await Promise.all([
      initializeRunPersistence(new IndexedDbRunStorage(name)),
      initializeRunPersistence(new IndexedDbRunStorage(name)),
    ]);
    const gameA = createGame({ seed: 'import-block', metaReady: false });
    const gameB = createGame({ seed: 'import-block-old', metaReady: false });
    gameA.attachRunPersistence(bootA.storage, bootA.save, bootA.issue);
    gameB.attachRunPersistence(bootB.storage, bootB.save, bootB.issue);
    const replacement = new IndexedDbRunStorage(name);
    await replacement.save(toRunSave(exported!, 4_000));
    gameB.clearRunSave();
    await waitFor(async () => {
      expect(gameB.hasTabConflict()).toBe(true);
    });
    const text = gameA.exportRunSaveText();
    expect(text).not.toBeNull();
    await expect(gameB.importRunSaveText(`${text}\n`)).resolves.toMatchObject({ ok: false });
    expect((await writer.load())?.savedAt).toBe(4_000);
  });
});
