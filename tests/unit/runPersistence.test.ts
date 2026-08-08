import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../src/game';
import { createRunEngine } from '../../src/sim/run/engine';
import { MIN_ADJUSTED_QUARTER_DELIVERY_TARGET } from '../../src/sim/run/quarterReview';
import { openGameDb, RUN_RECORD_KEY, RUN_STORE_NAME } from '../../src/state/gameDb';
import {
  IndexedDbRunStorage,
  MemoryRunStorage,
  initializeRunPersistence,
  parseRunSave,
  toRunSave,
  RUN_SAVE_SCHEMA_VERSION,
  type RunSave,
} from '../../src/state/runPersistence';

const databases: string[] = [];

function indexedDbStorage(): IndexedDbRunStorage {
  const name = `devops-tycoon-run-test-${databases.length}`;
  databases.push(name);
  return new IndexedDbRunStorage(name);
}

function makeRunSave(seed = 'ri72-run-save'): RunSave {
  const engine = createRunEngine({ seed });
  engine.startRun('easy', [], seed, { kind: 'daily', dailyDate: '2026-07-27' });
  const state = engine.exportPersistState();
  const frame = engine.exportReplayFrame();
  if (!state || !frame) throw new Error('failed to export run save fixture');
  return toRunSave(state, 1234, [{ phase: 'setup', label: '編成', frame }]);
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
    expect(
      parseRunSave({
        ...valid,
        state: { ...valid.state, status: 'lost' },
      }),
    ).toBeNull();
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

  it('RI-68/RI-75: 旧スキーマのセーブは Delivery スケール非互換のため破棄する', () => {
    const valid = makeRunSave('ri68-old-schema');
    expect(
      parseRunSave({
        ...valid,
        schemaVersion: 1,
        replayKeyframes: undefined,
      }),
    ).toBeNull();
    expect(
      parseRunSave({
        ...valid,
        schemaVersion: 2,
      }),
    ).toBeNull();
    // RI-75: v3 は旧 Delivery 目標スケールのまま残る進行中セーブを再開させない。
    expect(
      parseRunSave({
        ...valid,
        schemaVersion: 3,
      }),
    ).toBeNull();
  });

  it('RI-84: v4 の途中セーブは現行 Delivery 倍率へ移行して v5 として復元する', () => {
    const valid = makeRunSave('ri84-v4-goal-migration');
    const legacyDeliveryTarget = 1950;
    const parsed = parseRunSave({
      ...valid,
      schemaVersion: 4,
      state: {
        ...valid.state,
        difficulty: 'normal',
        quarterGoal: {
          ...valid.state.quarterGoal,
          deliveryTarget: legacyDeliveryTarget,
        },
      },
      summary: { ...valid.summary, difficulty: 'normal' },
    });

    expect(parsed?.schemaVersion).toBe(RUN_SAVE_SCHEMA_VERSION);
    expect(parsed?.state.quarterGoal.deliveryTarget).toBe(
      Math.round((legacyDeliveryTarget * 1.8) / 1.95),
    );
  });

  it('RI-84: v4 の quarterReview は移行後の目標から再構築する', () => {
    const valid = makeRunSave('ri84-v4-review-migration');
    const parsed = parseRunSave({
      ...valid,
      schemaVersion: 4,
      summary: { ...valid.summary, difficulty: 'normal', phase: 'quarterReview' },
      state: {
        ...valid.state,
        difficulty: 'normal',
        phase: 'quarterReview',
        quarterGoal: { ...valid.state.quarterGoal, deliveryTarget: 1260 },
        quarterReview: {
          goal: { ...valid.state.quarterGoal, deliveryTarget: 1260 },
          outcome: 'met',
          trust: { ...valid.state.stakeholderTrust },
          progress: [],
          missedReasons: [],
          availableAdjustments: [],
          bossCleared: true,
        },
      },
    });

    const review = parsed?.state.quarterReview;
    expect(parsed?.state.quarterGoal.deliveryTarget).toBe(MIN_ADJUSTED_QUARTER_DELIVERY_TARGET);
    expect(review?.goal.deliveryTarget).toBe(MIN_ADJUSTED_QUARTER_DELIVERY_TARGET);
    expect(review?.progress.length).toBeGreaterThan(0);
    expect(review?.progress.find((item) => item.id === 'delivery')?.target).toBe(
      MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
    );
    expect(review?.outcome).not.toBe('met');
  });

  it('現行スキーマのセーブは不足 replayKeyframes を空配列に正規化する', () => {
    const valid = makeRunSave('ri68-current-schema');
    const parsed = parseRunSave({
      ...valid,
      schemaVersion: RUN_SAVE_SCHEMA_VERSION,
      replayKeyframes: undefined,
    });

    expect(parsed).toMatchObject({
      schemaVersion: RUN_SAVE_SCHEMA_VERSION,
      savedAt: 1234,
      summary: {
        seed: 'ri68-current-schema',
        runKind: 'daily',
        dailyDate: '2026-07-27',
        status: 'playing',
      },
    });
    expect(parsed?.replayKeyframes).toEqual([]);
  });

  it('壊れた replayKeyframes だけを捨て、正常要素は clone して残す', () => {
    const valid = makeRunSave('ri72-keyframes');
    const goodKeyframe = valid.replayKeyframes[0]!;
    const parsed = parseRunSave({
      ...valid,
      replayKeyframes: [
        goodKeyframe,
        { phase: 'setup', label: 123, frame: goodKeyframe.frame },
        { phase: 'sprint', frame: goodKeyframe.frame },
        { phase: 'setup', frame: { ...goodKeyframe.frame, phase: 'sprint' } },
        { phase: 'setup', frame: { ...goodKeyframe.frame, extras: { allowedCards: [] } } },
        null,
      ],
    });

    expect(parsed?.replayKeyframes).toHaveLength(2);
    expect(parsed?.replayKeyframes[0]).toEqual(goodKeyframe);
    expect(parsed?.replayKeyframes[0]).not.toBe(goodKeyframe);
    expect(parsed?.replayKeyframes[0]?.frame).not.toBe(goodKeyframe.frame);
    expect(parsed?.replayKeyframes[1]?.label).toBeUndefined();
  });

  it('summary の不正値は個別に拒否する', () => {
    const valid = makeRunSave('ri72-bad-summary');
    const withSummary = (summary: Record<string, unknown>) => ({
      ...valid,
      summary: { ...valid.summary, ...summary },
    });

    expect(parseRunSave(null)).toBeNull();
    expect(parseRunSave([])).toBeNull();
    expect(parseRunSave({ ...valid, savedAt: Number.NaN })).toBeNull();
    expect(parseRunSave({ ...valid, summary: [] })).toBeNull();
    expect(parseRunSave({ ...valid, state: [] })).toBeNull();
    expect(parseRunSave(withSummary({ seed: 42 }))).toBeNull();
    expect(parseRunSave(withSummary({ difficulty: 'casual' }))).toBeNull();
    expect(parseRunSave(withSummary({ trials: 'trial-a' }))).toBeNull();
    expect(parseRunSave(withSummary({ trials: ['trial-a', 1] }))).toBeNull();
    expect(parseRunSave(withSummary({ runKind: 'weekly' }))).toBeNull();
    expect(parseRunSave(withSummary({ dailyDate: 20260727 }))).toBeNull();
    expect(parseRunSave(withSummary({ phase: 'sprint' }))).toBeNull();
    expect(parseRunSave(withSummary({ quarterNumber: '1' }))).toBeNull();
    expect(parseRunSave(withSummary({ sprintIndexInQuarter: '0' }))).toBeNull();
    expect(parseRunSave(withSummary({ sprintsPlayed: '0' }))).toBeNull();
    expect(parseRunSave(withSummary({ status: 'won' }))).toBeNull();
  });

  it('state と extras の不正値は個別に拒否する', () => {
    const valid = makeRunSave('ri72-bad-state');
    const withState = (state: Record<string, unknown>) => ({
      ...valid,
      state: { ...valid.state, ...state },
    });
    const withExtras = (extras: Record<string, unknown>) =>
      withState({ extras: { ...valid.state.extras, ...extras } });

    expect(parseRunSave(withState({ phase: 'title' }))).toBeNull();
    expect(parseRunSave(withState({ phase: 'result' }))).toBeNull();
    expect(parseRunSave(withState({ status: 'lost' }))).toBeNull();
    expect(parseRunSave(withState({ seed: 'other-seed' }))).toBeNull();
    expect(parseRunSave(withState({ extras: null }))).toBeNull();
    expect(parseRunSave(withState({ extras: [] }))).toBeNull();
    expect(parseRunSave(withExtras({ allowedCards: 'copilot' }))).toBeNull();
    expect(parseRunSave(withExtras({ allowedRelics: 'coffee' }))).toBeNull();
    expect(parseRunSave(withExtras({ baseConfig: [] }))).toBeNull();
    expect(parseRunSave(withExtras({ orgAdjust: null }))).toBeNull();
  });

  it('IndexedDbRunStorage clear は直接呼びで保存済みセーブを削除する', async () => {
    const storage = indexedDbStorage();
    const save = makeRunSave('ri72-clear-direct');
    await storage.save(save);
    expect(await storage.load()).toEqual(save);

    await storage.clear();

    expect(await storage.load()).toBeNull();
    const next = makeRunSave('ri72-clear-next');
    await storage.save(next);
    expect(await storage.load()).toEqual(next);
  });

  it('IndexedDbRunStorage clear 失敗後も次の保存と読み取りが継続できる', async () => {
    const storage = indexedDbStorage();
    await storage.save(makeRunSave('ri72-clear-fail-first'));
    const originalDelete = IDBObjectStore.prototype.delete;
    const deleteSpy = vi.spyOn(IDBObjectStore.prototype, 'delete');
    deleteSpy.mockImplementationOnce(function (
      this: IDBObjectStore,
      query: IDBValidKey | IDBKeyRange,
    ) {
      if (query === RUN_RECORD_KEY) {
        throw new DOMException('forced run clear failure', 'InvalidStateError');
      }
      return originalDelete.call(this, query);
    });

    await expect(storage.clear()).rejects.toThrow('forced run clear failure');
    deleteSpy.mockRestore();

    const recovered = makeRunSave('ri72-clear-recovered');
    await storage.save(recovered);
    expect(await storage.load()).toEqual(recovered);
  });

  it('MemoryRunStorage は保存値と読み取り値を clone し、clear で破棄する', async () => {
    const storage = new MemoryRunStorage();
    const save = makeRunSave('ri72-memory-clone');
    await storage.save(save);
    save.summary.seed = 'mutated-after-save';

    const loaded = await storage.load();
    expect(loaded?.summary.seed).toBe('ri72-memory-clone');
    loaded!.summary.seed = 'mutated-after-load';
    expect((await storage.load())?.summary.seed).toBe('ri72-memory-clone');

    await storage.clear();
    expect(await storage.load()).toBeNull();
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

  it('beginSetupSprint 直前の編成変更をセーブに残す', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ seed: 'ri58-form', runStorage: storage, metaReady: true });
    game.attachRunPersistence(storage, null);
    game.startRun('easy', [], 'ri58-form');
    const memberId = game.getState().roster.members[0]!.id;
    game.assignMember(memberId, 'review');
    expect(game.getState().roster.members.find((m) => m.id === memberId)?.assignment).toBe(
      'review',
    );

    game.beginSetupSprint();
    expect(game.phase()).toBe('sprint');
    await flushSave(storage);
    const save = await storage.load();
    expect(save?.summary.phase).toBe('setup');
    expect(save?.state.roster.members.find((m) => m.id === memberId)?.assignment).toBe('review');
  });

  it('enterTeam 成功時は setup セーブへ activeTeamId を残す', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ seed: 'ri64-enter-save', runStorage: storage, metaReady: true });
    game.attachRunPersistence(storage, null);
    game.startRun('easy', [], 'ri64-enter-save');
    await flushSave(storage);
    expect(game.getState().activeTeamId).toBe('product-t0');

    game.enterTeam('platform-t1');
    expect(game.getState().activeTeamId).toBe('platform-t1');
    await flushSave(storage);
    const save = await storage.load();
    expect(save?.state.extras.activeTeamId).toBe('platform-t1');
    expect(save?.state.extras.teamLockUntilSprint).toBeGreaterThan(0);
  });

  it('ショップ購入で敗北したらセーブを破棄する', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({
      seed: 'ri58-shop-lose',
      difficulty: 'nightmare',
      runStorage: storage,
      metaReady: true,
    });
    game.attachRunPersistence(storage, null);
    game.startRun('nightmare', [], 'ri58-shop-lose');
    await flushSave(storage);
    expect(await storage.load()).not.toBeNull();

    const internals = game.engine as unknown as {
      phase: string;
      budget: number;
      shop: {
        cards: Array<{ defId: string; cost: number; bought: boolean }>;
        relic?: { id: string; cost: number; bought: boolean };
      } | null;
    };
    internals.phase = 'shop';
    internals.budget = 10;
    internals.shop = { cards: [{ defId: 'copilot', cost: 10, bought: false }] };

    const state = game.buyShopCard('copilot');
    expect(state.status).toBe('lost');
    expect(state.phase).toBe('lost');
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
