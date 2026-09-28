import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, type GameHandle } from '../../../src/game';
import { createRunEngine } from '../../../src/sim/run/engine';
import { defaultMeta } from '../../../src/state/meta';
import { initializeMetaPersistence, MemoryMetaStorage } from '../../../src/state/metaPersistence';
import {
  REPLAY_MAX_COUNT,
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  type ReplayBlob,
} from '../../../src/state/replay';
import { MemoryReplayStorage } from '../../../src/state/replayPersistence';
import { REPLAY_SHARE_REASON_MESSAGE, serializeReplay } from '../../../src/state/replayShare';
import {
  CURRENT_RUN_RULESET,
  MemoryRunStorage,
  toRunSave,
  type RunSave,
} from '../../../src/state/runPersistence';
import { RUN_SAVE_SHARE_REASON_MESSAGE, serializeRunSave } from '../../../src/state/runSaveShare';
import { serializePersistenceBackup } from '../../../src/state/persistenceBackup';
import { formatPersistenceClock } from '../../../src/state/persistenceStatus';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeRunSave(seed: string): RunSave {
  const engine = createRunEngine({ seed });
  engine.startRun('easy', [], seed);
  const state = engine.exportPersistState();
  const frame = engine.exportReplayFrame();
  if (!state || !frame) throw new Error('setup fixture export failed');
  return toRunSave(state, 1000, [{ phase: 'setup', frame }]);
}

function makeReplay(seed: string): ReplayBlob {
  const save = makeRunSave(seed);
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: seed,
    seed,
    difficulty: 'easy',
    trials: [],
    finishedAt: 1000,
    outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 10 },
    keyframes: save.replayKeyframes,
    ruleset: { ...CURRENT_RUN_RULESET },
    contentSnapshot: snapshotReplayContent(save.replayKeyframes),
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

describe('ゲームの途中セーブ保存失敗と取り込み競合', () => {
  it('取り込みの保存失敗は既存セーブを残し、待機中の次の取り込みを妨げない', async () => {
    const existing = makeRunSave('existing-save');
    const storage = new MemoryRunStorage();
    await storage.save(existing);
    const game = createGame({ seed: 'title', runStorage: storage, initialRunSave: existing });
    const initialState = game.engine.snapshot();
    const revision = game.revision();
    const started = deferred();
    const failure = deferred();
    const nextStarted = deferred();
    const nextRelease = deferred();
    const saveOriginal = storage.save.bind(storage);
    const save = vi
      .spyOn(storage, 'save')
      .mockImplementationOnce(async () => {
        started.resolve();
        await failure.promise;
      })
      .mockImplementationOnce(async (incoming) => {
        nextStarted.resolve();
        await nextRelease.promise;
        await saveOriginal(incoming);
      });

    const failedImport = game.importRunSaveText(serializeRunSave(makeRunSave('failed-import')));
    await started.promise;
    const next = makeRunSave('next-import');
    const nextImport = game.importRunSaveText(serializeRunSave(next));
    expect(save).toHaveBeenCalledTimes(1);
    expect(game.getRunSaveSummary()).toEqual(existing.summary);
    expect(await storage.load()).toEqual(existing);
    expect(game.revision()).toBe(revision);

    failure.reject(new Error('storage unavailable'));

    expect(await failedImport).toEqual({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    await nextStarted.promise;
    expect(game.getRunSaveSummary()).toEqual(existing.summary);
    expect(await storage.load()).toEqual(existing);
    expect(game.revision()).toBe(revision);
    nextRelease.resolve();

    expect(await nextImport).toMatchObject({ ok: true });
    expect(save).toHaveBeenCalledTimes(2);
    expect(game.getRunSaveSummary()).toEqual(next.summary);
    expect(await storage.load()).toEqual(next);
    expect(game.engine.snapshot()).toEqual(initialState);
    expect(game.revision()).toBe(revision + 1);
  });

  it.each<{
    name: string;
    start: (game: GameHandle) => void;
  }>([
    { name: '通常ラン', start: (game) => void game.startRun('easy', [], 'new-normal-run') },
    { name: 'デイリーラン', start: (game) => void game.startDailyRun('2026-09-04') },
  ])(
    '保存中に $name を開始したら、遅れて完了した取り込みから新しいセーブを保護する',
    async ({ start }) => {
      const storage = new MemoryRunStorage();
      const saveOriginal = storage.save.bind(storage);
      const started = deferred();
      const release = deferred();
      const save = vi.spyOn(storage, 'save').mockImplementationOnce(async (incoming) => {
        started.resolve();
        await release.promise;
        await saveOriginal(incoming);
      });
      const game = createGame({ seed: 'title', runStorage: storage });
      const importing = game.importRunSaveText(serializeRunSave(makeRunSave('late-import')));
      await started.promise;

      start(game);
      const currentState = game.engine.snapshot();
      const currentSave = await storage.load();
      const revision = game.revision();
      expect(currentSave?.summary.seed).toBe(currentState.seed);
      expect(currentSave?.summary.seed).not.toBe('late-import');
      release.resolve();

      expect(await importing).toMatchObject({ ok: true });
      expect(game.engine.snapshot()).toEqual(currentState);
      expect(game.revision()).toBe(revision);
      expect(game.getRunSaveSummary()).toEqual(currentSave?.summary);
      expect(await storage.load()).toEqual(currentSave);
      expect(save).toHaveBeenCalledTimes(3);
      expect(save.mock.calls.map(([saved]) => saved.summary.seed)).toEqual([
        'late-import',
        currentState.seed,
        currentState.seed,
      ]);
    },
  );

  it('自動保存が失敗しても編成を保持し、スプリント開始時に保存を再試行できる', async () => {
    const storage = new MemoryRunStorage();
    const save = vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('storage unavailable'));
    const game = createGame({ seed: 'autosave-retry', runStorage: storage });

    const setup = game.startRun('easy', [], 'autosave-retry');
    await Promise.resolve();
    expect(setup.phase).toBe('setup');
    expect(game.hasResumableRun()).toBe(true);
    expect(game.getRunSaveSummary()?.seed).toBe('autosave-retry');
    expect(await storage.load()).toBeNull();

    expect(game.beginSetupSprint().phase).toBe('sprint');
    expect(game.isSprintRunning()).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect((await storage.load())?.state.roster).toEqual(setup.roster);
    expect((await storage.load())?.summary.phase).toBe('setup');
  });

  it('容量不足と一過性の保存失敗を知らせ、再試行で端末へ書き戻す', async () => {
    const runStorage = new MemoryRunStorage();
    const metaStorage = new MemoryMetaStorage();
    const runSave = vi.spyOn(runStorage, 'save');
    const metaSave = vi.spyOn(metaStorage, 'save');
    const game = createGame({
      seed: 'save-status',
      runStorage,
      metaStorage,
      initialMeta: defaultMeta(),
    });

    game.startRun('easy', [], 'save-status');
    await Promise.resolve();
    const saved = game.getPersistenceStatus();
    expect(saved.state).toBe('saved');
    expect(saved.liveMessage).toBe('');
    expect(saved.persistent).toBe(false);
    expect(saved.detail).toContain('最後に端末へ保存できた時刻');

    runSave.mockRejectedValueOnce(new DOMException('full', 'QuotaExceededError'));
    expect(game.beginSetupSprint().phase).toBe('sprint');
    await Promise.resolve();
    await Promise.resolve();
    const quota = game.getPersistenceStatus();
    expect(quota.state).toBe('failed');
    expect(quota.persistent).toBe(true);
    expect(quota.showRetry).toBe(true);
    expect(quota.detail).toContain('容量が不足');
    expect(quota.detail).toContain('最後に端末へ保存できた時刻');
    expect(quota.liveMessage).toContain('容量');
    expect(game.hasResumableRun()).toBe(true);

    metaSave.mockRejectedValueOnce(new Error('transient'));
    game.setSoundMuted(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(game.getPersistenceStatus().liveMessage).toContain('容量');
    expect(game.getPersistenceStatus().liveMessage).not.toContain('保存に失敗しました');
    expect(game.getPersistenceStatus().detail).toContain('容量が不足');

    await game.retryPersistence();
    expect(game.getPersistenceStatus().state).toBe('saved');
    expect(game.getPersistenceStatus().liveMessage).toBe('保存できました。');
    expect((await runStorage.load())?.summary.seed).toBe('save-status');
    expect((await metaStorage.load())?.soundMuted).toBe(false);

    const quiet = game.getPersistenceStatus().liveMessage;
    game.setSoundMuted(true);
    await Promise.resolve();
    expect(game.getPersistenceStatus().liveMessage).toBe(quiet);
  });

  it('初期読込失敗の再試行は既存メタを初期値で上書きしない', async () => {
    const durable = new MemoryMetaStorage();
    const existing = { ...defaultMeta(), points: 80, unlockedCards: ['devin'] };
    await durable.save(existing);
    vi.spyOn(durable, 'load').mockRejectedValueOnce(new Error('unavailable'));
    const boot = await initializeMetaPersistence(durable);
    const save = vi.spyOn(durable, 'save');
    const game = createGame({ seed: 'session-meta', metaReady: false });

    expect(boot.sessionOnly).toBe(true);
    expect(boot.storage).toBeInstanceOf(MemoryMetaStorage);
    expect(boot.durableStorage).toBe(durable);
    game.attachMetaPersistence(boot.meta, boot.storage, {
      sessionOnly: true,
      durableStorage: boot.durableStorage,
    });

    expect(game.getPersistenceStatus().state).toBe('session');
    expect(game.getPersistenceStatus().detail).toContain('メタ進行はこのセッション限り');
    expect(game.getPersistenceStatus().detail).toContain('ほかの保存は端末へ続きます');
    expect(save).not.toHaveBeenCalled();

    await game.retryPersistence();

    expect(save).not.toHaveBeenCalled();
    expect(game.getMeta().points).toBe(80);
    expect(game.getMeta().unlockedCards).toEqual(['devin']);
    expect(game.getMeta().soundMuted).toBe(true);
    expect(game.getPersistenceStatus().state).not.toBe('session');
    expect(game.getPersistenceStatus().liveMessage).toContain('読み直せました');
  });

  it('再試行の前に変えたメタは、既存の永続データで置き換えない', async () => {
    const durable = new MemoryMetaStorage();
    const existing = { ...defaultMeta(), points: 80, soundMuted: true };
    await durable.save(existing);
    const game = createGame({ seed: 'meta-before-retry', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.setSoundMuted(false);
    await Promise.resolve();

    await game.retryPersistence();

    expect(game.getMeta().soundMuted).toBe(false);
    expect(game.getMeta().points).not.toBe(80);
    expect((await durable.load()).soundMuted).toBe(true);
    expect((await durable.load()).points).toBe(80);
    expect(game.getPersistenceStatus().state).toBe('session');
    expect(game.getPersistenceStatus().detail).toContain('メタ進行はこのセッション限り');
  });

  it('メタの再読込中に変わった設定は、古い永続データで置き換えない', async () => {
    const durable = new MemoryMetaStorage();
    const existing = { ...defaultMeta(), points: 80, soundMuted: true };
    await durable.save(existing);
    const game = createGame({ seed: 'meta-moved', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    const original = durable.load.bind(durable);
    let release: (() => void) | undefined;
    vi.spyOn(durable, 'load').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(original());
        }),
    );
    const pending = game.retryPersistence();
    for (let i = 0; i < 12 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    game.setSoundMuted(false);
    release?.();
    await pending;

    expect(game.getMeta().soundMuted).toBe(false);
    expect(game.getMeta().points).not.toBe(80);
    expect((await durable.load()).soundMuted).toBe(true);
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('メタ復旧の待ち時間に取り込んだランは、既存セーブで置き換えない', async () => {
    const metaDurable = new MemoryMetaStorage();
    await metaDurable.save(defaultMeta());
    const runDurable = new MemoryRunStorage();
    await runDurable.save(makeRunSave('stored-run'));
    const game = createGame({ seed: 'import-during-meta', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: metaDurable,
    });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: runDurable,
    });
    const original = metaDurable.load.bind(metaDurable);
    let release: (() => void) | undefined;
    vi.spyOn(metaDurable, 'load').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(original());
        }),
    );
    const pending = game.retryPersistence();
    for (let i = 0; i < 12 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    const importing = game.importRunSaveText(serializeRunSave(makeRunSave('imported-run')));
    expect(await importing).toMatchObject({ ok: true });
    release?.();
    await pending;

    expect(game.getRunSaveSummary()?.seed).toBe('imported-run');
    expect((await runDurable.load())?.summary.seed).toBe('stored-run');
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('再試行開始後、リプレイ復旧の前に完走した記録は永続先へ残す', async () => {
    const metaDurable = new MemoryMetaStorage();
    await metaDurable.save({ ...defaultMeta(), points: 4 });
    const replayDurable = new MemoryReplayStorage();
    await replayDurable.save(makeReplay('stored-replay'));
    const game = createGame({ seed: 'finish-before-replay', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: metaDurable,
    });
    await game.attachReplay(new MemoryReplayStorage(), {
      sessionOnly: true,
      durableStorage: replayDurable,
    });
    const original = metaDurable.load.bind(metaDurable);
    let release: (() => void) | undefined;
    vi.spyOn(metaDurable, 'load').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(original());
        }),
    );
    const pending = game.retryPersistence();
    for (let i = 0; i < 12 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    game.startRun('easy', [], 'during-meta');
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    release?.();
    await pending;

    expect((await replayDurable.list()).map((replay) => replay.seed).sort()).toEqual([
      'during-meta',
      'stored-replay',
    ]);
    expect(game.listReplays().map((replay) => replay.seed)).toContain('during-meta');
    expect(game.getPersistenceStatus().detail).toContain('メタ進行はこのセッション限り');
    expect(game.getPersistenceStatus().detail).not.toContain('リプレイ');
  });

  it('永続先へのセーブ取り込みは、ファイルの時刻ではなく書込み完了時刻になる', async () => {
    const storage = new MemoryRunStorage();
    const completedAt = 1_700_000_000_000;
    const future = completedAt + 5 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(completedAt);
    const game = createGame({ seed: 'import-clock', runStorage: storage });
    const save = makeRunSave('imported-run');
    save.savedAt = future;
    expect(await game.importRunSaveText(serializeRunSave(save))).toMatchObject({ ok: true });
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('transient'));
    vi.spyOn(Date, 'now').mockReturnValue(completedAt + 120_000);
    game.startRun('easy', [], 'after-import');
    await Promise.resolve();
    await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain(formatPersistenceClock(completedAt));
    expect(status.detail).not.toContain(formatPersistenceClock(future));
    expect(status.detail).not.toContain('NaN');
  });

  it('途中セーブの失敗時刻は、その後のメタ保存では進まない', async () => {
    const runStorage = new MemoryRunStorage();
    const metaStorage = new MemoryMetaStorage();
    const earlier = 1_700_000_000_000;
    const later = 1_700_000_180_000;
    vi.spyOn(Date, 'now').mockReturnValue(earlier);
    const game = createGame({
      seed: 'clock-channel',
      runStorage,
      metaStorage,
      initialMeta: defaultMeta(),
    });
    game.startRun('easy', [], 'clock-run');
    await Promise.resolve();
    await Promise.resolve();
    vi.spyOn(runStorage, 'save').mockRejectedValueOnce(new Error('transient'));
    expect(game.beginSetupSprint().phase).toBe('sprint');
    await Promise.resolve();
    await Promise.resolve();
    vi.spyOn(Date, 'now').mockReturnValue(later);
    game.setSoundMuted(false);
    await Promise.resolve();
    await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain(formatPersistenceClock(earlier));
    expect(status.detail).not.toContain(formatPersistenceClock(later));
  });

  it('完走リプレイの保存失敗は記録を残し、再試行で保存できる', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'replay-retry' });
    await game.attachReplay(storage);
    game.startRun('easy', [], 'replay-retry');
    const save = vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('storage unavailable'));
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';

    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    expect(save).toHaveBeenCalledOnce();
    expect(game.hasResumableRun()).toBe(false);
    expect(game.listReplays().map((replay) => replay.seed)).toEqual(['replay-retry']);
    expect(game.exportPendingReplayText()).toContain('replay-retry');
    const failed = game.getPersistenceStatus();
    expect(failed.state).toBe('failed');
    expect(failed.showRetry).toBe(true);
    expect(failed.showExport).toBe(true);

    await game.retryPersistence();

    expect(save).toHaveBeenCalledTimes(2);
    expect(game.listReplays()).toHaveLength(1);
    expect(game.listReplays()[0]?.seed).toBe('replay-retry');
    expect(game.getPersistenceStatus().state).toBe('saved');
  });

  it('上限いっぱいでも、古い完走は端末へ残ってから未保存を外す', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 10_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'replay-cap-keep' });
    await game.attachReplay(storage);
    game.startRun('easy', [], 'clock-skew');
    vi.spyOn(Date, 'now').mockReturnValue(1);
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();

    expect((await storage.list()).map((replay) => replay.seed)).toContain('clock-skew');
    expect(game.listReplays().map((replay) => replay.seed)).toContain('clock-skew');
    expect(game.exportPendingReplayText()).toBeNull();
    expect(game.getPersistenceStatus().state).not.toBe('failed');
  });

  it('上限で消えた完走は保存成功にせず、未保存のまま残す', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 10_000 + i;
      await storage.save(stored);
    }
    const original = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementation((blob) => original(blob));
    const game = createGame({ seed: 'replay-cap-drop' });
    await game.attachReplay(storage);
    game.startRun('easy', [], 'clock-skew');
    vi.spyOn(Date, 'now').mockReturnValue(1);
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();

    expect((await storage.list()).some((replay) => replay.seed === 'clock-skew')).toBe(false);
    expect(game.listReplays().map((replay) => replay.seed)).toContain('clock-skew');
    expect(game.exportPendingReplayText()).toContain('clock-skew');
    expect(game.getPersistenceStatus().state).toBe('failed');
  });

  it('上限いっぱいの pin より古い完走も、今回の保存として残す', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'pin-priority' });
    await game.attachReplay(storage);
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const imported = makeReplay(`imported-${i}`);
      imported.finishedAt = 80_000 + i;
      expect(await game.importReplayText(serializeReplay(imported))).toMatchObject({ ok: true });
    }
    game.startRun('easy', [], 'older-finish');
    vi.spyOn(Date, 'now').mockReturnValue(1);
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();

    expect((await storage.list()).map((replay) => replay.seed)).toContain('older-finish');
    expect(game.getPersistenceStatus().state).not.toBe('failed');
    expect(game.exportPendingReplayText()).toBeNull();
  });

  it('容量不足のあと、別リプレイの一過性失敗でも容量不足を残す', async () => {
    const storage = new MemoryReplayStorage();
    const originalSave = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementation((blob) => {
      if (blob.seed === 'replay-quota') {
        return Promise.reject(new DOMException('full', 'QuotaExceededError'));
      }
      if (blob.seed === 'replay-transient') return Promise.reject(new Error('offline'));
      return originalSave(blob);
    });
    const game = createGame({ seed: 'replay-quota-then-transient' });
    await game.attachReplay(storage);
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string) => {
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('replay-quota');
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
    finish('replay-transient');
    for (let i = 0; i < 16; i += 1) await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain('容量が不足');
    expect(status.liveMessage).toContain('容量');
    expect(game.listReplays().map((replay) => replay.seed)).toEqual(
      expect.arrayContaining(['replay-quota', 'replay-transient']),
    );
  });

  it('後続リプレイの保存成功後も、未保存の完走は一覧に残す', async () => {
    const storage = new MemoryReplayStorage();
    const originalSave = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementation((blob) => {
      if (blob.seed === 'replay-a') return Promise.reject(new Error('unavailable'));
      return originalSave(blob);
    });
    const game = createGame({ seed: 'replay-keep-pending' });
    await game.attachReplay(storage);
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string) => {
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('replay-a');
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    finish('replay-b');
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(['replay-a', 'replay-b']);
    expect(game.getPersistenceStatus().state).toBe('failed');
    expect(game.exportPendingReplayFiles()).toEqual([
      expect.objectContaining({ filename: 'devops-tycoon-replay.json' }),
    ]);
    expect(game.exportPendingReplayText()).toContain('replay-a');
  });

  it('未保存の容量不足は、後続リプレイの保存成功後も案内に残す', async () => {
    const storage = new MemoryReplayStorage();
    const originalSave = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementation((blob) => {
      if (blob.seed === 'replay-quota') {
        return Promise.reject(new DOMException('full', 'QuotaExceededError'));
      }
      return originalSave(blob);
    });
    const game = createGame({ seed: 'replay-quota-kept' });
    await game.attachReplay(storage);
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string) => {
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('replay-quota');
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    finish('replay-ok');
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain('容量が不足');
    expect(status.liveMessage).toContain('容量');
    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(['replay-ok', 'replay-quota']);
  });

  it('遅れて届いた容量不足は、後続の保存成功後も案内に残す', async () => {
    const storage = new MemoryReplayStorage();
    const original = storage.save.bind(storage);
    let rejectQuota: (error: unknown) => void = () => {};
    const quota = new Promise<void>((_resolve, reject) => {
      rejectQuota = reject;
    });
    let releaseOk: () => void = () => {};
    const ok = new Promise<void>((resolve) => {
      releaseOk = resolve;
    });
    vi.spyOn(storage, 'save').mockImplementation((blob, options) => {
      if (blob.seed === 'late-quota') return quota.then(() => original(blob, options));
      if (blob.seed === 'late-ok') return ok.then(() => original(blob, options));
      return original(blob, options);
    });
    const game = createGame({ seed: 'late-quota' });
    await game.attachReplay(storage);
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string) => {
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('late-quota');
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    finish('late-ok');
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    rejectQuota(new DOMException('full', 'QuotaExceededError'));
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    releaseOk();
    for (let i = 0; i < 40; i += 1) await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain('容量が不足');
    expect(status.liveMessage).toContain('容量');
    expect(game.exportPendingReplayText()).toContain('late-quota');
  });

  it('保存後に同じ ID が別内容へ変わったら、未保存の完走を外さない', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'save-foreign-content' });
    await game.attachReplay(storage);
    const original = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementation(async (blob, options) => {
      await original(blob, options);
      if (blob.seed !== 'pending-replay') return;
      const foreign = structuredClone(blob);
      foreign.outcome = { ...foreign.outcome, score: blob.outcome.score + 1 };
      await original(foreign);
    });
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'pending-replay');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    const pending = JSON.parse(game.exportPendingReplayText()!) as ReplayBlob;
    expect(game.getPersistenceStatus().state).toBe('failed');
    expect((await storage.get(pending.id))?.outcome.score).toBe(pending.outcome.score + 1);
    expect(game.listReplays().find((replay) => replay.id === pending.id)?.outcome.score).toBe(
      pending.outcome.score,
    );
  });

  it('再試行の前に取り込んだセーブは、既存セーブで置き換えない', async () => {
    const durable = new MemoryRunStorage();
    await durable.save(makeRunSave('stored-run'));
    const game = createGame({ seed: 'import-before-retry' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    expect(
      await game.importRunSaveText(serializeRunSave(makeRunSave('imported-before'))),
    ).toMatchObject({ ok: true });
    expect(game.getRunSaveSummary()?.seed).toBe('imported-before');

    await game.retryPersistence();

    expect(game.getRunSaveSummary()?.seed).toBe('imported-before');
    expect((await durable.load())?.summary.seed).toBe('stored-run');
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('比較対象のランが消えていたら、再試行でも永続先を作り直さない', async () => {
    const durable = new MemoryRunStorage();
    const game = createGame({ seed: 'run-removed-during-migrate' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.startRun('easy', [], 'kept-run');
    const originalInsert = durable.insertIfAbsent!.bind(durable);
    vi.spyOn(durable, 'insertIfAbsent').mockImplementation(async (save) => {
      const existing = await originalInsert(save);
      game.startRun('easy', [], 'changed-run');
      await durable.clear();
      return existing;
    });

    await game.retryPersistence();

    expect(await durable.load()).toBeNull();
    expect(game.getPersistenceStatus().state).toBe('session');
    expect(game.getRunSaveSummary()?.seed).toBe('changed-run');

    await game.retryPersistence();

    expect(await durable.load()).toBeNull();
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('遅延したリプレイ保存の完了は次ランのキーフレームを消さない', async () => {
    const storage = new MemoryReplayStorage();
    const originalSave = storage.save.bind(storage);
    let release: (() => void) | undefined;
    const save = vi.spyOn(storage, 'save').mockImplementationOnce(
      (blob) =>
        new Promise((resolve) => {
          release = () => resolve(originalSave(blob));
        }),
    );
    const game = createGame({ seed: 'replay-next' });
    await game.attachReplay(storage);
    game.startRun('easy', [], 'replay-first');
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();

    game.startRun('easy', [], 'replay-second');
    release?.();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    const second = game.listReplays().find((replay) => replay.seed === 'replay-second');
    expect(second?.keyframes.length).toBeGreaterThan(1);
    expect(game.listReplays().some((replay) => replay.seed === 'replay-first')).toBe(true);
  });

  it('空の永続先への再試行はメモリ上のランセーブを移し、既存データは上書きしない', async () => {
    const durable = new MemoryRunStorage();
    const game = createGame({ seed: 'empty-run' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.startRun('easy', [], 'kept-run');
    expect(game.hasResumableRun()).toBe(true);
    expect(game.getPersistenceStatus().state).toBe('session');

    await game.retryPersistence();

    expect((await durable.load())?.summary.seed).toBe('kept-run');
    expect(game.hasResumableRun()).toBe(true);
    expect(game.getRunSaveSummary()?.seed).toBe('kept-run');
    expect(game.getPersistenceStatus().state).not.toBe('session');

    vi.spyOn(durable, 'save').mockRejectedValueOnce(new Error('transient'));
    game.startRun('easy', [], 'after-migrate');
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    const migrated = game.getPersistenceStatus();
    expect(migrated.state).toBe('failed');
    expect(migrated.detail).toContain('最後に端末へ保存できた時刻');
    expect(migrated.detail).not.toContain('まだ端末へ保存できていません');

    const durableExisting = new MemoryRunStorage();
    await durableExisting.save(makeRunSave('stored-run'));
    const other = createGame({ seed: 'stored-run' });
    other.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durableExisting,
    });
    other.startRun('easy', [], 'memory-run');
    const overwrite = vi.spyOn(durableExisting, 'save');
    await other.retryPersistence();

    expect(overwrite).not.toHaveBeenCalled();
    expect(other.getRunSaveSummary()?.seed).toBe('memory-run');
    expect(other.engine.snapshot().seed).toBe('memory-run');
    expect(other.getPersistenceStatus().state).toBe('session');
    expect((await durableExisting.load())?.summary.seed).toBe('stored-run');

    other.newRun();
    await other.retryPersistence();
    expect(other.getRunSaveSummary()).toBeNull();
    expect(other.engine.snapshot().phase).toBe('title');
    expect(other.getPersistenceStatus().state).toBe('session');
    expect((await durableExisting.load())?.summary.seed).toBe('stored-run');
  });

  it('セッション中にランを動かしていなければ、再試行で既存セーブを採用する', async () => {
    const durable = new MemoryRunStorage();
    await durable.save(makeRunSave('stored-run'));
    const game = createGame({ seed: 'adopt-unchanged' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });

    await game.retryPersistence();

    expect(game.getRunSaveSummary()?.seed).toBe('stored-run');
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('セッション中に完走してから再試行しても、以前の途中セーブは戻さない', async () => {
    const durable = new MemoryRunStorage();
    await durable.save(makeRunSave('stored-run'));
    const game = createGame({ seed: 'finish-before-retry' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.startRun('easy', [], 'memory-run');
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    await game.retryPersistence();

    expect(game.getRunSaveSummary()?.seed).not.toBe('stored-run');
    expect(game.engine.snapshot().phase).toBe('won');
    expect(game.getPersistenceStatus().state).toBe('session');
    expect((await durable.load())?.summary.seed).toBe('stored-run');
  });

  it('空の永続先への再試行は現在のメタを保存し、失敗時はセッション限りを維持する', async () => {
    const durable = new MemoryMetaStorage();
    const game = createGame({ seed: 'empty-meta', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.setSoundMuted(false);
    await game.retryPersistence();

    expect((await durable.load())?.soundMuted).toBe(false);
    expect(game.getMeta().soundMuted).toBe(false);
    expect(game.getPersistenceStatus().state).not.toBe('session');

    vi.spyOn(durable, 'save').mockRejectedValueOnce(new Error('transient'));
    game.setSoundMuted(true);
    await Promise.resolve();
    await Promise.resolve();
    const migrated = game.getPersistenceStatus();
    expect(migrated.state).toBe('failed');
    expect(migrated.detail).toContain('最後に端末へ保存できた時刻');
    expect(migrated.detail).not.toContain('まだ端末へ保存できていません');
    expect((await durable.load())?.soundMuted).toBe(false);

    const blocked = new MemoryMetaStorage();
    const stuck = createGame({ seed: 'meta-stuck', metaReady: false });
    stuck.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: blocked,
    });
    stuck.setSoundMuted(false);
    vi.spyOn(blocked, 'save').mockRejectedValueOnce(new Error('full'));
    await stuck.retryPersistence();

    expect(stuck.getPersistenceStatus().state).toBe('session');
    expect(stuck.getMeta().soundMuted).toBe(false);
    expect(await blocked.load()).toBeNull();
  });

  it('空メタの移行に失敗したあと、後から現れた記録は上書きしない', async () => {
    const durable = new MemoryMetaStorage();
    const game = createGame({ seed: 'meta-appeared', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.setSoundMuted(false);
    const save = vi.spyOn(durable, 'save').mockRejectedValueOnce(new Error('full'));
    await game.retryPersistence();
    expect(await durable.load()).toBeNull();
    expect(game.getPersistenceStatus().state).toBe('session');

    save.mockRestore();
    const other = { ...defaultMeta(), points: 40, soundMuted: true };
    await durable.save(other);
    const overwrite = vi.spyOn(durable, 'save');
    await game.retryPersistence();

    expect(overwrite).not.toHaveBeenCalled();
    expect((await durable.load())?.points).toBe(40);
    expect((await durable.load())?.soundMuted).toBe(true);
    expect(game.getMeta().soundMuted).toBe(false);
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('空メタの移行に失敗したあと、未変更なら後から現れた記録を採用する', async () => {
    const durable = new MemoryMetaStorage();
    const game = createGame({ seed: 'meta-adopt-later', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    const save = vi.spyOn(durable, 'save').mockRejectedValueOnce(new Error('full'));
    await game.retryPersistence();
    expect(await durable.load()).toBeNull();

    save.mockRestore();
    await durable.save({ ...defaultMeta(), points: 40, unlockedCards: ['devin'] });
    const overwrite = vi.spyOn(durable, 'save');
    await game.retryPersistence();

    expect(overwrite).not.toHaveBeenCalled();
    expect(game.getMeta().points).toBe(40);
    expect(game.getMeta().unlockedCards).toEqual(['devin']);
    expect(game.getPersistenceStatus().state).not.toBe('session');
    expect(game.getPersistenceStatus().liveMessage).toContain('読み直せました');
  });

  it('空ランの移行に失敗したあと、後から現れたセーブは上書きしない', async () => {
    const durable = new MemoryRunStorage();
    const game = createGame({ seed: 'run-appeared' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.startRun('easy', [], 'memory-run');
    const save = vi.spyOn(durable, 'save').mockRejectedValueOnce(new Error('full'));
    await game.retryPersistence();
    expect(await durable.load()).toBeNull();
    expect(game.getPersistenceStatus().state).toBe('session');

    save.mockRestore();
    await durable.save(makeRunSave('other-tab'));
    const overwrite = vi.spyOn(durable, 'save');
    await game.retryPersistence();

    expect(overwrite).not.toHaveBeenCalled();
    expect((await durable.load())?.summary.seed).toBe('other-tab');
    expect(game.getRunSaveSummary()?.seed).toBe('memory-run');
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('空確認の直後に現れたメタは、同じ再試行では上書きしない', async () => {
    const durable = new MemoryMetaStorage();
    const game = createGame({ seed: 'meta-race-absent', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    const other = { ...defaultMeta(), points: 40, unlockedCards: ['devin'] };
    await durable.save(other);
    vi.spyOn(durable, 'load').mockResolvedValueOnce(null);
    const save = vi.spyOn(durable, 'save');
    await game.retryPersistence();

    expect(save).not.toHaveBeenCalled();
    expect((await durable.load())?.points).toBe(40);
    expect(game.getMeta().points).toBe(40);
    expect(game.getMeta().unlockedCards).toEqual(['devin']);
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('空確認の直後に現れたセーブは、進行中ランでは上書きしない', async () => {
    const durable = new MemoryRunStorage();
    const game = createGame({ seed: 'run-race-absent' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.startRun('easy', [], 'memory-run');
    await durable.save(makeRunSave('other-tab'));
    vi.spyOn(durable, 'load').mockResolvedValueOnce(null);
    const save = vi.spyOn(durable, 'save');
    await game.retryPersistence();

    expect(save).not.toHaveBeenCalled();
    expect((await durable.load())?.summary.seed).toBe('other-tab');
    expect(game.getRunSaveSummary()?.seed).toBe('memory-run');
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('セッション中の古い完走は、上限いっぱいの新しい永続リプレイに残す', async () => {
    const durable = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await durable.save(stored);
    }
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'session-old-replay' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    game.startRun('easy', [], 'session-old');
    vi.spyOn(Date, 'now').mockReturnValue(1);
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
    vi.restoreAllMocks();
    await game.retryPersistence();

    expect((await durable.list()).map((replay) => replay.seed)).toContain('session-old');
    expect(game.listReplays().map((replay) => replay.seed)).toContain('session-old');
    expect(game.getPersistenceStatus().detail).not.toContain('リプレイはこのセッション限り');
  });

  it('セッション限りの完走は、未保存を外したあとでも通知から書き出せる', async () => {
    const durable = new MemoryReplayStorage();
    const memory = new MemoryReplayStorage();
    await memory.save(makeReplay('already-there'));
    const game = createGame({ seed: 'session-export' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    game.startRun('easy', [], 'session-finish');
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();

    expect(game.hasResumableRun()).toBe(false);
    expect(game.listReplays().map((replay) => replay.seed)).toEqual(
      expect.arrayContaining(['already-there', 'session-finish']),
    );
    const status = game.getPersistenceStatus();
    expect(status.state).toBe('session');
    expect(status.showExport).toBe(true);
    const files = game.exportPendingReplayFiles();
    expect(files).toHaveLength(1);
    expect(files[0]?.text).toContain('session-finish');
    expect(files[0]?.text).not.toContain('already-there');
    expect(game.exportPendingReplayText()).toContain('session-finish');
  });

  it('上限いっぱいの新しい永続リプレイへ、セッションの完走を複数残す', async () => {
    const durable = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await durable.save(stored);
    }
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'session-two-replays' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string, finishedAt: number) => {
      game.startRun('easy', [], seed);
      vi.spyOn(Date, 'now').mockReturnValue(finishedAt);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('older-a', 1);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
    finish('older-b', 2);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
    vi.restoreAllMocks();
    await game.retryPersistence();

    const seeds = (await durable.list()).map((replay) => replay.seed);
    expect(seeds).toContain('older-a');
    expect(seeds).toContain('older-b');
    expect(seeds).toHaveLength(REPLAY_MAX_COUNT);
    expect(game.listReplays().map((replay) => replay.seed)).toEqual(
      expect.arrayContaining(['older-a', 'older-b']),
    );
    expect(game.getPersistenceStatus().detail).not.toContain('リプレイはこのセッション限り');
  });

  it('空の永続先へ移したリプレイのあと、保存失敗でも移行時刻を残す', async () => {
    const durable = new MemoryReplayStorage();
    const game = createGame({ seed: 'replay-migrate-clock' });
    await game.attachReplay(new MemoryReplayStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string) => {
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('moved');
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
    await game.retryPersistence();
    expect(game.getPersistenceStatus().state).not.toBe('session');
    expect((await durable.list()).map((replay) => replay.seed)).toContain('moved');

    const original = durable.save.bind(durable);
    vi.spyOn(durable, 'save').mockImplementation((blob) => {
      if (blob.seed === 'after') return Promise.reject(new Error('transient'));
      return original(blob);
    });
    finish('after');
    for (let i = 0; i < 16; i += 1) await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain('最後に端末へ保存できた時刻');
    expect(status.detail).not.toContain('まだ端末へ保存できていません');
  });

  it('確認済みの取り込みは、その後の通常完走で上限枠を占有しない', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'unpin-imports' });
    await game.attachReplay(storage);
    for (let i = 0; i < REPLAY_MAX_COUNT - 1; i += 1) {
      const imported = makeReplay(`imported-${i}`);
      imported.finishedAt = 1_000 + i;
      expect(await game.importReplayText(serializeReplay(imported))).toMatchObject({ ok: true });
    }
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string, finishedAt: number) => {
      game.startRun('easy', [], seed);
      vi.spyOn(Date, 'now').mockReturnValue(finishedAt);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('normal-kept', 20_000);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
    vi.restoreAllMocks();
    finish('normal-new', 30_000);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();

    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).toContain('normal-kept');
    expect(seeds).toContain('normal-new');
    expect(seeds).toHaveLength(REPLAY_MAX_COUNT);
    expect(seeds).not.toContain('imported-0');
  });

  it('保存に失敗した取り込みは、その後の通常完走で上限枠を占有しない', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 1_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'unpin-failed-import' });
    await game.attachReplay(storage);
    const incoming = makeReplay('stored-0');
    incoming.finishedAt = 1_000;
    incoming.outcome = { ...incoming.outcome, score: 99 };
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('quota'));
    expect(await game.importReplayText(serializeReplay(incoming))).toMatchObject({ ok: false });
    vi.restoreAllMocks();

    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'normal-new');
    vi.spyOn(Date, 'now').mockReturnValue(90_000);
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();

    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).toContain('normal-new');
    expect(seeds).not.toContain('stored-0');
    expect(seeds).toHaveLength(REPLAY_MAX_COUNT);
  });

  it('まとめファイルから途中セーブと複数リプレイを戻す', async () => {
    const runStorage = new MemoryRunStorage();
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'backup-import', runStorage });
    await game.attachReplay(replayStorage);
    const raw = serializePersistenceBackup({
      runSave: serializeRunSave(makeRunSave('backed-up')),
      replays: [serializeReplay(makeReplay('replay-a')), serializeReplay(makeReplay('replay-b'))],
    });

    expect(await game.importRunSaveText(raw)).toMatchObject({ ok: true });
    expect(game.getRunSaveSummary()?.seed).toBe('backed-up');
    expect(await game.importReplayText(raw)).toMatchObject({ ok: true });
    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(['replay-a', 'replay-b']);
  });

  it('まとめファイルの古いリプレイは、上限いっぱいでも全部残す', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'backup-cap' });
    await game.attachReplay(storage);
    const olderA = makeReplay('older-a');
    olderA.finishedAt = 1;
    const olderB = makeReplay('older-b');
    olderB.finishedAt = 2;
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [serializeReplay(olderA), serializeReplay(olderB)],
    });

    expect(await game.importReplayText(raw)).toMatchObject({ ok: true });
    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).toContain('older-a');
    expect(seeds).toContain('older-b');
    expect(seeds).toHaveLength(REPLAY_MAX_COUNT);
  });

  it('空の永続先へ移したランは、ファイルの時刻ではなく書込み完了時刻になる', async () => {
    const durable = new MemoryRunStorage();
    const completedAt = 1_700_000_000_000;
    const future = completedAt + 5 * 60 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(completedAt);
    const game = createGame({ seed: 'migrate-clock' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    const save = makeRunSave('future-file');
    save.savedAt = future;
    expect(await game.importRunSaveText(serializeRunSave(save))).toMatchObject({ ok: true });
    const writtenAt = completedAt + 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(writtenAt);
    await game.retryPersistence();
    expect(game.getPersistenceStatus().state).not.toBe('session');

    vi.spyOn(durable, 'save').mockRejectedValueOnce(new Error('transient'));
    vi.spyOn(Date, 'now').mockReturnValue(completedAt + 120_000);
    game.startRun('easy', [], 'after-migrate');
    await Promise.resolve();
    await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain(formatPersistenceClock(writtenAt));
    expect(status.detail).not.toContain('まだ端末へ保存できていません');
    expect(status.detail).not.toContain(formatPersistenceClock(future));
  });

  it('保存失敗したリプレイを取り込むと、未保存と失敗表示を消す', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'replay-import-pending' });
    await game.attachReplay(storage);
    game.startRun('easy', [], 'pending-replay');
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('transient'));
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    const exported = game.exportPendingReplayText();
    expect(exported).toContain('pending-replay');
    expect(game.getPersistenceStatus().state).toBe('failed');

    expect(await game.importReplayText(exported!)).toMatchObject({ ok: true });

    const status = game.getPersistenceStatus();
    expect(status.state).not.toBe('failed');
    expect(status.headline).not.toBe('保存失敗');
    expect(status.detail).not.toContain('進行はメモリに残しています');
    expect(game.exportPendingReplayText()).toBeNull();
    expect((await storage.list()).map((replay) => replay.seed)).toContain('pending-replay');
  });

  it('同じ ID でも内容が違う取り込みは、未保存と失敗表示を消さない', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'replay-import-different' });
    await game.attachReplay(storage);
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('transient'));
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'pending-replay');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    const exported = game.exportPendingReplayText();
    expect(exported).toContain('pending-replay');
    expect(game.getPersistenceStatus().state).toBe('failed');
    const pending = JSON.parse(exported!) as ReplayBlob;
    const originalScore = pending.outcome.score;
    const different = JSON.parse(exported!) as ReplayBlob;
    different.outcome = { ...different.outcome, score: originalScore + 1 };

    expect(await game.importReplayText(JSON.stringify(different))).toMatchObject({ ok: true });

    expect(game.getPersistenceStatus().state).toBe('failed');
    expect(game.getPersistenceStatus().headline).toBe('保存失敗');
    expect(JSON.parse(game.exportPendingReplayText()!).outcome.score).toBe(originalScore);
    expect((await storage.get(different.id))?.outcome.score).toBe(originalScore + 1);
  });

  it('同じ ID でも内容が違う取り込みは、再試行で永続先へ残す', async () => {
    const durable = new MemoryReplayStorage();
    const stored = makeReplay('same-id');
    stored.outcome = { ...stored.outcome, score: 1 };
    await durable.save(stored);
    const game = createGame({ seed: 'content-migrate' });
    await game.attachReplay(new MemoryReplayStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    const imported = makeReplay('same-id');
    imported.outcome = { ...imported.outcome, score: 99 };
    expect(imported.id).toBe(stored.id);
    expect(await game.importReplayText(serializeReplay(imported))).toMatchObject({ ok: true });

    await game.retryPersistence();

    expect((await durable.get(stored.id))?.outcome.score).toBe(99);
    expect(game.listReplays().find((replay) => replay.id === stored.id)?.outcome.score).toBe(99);
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('再試行する未保存リプレイは、まとめて上限から守る', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'retry-cohort' });
    await game.attachReplay(storage);
    const save = vi.spyOn(storage, 'save');
    const internals = game.engine as unknown as { phase: string; status: string };
    save.mockRejectedValueOnce(new Error('transient'));
    vi.spyOn(Date, 'now').mockReturnValue(1);
    game.startRun('easy', [], 'pending-a');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    save.mockRejectedValueOnce(new Error('transient'));
    vi.spyOn(Date, 'now').mockReturnValue(2);
    game.startRun('easy', [], 'pending-b');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(game.getPersistenceStatus().state).toBe('failed');
    save.mockRestore();

    await game.retryPersistence();

    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).toContain('pending-a');
    expect(seeds).toContain('pending-b');
    expect(seeds).toHaveLength(REPLAY_MAX_COUNT);
    expect(game.exportPendingReplayText()).toBeNull();
    expect(game.getPersistenceStatus().state).not.toBe('failed');
  });

  it('一部だけ保存できた再試行は、残件の次回まで先に保存した完走を守る', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'retry-partial-cohort' });
    await game.attachReplay(storage);
    const original = storage.save.bind(storage);
    const save = vi.spyOn(storage, 'save');
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string, finishedAt: number) => {
      save.mockRejectedValueOnce(new Error('transient'));
      vi.spyOn(Date, 'now').mockReturnValue(finishedAt);
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('pending-a', 1);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    finish('pending-b', 2);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(game.getPersistenceStatus().state).toBe('failed');
    save.mockImplementation(async (blob, options) => {
      if (blob.seed === 'pending-b') throw new Error('quota');
      await original(blob, options);
    });

    await game.retryPersistence();

    expect((await storage.list()).map((replay) => replay.seed)).toContain('pending-a');
    expect(game.exportPendingReplayText()).toContain('pending-b');
    expect(game.getPersistenceStatus().state).toBe('failed');
    save.mockImplementation(original);

    await game.retryPersistence();

    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).toContain('pending-a');
    expect(seeds).toContain('pending-b');
    expect(game.exportPendingReplayText()).toBeNull();
    expect(game.getPersistenceStatus().state).not.toBe('failed');
  });

  it('一部だけ保存できた再試行の完走は、その後の取り込みでも上限から守る', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'import-keeps-retry' });
    await game.attachReplay(storage);
    const original = storage.save.bind(storage);
    const save = vi.spyOn(storage, 'save');
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string, finishedAt: number) => {
      save.mockRejectedValueOnce(new Error('transient'));
      vi.spyOn(Date, 'now').mockReturnValue(finishedAt);
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('pending-a', 1);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    finish('pending-b', 2);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    save.mockImplementation(async (blob, options) => {
      if (blob.seed === 'pending-b') throw new Error('quota');
      await original(blob, options);
    });
    await game.retryPersistence();
    expect((await storage.list()).map((replay) => replay.seed)).toContain('pending-a');
    save.mockImplementation(original);
    const incoming = makeReplay('imported-new');
    incoming.finishedAt = 90_000;

    expect(await game.importReplayText(serializeReplay(incoming))).toMatchObject({ ok: true });

    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).toContain('pending-a');
    expect(seeds).toContain('imported-new');
  });

  it('残件を取り込み切ったら、先に保存した完走の保護を外す', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'import-clears-retry-protect' });
    await game.attachReplay(storage);
    const original = storage.save.bind(storage);
    const save = vi.spyOn(storage, 'save');
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string, finishedAt: number) => {
      save.mockRejectedValueOnce(new Error('transient'));
      vi.spyOn(Date, 'now').mockReturnValue(finishedAt);
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('pending-a', 1);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    finish('pending-b', 2);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    save.mockImplementation(async (blob, options) => {
      if (blob.seed === 'pending-b') throw new Error('quota');
      await original(blob, options);
    });
    await game.retryPersistence();
    expect((await storage.list()).map((replay) => replay.seed)).toContain('pending-a');
    save.mockImplementation(original);
    const pending = game.exportPendingReplayText();
    expect(pending).toContain('pending-b');

    expect(await game.importReplayText(pending!)).toMatchObject({ ok: true });
    expect(game.exportPendingReplayText()).toBeNull();
    expect((await storage.list()).map((replay) => replay.seed)).toContain('pending-a');

    const newer = makeReplay('newer-after-import');
    newer.finishedAt = 90_000;
    expect(await game.importReplayText(serializeReplay(newer))).toMatchObject({ ok: true });

    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).not.toContain('pending-a');
    expect(seeds).toContain('pending-b');
    expect(seeds).toContain('newer-after-import');
  });

  it('まとめ取り込みで残件が尽きたら、先に保存した完走の保護を外す', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'backup-clears-retry-protect' });
    await game.attachReplay(storage);
    const original = storage.save.bind(storage);
    const save = vi.spyOn(storage, 'save');
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string, finishedAt: number) => {
      save.mockRejectedValueOnce(new Error('transient'));
      vi.spyOn(Date, 'now').mockReturnValue(finishedAt);
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('pending-a', 1);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    finish('pending-b', 2);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    save.mockImplementation(async (blob, options) => {
      if (blob.seed === 'pending-b') throw new Error('quota');
      await original(blob, options);
    });
    await game.retryPersistence();
    save.mockImplementation(original);
    const pending = game.exportPendingReplayText();
    const raw = serializePersistenceBackup({ runSave: null, replays: [pending!] });

    expect(await game.importReplayText(raw)).toMatchObject({ ok: true });
    expect(game.exportPendingReplayText()).toBeNull();

    const newer = makeReplay('newer-after-backup');
    newer.finishedAt = 90_000;
    expect(await game.importReplayText(serializeReplay(newer))).toMatchObject({ ok: true });

    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).not.toContain('pending-a');
    expect(seeds).toContain('pending-b');
    expect(seeds).toContain('newer-after-backup');
  });

  it('リプレイの取り込みに成功したら、その後の失敗は取り込み時刻を示す', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'import-replay-clock' });
    await game.attachReplay(storage);
    const writtenAt = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(writtenAt);
    expect(
      await game.importReplayText(serializeReplay(makeReplay('imported-clock'))),
    ).toMatchObject({
      ok: true,
    });
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('transient'));
    vi.spyOn(Date, 'now').mockReturnValue(writtenAt + 60_000);
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'after-import');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain(formatPersistenceClock(writtenAt));
    expect(status.detail).not.toContain('まだ端末へ保存できていません');
  });

  it('既存リプレイがあるとき、最初の保存失敗は一覧の時刻を示す', async () => {
    const storage = new MemoryReplayStorage();
    const existing = makeReplay('existing-replay');
    existing.finishedAt = 1_700_000_000_000;
    await storage.save(existing);
    const game = createGame({ seed: 'replay-clock-bootstrap' });
    await game.attachReplay(storage);
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('transient'));
    vi.spyOn(Date, 'now').mockReturnValue(existing.finishedAt + 60_000);
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'after-existing');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain(formatPersistenceClock(existing.finishedAt));
    expect(status.detail).not.toContain('まだ端末へ保存できていません');
  });

  it('単体取り込みは、同じ ID が別内容なら成功にしない', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'import-content-mismatch' });
    await game.attachReplay(storage);
    const replay = makeReplay('same-id');
    const original = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementation(async (blob, options) => {
      await original(blob, options);
      const foreign = structuredClone(blob);
      foreign.outcome = { ...foreign.outcome, score: blob.outcome.score + 1 };
      await original(foreign);
    });

    const imported = await game.importReplayText(serializeReplay(replay));

    expect(imported.ok).toBe(false);
    expect((await storage.get(replay.id))?.outcome.score).toBe(replay.outcome.score + 1);
    expect(game.listReplays().find((item) => item.id === replay.id)?.outcome.score).toBe(
      replay.outcome.score + 1,
    );
  });

  it('まとめファイルの途中で保存に失敗したら、取り込み前の一覧へ戻す', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const before = (await storage.list()).map((replay) => replay.seed).sort();
    const game = createGame({ seed: 'backup-rollback' });
    await game.attachReplay(storage);
    const olderA = makeReplay('older-a');
    olderA.finishedAt = 1;
    const olderB = makeReplay('older-b');
    olderB.finishedAt = 2;
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [serializeReplay(olderA), serializeReplay(olderB)],
    });
    const original = storage.save.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'save').mockImplementation(async (blob, options) => {
      calls += 1;
      if (calls === 2) throw new Error('quota');
      await original(blob, options);
    });

    const imported = await game.importReplayText(raw);
    expect(imported.ok).toBe(false);
    expect((await storage.list()).map((replay) => replay.seed).sort()).toEqual(before);
    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(before);
    expect((await storage.list()).map((replay) => replay.seed)).not.toContain('older-a');
  });

  it('まとめファイルの巻き戻しは、途中で増えた別のリプレイを消さない', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'backup-other-tab' });
    await game.attachReplay(storage);
    const olderA = makeReplay('older-a');
    olderA.finishedAt = 1;
    const olderB = makeReplay('older-b');
    olderB.finishedAt = 2;
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [serializeReplay(olderA), serializeReplay(olderB)],
    });
    const original = storage.save.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'save').mockImplementation(async (blob, options) => {
      calls += 1;
      if (calls === 1) {
        await original(blob, options);
        const other = makeReplay('other-tab');
        other.finishedAt = 90_000;
        await original(other);
        return;
      }
      if (calls === 2) throw new Error('quota');
      await original(blob, options);
    });

    const imported = await game.importReplayText(raw);
    expect(imported.ok).toBe(false);
    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).toContain('other-tab');
    expect(seeds).not.toContain('older-a');
    expect(seeds).not.toContain('older-b');
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) expect(seeds).toContain(`stored-${i}`);
  });

  it('まとめファイルの巻き戻しは、同じ ID の別内容を消さない', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'backup-same-id-foreign' });
    await game.attachReplay(storage);
    const olderA = makeReplay('older-a');
    olderA.finishedAt = 1;
    const olderB = makeReplay('older-b');
    olderB.finishedAt = 2;
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [serializeReplay(olderA), serializeReplay(olderB)],
    });
    const original = storage.save.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'save').mockImplementation(async (blob, options) => {
      calls += 1;
      if (calls === 1) {
        await original(blob, options);
        const foreign = makeReplay('older-a');
        foreign.finishedAt = 99_000;
        foreign.outcome = { ...foreign.outcome, score: 77 };
        await original(foreign);
        return;
      }
      if (calls === 2) throw new Error('quota');
      await original(blob, options);
    });

    const imported = await game.importReplayText(raw);
    expect(imported.ok).toBe(false);
    expect((await storage.get('older-a'))?.outcome.score).toBe(77);
    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).not.toContain('older-b');
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) expect(seeds).toContain(`stored-${i}`);
  });

  it('まとめファイルの最終一覧が別内容なら、未保存を消さず取り込み前へ戻す', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'backup-listed-content' });
    await game.attachReplay(storage);
    vi.spyOn(Date, 'now').mockReturnValue(2_000);
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('transient'));
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'pending-replay');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    const pending = JSON.parse(game.exportPendingReplayText()!) as ReplayBlob;
    const older = structuredClone(pending);
    older.finishedAt = pending.finishedAt - 1;
    older.outcome = { ...older.outcome, score: pending.outcome.score + 1 };
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [JSON.stringify(pending), JSON.stringify(older)],
    });
    const originalList = storage.list.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'list').mockImplementation(async () => {
      calls += 1;
      const rows = await originalList();
      if (calls !== 4) return rows;
      return rows.map((row) =>
        row.id === pending.id
          ? { ...row, outcome: { ...row.outcome, score: pending.outcome.score + 2 } }
          : row,
      );
    });

    const imported = await game.importReplayText(raw);
    expect(imported.ok).toBe(false);
    expect(game.getPersistenceStatus().state).toBe('failed');
    expect(JSON.parse(game.exportPendingReplayText()!).outcome.score).toBe(pending.outcome.score);
    expect((await storage.list()).map((replay) => replay.id)).not.toContain(pending.id);
  });

  it('同じ ID の後続保存が失敗したら、先に保存できた内容だけを戻す', async () => {
    const storage = new MemoryReplayStorage();
    const kept = makeReplay('kept');
    kept.finishedAt = 10;
    await storage.save(kept);
    const game = createGame({ seed: 'backup-partial-same-id' });
    await game.attachReplay(storage);
    const first = makeReplay('same-id');
    first.finishedAt = 5;
    first.outcome = { ...first.outcome, score: 10 };
    const second = makeReplay('same-id');
    second.finishedAt = 1;
    second.outcome = { ...second.outcome, score: 99 };
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [serializeReplay(first), serializeReplay(second)],
    });
    const original = storage.save.bind(storage);
    vi.spyOn(storage, 'save').mockImplementation(async (blob, options) => {
      if (blob.outcome.score === 99) throw new Error('quota');
      await original(blob, options);
    });

    const imported = await game.importReplayText(raw);
    expect(imported.ok).toBe(false);
    expect(await storage.get('same-id')).toBeNull();
    expect((await storage.list()).map((replay) => replay.id)).toEqual(['kept']);
  });

  it('巻き戻しは、別タブが消した記録を戻さない', async () => {
    const storage = new MemoryReplayStorage();
    const kept = makeReplay('kept');
    kept.finishedAt = 10;
    const removed = makeReplay('removed');
    removed.finishedAt = 9;
    await storage.save(kept);
    await storage.save(removed);
    const game = createGame({ seed: 'backup-foreign-delete' });
    await game.attachReplay(storage);
    const olderA = makeReplay('older-a');
    olderA.finishedAt = 1;
    const olderB = makeReplay('older-b');
    olderB.finishedAt = 2;
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [serializeReplay(olderA), serializeReplay(olderB)],
    });
    const original = storage.save.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'save').mockImplementation(async (blob, options) => {
      calls += 1;
      if (calls === 1) {
        await original(blob, options);
        (storage as unknown as { items: Map<string, ReplayBlob> }).items.delete('removed');
        return;
      }
      throw new Error('quota');
    });

    const imported = await game.importReplayText(raw);
    expect(imported.ok).toBe(false);
    expect(await storage.get('removed')).toBeNull();
    expect(await storage.get('kept')).not.toBeNull();
    expect(await storage.get('older-a')).toBeNull();
    expect(await storage.get('older-b')).toBeNull();
  });

  it('まとめ取り込みの失敗は、開始後に増えて上限で消した記録を戻す', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'backup-evicted-late' });
    await game.attachReplay(storage);
    const olderA = makeReplay('older-a');
    olderA.finishedAt = 1;
    const olderB = makeReplay('older-b');
    olderB.finishedAt = 2;
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [serializeReplay(olderA), serializeReplay(olderB)],
    });
    const original = storage.save.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'save').mockImplementation(async (blob, options) => {
      calls += 1;
      if (calls === 1) {
        const late = makeReplay('late-import');
        late.finishedAt = 10;
        await original(late, { pin: true });
        await original(blob, options);
        return;
      }
      throw new Error('quota');
    });

    const imported = await game.importReplayText(raw);

    expect(imported.ok).toBe(false);
    expect(await storage.get('late-import')).not.toBeNull();
    expect(await storage.get('older-a')).toBeNull();
    expect(await storage.get('older-b')).toBeNull();
    expect(await storage.get('stored-0')).toBeNull();
    expect(await storage.get('stored-1')).not.toBeNull();
  });

  it('上限を超える未保存の再試行は、端末に残らなかった完走を未保存のままにする', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'retry-over-cap' });
    await game.attachReplay(storage);
    const original = storage.save.bind(storage);
    const save = vi.spyOn(storage, 'save').mockRejectedValue(new Error('transient'));
    const internals = game.engine as unknown as { phase: string; status: string };
    for (let i = 0; i < REPLAY_MAX_COUNT + 1; i += 1) {
      vi.spyOn(Date, 'now').mockReturnValue(1_000 + i);
      game.startRun('easy', [], `pending-${i}`);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
      for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
    }
    const before = game.exportPendingReplayFiles().map((file) => file.text);
    expect(before).toHaveLength(REPLAY_MAX_COUNT + 1);
    expect(before.some((text) => text.includes('pending-0'))).toBe(true);
    expect(game.getPersistenceStatus().state).toBe('failed');
    save.mockImplementation(original);

    await game.retryPersistence();

    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).toHaveLength(REPLAY_MAX_COUNT);
    expect(seeds).not.toContain('pending-0');
    expect(seeds).toContain('pending-10');
    const pending = game.exportPendingReplayFiles().map((file) => file.text);
    expect(pending.some((text) => text.includes('pending-0'))).toBe(true);
    expect(game.getPersistenceStatus().state).toBe('failed');
  });

  it('まとめファイルの最終一覧に失敗したら、取り込み前の一覧へ戻す', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const before = (await storage.list()).map((replay) => replay.seed).sort();
    const game = createGame({ seed: 'backup-list-rollback' });
    await game.attachReplay(storage);
    const olderA = makeReplay('older-a');
    olderA.finishedAt = 1;
    const olderB = makeReplay('older-b');
    olderB.finishedAt = 2;
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [serializeReplay(olderA), serializeReplay(olderB)],
    });
    const original = storage.list.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'list').mockImplementation(async () => {
      calls += 1;
      if (calls === 4) throw new Error('transient');
      return original();
    });

    const imported = await game.importReplayText(raw);
    expect(imported.ok).toBe(false);
    expect(calls).toBeGreaterThanOrEqual(4);
    expect((await storage.list()).map((replay) => replay.seed).sort()).toEqual(before);
    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(before);
  });

  it('まとめファイルの途中失敗では、未保存と失敗表示も取り込み前のまま残す', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'backup-pending-rollback' });
    await game.attachReplay(storage);
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('transient'));
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'pending-a');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    const pending = game.exportPendingReplayText();
    expect(pending).toContain('pending-a');
    expect(game.getPersistenceStatus().state).toBe('failed');
    const other = makeReplay('other-b');
    other.finishedAt = 2;
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: [pending!, serializeReplay(other)],
    });
    const original = storage.save.bind(storage);
    let calls = 0;
    vi.spyOn(storage, 'save').mockImplementation(async (blob, options) => {
      calls += 1;
      if (calls === 2) throw new Error('quota');
      await original(blob, options);
    });

    const imported = await game.importReplayText(raw);
    expect(imported.ok).toBe(false);
    expect(game.exportPendingReplayText()).toContain('pending-a');
    expect(game.getPersistenceStatus().state).toBe('failed');
    expect(game.getPersistenceStatus().headline).toBe('保存失敗');
    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).not.toContain('pending-a');
    expect(seeds).not.toContain('other-b');
  });

  it('上限を超えるまとめファイルは、新しい10件だけを残して取り込む', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 50_000 + i;
      await storage.save(stored);
    }
    const game = createGame({ seed: 'backup-over-cap' });
    await game.attachReplay(storage);
    const backups = Array.from({ length: REPLAY_MAX_COUNT + 1 }, (_, index) => {
      const replay = makeReplay(`backup-${index}`);
      replay.finishedAt = index + 1;
      return replay;
    });
    const raw = serializePersistenceBackup({
      runSave: null,
      replays: backups.map((replay) => serializeReplay(replay)),
    });

    expect(await game.importReplayText(raw)).toMatchObject({ ok: true });
    const seeds = (await storage.list()).map((replay) => replay.seed);
    expect(seeds).toHaveLength(REPLAY_MAX_COUNT);
    for (let index = 1; index <= REPLAY_MAX_COUNT; index += 1) {
      expect(seeds).toContain(`backup-${index}`);
    }
    expect(seeds).not.toContain('backup-0');
  });

  it('セッション復旧と同じ再試行で、別チャネルの保存失敗も書き直す', async () => {
    const durable = new MemoryMetaStorage();
    const existing = { ...defaultMeta(), points: 80, unlockedCards: ['devin'] };
    await durable.save(existing);
    const runStorage = new MemoryRunStorage();
    const game = createGame({ seed: 'mixed-retry', runStorage, metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.startRun('easy', [], 'mixed-run');
    const runSave = vi.spyOn(runStorage, 'save');
    runSave.mockRejectedValueOnce(new Error('transient'));
    expect(game.beginSetupSprint().phase).toBe('sprint');
    await Promise.resolve();
    await Promise.resolve();
    expect(game.getPersistenceStatus().state).toBe('session');

    await game.retryPersistence();

    expect(game.getMeta().points).toBe(80);
    expect(game.getMeta().unlockedCards).toEqual(['devin']);
    expect((await runStorage.load())?.summary.seed).toBe('mixed-run');
    expect(game.getPersistenceStatus().state).not.toBe('session');
    expect(game.getPersistenceStatus().state).not.toBe('failed');
  });

  it('後から終わったリプレイ保存が先に成功しても、全部保存できたら失敗表示を残さない', async () => {
    const storage = new MemoryReplayStorage();
    const originalSave = storage.save.bind(storage);
    const gates: Array<() => void> = [];
    vi.spyOn(storage, 'save').mockImplementation(
      (blob) =>
        new Promise((resolve) => {
          gates.push(() => resolve(originalSave(blob)));
        }),
    );
    const game = createGame({ seed: 'replay-order' });
    await game.attachReplay(storage);
    const internals = game.engine as unknown as { phase: string; status: string };

    game.startRun('easy', [], 'replay-older');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    game.startRun('easy', [], 'replay-newer');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    expect(gates).toHaveLength(2);

    gates[1]?.();
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
    expect(game.getPersistenceStatus().state).toBe('failed');

    gates[0]?.();
    for (let i = 0; i < 16; i += 1) await Promise.resolve();
    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(['replay-newer', 'replay-older']);
    expect(game.getPersistenceStatus().state).not.toBe('failed');
  });

  it('空の永続先へ移している間のメタ更新も、復旧前に最新のメタを書く', async () => {
    const durable = new MemoryMetaStorage();
    const original = durable.save.bind(durable);
    let release: (() => void) | undefined;
    vi.spyOn(durable, 'save').mockImplementationOnce(
      (incoming) =>
        new Promise((resolve) => {
          release = () => resolve(original(incoming));
        }),
    );
    const game = createGame({ seed: 'meta-race', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    const pending = game.retryPersistence();
    for (let i = 0; i < 8 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    game.setSoundMuted(false);
    release?.();
    await pending;

    expect((await durable.load())?.soundMuted).toBe(false);
    expect(game.getMeta().soundMuted).toBe(false);
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('移行の続きは、このセッションが書いたメタと違う記録を上書きしない', async () => {
    const durable = new MemoryMetaStorage();
    const foreign = { ...defaultMeta(), points: 777, unlockedCards: ['devin'] };
    const original = durable.save.bind(durable);
    let calls = 0;
    let release: (() => void) | undefined;
    vi.spyOn(durable, 'save').mockImplementation((incoming) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          release = () => {
            void original(incoming)
              .then(() => original(foreign))
              .then(() => resolve());
          };
        });
      }
      return original(incoming);
    });
    const game = createGame({ seed: 'meta-cas', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    const pending = game.retryPersistence();
    for (let i = 0; i < 8 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    game.setSoundMuted(false);
    release?.();
    await pending;

    expect(calls).toBe(1);
    expect((await durable.load())?.points).toBe(777);
    expect(game.getMeta().points).not.toBe(777);
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('移行中に何度更新しても、最新のメタを書いてから復旧する', async () => {
    const durable = new MemoryMetaStorage();
    const original = durable.save.bind(durable);
    let flips = 0;
    vi.spyOn(durable, 'save').mockImplementation(async (incoming) => {
      if (flips < 9) {
        flips += 1;
        game.setSoundMuted(!game.getMeta().soundMuted);
      }
      await original(incoming);
    });
    const game = createGame({ seed: 'meta-many', metaReady: false });
    game.attachMetaPersistence(defaultMeta(), new MemoryMetaStorage(), {
      sessionOnly: true,
      durableStorage: durable,
    });
    await game.retryPersistence();

    expect(flips).toBe(9);
    expect(game.getMeta().soundMuted).toBe(false);
    expect((await durable.load())?.soundMuted).toBe(false);
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('移行の続きは、このセッションが書いたセーブと違う記録を上書きしない', async () => {
    const durable = new MemoryRunStorage();
    const foreign = makeRunSave('other-tab');
    const original = durable.save.bind(durable);
    let calls = 0;
    let release: (() => void) | undefined;
    vi.spyOn(durable, 'save').mockImplementation((incoming) => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          release = () => {
            void original(incoming)
              .then(() => original(foreign))
              .then(() => resolve());
          };
        });
      }
      return original(incoming);
    });
    const game = createGame({ seed: 'run-cas' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.startRun('easy', [], 'session-run');
    const pending = game.retryPersistence();
    for (let i = 0; i < 8 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    game.startRun('easy', [], 'during-retry');
    release?.();
    await pending;

    expect(calls).toBe(1);
    expect((await durable.load())?.summary.seed).toBe('other-tab');
    expect(game.getRunSaveSummary()?.seed).toBe('during-retry');
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('保存失敗のあと、ランの取り込みに成功したら失敗表示を消す', async () => {
    const storage = new MemoryRunStorage();
    const save = vi.spyOn(storage, 'save');
    const game = createGame({ seed: 'import-clears-failure', runStorage: storage });
    game.startRun('easy', [], 'before-fail');
    await Promise.resolve();
    save.mockRejectedValueOnce(new Error('transient'));
    expect(game.beginSetupSprint().phase).toBe('sprint');
    await Promise.resolve();
    await Promise.resolve();
    expect(game.getPersistenceStatus().state).toBe('failed');
    expect(game.getPersistenceStatus().headline).toBe('保存失敗');
    expect(game.getPersistenceStatus().detail).toContain('進行はメモリに残しています');

    expect(
      await game.importRunSaveText(serializeRunSave(makeRunSave('imported-after-fail'))),
    ).toMatchObject({
      ok: true,
    });

    const status = game.getPersistenceStatus();
    expect(status.state).not.toBe('failed');
    expect(status.headline).not.toBe('保存失敗');
    expect(status.detail).not.toContain('進行はメモリに残しています');
    expect((await storage.load())?.summary.seed).toBe('imported-after-fail');
  });

  it('空の永続先へ移している間のラン更新も、復旧前に最新のセーブを書く', async () => {
    const durable = new MemoryRunStorage();
    const original = durable.save.bind(durable);
    let release: (() => void) | undefined;
    vi.spyOn(durable, 'save').mockImplementationOnce(
      (incoming) =>
        new Promise((resolve) => {
          release = () => resolve(original(incoming));
        }),
    );
    const game = createGame({ seed: 'run-race' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    game.startRun('easy', [], 'before-retry');
    const pending = game.retryPersistence();
    for (let i = 0; i < 8 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    game.startRun('easy', [], 'during-retry');
    release?.();
    await pending;

    expect((await durable.load())?.summary.seed).toBe('during-retry');
    expect(game.getRunSaveSummary()?.seed).toBe('during-retry');
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('既存セーブの再読込中に取り込んだランは、既存データで置き換えず上書きもしない', async () => {
    const durable = new MemoryRunStorage();
    await durable.save(makeRunSave('stored-run'));
    const game = createGame({ seed: 'import-during-adopt' });
    game.attachRunPersistence(new MemoryRunStorage(), null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    expect(game.engine.snapshot().phase).toBe('title');
    const original = durable.load.bind(durable);
    let release: (() => void) | undefined;
    vi.spyOn(durable, 'load').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(original());
        }),
    );
    const pending = game.retryPersistence();
    for (let i = 0; i < 12 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    const importing = game.importRunSaveText(serializeRunSave(makeRunSave('imported-run')));
    release?.();
    await pending;
    expect(await importing).toMatchObject({ ok: true });

    expect(game.getRunSaveSummary()?.seed).toBe('imported-run');
    expect((await durable.load())?.summary.seed).toBe('stored-run');
    expect(game.getPersistenceStatus().state).toBe('session');
  });

  it('空の永続先を読む間に始まった取り込みは、保存完了前にセッションを外さない', async () => {
    const memory = new MemoryRunStorage();
    const durable = new MemoryRunStorage();
    const game = createGame({ seed: 'import-before-empty-adopt' });
    game.attachRunPersistence(memory, null, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    const originalLoad = durable.load.bind(durable);
    let releaseLoad: (() => void) | undefined;
    vi.spyOn(durable, 'load').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseLoad = () => resolve(originalLoad());
        }),
    );
    const originalSave = memory.save.bind(memory);
    let releaseSave: (() => void) | undefined;
    vi.spyOn(memory, 'save').mockImplementationOnce(
      (incoming) =>
        new Promise((resolve) => {
          releaseSave = () => resolve(originalSave(incoming));
        }),
    );
    const pending = game.retryPersistence();
    for (let i = 0; i < 12 && !releaseLoad; i += 1) await Promise.resolve();
    expect(releaseLoad).toBeTypeOf('function');
    const importing = game.importRunSaveText(serializeRunSave(makeRunSave('imported-run')));
    for (let i = 0; i < 12 && !releaseSave; i += 1) await Promise.resolve();
    expect(releaseSave).toBeTypeOf('function');
    releaseLoad?.();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(game.getPersistenceStatus().state).toBe('session');
    releaseSave?.();
    await pending;
    expect(await importing).toMatchObject({ ok: true });

    expect(game.getRunSaveSummary()?.seed).toBe('imported-run');
    expect((await durable.load())?.summary.seed).toBe('imported-run');
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('空の永続先へ移している間のセーブ取り込みも、復旧前に永続先へ書く', async () => {
    const held = makeRunSave('held-run');
    const durable = new MemoryRunStorage();
    const original = durable.save.bind(durable);
    let release: (() => void) | undefined;
    vi.spyOn(durable, 'save').mockImplementationOnce(
      (incoming) =>
        new Promise((resolve) => {
          release = () => resolve(original(incoming));
        }),
    );
    const game = createGame({ seed: 'import-during-migrate' });
    game.attachRunPersistence(new MemoryRunStorage(), held, null, {
      sessionOnly: true,
      durableStorage: durable,
    });
    expect(game.engine.snapshot().phase).toBe('title');
    const pending = game.retryPersistence();
    for (let i = 0; i < 8 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    const importing = game.importRunSaveText(serializeRunSave(makeRunSave('imported-run')));
    release?.();
    await pending;
    expect(await importing).toMatchObject({ ok: true });

    expect(game.getRunSaveSummary()?.seed).toBe('imported-run');
    expect((await durable.load())?.summary.seed).toBe('imported-run');
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('既存リプレイの再読込中に完走した記録は、保存先を切り替えたあとも残す', async () => {
    const durable = new MemoryReplayStorage();
    await durable.save(makeReplay('stored-replay'));
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'replay-during-adopt' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    const originalList = durable.list.bind(durable);
    let releaseList: (() => void) | undefined;
    vi.spyOn(durable, 'list').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseList = () => resolve(originalList());
        }),
    );
    const originalSave = memory.save.bind(memory);
    let releaseSave: (() => void) | undefined;
    vi.spyOn(memory, 'save').mockImplementationOnce(
      (blob) =>
        new Promise((resolve) => {
          releaseSave = () => resolve(originalSave(blob));
        }),
    );
    const pending = game.retryPersistence();
    for (let i = 0; i < 12 && !releaseList; i += 1) await Promise.resolve();
    expect(releaseList).toBeTypeOf('function');
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'during-list');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12 && !releaseSave; i += 1) await Promise.resolve();
    expect(releaseSave).toBeTypeOf('function');
    releaseList?.();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    releaseSave?.();
    await pending;

    expect((await durable.list()).map((replay) => replay.seed).sort()).toEqual([
      'during-list',
      'stored-replay',
    ]);
    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(['during-list', 'stored-replay']);
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('既存リプレイが上限のとき、再読込中に取り込んだ古い記録は pin のまま残す', async () => {
    const durable = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const stored = makeReplay(`stored-${i}`);
      stored.finishedAt = 10_000 + i;
      await durable.save(stored);
    }
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'pin-during-adopt' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    const originalList = durable.list.bind(durable);
    let releaseList: (() => void) | undefined;
    vi.spyOn(durable, 'list').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseList = () => resolve(originalList());
        }),
    );
    const pending = game.retryPersistence();
    for (let i = 0; i < 12 && !releaseList; i += 1) await Promise.resolve();
    expect(releaseList).toBeTypeOf('function');
    const imported = makeReplay('imported-old');
    imported.finishedAt = 1;
    const importing = game.importReplayText(serializeReplay(imported));
    expect(await importing).toMatchObject({ ok: true });
    expect((await memory.list()).map((replay) => replay.id)).toContain('imported-old');
    releaseList?.();
    await pending;

    const durableIds = (await durable.list()).map((replay) => replay.id);
    expect(durableIds).toHaveLength(REPLAY_MAX_COUNT);
    expect(durableIds).toContain('imported-old');
    expect(durableIds).not.toContain('stored-0');
    expect(game.listReplays().map((replay) => replay.id)).toContain('imported-old');
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('再試行の前に取り込んだリプレイは、既存の永続先へ残す', async () => {
    const durable = new MemoryReplayStorage();
    await durable.save(makeReplay('stored-replay'));
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'pin-before-retry' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    expect(
      await game.importReplayText(serializeReplay(makeReplay('imported-before'))),
    ).toMatchObject({ ok: true });
    expect(game.listReplays().map((replay) => replay.id)).toContain('imported-before');

    await game.retryPersistence();

    expect((await durable.list()).map((replay) => replay.id).sort()).toEqual([
      'imported-before',
      'stored-replay',
    ]);
    expect(game.listReplays().map((replay) => replay.id)).toContain('imported-before');
    expect(game.listReplays().map((replay) => replay.id)).toContain('stored-replay');
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('セッション中の完走リプレイは空の永続先へ移し、既存リプレイの隣へ残す', async () => {
    const durable = new MemoryReplayStorage();
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'session-replay' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    game.startRun('easy', [], 'session-replay');
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    expect(await memory.list()).toHaveLength(1);
    expect(await durable.list()).toEqual([]);

    await game.retryPersistence();

    expect((await durable.list()).map((replay) => replay.seed)).toEqual(['session-replay']);
    expect(game.listReplays().map((replay) => replay.seed)).toEqual(['session-replay']);
    expect(game.getPersistenceStatus().state).not.toBe('session');

    const occupied = new MemoryReplayStorage();
    await occupied.save(makeReplay('stored-replay'));
    const other = createGame({ seed: 'stored-replay' });
    const otherMemory = new MemoryReplayStorage();
    await other.attachReplay(otherMemory, { sessionOnly: true, durableStorage: occupied });
    other.startRun('easy', [], 'memory-replay');
    const otherInternals = other.engine as unknown as { phase: string; status: string };
    otherInternals.phase = 'won';
    otherInternals.status = 'won';
    other.step(0);
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    await other.retryPersistence();

    expect((await occupied.list()).map((replay) => replay.seed).sort()).toEqual([
      'memory-replay',
      'stored-replay',
    ]);
    expect(
      other
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(['memory-replay', 'stored-replay']);
    expect(other.getPersistenceStatus().state).not.toBe('session');
  });

  it('空の永続先へ移すとき、同じ ID の別内容では未保存を消さない', async () => {
    const durable = new MemoryReplayStorage();
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'empty-foreign-replay' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    vi.spyOn(memory, 'save').mockRejectedValueOnce(new Error('transient'));
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'pending-replay');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    const pending = JSON.parse(game.exportPendingReplayText()!) as ReplayBlob;
    const original = durable.save.bind(durable);
    vi.spyOn(durable, 'save').mockImplementation(async (blob, options) => {
      await original(blob, options);
      const foreign = structuredClone(blob);
      foreign.outcome = { ...foreign.outcome, score: blob.outcome.score + 1 };
      await original(foreign);
    });

    await game.retryPersistence();

    expect(game.getPersistenceStatus().state).toBe('session');
    expect(JSON.parse(game.exportPendingReplayText()!).outcome.score).toBe(pending.outcome.score);
    expect((await durable.get(pending.id))?.outcome.score).toBe(pending.outcome.score + 1);
    expect(game.listReplays().find((replay) => replay.id === pending.id)?.outcome.score).toBe(
      pending.outcome.score,
    );
  });

  it('空の永続先の最終一覧が別内容でも、セッション側の完走へ切り替えない', async () => {
    const durable = new MemoryReplayStorage();
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'empty-final-list' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'session-replay');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    const originalScore = (await memory.list())[0]?.outcome.score;
    const originalList = durable.list.bind(durable);
    let calls = 0;
    vi.spyOn(durable, 'list').mockImplementation(async () => {
      calls += 1;
      const rows = await originalList();
      if (calls !== 3) return rows;
      return rows.map((row) => ({
        ...row,
        outcome: { ...row.outcome, score: row.outcome.score + 1 },
      }));
    });

    await game.retryPersistence();

    expect(game.getPersistenceStatus().state).not.toBe('session');
    expect(game.listReplays()[0]?.outcome.score).toBe(originalScore);
    expect((await durable.list())[0]?.outcome.score).toBe(originalScore);
  });

  it('リプレイ移行中に失敗した新しい完走は、セッションを外さず永続先へ残す', async () => {
    const durable = new MemoryReplayStorage();
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'migrate-pending' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = (seed: string) => {
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
    };
    finish('migrate-a');
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    expect(await memory.list()).toHaveLength(1);

    const originalDurable = durable.save.bind(durable);
    let releaseDurable: (() => void) | undefined;
    vi.spyOn(durable, 'save').mockImplementationOnce(
      (blob) =>
        new Promise((resolve) => {
          releaseDurable = () => resolve(originalDurable(blob));
        }),
    );
    vi.spyOn(memory, 'save').mockRejectedValueOnce(new Error('memory failed'));

    const pending = game.retryPersistence();
    for (let i = 0; i < 12 && !releaseDurable; i += 1) await Promise.resolve();
    expect(releaseDurable).toBeTypeOf('function');
    finish('migrate-b');
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    releaseDurable?.();
    await pending;

    const seeds = (await durable.list()).map((replay) => replay.seed).sort();
    const status = game.getPersistenceStatus();
    if (seeds.includes('migrate-b')) {
      expect(seeds).toEqual(['migrate-a', 'migrate-b']);
      expect(status.state).not.toBe('session');
      expect(status.state).not.toBe('failed');
      return;
    }
    expect(status.state === 'session' || status.state === 'failed').toBe(true);
    await game.retryPersistence();
    expect((await durable.list()).map((replay) => replay.seed).sort()).toEqual([
      'migrate-a',
      'migrate-b',
    ]);
    expect(game.getPersistenceStatus().state).not.toBe('session');
    expect(game.getPersistenceStatus().state).not.toBe('failed');
  });

  it('リプレイ移行の最終一覧中に取り込んだ完走は、メモリへ残したまま消さない', async () => {
    const durable = new MemoryReplayStorage();
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'replay-import-migrate' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    const internals = game.engine as unknown as { phase: string; status: string };
    game.startRun('easy', [], 'migrate-a');
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 12; i += 1) await Promise.resolve();

    const originalList = durable.list.bind(durable);
    let lists = 0;
    let release: (() => void) | undefined;
    vi.spyOn(durable, 'list').mockImplementation(() => {
      lists += 1;
      if (lists === 2) {
        return new Promise((resolve) => {
          release = () => resolve(originalList());
        });
      }
      return originalList();
    });
    const pending = game.retryPersistence();
    for (let i = 0; i < 16 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    const importing = game.importReplayText(serializeReplay(makeReplay('imported-replay')));
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    release?.();
    await pending;
    expect(await importing).toMatchObject({ ok: true });

    expect((await durable.list()).map((replay) => replay.seed).sort()).toEqual([
      'imported-replay',
      'migrate-a',
    ]);
    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(['imported-replay', 'migrate-a']);
    expect(game.getPersistenceStatus().state).not.toBe('session');
  });

  it('途中まで移したリプレイは既存データとして捨てず、再試行で残りも書く', async () => {
    const durable = new MemoryReplayStorage();
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'partial-replay' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    const internals = game.engine as unknown as { phase: string; status: string };
    for (const seed of ['partial-a', 'partial-b']) {
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    }
    expect((await memory.list()).map((replay) => replay.seed).sort()).toEqual([
      'partial-a',
      'partial-b',
    ]);

    const original = durable.save.bind(durable);
    let saves = 0;
    vi.spyOn(durable, 'save').mockImplementation(async (blob) => {
      saves += 1;
      if (saves === 2) throw new Error('transient');
      await original(blob);
    });
    await game.retryPersistence();

    expect(game.getPersistenceStatus().state).toBe('session');
    expect(await durable.list()).toHaveLength(1);
    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(['partial-a', 'partial-b']);

    await game.retryPersistence();

    expect(game.getPersistenceStatus().state).not.toBe('session');
    expect((await durable.list()).map((replay) => replay.seed).sort()).toEqual([
      'partial-a',
      'partial-b',
    ]);
  });

  it('セッション復旧の再試行を重ねても、先行の失敗後に復旧済みにしない', async () => {
    const durable = new MemoryReplayStorage();
    const memory = new MemoryReplayStorage();
    const game = createGame({ seed: 'retry-serial' });
    await game.attachReplay(memory, { sessionOnly: true, durableStorage: durable });
    const internals = game.engine as unknown as { phase: string; status: string };
    for (const seed of ['serial-a', 'serial-b']) {
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    }

    let rejectSave: ((error: Error) => void) | undefined;
    vi.spyOn(durable, 'save').mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const first = game.retryPersistence();
    for (let i = 0; i < 8 && !rejectSave; i += 1) await Promise.resolve();
    expect(rejectSave).toBeTypeOf('function');
    const second = game.retryPersistence();
    rejectSave?.(new Error('transient'));
    await first;
    await second;

    expect(game.getPersistenceStatus().state).toBe('session');
    expect(
      game
        .listReplays()
        .map((replay) => replay.seed)
        .sort(),
    ).toEqual(['serial-a', 'serial-b']);
    expect(await memory.list()).toHaveLength(2);
    await game.retryPersistence();
    expect((await durable.list()).map((replay) => replay.seed).sort()).toEqual([
      'serial-a',
      'serial-b',
    ]);
  });

  it('再試行の途中で失敗した新しいリプレイは、古い再試行の成功では消さない', async () => {
    const storage = new MemoryReplayStorage();
    const original = storage.save.bind(storage);
    let calls = 0;
    let release: (() => void) | undefined;
    vi.spyOn(storage, 'save').mockImplementation((blob) => {
      calls += 1;
      if (calls <= 2 || calls === 4) return Promise.reject(new Error('fail'));
      if (calls === 3) {
        return new Promise((resolve) => {
          release = () => resolve(original(blob));
        });
      }
      return original(blob);
    });
    const game = createGame({ seed: 'retry-pending' });
    await game.attachReplay(storage);
    const internals = game.engine as unknown as { phase: string; status: string };
    const finish = async (seed: string) => {
      game.startRun('easy', [], seed);
      internals.phase = 'won';
      internals.status = 'won';
      game.step(0);
      for (let i = 0; i < 12; i += 1) await Promise.resolve();
    };
    await finish('retry-a');
    await finish('retry-b');
    expect(game.getPersistenceStatus().state).toBe('failed');

    const pending = game.retryPersistence();
    for (let i = 0; i < 8 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    await finish('retry-c');
    release?.();
    await pending;

    expect(game.getPersistenceStatus().state).toBe('failed');
    expect(game.getPersistenceStatus().showRetry).toBe(true);
    expect(await storage.list()).toHaveLength(2);
  });

  it('リプレイ保存後の一覧失敗はキャッシュに残し、再試行できる', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'replay-list' });
    await game.attachReplay(storage);
    game.startRun('easy', [], 'replay-list');
    vi.spyOn(storage, 'list').mockRejectedValueOnce(new Error('list failed'));
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 16; i += 1) await Promise.resolve();

    expect(game.getPersistenceStatus().state).toBe('failed');
    expect(game.getPersistenceStatus().showRetry).toBe(true);
    expect(game.listReplays().some((replay) => replay.seed === 'replay-list')).toBe(true);
    expect(await storage.list()).toHaveLength(1);

    await game.retryPersistence();

    expect(game.listReplays().some((replay) => replay.seed === 'replay-list')).toBe(true);
    expect(game.getPersistenceStatus().state).not.toBe('failed');
  });

  it('進行中のリプレイ保存は再試行で重ねず、重複失敗でバナーを残さない', async () => {
    const replayStorage = new MemoryReplayStorage();
    const metaStorage = new MemoryMetaStorage();
    const original = replayStorage.save.bind(replayStorage);
    let release: (() => void) | undefined;
    const save = vi.spyOn(replayStorage, 'save').mockImplementationOnce(
      (blob) =>
        new Promise((resolve) => {
          release = () => resolve(original(blob));
        }),
    );
    const game = createGame({ seed: 'replay-inflight', metaStorage });
    await game.attachReplay(replayStorage);
    vi.spyOn(metaStorage, 'save').mockRejectedValueOnce(new Error('meta failed'));
    game.setSoundMuted(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(game.getPersistenceStatus().state).toBe('failed');

    game.startRun('easy', [], 'replay-inflight');
    const internals = game.engine as unknown as { phase: string; status: string };
    internals.phase = 'won';
    internals.status = 'won';
    game.step(0);
    for (let i = 0; i < 8 && !release; i += 1) await Promise.resolve();
    expect(release).toBeTypeOf('function');
    expect(save).toHaveBeenCalledOnce();

    const pending = game.retryPersistence();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    expect(save).toHaveBeenCalledOnce();
    release?.();
    await pending;
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    expect(save).toHaveBeenCalledOnce();
    expect(game.listReplays().some((replay) => replay.seed === 'replay-inflight')).toBe(true);
    expect(game.getPersistenceStatus().state).not.toBe('failed');
  });

  it('セーブ削除の成功は、最後に端末へ保存できた時刻にしない', async () => {
    let now = Date.parse('2026-01-01T00:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const storage = new MemoryRunStorage();
    const game = createGame({ seed: 'clear-clock', runStorage: storage });
    game.startRun('easy', [], 'clear-clock');
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    const savedClock = formatPersistenceClock(now);

    now += 120_000;
    const clearedAt = now;
    game.clearRunSave();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    now += 120_000;
    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('transient'));
    game.startRun('easy', [], 'next-run');
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    const failed = game.getPersistenceStatus();
    expect(failed.state).toBe('failed');
    expect(failed.detail).toContain(savedClock);
    expect(failed.detail).not.toContain(formatPersistenceClock(clearedAt));
    expect(failed.detail).not.toContain('まだ端末へ保存できていません');
  });

  it('読み込んだセーブの時刻を、最初の保存失敗でも最後の成功時刻として出す', async () => {
    const save = makeRunSave('clock-run');
    const storage = new MemoryRunStorage();
    await storage.save(save);
    const game = createGame({ seed: 'clock-run' });
    game.attachRunPersistence(storage, save);
    expect(game.getPersistenceStatus().liveMessage).toBe('');
    expect(game.getPersistenceStatus().persistent).toBe(false);

    vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('transient'));
    game.startRun('easy', [], 'clock-run');
    await Promise.resolve();
    await Promise.resolve();

    const status = game.getPersistenceStatus();
    expect(status.state).toBe('failed');
    expect(status.detail).toContain('最後に端末へ保存できた時刻');
    expect(status.detail).not.toContain('まだ端末へ保存できていません');
  });

  it('破棄の保存先エラー後も古いセーブを再開させず、新規ランの保存で回復する', async () => {
    const existing = makeRunSave('discarded-save');
    const storage = new MemoryRunStorage();
    await storage.save(existing);
    const clear = vi.spyOn(storage, 'clear').mockRejectedValueOnce(new Error('clear failed'));
    const game = createGame({ seed: 'title', runStorage: storage, initialRunSave: existing });

    game.clearRunSave();
    await Promise.resolve();

    expect(clear).toHaveBeenCalledOnce();
    expect(game.hasResumableRun()).toBe(false);
    expect(game.getRunSaveSummary()).toBeNull();
    expect(game.exportRunSaveText()).toBeNull();
    expect(game.resumeRun()).toBeNull();
    expect(await storage.load()).toEqual(existing);

    game.startRun('easy', [], 'replacement-save');
    expect((await storage.load())?.summary.seed).toBe('replacement-save');
    expect(game.getRunSaveSummary()?.seed).toBe('replacement-save');
  });
});

describe('ゲームのリプレイ保存失敗', () => {
  it('保存先がないと共有取り込みを拒否し、現在のランを変更しない', async () => {
    const game = createGame({ seed: 'without-replay-storage' });
    game.startRun('easy');
    const state = game.engine.snapshot();
    const revision = game.revision();
    const replay = makeReplay('not-persisted');

    expect(await game.importReplayText(serializeReplay(replay))).toEqual({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(await game.importReplay(replay)).toBe(false);
    expect(game.exportReplayText(replay.id)).toBeNull();
    expect(game.listReplays()).toEqual([]);
    expect(game.engine.snapshot()).toEqual(state);
    expect(game.revision()).toBe(revision);
  });

  it.each(['共有ファイル', 'デバッグAPI'] as const)(
    '%s の保存失敗では既存リプレイとラン・メタを保持する',
    async (kind) => {
      const existing = makeReplay('existing-replay');
      const incoming = makeReplay('failed-replay');
      const storage = new MemoryReplayStorage();
      await storage.save(existing);
      const runSave = makeRunSave('keep-run-save');
      const meta = { ...defaultMeta(), points: 20 };
      const game = createGame({ seed: 'title', initialRunSave: runSave, initialMeta: meta });
      await game.attachReplay(storage);
      const state = game.engine.snapshot();
      const revision = game.revision();
      vi.spyOn(storage, 'save').mockRejectedValueOnce(new Error('save failed'));
      const list = vi.spyOn(storage, 'list');

      if (kind === '共有ファイル') {
        expect(await game.importReplayText(serializeReplay(incoming))).toEqual({
          ok: false,
          reason: 'corrupt',
          message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
        });
      } else {
        expect(await game.importReplay(incoming)).toBe(false);
      }

      expect(list).not.toHaveBeenCalled();
      expect(game.listReplays()).toEqual([existing]);
      expect(await storage.get(incoming.id)).toBeNull();
      expect(game.engine.snapshot()).toEqual(state);
      expect(game.getRunSaveSummary()).toEqual(runSave.summary);
      expect(game.getMeta()).toEqual(meta);
      expect(game.revision()).toBe(revision);
      expect(await game.importReplayText(serializeReplay(incoming))).toMatchObject({ ok: true });
      expect(game.listReplays().map((replay) => replay.id)).toContain(incoming.id);
    },
  );

  it('保存後の一覧に取り込み対象がなければ成功を返さず、既存リプレイを残す', async () => {
    const existing = makeReplay('existing-replay');
    const incoming = makeReplay('missing-after-save');
    const storage = new MemoryReplayStorage();
    await storage.save(existing);
    const game = createGame({ seed: 'title' });
    await game.attachReplay(storage);
    const save = vi.spyOn(storage, 'save').mockResolvedValueOnce(undefined);

    expect(await game.importReplayText(serializeReplay(incoming))).toEqual({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: incoming.id }), { pin: true });
    expect(game.listReplays()).toEqual([existing]);
    expect(game.openReplay(incoming.id)).toBeNull();
    expect(game.openReplay(existing.id)?.seed).toBe(existing.seed);
  });

  it('接続先の一覧取得が失敗してもキャッシュ済みリプレイを閲覧できる', async () => {
    const replay = makeReplay('cached-replay');
    const storage = new MemoryReplayStorage();
    await storage.save(replay);
    const game = createGame({ seed: 'title' });
    await game.attachReplay(storage);
    const revision = game.revision();
    const unavailableStorage = new MemoryReplayStorage();
    vi.spyOn(unavailableStorage, 'list').mockRejectedValue(new Error('read failed'));

    await game.attachReplay(unavailableStorage);

    expect(game.revision()).toBeGreaterThan(revision);
    expect(game.listReplays()).toEqual([replay]);
    expect(game.openReplay(replay.id)?.seed).toBe(replay.seed);
    expect(game.isReplayMode()).toBe(true);
  });
});
