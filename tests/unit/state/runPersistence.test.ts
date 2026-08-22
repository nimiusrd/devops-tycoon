import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../../src/game';
import { createRunEngine } from '../../../src/sim/run/engine';
import {
  goalProgressStatus,
  MIN_ADJUSTED_QUARTER_DELIVERY_TARGET,
} from '../../../src/sim/run/quarterReview';
import { openGameDb, RUN_RECORD_KEY, RUN_STORE_NAME } from '../../../src/state/gameDb';
import { defaultMeta } from '../../../src/state/meta';
import {
  CURRENT_RUN_RULESET,
  getRunSaveCompatibilityIssue,
  IndexedDbRunStorage,
  MemoryRunStorage,
  initializeRunPersistence,
  parseRunSave,
  parseRunSaveFile,
  serializeRunSave,
  toRunSave,
  RUN_SAVE_SCHEMA_VERSION,
  type RunSave,
} from '../../../src/state/runPersistence';
import { MemoryReplayStorage } from '../../../src/state/replayPersistence';

import 'fake-indexeddb/auto';

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

function makeBlockingRunStorage(initial: RunSave) {
  let saveState: RunSave | null = structuredClone(initial);
  let blockNextSave = false;
  let saveStarted = Promise.resolve();
  let resolveSaveStarted: (() => void) | null = null;
  let releasePendingSave: (() => void) | null = null;

  const storage = {
    async load(): Promise<RunSave | null> {
      return saveState ? structuredClone(saveState) : null;
    },
    save(save: RunSave): Promise<void> {
      const snapshot = structuredClone(save);
      if (!blockNextSave) {
        saveState = snapshot;
        return Promise.resolve();
      }
      blockNextSave = false;
      resolveSaveStarted?.();
      return new Promise<void>((resolve) => {
        releasePendingSave = () => {
          saveState = snapshot;
          releasePendingSave = null;
          resolve();
        };
      });
    },
    async clear(): Promise<void> {
      saveState = null;
    },
  };

  return {
    storage,
    blockNextSave() {
      blockNextSave = true;
      saveStarted = new Promise<void>((resolve) => {
        resolveSaveStarted = resolve;
      });
    },
    saveStarted: () => saveStarted,
    releaseSave() {
      releasePendingSave?.();
    },
  };
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

  it('RI-117: 新規セーブは現行ルールセットを記録し、一致時だけ互換になる', () => {
    const valid = makeRunSave('ri117-ruleset-match');
    expect(valid.ruleset).toEqual(CURRENT_RUN_RULESET);
    expect(getRunSaveCompatibilityIssue(valid)).toBeNull();

    const unknown = parseRunSave({
      ...valid,
      ruleset: undefined,
    });
    expect(unknown?.ruleset).toBeNull();
    expect(getRunSaveCompatibilityIssue(unknown!)).toMatchObject({
      kind: 'ruleset-unknown',
      savedRuleset: null,
    });

    const mismatched = parseRunSave({
      ...valid,
      ruleset: { version: CURRENT_RUN_RULESET.version, fingerprint: 'different-ruleset' },
    });
    expect(getRunSaveCompatibilityIssue(mismatched!)).toMatchObject({
      kind: 'ruleset-mismatch',
      savedRuleset: { fingerprint: 'different-ruleset' },
    });
  });

  it('RI-117: 互換不可セーブは自動削除せず、明示 clear まで保持する', async () => {
    const storage = indexedDbStorage();
    const save = { ...makeRunSave('ri117-unknown-save'), ruleset: null };
    await storage.save(save);

    const loaded = await storage.load();
    expect(loaded).toMatchObject({ ruleset: null, summary: save.summary });

    const boot = await initializeRunPersistence(storage);
    expect(boot.save).toBeNull();
    expect(boot.issue).toMatchObject({
      kind: 'ruleset-unknown',
      summary: save.summary,
    });
    expect(await storage.load()).not.toBeNull();

    await storage.clear();
    expect(await storage.load()).toBeNull();
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

  it('RI-68/RI-75: 旧スキーマ v1〜v3 は Delivery スケール非互換のため破棄する', () => {
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

    const legacyV7 = parseRunSave({
      ...valid,
      schemaVersion: 7,
    });
    expect(legacyV7?.ruleset).toBeNull();
    expect(getRunSaveCompatibilityIssue(legacyV7!)).toMatchObject({
      kind: 'ruleset-unknown',
    });
  });

  it('RI-84: v4 の途中セーブは現行 Delivery 倍率へ移行して現行スキーマとして復元する', () => {
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
    // v4 normal 倍率 1.95 → 現行（RI-77）2.25 へスケールする。
    expect(parsed?.state.quarterGoal.deliveryTarget).toBe(
      Math.round((legacyDeliveryTarget * 2.25) / 1.95),
    );
  });

  it('RI-77: v5 の途中セーブは現行 Delivery 倍率へ移行して現行スキーマとして復元する', () => {
    const valid = makeRunSave('ri77-v5-goal-migration');
    const legacyDeliveryTarget = 3510;
    const parsed = parseRunSave({
      ...valid,
      schemaVersion: 5,
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
    // v5 normal 倍率 1.8 → 現行 2.25。
    expect(parsed?.state.quarterGoal.deliveryTarget).toBe(
      Math.round((legacyDeliveryTarget * 2.25) / 1.8),
    );
  });

  it('RI-128: v6 の途中セーブは欠落した trendHistory を空配列へ補完する', () => {
    const valid = makeRunSave('ri128-v6-trend-backfill');
    const { trendHistory: _omitted, ...stateWithoutTrend } = valid.state;
    const parsed = parseRunSave({
      ...valid,
      schemaVersion: 6,
      state: stateWithoutTrend,
    });

    expect(parsed?.schemaVersion).toBe(RUN_SAVE_SCHEMA_VERSION);
    expect(parsed?.state.trendHistory).toEqual([]);
  });

  it('RI-128: v7 の trendHistory は往復で同一内容を保つ', () => {
    const valid = makeRunSave('ri128-v7-trend-roundtrip');
    const history = [
      {
        quarterNumber: 1,
        diagnosis: 'reviewHell' as const,
        kpis: [
          { id: 'delivery', label: '出荷', target: 90, actual: 80, status: 'missed' as const },
        ],
        company: {
          shipping: 80,
          aiDependency: 55,
          techDebt: 30,
          morale: 60,
          onFire: 1,
          healthRank: 'B',
          selfRank: 4,
        },
        departments: [
          {
            deptId: 'product',
            aiDependency: 50,
            techDebt: 20,
            morale: 65,
            health: 'congested' as const,
          },
        ],
      },
    ];
    const parsed = parseRunSave({
      ...valid,
      state: { ...valid.state, trendHistory: history },
    });

    expect(parsed?.schemaVersion).toBe(RUN_SAVE_SCHEMA_VERSION);
    expect(parsed?.state.trendHistory).toEqual(history);
    expect(parsed?.state.trendHistory).not.toBe(history);
    parsed!.state.trendHistory[0]!.company.shipping = 0;
    expect(history[0]!.company.shipping).toBe(80);
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
        org: { ...valid.state.org, quality: 99 },
        quarterTotals: {
          ...valid.state.quarterTotals,
          delivered: 1260,
          completed: 2,
          rework: 1,
        },
        extras: {
          ...valid.state.extras,
          teams: valid.state.extras.teams?.map((team) => ({
            ...team,
            aiDependency: 40,
            quality: 99,
          })),
          winEvalOrg: { ...valid.state.org, aiDependency: 90 },
        },
        quarterGoal: { ...valid.state.quarterGoal, deliveryTarget: 1260 },
        quarterReview: {
          goal: { ...valid.state.quarterGoal, deliveryTarget: 1260 },
          outcome: 'met',
          trust: { ...valid.state.stakeholderTrust },
          progress: [
            {
              id: 'delivery',
              label: 'Delivery（四半期累計）',
              target: 1260,
              actual: 1260,
              status: 'met',
            },
            { id: 'quality', label: 'Quality', target: 45, actual: 40, status: 'missed' },
            { id: 'techDebt', label: 'Tech Debt', target: 55, actual: 40, status: 'met' },
            { id: 'morale', label: 'Morale', target: 40, actual: 50, status: 'met' },
            { id: 'incident', label: 'Incident', target: 6, actual: 1, status: 'met' },
          ],
          missedReasons: [],
          availableAdjustments: [],
          bossCleared: true,
        },
      },
    });

    const review = parsed?.state.quarterReview;
    // 1260 × 2.25/1.95 → 1454（下限 MIN_ADJUSTED より上）。
    const migratedDelivery = Math.round((1260 * 2.25) / 1.95);
    expect(migratedDelivery).toBeGreaterThan(MIN_ADJUSTED_QUARTER_DELIVERY_TARGET);
    expect(parsed?.state.quarterGoal.deliveryTarget).toBe(migratedDelivery);
    expect(review?.goal.deliveryTarget).toBe(migratedDelivery);
    expect(review?.progress.length).toBeGreaterThan(0);
    expect(review?.progress.find((item) => item.id === 'delivery')?.target).toBe(migratedDelivery);
    expect(review?.progress.find((item) => item.id === 'quality')).toMatchObject({
      actual: 40,
      status: 'missed',
    });
    expect(review?.progress.find((item) => item.id === 'quality')?.status).toBe(
      goalProgressStatus(40, 45, true),
    );
    expect(review?.missedReasons).not.toContain(
      'AI 過信: AI 利用率は高いが手戻り・品質が追いついていない。',
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

  it('RI-117: 互換不可セーブは GameHandle から再開できず、clear はラン保存だけを消す', async () => {
    const storage = new MemoryRunStorage();
    const incompatible = { ...makeRunSave('ri117-game-guard'), ruleset: null };
    const game = createGame({
      seed: 'fresh',
      runStorage: storage,
      initialRunSave: incompatible,
      metaReady: true,
    });

    expect(game.hasResumableRun()).toBe(false);
    expect(game.getRunSaveIssue()).toMatchObject({ kind: 'ruleset-unknown' });
    expect(game.getRunSaveSummary()).toEqual(incompatible.summary);
    expect(game.resumeRun()).toBeNull();

    const metaBefore = game.getMeta();
    game.clearRunSave();
    await flushSave(storage);
    expect(await storage.load()).toBeNull();
    expect(game.getRunSaveIssue()).toBeNull();
    expect(game.getRunSaveSummary()).toBeNull();
    expect(game.getMeta()).toEqual(metaBefore);
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

function indexedDbName(): string {
  const name = `devops-tycoon-ri91-b4-${databases.length}`;
  databases.push(name);
  return name;
}

function makeRunSaveWith(
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

describe('RI-91-B4 runPersistence survived mutants', () => {
  describe('difficulty / trials 正常系', () => {
    it('difficulty normal / nightmare を受け入れ、非空 trials を clone する', () => {
      for (const difficulty of ['normal', 'nightmare'] as const) {
        const valid = makeRunSaveWith(`ri91-b4-${difficulty}`, {
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
      const valid = makeRunSaveWith('ri91-b4-broken-fields', {
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
      const save = makeRunSaveWith('ri91-b4-init-ok', {
        difficulty: 'nightmare',
        trials: ['frontier-dependency'],
      });
      const storage = new MemoryRunStorage();
      await storage.save(save);

      const boot = await initializeRunPersistence(storage);
      expect(boot.storage).toBe(storage);
      expect(boot.save).toEqual(save);
      expect(boot).toEqual({ save, issue: null, storage });
    });
  });
});

describe('RI-133 セーブファイル共有', () => {
  it('現行セーブをJSONへ変換し、同じ内容へ往復できる', () => {
    const save = makeRunSaveWith('ri133-save-roundtrip');
    const result = parseRunSaveFile(serializeRunSave(save));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.save).toEqual(save);
  });

  it('破損・未対応スキーマ・ルールセット不一致を理由付きで拒否する', () => {
    const save = makeRunSave('ri133-save-reject');

    expect(parseRunSaveFile('{')).toMatchObject({ ok: false, reason: 'invalid-json' });
    expect(parseRunSaveFile(JSON.stringify({ ...save, schemaVersion: 999 }))).toMatchObject({
      ok: false,
      reason: 'unsupported-schema',
    });
    expect(parseRunSaveFile(JSON.stringify({ ...save, summary: null }))).toMatchObject({
      ok: false,
      reason: 'invalid-data',
    });
    expect(
      parseRunSaveFile(
        JSON.stringify({
          ...save,
          state: { ...save.state, deck: null },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseRunSaveFile(
        JSON.stringify({
          ...save,
          state: { ...save.state, shop: {} },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseRunSaveFile(
        JSON.stringify({
          ...save,
          state: { ...save.state, diagnosis: 'unknown-diagnosis' },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseRunSaveFile(
        JSON.stringify({
          ...save,
          summary: { ...save.summary, dailyDate: undefined },
          state: { ...save.state, dailyDate: undefined },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseRunSaveFile(
        JSON.stringify({
          ...save,
          summary: { ...save.summary, dailyDate: '2026-02-29' },
          state: { ...save.state, dailyDate: '2026-02-29' },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseRunSaveFile(
        JSON.stringify({
          ...save,
          summary: { ...save.summary, runKind: 'normal', dailyDate: '2026-07-27' },
          state: { ...save.state, runKind: 'normal', dailyDate: '2026-07-27' },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseRunSaveFile(
        JSON.stringify({
          ...save,
          summary: { ...save.summary, runKind: 'normal', dailyDate: undefined },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseRunSaveFile(
        JSON.stringify({
          ...save,
          replayKeyframes: [
            {
              ...save.replayKeyframes[0],
              frame: { ...save.replayKeyframes[0].frame, deck: null },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(parseRunSaveFile(JSON.stringify({ ...save, ruleset: null }))).toMatchObject({
      ok: false,
      reason: 'ruleset-unknown',
    });
    expect(
      parseRunSaveFile(
        JSON.stringify({
          ...save,
          ruleset: { version: CURRENT_RUN_RULESET.version, fingerprint: 'different-ruleset' },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'ruleset-mismatch' });
  });

  it('フェーズごとの必須状態が欠けたセーブを拒否する', () => {
    const engine = createRunEngine({ seed: 'ri133-phase-required' });
    engine.startRun('easy', [], 'ri133-phase-required');
    engine.beginSetupSprint();
    let guard = 0;
    while (engine.sprintRunning() && guard++ < 20_000) engine.step(100);
    const resultState = engine.exportPersistState();
    if (!resultState || resultState.phase !== 'result') throw new Error('result fixture missing');

    expect(
      parseRunSaveFile(
        serializeRunSave({
          ...toRunSave(resultState),
          state: { ...resultState, lastResult: null },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });

    engine.acknowledgeResult();
    const draftState = engine.exportPersistState();
    if (!draftState || draftState.phase !== 'draft') throw new Error('draft fixture missing');
    expect(
      parseRunSaveFile(
        serializeRunSave({
          ...toRunSave(draftState),
          state: { ...draftState, draft: null },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
  });

  it('GameHandleは検証成功後だけセーブを置き換え、メタ進行を変更しない', async () => {
    const storage = new MemoryRunStorage();
    const meta = defaultMeta();
    const game = createGame({ initialMeta: meta, runStorage: storage });
    const save = makeRunSaveWith('ri133-game-import');

    const imported = await game.importRunSave(serializeRunSave(save));
    expect(imported).toMatchObject({ ok: true });
    expect(await storage.load()).toEqual(save);
    expect(game.getRunSave()).toEqual(save);
    expect(game.getMeta()).toEqual(meta);
    const importedRevision = game.getRunSaveRevision();
    expect(importedRevision).toBeGreaterThan(0);
    expect(game.getRunSaveRevision()).toBe(importedRevision);

    const beforeRejectedImport = await storage.load();
    const rejected = await game.importRunSave(JSON.stringify({ ...save, schemaVersion: 999 }));
    expect(rejected).toMatchObject({ ok: false, reason: 'unsupported-schema' });
    expect(await storage.load()).toEqual(beforeRejectedImport);
  });

  it('タイトルを離れた後に完了したセーブ取込は現在のランを上書きしない', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ runStorage: storage });
    const importedSave = makeRunSaveWith('ri133-stale-import');

    game.startRun('easy', [], 'ri133-current-run');
    const currentSave = await storage.load();

    const result = await game.importRunSave(serializeRunSave(importedSave));

    expect(result).toMatchObject({ ok: false, reason: 'stale' });
    expect(await storage.load()).toEqual(currentSave);
    expect(game.getRunSave()?.state.seed).toBe('ri133-current-run');
  });

  it('リプレイ閲覧への遷移と競合したセーブ取込は既存セーブを復元する', async () => {
    const existingSave = makeRunSaveWith('ri133-existing-save');
    const controlled = makeBlockingRunStorage(existingSave);
    const replayStorage = new MemoryReplayStorage();
    const replay = makeRunSave('ri133-replay-stale-import').replayKeyframes[0];
    if (!replay) throw new Error('replay fixture missing');
    await replayStorage.save({
      schemaVersion: 2,
      id: 'ri133-replay-stale',
      seed: replay.frame.seed,
      difficulty: replay.frame.difficulty,
      trials: replay.frame.trials,
      finishedAt: 1234,
      outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 1 },
      keyframes: [replay],
      ruleset: CURRENT_RUN_RULESET,
      contentSnapshot: { cards: [], relics: [] },
    });
    const game = createGame({ runStorage: controlled.storage });
    game.attachRunPersistence(controlled.storage, existingSave);
    await game.attachReplay(replayStorage);

    controlled.blockNextSave();
    const importPromise = game.importRunSave(
      serializeRunSave(makeRunSaveWith('ri133-replay-stale-import')),
    );
    await controlled.saveStarted();
    expect(game.openReplay('ri133-replay-stale', 0)).not.toBeNull();
    controlled.releaseSave();

    expect(await importPromise).toMatchObject({ ok: false, reason: 'stale' });
    expect(await controlled.storage.load()).toEqual(existingSave);
    expect(game.getRunSave()).toEqual(existingSave);
  });

  it('重なったセーブ取込を直列化し、メモリと永続層を同じ結果にする', async () => {
    const storage = new MemoryRunStorage();
    const game = createGame({ runStorage: storage });
    const firstSave = makeRunSaveWith('ri133-queued-first');
    const secondSave = makeRunSaveWith('ri133-queued-second');

    const [first, second] = await Promise.all([
      game.importRunSave(serializeRunSave(firstSave)),
      game.importRunSave(serializeRunSave(secondSave)),
    ]);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(game.getRunSave()).toEqual(secondSave);
    expect(await storage.load()).toEqual(secondSave);
  });
});
