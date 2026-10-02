import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { createRunEngine } from '../../../src/sim/run/engine';
import { defaultMeta } from '../../../src/state/meta';
import {
  IndexedDbMetaStorage,
  initializeMetaPersistence,
} from '../../../src/state/metaPersistence';
import { MemoryReplayStorage } from '../../../src/state/replayPersistence';
import {
  IndexedDbRunStorage,
  initializeRunPersistence,
  toRunSave,
} from '../../../src/state/runPersistence';
import { serializeRunSave } from '../../../src/state/runSaveShare';
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

async function finishReadyGame(seed: string) {
  const engine = createRunEngine({ seed });
  engine.startRun('easy', [], seed);
  const setup = engine.exportPersistState();
  expect(setup).not.toBeNull();
  const name = databaseName();
  await new IndexedDbMetaStorage(name).save({ ...defaultMeta(), points: 40, bestScore: 0 });
  await new IndexedDbRunStorage(name).save(toRunSave(setup!, 1_000));
  const metaBoot = await initializeMetaPersistence(new IndexedDbMetaStorage(name));
  const runBoot = await initializeRunPersistence(new IndexedDbRunStorage(name));
  const game = createGame({ seed: `${seed}-player`, metaReady: false });
  game.attachMetaPersistence(metaBoot.meta, metaBoot.storage, {
    loadedFromDevice: metaBoot.loadedFromDevice,
  });
  game.attachRunPersistence(runBoot.storage, runBoot.save, runBoot.issue);
  game.resumeRun();
  game.beginSetupSprint();
  await waitFor(async () => {
    expect(game.phase()).toBe('sprint');
  });
  const internals = game.engine as unknown as {
    phase: string;
    budget: number;
    shop: { cards: Array<{ defId: string; cost: number; bought: boolean }> } | null;
  };
  internals.phase = 'shop';
  internals.budget = 10;
  internals.shop = { cards: [{ defId: 'copilot', cost: 10, bought: false }] };
  return { name, game, metaStorage: metaBoot.storage, runStorage: runBoot.storage };
}

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
    expect(gameB.getMeta().soundMuted).toBe(false);
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

    const fresh = new IndexedDbRunStorage(name);
    await fresh.load();
    await writer.save(toRunSave(exported!, 2_500));
    await fresh.load();
    await expect(fresh.saveIfMatches(current, imported)).rejects.toBeInstanceOf(TabConflictError);
    expect((await writer.load())?.savedAt).toBe(2_500);

    await expect(reader.saveIfMatches(current, imported)).rejects.toBeInstanceOf(TabConflictError);
    await expect(reader.clear()).rejects.toBeInstanceOf(TabConflictError);
    expect((await writer.load())?.savedAt).toBe(2_500);
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

  it('競合した途中セーブは書き出せ、破棄の応答は後続のランを戻さない', async () => {
    const name = databaseName();
    const [runA, runB] = await Promise.all([
      initializeRunPersistence(new IndexedDbRunStorage(name)),
      initializeRunPersistence(new IndexedDbRunStorage(name)),
    ]);
    const gameA = createGame({ seed: 'keep-a', metaReady: false });
    const gameB = createGame({ seed: 'keep-b', metaReady: false });
    gameA.attachRunPersistence(runA.storage, runA.save, runA.issue);
    gameB.attachRunPersistence(runB.storage, runB.save, runB.issue);
    gameA.startRun('easy', [], 'keep-a');
    const reader = new IndexedDbRunStorage(name);
    await waitFor(async () => {
      expect((await reader.load())?.summary.seed).toBe('keep-a');
    });

    gameB.startRun('easy', [], 'keep-b');
    await waitFor(async () => {
      expect(gameB.hasTabConflict()).toBe(true);
    });
    expect(gameB.getPersistenceStatus().showExport).toBe(true);
    expect(gameB.exportRunSaveText()).toContain('keep-b');
    gameB.startRun('easy', [], 'keep-b-next');
    expect(gameB.exportRunSaveText()).toContain('keep-b-next');
    await expect(gameB.importReplayText('{}')).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining('再読込') as unknown as string,
    });
    expect((await reader.load())?.summary.seed).toBe('keep-a');

    const gameC = createGame({ seed: 'keep-c', metaReady: false });
    const bootC = await initializeRunPersistence(new IndexedDbRunStorage(name));
    gameC.attachRunPersistence(bootC.storage, bootC.save, bootC.issue);
    const fresh = new IndexedDbRunStorage(name);
    await fresh.save(toRunSave((await reader.load())!.state, 9_000));
    gameC.clearRunSave();
    gameC.startRun('easy', [], 'after-clear');
    await waitFor(async () => {
      expect(gameC.hasTabConflict()).toBe(true);
    });
    expect(gameC.getRunSaveSummary()?.seed).toBe('after-clear');
    expect((await reader.load())?.summary.seed).toBe('keep-a');
  });

  it('古い途中セーブの完走では、報酬を書いてからセーブ削除だけ競合させない', async () => {
    const engine = createRunEngine({ seed: 'finish-stale' });
    engine.startRun('easy', [], 'finish-stale');
    const setup = engine.exportPersistState();
    expect(setup).not.toBeNull();
    const name = databaseName();
    const metaSeed = new IndexedDbMetaStorage(name);
    await metaSeed.save({ ...defaultMeta(), points: 40, bestScore: 0 });
    const runSeed = new IndexedDbRunStorage(name);
    await runSeed.save(toRunSave(setup!, 1_000));
    const metaB = await initializeMetaPersistence(new IndexedDbMetaStorage(name));
    const runB = await initializeRunPersistence(new IndexedDbRunStorage(name));
    const gameB = createGame({ seed: 'finish-b', metaReady: false });
    gameB.attachMetaPersistence(metaB.meta, metaB.storage, {
      loadedFromDevice: metaB.loadedFromDevice,
    });
    gameB.attachRunPersistence(runB.storage, runB.save, runB.issue);
    gameB.resumeRun();
    gameB.beginSetupSprint();
    const runs = new IndexedDbRunStorage(name);
    await waitFor(async () => {
      expect(gameB.phase()).toBe('sprint');
      expect(await runs.load()).not.toBeNull();
    });

    const metaA = await initializeMetaPersistence(new IndexedDbMetaStorage(name));
    const runA = await initializeRunPersistence(new IndexedDbRunStorage(name));
    const gameA = createGame({ seed: 'finish-a', metaReady: false });
    gameA.attachMetaPersistence(metaA.meta, metaA.storage, {
      loadedFromDevice: metaA.loadedFromDevice,
    });
    gameA.attachRunPersistence(runA.storage, runA.save, runA.issue);
    gameA.startRun('easy', [], 'finish-a');
    await waitFor(async () => {
      expect((await runs.load())?.summary.seed).toBe('finish-a');
    });

    const internals = gameB.engine as unknown as {
      phase: string;
      budget: number;
      shop: { cards: Array<{ defId: string; cost: number; bought: boolean }> } | null;
    };
    internals.phase = 'shop';
    internals.budget = 10;
    internals.shop = { cards: [{ defId: 'copilot', cost: 10, bought: false }] };
    expect(gameB.buyShopCard('copilot').status).toBe('lost');
    const metas = new IndexedDbMetaStorage(name);
    await waitFor(async () => {
      expect(gameB.hasTabConflict()).toBe(true);
    });
    expect((await metas.load())?.points).toBe(40);
    expect((await runs.load())?.summary.seed).toBe('finish-a');
    expect(gameB.getMeta().points).toBe(40);
  });

  it('報酬の確定と別タブの途中セーブ更新は、同時に残らない', async () => {
    const engine = createRunEngine({ seed: 'finish-race' });
    engine.startRun('easy', [], 'finish-race');
    const setup = engine.exportPersistState();
    expect(setup).not.toBeNull();
    const name = databaseName();
    await new IndexedDbMetaStorage(name).save({ ...defaultMeta(), points: 40, bestScore: 0 });
    await new IndexedDbRunStorage(name).save(toRunSave(setup!, 1_000));
    const metaB = await initializeMetaPersistence(new IndexedDbMetaStorage(name));
    const runB = await initializeRunPersistence(new IndexedDbRunStorage(name));
    const gameB = createGame({ seed: 'finish-b', metaReady: false });
    gameB.attachMetaPersistence(metaB.meta, metaB.storage, {
      loadedFromDevice: metaB.loadedFromDevice,
    });
    gameB.attachRunPersistence(runB.storage, runB.save, runB.issue);
    gameB.resumeRun();
    gameB.beginSetupSprint();
    const runs = new IndexedDbRunStorage(name);
    await waitFor(async () => {
      expect(gameB.phase()).toBe('sprint');
    });
    const metaA = await initializeMetaPersistence(new IndexedDbMetaStorage(name));
    const runA = await initializeRunPersistence(new IndexedDbRunStorage(name));
    const gameA = createGame({ seed: 'finish-a', metaReady: false });
    gameA.attachMetaPersistence(metaA.meta, metaA.storage, {
      loadedFromDevice: metaA.loadedFromDevice,
    });
    gameA.attachRunPersistence(runA.storage, runA.save, runA.issue);
    gameA.startRun('easy', [], 'finish-a');
    const internals = gameB.engine as unknown as {
      phase: string;
      budget: number;
      shop: { cards: Array<{ defId: string; cost: number; bought: boolean }> } | null;
    };
    internals.phase = 'shop';
    internals.budget = 10;
    internals.shop = { cards: [{ defId: 'copilot', cost: 10, bought: false }] };
    gameB.buyShopCard('copilot');
    const metas = new IndexedDbMetaStorage(name);
    await waitFor(async () => {
      const saved = await runs.load();
      const points = (await metas.load())?.points;
      const settled = saved?.summary.seed === 'finish-a' || points !== 40 || saved === null;
      expect(settled).toBe(true);
    });
    const saved = await runs.load();
    const points = (await metas.load())?.points;
    expect(saved?.summary.seed === 'finish-a' && points !== 40).toBe(false);
  });

  it('空確認で見つけたメタは、その世代のまま続きを書ける', async () => {
    const name = databaseName();
    const writer = new IndexedDbMetaStorage(name);
    await writer.save({ ...defaultMeta(), points: 3 });
    const reader = new IndexedDbMetaStorage(name);
    const existing = await reader.insertIfAbsent({ ...defaultMeta(), points: 99 });
    expect(existing?.points).toBe(3);
    const next = { ...existing!, soundMuted: false };
    expect((await reader.compareAndSave(next)).ok).toBe(true);
    expect((await writer.load())?.soundMuted).toBe(false);
    expect((await writer.load())?.points).toBe(3);
  });

  it('途中セーブの世代が違う報酬のあとは、後続のメタも書かない', async () => {
    const engine = createRunEngine({ seed: 'block-meta' });
    engine.startRun('easy', [], 'block-meta');
    const setup = engine.exportPersistState();
    expect(setup).not.toBeNull();
    const name = databaseName();
    const metas = new IndexedDbMetaStorage(name);
    await metas.save({ ...defaultMeta(), points: 1 });
    await new IndexedDbRunStorage(name).save(toRunSave(setup!, 1_000));
    const blocked = await metas.compareAndSave({ ...defaultMeta(), points: 2 }, 0);
    expect(blocked.ok).toBe(false);
    const later = await metas.compareAndSave({ ...defaultMeta(), points: 9 });
    expect(later.ok).toBe(false);
    expect((await new IndexedDbMetaStorage(name).load())?.points).toBe(1);
  });

  it('完了確定の前に音設定を変えても、報酬だけ先に残さない', async () => {
    const { name, game, metaStorage } = await finishReadyGame('finish-mute');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = metaStorage.compareAndSave.bind(metaStorage);
    metaStorage.compareAndSave = (meta, expected) => {
      if (expected !== undefined) return gate.then(() => original(meta, expected));
      return original(meta, expected);
    };
    expect(game.buyShopCard('copilot').status).toBe('lost');
    game.setSoundMuted(false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    const mid = await new IndexedDbMetaStorage(name).load();
    expect(mid?.points).toBe(40);
    expect(mid?.soundMuted).toBe(true);
    expect(await new IndexedDbRunStorage(name).load()).not.toBeNull();
    release();
    await waitFor(async () => {
      const saved = await new IndexedDbMetaStorage(name).load();
      expect(saved?.points).not.toBe(40);
      expect(saved?.soundMuted).toBe(false);
      expect(await new IndexedDbRunStorage(name).load()).toBeNull();
    });
  });

  it('完了保存が失敗しても、リプレイを書き出せ、別の途中セーブは取り込めない', async () => {
    const { name, game, metaStorage, runStorage } = await finishReadyGame('finish-export');
    await game.attachReplay(new MemoryReplayStorage());
    const original = metaStorage.compareAndSave.bind(metaStorage);
    let finishWrites = 0;
    metaStorage.compareAndSave = (meta, expected) => {
      if (expected !== undefined) {
        finishWrites += 1;
        if (finishWrites === 1) {
          return Promise.reject(new DOMException('The transaction was aborted', 'AbortError'));
        }
      }
      return original(meta, expected);
    };
    expect(game.buyShopCard('copilot').status).toBe('lost');
    await waitFor(async () => {
      expect(game.getPersistenceStatus()).toMatchObject({ state: 'failed', showExport: true });
    });
    const files = game.exportPendingReplayFiles();
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]?.text).toContain('finish-export');
    const incomingEngine = createRunEngine({ seed: 'imported-run' });
    incomingEngine.startRun('easy', [], 'imported-run');
    const incomingState = incomingEngine.exportPersistState();
    expect(incomingState).not.toBeNull();
    const imported = await game.importRunSaveText(
      serializeRunSave(toRunSave(incomingState!, 8_000)),
    );
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.message).toContain('再試行');
    expect((await new IndexedDbRunStorage(name).load())?.summary.seed).toBe('finish-export');
    expect((await new IndexedDbMetaStorage(name).load())?.points).toBe(40);
    runStorage.adoptRunGeneration(999);
    await game.retryPersistence();
    await waitFor(async () => {
      expect((await new IndexedDbMetaStorage(name).load())?.points).not.toBe(40);
      expect(await new IndexedDbRunStorage(name).load()).toBeNull();
    });
    expect(game.exportPendingReplayFiles().length + game.listReplays().length).toBeGreaterThan(0);
  });
});
