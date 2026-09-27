import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, type GameHandle } from '../../../src/game';
import { createRunEngine } from '../../../src/sim/run/engine';
import { defaultMeta } from '../../../src/state/meta';
import { initializeMetaPersistence, MemoryMetaStorage } from '../../../src/state/metaPersistence';
import {
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
    expect(game.getPersistenceStatus().liveMessage).toContain('失敗');
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
    game.setSoundMuted(false);
    await Promise.resolve();

    expect(game.getPersistenceStatus().state).toBe('session');
    expect(game.getPersistenceStatus().detail).toContain('書き戻しません');
    expect(save).not.toHaveBeenCalled();
    expect(game.getMeta().soundMuted).toBe(false);

    await game.retryPersistence();

    expect(save).not.toHaveBeenCalled();
    expect(game.getMeta().points).toBe(80);
    expect(game.getMeta().unlockedCards).toEqual(['devin']);
    expect(game.getMeta().soundMuted).toBe(true);
    expect(game.getPersistenceStatus().state).not.toBe('session');
    expect(game.getPersistenceStatus().liveMessage).toContain('読み直せました');
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
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledOnce();
    expect(game.listReplays()).toEqual([]);
    expect(game.getPersistenceStatus().state).toBe('failed');
    expect(game.getPersistenceStatus().showRetry).toBe(true);

    await game.retryPersistence();

    expect(save).toHaveBeenCalledTimes(2);
    expect(game.listReplays()).toHaveLength(1);
    expect(game.listReplays()[0]?.seed).toBe('replay-retry');
    expect(game.getPersistenceStatus().state).toBe('saved');
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
    expect(other.getRunSaveSummary()?.seed).toBe('stored-run');
    expect((await durableExisting.load())?.summary.seed).toBe('stored-run');
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
