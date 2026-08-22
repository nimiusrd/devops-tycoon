import { deleteDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../../../src/game';
import { RunEngine } from '../../../src/sim/run/engine';
import { openGameDb, REPLAYS_STORE_NAME } from '../../../src/state/gameDb';
import { defaultMeta } from '../../../src/state/meta';
import {
  buildReplayId,
  normalizeReplay,
  parseReplayFile,
  REPLAY_MAX_COUNT,
  REPLAY_SCHEMA_VERSION,
  serializeReplay,
  snapshotReplayContent,
  type ReplayBlob,
  normalizeReplayKeyframes,
  type ReplayKeyframe,
} from '../../../src/state/replay';
import {
  IndexedDbReplayStorage,
  initializeReplayPersistence,
  MemoryReplayStorage,
  type ReplayStorage,
} from '../../../src/state/replayPersistence';
import { CURRENT_RUN_RULESET, MemoryRunStorage } from '../../../src/state/runPersistence';

import 'fake-indexeddb/auto';

const databases: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

function nextReplayDbName(label: string): string {
  const name = `devops-tycoon-${label}-${databases.length}`;
  databases.push(name);
  return name;
}

function makeBlob(partial: Partial<ReplayBlob> & Pick<ReplayBlob, 'id' | 'seed'>): ReplayBlob {
  const engine = new RunEngine({ seed: partial.seed, difficulty: 'easy' });
  engine.startRun('easy', [], partial.seed);
  const frame = engine.exportReplayFrame();
  if (!frame) throw new Error('export failed');
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: partial.id,
    seed: partial.seed,
    difficulty: 'easy',
    trials: [],
    finishedAt: partial.finishedAt ?? 1000,
    outcome: {
      status: 'won',
      diagnosis: 'healthyAcceleration',
      score: 10,
      ...partial.outcome,
    },
    keyframes: partial.keyframes ?? [{ phase: 'setup', frame }],
    ruleset: partial.ruleset ?? { version: 1, fingerprint: 'test-ruleset' },
    contentSnapshot: partial.contentSnapshot ?? { cards: [], relics: [] },
  };
}

describe('リプレイ正規化（RI-61）', () => {
  it('正常 blob を往復できる', () => {
    const blob = makeBlob({ id: 'a', seed: 'r1' });
    const normalized = normalizeReplay(blob);
    expect(normalized?.id).toBe('a');
    expect(normalized?.ruleset).toEqual(blob.ruleset);
    expect(normalized?.contentSnapshot).toEqual(blob.contentSnapshot);
    expect(normalized?.contentSnapshot).not.toBe(blob.contentSnapshot);
  });

  it('壊れた／非互換は null', () => {
    expect(normalizeReplay(null)).toBeNull();
    expect(normalizeReplay({ schemaVersion: 99 })).toBeNull();
    const blob = makeBlob({ id: 'b', seed: 'r2' });
    expect(normalizeReplay({ ...blob, keyframes: [] })).toBeNull();
    expect(normalizeReplay({ ...blob, ruleset: null })).toBeNull();
    expect(normalizeReplay({ ...blob, ruleset: { version: 0, fingerprint: 'bad' } })).toBeNull();
    expect(
      normalizeReplay({
        ...blob,
        contentSnapshot: { cards: [{ id: 'bad' }], relics: [] },
      }),
    ).toBeNull();
  });

  it('v1 はキーフレームを保持したままルールセット不明へ正規化する', () => {
    const {
      ruleset: _ruleset,
      contentSnapshot: _contentSnapshot,
      ...v1
    } = makeBlob({
      id: 'legacy',
      seed: 'legacy',
    });
    const normalized = normalizeReplay({ ...v1, schemaVersion: 1 });

    expect(normalized?.schemaVersion).toBe(REPLAY_SCHEMA_VERSION);
    expect(normalized?.ruleset).toBeNull();
    expect(normalized?.contentSnapshot).toBeNull();
    expect(normalized?.keyframes).toHaveLength(1);
  });

  it('v2 のスナップショットはキーフレーム参照IDだけを収集し、deep cloneする', () => {
    const frame = makeNormalizeFrame('snapshot');
    frame.deck = [{ defId: 'copilot', level: 1 }];
    frame.relics = ['psych-safety'];
    frame.bossRelicReward = 'postmortem';
    frame.draft = ['auto-test'];
    frame.shop = {
      cards: [{ defId: 'docs', cost: 1, bought: false }],
      relic: { id: 'flow-first', cost: 1, bought: false },
    };
    frame.extras.allowedCards = ['feature-flags'];
    frame.extras.allowedRelics = ['primary-source'];

    const snapshot = snapshotReplayContent([{ phase: 'setup', frame }]);
    expect(snapshot.cards.map((card) => card.id)).toEqual(['copilot', 'auto-test', 'docs']);
    expect(snapshot.relics.map((relic) => relic.id)).toEqual([
      'flow-first',
      'psych-safety',
      'postmortem',
    ]);

    const blob = makeBlob({
      id: 'snapshot',
      seed: 'snapshot',
      ruleset: CURRENT_RUN_RULESET,
      contentSnapshot: snapshot,
      keyframes: [{ phase: 'setup', frame }],
    });
    const normalized = normalizeReplay(blob);
    expect(normalized?.contentSnapshot).toEqual(snapshot);
    expect(normalized?.contentSnapshot).not.toBe(snapshot);
    expect(normalized?.contentSnapshot?.cards[0]).not.toBe(snapshot.cards[0]);

    snapshot.cards[0]!.name = '入力変更';
    snapshot.relics[0]!.name = '入力変更';
    expect(normalized?.contentSnapshot?.cards[0]?.name).toBe('Copilot全員配布');
    expect(normalized?.contentSnapshot?.relics[0]?.name).toBe('フロー重視');
  });

  it('buildReplayId は seed と時刻を含む', () => {
    expect(buildReplayId('seed-x', 42)).toBe('seed-x:42');
  });
});

describe('IndexedDB リプレイ永続化（RI-61）', () => {
  it('上限超過で古いリプレイを削除する', async () => {
    const name = nextReplayDbName('replay');
    const storage = new IndexedDbReplayStorage(name);

    for (let i = 0; i < REPLAY_MAX_COUNT + 3; i += 1) {
      await storage.save(
        makeBlob({
          id: `id-${i}`,
          seed: `seed-${i}`,
          finishedAt: 1000 + i,
        }),
      );
    }

    const listed = await storage.list();
    expect(listed).toHaveLength(REPLAY_MAX_COUNT);
    expect(listed[0]?.id).toBe(`id-${REPLAY_MAX_COUNT + 2}`);
    expect(listed.some((r) => r.id === 'id-0')).toBe(false);
  });
});

describe('ReplayPersistence 直接テスト（RI-72-B1）', () => {
  it('IndexedDB get は保存済み blob を返し、欠損と不正レコードは null にする', async () => {
    const name = nextReplayDbName('replay-get');
    const storage = new IndexedDbReplayStorage(name);
    const blob = makeBlob({ id: 'idb-get', seed: 'idb-get', finishedAt: 2000 });

    await storage.save(blob);
    const loaded = await storage.get(blob.id);
    expect(loaded).toEqual(blob);
    expect(loaded).not.toBe(blob);
    expect(await storage.get('missing')).toBeNull();

    const db = await openGameDb(name);
    try {
      await db.put(REPLAYS_STORE_NAME, { ...blob, keyframes: [] }, 'invalid');
    } finally {
      db.close();
    }
    expect(await storage.get('invalid')).toBeNull();
  });

  it('IndexedDB clear は保存済みリプレイをすべて削除する', async () => {
    const name = nextReplayDbName('replay-clear');
    const storage = new IndexedDbReplayStorage(name);
    await storage.save(makeBlob({ id: 'clear-a', seed: 'clear-a', finishedAt: 1000 }));
    await storage.save(makeBlob({ id: 'clear-b', seed: 'clear-b', finishedAt: 2000 }));

    await storage.clear();

    expect(await storage.list()).toEqual([]);
    expect(await storage.get('clear-a')).toBeNull();
  });

  it('IndexedDB の旧v1リプレイを list/get で保持する', async () => {
    const name = nextReplayDbName('replay-legacy');
    const storage = new IndexedDbReplayStorage(name);
    const base = makeBlob({ id: 'legacy-idb', seed: 'legacy-idb', finishedAt: 2000 });
    const { ruleset: _ruleset, contentSnapshot: _contentSnapshot, ...legacy } = base;
    const raw = { ...legacy, schemaVersion: 1 };

    const db = await openGameDb(name);
    try {
      await db.put(REPLAYS_STORE_NAME, raw, raw.id);
    } finally {
      db.close();
    }

    expect((await storage.list()).map((replay) => replay.id)).toContain('legacy-idb');
    expect((await storage.get('legacy-idb'))?.ruleset).toBeNull();
    expect((await storage.get('legacy-idb'))?.contentSnapshot).toBeNull();
  });

  it('IndexedDB save 失敗後も次の書き込みと読み取りが継続できる', async () => {
    const name = nextReplayDbName('replay-write-failure');
    const storage = new IndexedDbReplayStorage(name);
    const originalPut = IDBObjectStore.prototype.put;
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put');
    putSpy.mockImplementationOnce(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey,
    ) {
      if (key === 'fail-first') {
        throw new DOMException('forced replay write failure', 'InvalidStateError');
      }
      return originalPut.call(this, value, key);
    });

    await expect(
      storage.save(makeBlob({ id: 'fail-first', seed: 'fail-first', finishedAt: 1000 })),
    ).rejects.toThrow('forced replay write failure');
    putSpy.mockRestore();

    const recovered = makeBlob({ id: 'after-failure', seed: 'after-failure', finishedAt: 2000 });
    await storage.save(recovered);

    expect(await storage.get('fail-first')).toBeNull();
    expect(await storage.get('after-failure')).toEqual(recovered);
  });

  it('MemoryReplayStorage は clone を返し、上限超過時に古いリプレイを削除する', async () => {
    const storage = new MemoryReplayStorage();
    for (let i = 0; i < REPLAY_MAX_COUNT + 2; i += 1) {
      await storage.save(
        makeBlob({
          id: `memory-${i}`,
          seed: `memory-${i}`,
          finishedAt: 1000 + i,
        }),
      );
    }

    const listed = await storage.list();
    expect(listed).toHaveLength(REPLAY_MAX_COUNT);
    expect(listed.map((r) => r.id)).toEqual([
      'memory-11',
      'memory-10',
      'memory-9',
      'memory-8',
      'memory-7',
      'memory-6',
      'memory-5',
      'memory-4',
      'memory-3',
      'memory-2',
    ]);
    expect(await storage.get('memory-0')).toBeNull();

    const loaded = await storage.get('memory-11');
    expect(loaded).not.toBeNull();
    loaded!.outcome.score = 999;
    expect((await storage.get('memory-11'))?.outcome.score).toBe(10);

    await storage.clear();
    expect(await storage.list()).toEqual([]);
  });

  it('initializeReplayPersistence は一覧取得成功時に渡した storage を使う', async () => {
    const storage: ReplayStorage = {
      list: vi.fn(async () => []),
      get: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };

    const bootstrap = await initializeReplayPersistence(storage);

    expect(bootstrap.storage).toBe(storage);
    expect(storage.list).toHaveBeenCalledTimes(1);
  });

  it('initializeReplayPersistence は初期一覧取得に失敗したら MemoryReplayStorage へ fallback する', async () => {
    const storage: ReplayStorage = {
      list: vi.fn(async () => {
        throw new Error('idb unavailable');
      }),
      get: vi.fn(),
      save: vi.fn(),
      clear: vi.fn(),
    };

    const bootstrap = await initializeReplayPersistence(storage);
    const blob = makeBlob({ id: 'fallback-memory', seed: 'fallback-memory' });

    expect(bootstrap.storage).toBeInstanceOf(MemoryReplayStorage);
    expect(bootstrap.storage).not.toBe(storage);
    await bootstrap.storage.save(blob);
    expect(await bootstrap.storage.get(blob.id)).toEqual(blob);
  });
});

describe('GameHandle リプレイ（RI-61）', () => {
  it('openReplay は操作を無効化し、exitReplay でタイトルへ戻る', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'game-replay', initialMeta: defaultMeta() });
    await game.attachReplay(storage);

    const blob = makeBlob({ id: 'manual', seed: 'game-replay', finishedAt: Date.now() });
    await storage.save(blob);
    await game.attachReplay(storage);

    expect(game.listReplays().length).toBeGreaterThan(0);
    const opened = game.openReplay(blob.id, 0);
    expect(opened).not.toBeNull();
    expect(game.isReplayMode()).toBe(true);
    expect(game.getActiveReplayInfo()).toEqual({
      ruleset: { version: 1, fingerprint: 'test-ruleset' },
      contentSnapshot: { cards: [], relics: [] },
    });
    expect(game.isPaused()).toBe(true);
    expect(game.dispatch('pairReview')).toEqual({ ok: false, reason: 'complete' });
    expect(game.beginSetupSprint().phase).toBe(opened!.phase);

    game.exitReplay();
    expect(game.isReplayMode()).toBe(false);
    expect(game.isPaused()).toBe(false);
    expect(game.phase()).toBe('title');
  });

  it('ルールセット不一致でも閲覧でき、what-if を再計算しない', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'mismatch-replay', initialMeta: defaultMeta() });
    await game.attachReplay(storage);

    const blob = makeBlob({
      id: 'mismatch',
      seed: 'mismatch-replay',
      ruleset: { version: 999, fingerprint: 'recorded-before-current' },
    });
    await storage.save(blob);
    await game.attachReplay(storage);

    expect(game.openReplay(blob.id, 0)).not.toBeNull();
    expect(game.getActiveReplayInfo()?.ruleset).toEqual({
      version: 999,
      fingerprint: 'recorded-before-current',
    });
    expect(game.getState().whatIf).toBeNull();
    game.exitReplay();
    expect(game.getActiveReplayInfo()).toBeNull();
  });

  it('旧v1を取り込み、未知IDを含むキーフレームも保持して開ける', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'legacy-replay', initialMeta: defaultMeta() });
    await game.attachReplay(storage);

    const base = makeBlob({ id: 'legacy-open', seed: 'legacy-replay' });
    const frame = structuredClone(base.keyframes[0]!.frame);
    frame.deck = [{ defId: 'removed-card', level: 1 }];
    frame.relics = ['removed-relic'];
    const { ruleset: _ruleset, contentSnapshot: _contentSnapshot, ...legacy } = base;
    const raw = {
      ...legacy,
      schemaVersion: 1,
      keyframes: [{ phase: 'setup', frame }],
    } as unknown as ReplayBlob;

    expect(await game.importReplay(raw)).toBe(true);
    const listed = game.listReplays().find((replay) => replay.id === raw.id);
    expect(listed?.ruleset).toBeNull();
    expect(listed?.contentSnapshot).toBeNull();
    expect(game.openReplay(raw.id, 0)?.deck[0]?.defId).toBe('removed-card');
    expect(game.getActiveReplayInfo()).toEqual({ ruleset: null, contentSnapshot: null });
    game.exitReplay();
  });

  it('beginSetupSprint 直前の編成変更が setup キーフレームへ反映される', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'setup-kf', initialMeta: defaultMeta() });
    await game.attachReplay(storage);

    game.startRun('easy', [], 'setup-kf');
    const member = game.getState().roster.members[0];
    expect(member).toBeTruthy();
    game.assignMember(member!.id, 'coding');
    game.beginSetupSprint();
    while (game.isSprintRunning()) game.step(100);
    // スプリント完了後もキーフレームはメモリ上に残っているので、決着まで進めて保存を待つ。
    const guard = 80_000;
    for (let i = 0; i < guard; i += 1) {
      const phase = game.phase();
      if (phase === 'won' || phase === 'lost') break;
      if (phase === 'setup') game.beginSetupSprint();
      else if (phase === 'sprint') {
        while (game.isSprintRunning()) game.step(100);
      } else if (phase === 'result') game.acknowledgeResult();
      else if (phase === 'draft') game.skipDraft();
      else if (phase === 'evolution') game.finishEvolution();
      else if (phase === 'beat') game.resolveBeat(0);
      else if (phase === 'shop') game.leaveShop();
      else if (phase === 'rest') game.restChoose('heal');
      else if (phase === 'recruit') game.recruitChoose('skip');
      else if (phase === 'quarterReview') {
        const review = game.getState().quarterReview;
        if (review?.outcome === 'missed_adjustable') {
          game.chooseGoalAdjustment(review.availableAdjustments[0] ?? 'cut_scope');
        } else {
          game.acknowledgeQuarterReview();
        }
      } else break;
    }
    for (let i = 0; i < 40 && game.listReplays().length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const setupFrame = game.listReplays()[0]?.keyframes.find((k) => k.phase === 'setup');
    expect(setupFrame).toBeTruthy();
    const saved = setupFrame!.frame.roster.members.find((m) => m.id === member!.id);
    expect(saved?.assignment).toBe('coding');
  });

  it('スプリント突入直前の編成変更がランセーブのキーフレームへも反映される', async () => {
    const runStorage = new MemoryRunStorage();
    const game = createGame({
      seed: 'save-kf-order',
      initialMeta: defaultMeta(),
      runStorage,
    });

    game.startRun('easy', [], 'save-kf-order');
    const member = game.getState().roster.members[0];
    expect(member).toBeTruthy();
    // assignMember は afterLocal のためセーブを更新しない。beginSetupSprint 側で書き込む。
    game.assignMember(member!.id, 'coding');
    game.beginSetupSprint();
    expect(game.phase()).toBe('sprint');

    const saved = await runStorage.load();
    expect(saved).not.toBeNull();
    const setup = saved!.replayKeyframes.find((k) => k.phase === 'setup');
    expect(setup).toBeTruthy();
    const savedMember = setup!.frame.roster.members.find((m) => m.id === member!.id);
    expect(savedMember?.assignment).toBe('coding');
  });

  it('途中セーブ再開後も再開前のキーフレームがリプレイに残る', async () => {
    const runStorage = new MemoryRunStorage();
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({
      seed: 'resume-kf',
      initialMeta: defaultMeta(),
      runStorage,
    });
    await game.attachReplay(replayStorage);

    game.startRun('easy', [], 'resume-kf');
    expect(game.phase()).toBe('setup');
    // setup セーブが書かれるまで待つ（同期 Memory でも after 経由）。
    expect((await runStorage.load())?.replayKeyframes.some((k) => k.phase === 'setup')).toBe(true);

    // リロード相当: 新しいハンドルへ同じセーブを渡して再開。
    const saved = await runStorage.load();
    expect(saved).not.toBeNull();
    const game2 = createGame({
      seed: 'other',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: saved!,
    });
    await game2.attachReplay(replayStorage);
    expect(game2.resumeRun()?.phase).toBe('setup');

    const guard = 80_000;
    for (let i = 0; i < guard; i += 1) {
      const phase = game2.phase();
      if (phase === 'won' || phase === 'lost') break;
      if (phase === 'setup') game2.beginSetupSprint();
      else if (phase === 'sprint') {
        while (game2.isSprintRunning()) game2.step(100);
      } else if (phase === 'result') game2.acknowledgeResult();
      else if (phase === 'draft') game2.skipDraft();
      else if (phase === 'evolution') game2.finishEvolution();
      else if (phase === 'beat') game2.resolveBeat(0);
      else if (phase === 'shop') game2.leaveShop();
      else if (phase === 'rest') game2.restChoose('heal');
      else if (phase === 'recruit') game2.recruitChoose('skip');
      else if (phase === 'quarterReview') {
        const review = game2.getState().quarterReview;
        if (review?.outcome === 'missed_adjustable') {
          game2.chooseGoalAdjustment(review.availableAdjustments[0] ?? 'cut_scope');
        } else {
          game2.acknowledgeQuarterReview();
        }
      } else break;
    }

    for (let i = 0; i < 40 && game2.listReplays().length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const replay = game2.listReplays()[0];
    expect(replay).toBeTruthy();
    expect(replay!.keyframes.some((k) => k.phase === 'setup')).toBe(true);
    expect(
      replay!.keyframes.some(
        (k) => k.phase === 'result' || k.phase === 'won' || k.phase === 'lost',
      ),
    ).toBe(true);
  });

  it('startRun〜決着でキーフレームがリプレイに残る', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'flow-replay', initialMeta: defaultMeta() });
    await game.attachReplay(storage);

    game.startRun('easy', [], 'flow-replay');
    const guard = 80_000;
    for (let i = 0; i < guard; i += 1) {
      const phase = game.phase();
      if (phase === 'won' || phase === 'lost') break;
      if (phase === 'setup') game.beginSetupSprint();
      else if (phase === 'sprint') {
        while (game.isSprintRunning()) game.step(100);
      } else if (phase === 'result') game.acknowledgeResult();
      else if (phase === 'draft') game.skipDraft();
      else if (phase === 'evolution') game.finishEvolution();
      else if (phase === 'beat') game.resolveBeat(0);
      else if (phase === 'shop') game.leaveShop();
      else if (phase === 'rest') game.restChoose('heal');
      else if (phase === 'recruit') game.recruitChoose('skip');
      else if (phase === 'quarterReview') {
        const review = game.getState().quarterReview;
        if (review?.outcome === 'missed_adjustable') {
          game.chooseGoalAdjustment(review.availableAdjustments[0] ?? 'cut_scope');
        } else {
          game.acknowledgeQuarterReview();
        }
      } else break;
    }

    expect(['won', 'lost']).toContain(game.phase());
    for (let i = 0; i < 40 && game.listReplays().length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(game.listReplays().length).toBeGreaterThan(0);
    expect(game.listReplays()[0]?.keyframes.length).toBeGreaterThan(0);
    expect(game.listReplays()[0]?.ruleset).toEqual(CURRENT_RUN_RULESET);
    expect(game.listReplays()[0]?.contentSnapshot).toEqual({ cards: [], relics: [] });
  });

  it('キーフレームに label が付く（RI-34‴）', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'label-replay', initialMeta: defaultMeta() });
    await game.attachReplay(storage);

    game.startRun('easy', [], 'label-replay');
    const guard = 80_000;
    for (let i = 0; i < guard; i += 1) {
      const phase = game.phase();
      if (phase === 'won' || phase === 'lost') break;
      if (phase === 'setup') game.beginSetupSprint();
      else if (phase === 'sprint') {
        while (game.isSprintRunning()) game.step(100);
      } else if (phase === 'result') game.acknowledgeResult();
      else if (phase === 'draft') game.skipDraft();
      else if (phase === 'evolution') game.finishEvolution();
      else if (phase === 'beat') game.resolveBeat(0);
      else if (phase === 'shop') game.leaveShop();
      else if (phase === 'rest') game.restChoose('heal');
      else if (phase === 'recruit') game.recruitChoose('skip');
      else if (phase === 'quarterReview') {
        const review = game.getState().quarterReview;
        if (review?.outcome === 'missed_adjustable') {
          game.chooseGoalAdjustment(review.availableAdjustments[0] ?? 'cut_scope');
        } else {
          game.acknowledgeQuarterReview();
        }
      } else break;
    }
    for (let i = 0; i < 40 && game.listReplays().length === 0; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const replay = game.listReplays()[0];
    expect(replay).toBeTruthy();
    const setup = replay!.keyframes.find((k) => k.phase === 'setup');
    expect(setup?.label).toBe('編成');
    const result = replay!.keyframes.find((k) => k.phase === 'result');
    if (result) {
      expect(result.label).toMatch(/Review peak \d+/);
    }
  });

  it('importReplay で reviewHell リプレイを取り込める（RI-34‴）', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'import-hell', initialMeta: defaultMeta() });
    await game.attachReplay(storage);

    const blob = makeBlob({
      id: 'hell-import',
      seed: 'import-hell',
      outcome: { status: 'lost', diagnosis: 'reviewHell', score: 3, loseReason: 'reviewFreeze' },
    });
    const resultFrame = structuredClone(blob.keyframes[0]!.frame);
    resultFrame.phase = 'result';
    // キーフレーム時点は別診断でも、終端 outcome が reviewHell なら専用演出対象。
    resultFrame.diagnosis = 'reworkSpiral';
    resultFrame.lastResult = {
      done: 4,
      delivered: 10,
      maxCombo: 1,
      aiAssistedPct: 60,
      reviewQueueMax: 20,
      rework: 1,
      incidents: 1,
      contained: 0,
      spread: 1,
      seniorHpDelta: -20,
      actionCounts: {},
      grade: 'D',
      title: 'PRを増やす者',
      diagnosis: '渋滞',
      timeline: [],
      events: [],
      fireEvents: [],
      focusRemaining: 1,
      focusMax: 8,
      autoContainCount: 0,
    };
    resultFrame.totals = { ...resultFrame.totals, reviewQueuePeak: 20 };
    blob.keyframes = [
      { phase: 'setup', frame: blob.keyframes[0]!.frame, label: '編成' },
      { phase: 'result', frame: resultFrame, label: 'Review peak 20' },
    ];

    expect(await game.importReplay(blob)).toBe(true);
    expect(game.listReplays().some((r) => r.id === 'hell-import')).toBe(true);
    const opened = game.openReplay('hell-import', 1);
    expect(opened?.phase).toBe('result');
    expect(opened?.diagnosis).toBe('reworkSpiral');
    expect(game.getActiveReplayDiagnosis()).toBe('reviewHell');
    expect(game.isReplayMode()).toBe(true);
    game.exitReplay();
    expect(game.getActiveReplayDiagnosis()).toBeNull();
  });
});

function makeNormalizeFrame(seed = 'normalize-frame'): ReplayKeyframe['frame'] {
  const engine = new RunEngine({ seed, difficulty: 'easy' });
  engine.startRun('easy', [], seed);
  const frame = engine.exportReplayFrame();
  if (!frame) throw new Error('export failed');
  return frame;
}

function makeNormalizeBlob(overrides: Partial<ReplayBlob> = {}): ReplayBlob {
  const trials = overrides.trials ?? [];
  const frame = makeNormalizeFrame('normalize-seed');
  const base: ReplayBlob = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: 'replay-normalize',
    seed: 'normalize-seed',
    difficulty: 'easy',
    trials: [...trials],
    finishedAt: 1234,
    outcome: {
      status: 'won',
      diagnosis: 'healthyAcceleration',
      score: 42,
    },
    keyframes: [{ phase: 'setup', label: '編成', frame: { ...frame, trials: [...trials] } }],
    ruleset: { version: 1, fingerprint: 'normalize-ruleset' },
    contentSnapshot: { cards: [], relics: [] },
  };

  return {
    ...base,
    ...overrides,
    outcome: {
      ...base.outcome,
      ...overrides.outcome,
    },
    keyframes: overrides.keyframes ?? base.keyframes,
    trials: [...base.trials],
  };
}

describe('リプレイ正規化（RI-72-B3）', () => {
  it('id / seed / difficulty / trials の壊れた値を拒否し、trials を clone する', () => {
    const valid = makeNormalizeBlob({ trials: ['trial-a', 'trial-b'] });

    expect(normalizeReplay({ ...valid, id: 123 })).toBeNull();
    expect(normalizeReplay({ ...valid, seed: null })).toBeNull();
    expect(normalizeReplay({ ...valid, difficulty: 7 })).toBeNull();
    expect(normalizeReplay({ ...valid, difficulty: 'custom' })).toBeNull();
    expect(normalizeReplay({ ...valid, trials: 'trial-a' })).toBeNull();
    expect(normalizeReplay({ ...valid, trials: ['trial-a', 2] })).toBeNull();

    const normalized = normalizeReplay(valid);
    expect(normalized?.trials).toEqual(['trial-a', 'trial-b']);
    expect(normalized?.trials).not.toBe(valid.trials);

    valid.trials.push('after-normalize');
    expect(normalized?.trials).toEqual(['trial-a', 'trial-b']);
  });

  it('finishedAt / outcome の壊れた値を拒否し、有効な敗北 outcome を保持する', () => {
    const validLost = makeNormalizeBlob({
      outcome: {
        status: 'lost',
        diagnosis: 'reviewHell',
        score: 7,
        loseReason: 'reviewFreeze',
      },
    });

    expect(normalizeReplay({ ...validLost, finishedAt: '1234' })).toBeNull();
    expect(normalizeReplay({ ...validLost, finishedAt: Number.NaN })).toBeNull();
    expect(normalizeReplay({ ...validLost, outcome: null })).toBeNull();
    expect(
      normalizeReplay({ ...validLost, outcome: { ...validLost.outcome, status: 'playing' } }),
    ).toBeNull();
    expect(
      normalizeReplay({ ...validLost, outcome: { ...validLost.outcome, diagnosis: 1 } }),
    ).toBeNull();
    expect(
      normalizeReplay({ ...validLost, outcome: { ...validLost.outcome, score: '7' } }),
    ).toBeNull();
    expect(
      normalizeReplay({ ...validLost, outcome: { ...validLost.outcome, score: Infinity } }),
    ).toBeNull();

    expect(normalizeReplay(validLost)?.outcome).toEqual({
      status: 'lost',
      winType: undefined,
      loseReason: 'reviewFreeze',
      diagnosis: 'reviewHell',
      score: 7,
    });
  });

  it('現行リプレイの結果スコアを終端フレームの出荷点と照合する', () => {
    const valid = makeNormalizeBlob({
      outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 42, winType: 'normal' },
    });
    const terminalFrame = {
      ...valid.keyframes[0]!.frame,
      phase: 'won' as const,
      status: 'won' as const,
      winType: 'normal' as const,
      totals: { ...valid.keyframes[0]!.frame.totals, delivered: 42 },
    };
    const terminal = {
      ...valid,
      keyframes: [{ phase: 'won' as const, frame: terminalFrame }],
    };

    expect(normalizeReplay(terminal)).not.toBeNull();
    expect(
      normalizeReplay({
        ...terminal,
        outcome: { ...terminal.outcome, score: 41 },
      }),
    ).toBeNull();
  });

  it('normalizeReplayKeyframes は壊れた要素だけ捨て、label の有無を正規化する', () => {
    const frame = makeNormalizeFrame('keyframes-valid');
    const resultFrame = structuredClone(frame);
    resultFrame.phase = 'result';

    const normalized = normalizeReplayKeyframes([
      null,
      { phase: 1, frame },
      { phase: 'sprint', frame: { ...frame, phase: 'sprint' } },
      { phase: 'setup', frame: null },
      { phase: 'setup', frame: { ...frame, seed: 1 } },
      { phase: 'setup', frame: { ...frame, extras: null } },
      { phase: 'setup', frame: { ...frame, extras: { ...frame.extras, allowedCards: 'bad' } } },
      { phase: 'setup', frame: { ...frame, extras: { ...frame.extras, allowedRelics: 'bad' } } },
      { phase: 'setup', label: '編成', frame },
      { phase: 'result', label: 123, frame: resultFrame },
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized.map((keyframe) => keyframe.phase)).toEqual(['setup', 'result']);
    expect(normalized[0]?.label).toBe('編成');
    expect(normalized[1]?.label).toBeUndefined();
  });

  it('normalizeReplayKeyframes は frame を deep clone して入力と独立させる', () => {
    const frame = makeNormalizeFrame('keyframes-clone');
    const normalized = normalizeReplayKeyframes([{ phase: 'setup', label: '編成', frame }]);
    const normalizedFrame = normalized[0]?.frame;

    expect(normalizedFrame).toBeTruthy();
    expect(normalizedFrame).not.toBe(frame);
    expect(normalizedFrame?.extras.allowedCards).not.toBe(frame.extras.allowedCards);
    expect(normalizedFrame?.extras.allowedRelics).not.toBe(frame.extras.allowedRelics);

    frame.extras.allowedCards.push('mutated-input-card');
    normalizedFrame?.extras.allowedRelics.push('mutated-normalized-relic');

    expect(normalizedFrame?.extras.allowedCards).not.toContain('mutated-input-card');
    expect(frame.extras.allowedRelics).not.toContain('mutated-normalized-relic');
  });

  it('完全な ReplayBlob では部分的に壊れた keyframes と全破棄 keyframes を拒否する', () => {
    const frame = makeNormalizeFrame('normalize-seed');
    const validKeyframe: ReplayKeyframe = { phase: 'setup', label: '編成', frame };

    expect(normalizeReplay({ ...makeNormalizeBlob(), keyframes: 'setup' })).toBeNull();
    expect(normalizeReplay({ ...makeNormalizeBlob(), keyframes: [] })).toBeNull();
    expect(
      normalizeReplay({
        ...makeNormalizeBlob(),
        keyframes: [validKeyframe, { phase: 'setup', frame: { ...frame, seed: 1 } }],
      }),
    ).toBeNull();
    expect(
      normalizeReplay({
        ...makeNormalizeBlob(),
        keyframes: [{ phase: 'setup', frame: { ...frame, extras: null } }],
      }),
    ).toBeNull();

    const normalized = normalizeReplay(makeNormalizeBlob({ keyframes: [validKeyframe] }));
    expect(normalized?.keyframes).toHaveLength(1);
    expect(normalized?.keyframes[0]?.frame).not.toBe(frame);
  });
});

describe('RI-133 リプレイファイル共有', () => {
  it('現行リプレイをJSONへ変換し、v1レガシーを含めて正規化できる', () => {
    const blob = makeBlob({
      id: 'ri133-roundtrip',
      seed: 'ri133-roundtrip',
      ruleset: CURRENT_RUN_RULESET,
    });
    const result = parseReplayFile(serializeReplay(blob));

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.replay).toEqual(blob);

    const { ruleset: _ruleset, contentSnapshot: _contentSnapshot, ...legacy } = blob;
    const legacyResult = parseReplayFile(JSON.stringify({ ...legacy, schemaVersion: 1 }));
    expect(legacyResult).toMatchObject({ ok: true });
    if (legacyResult.ok) {
      expect(legacyResult.replay.ruleset).toBeNull();
      expect(legacyResult.replay.contentSnapshot).toBeNull();
    }
  });

  it('破損・未対応スキーマ・ルールセット不一致を理由付きで拒否する', () => {
    const blob = makeBlob({
      id: 'ri133-reject',
      seed: 'ri133-reject',
      ruleset: CURRENT_RUN_RULESET,
    });

    expect(parseReplayFile('{')).toMatchObject({ ok: false, reason: 'invalid-json' });
    expect(parseReplayFile(JSON.stringify({ ...blob, schemaVersion: 999 }))).toMatchObject({
      ok: false,
      reason: 'unsupported-schema',
    });
    expect(
      parseReplayFile(serializeReplay({ ...blob, finishedAt: Number.MAX_SAFE_INTEGER })),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(parseReplayFile(JSON.stringify({ ...blob, keyframes: [] }))).toMatchObject({
      ok: false,
      reason: 'invalid-data',
    });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          keyframes: [
            {
              ...blob.keyframes[0],
              frame: { ...blob.keyframes[0].frame, seed: 'different-seed' },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    const { ruleset: _ruleset, contentSnapshot: _contentSnapshot, ...legacyBlob } = blob;
    expect(
      parseReplayFile(
        JSON.stringify({
          ...legacyBlob,
          schemaVersion: 1,
          keyframes: [
            {
              ...blob.keyframes[0],
              frame: { ...blob.keyframes[0].frame, roster: {} },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    const {
      ruleset: _legacyReviewRuleset,
      contentSnapshot: _legacyReviewSnapshot,
      ...legacyQuarterReviewBlob
    } = blob;
    expect(
      parseReplayFile(
        serializeReplay({
          ...legacyQuarterReviewBlob,
          schemaVersion: 1,
          keyframes: [
            {
              ...blob.keyframes[0],
              phase: 'quarterReview',
              frame: {
                ...blob.keyframes[0].frame,
                phase: 'quarterReview',
                quarterReview: {} as never,
              },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          ruleset: null,
          contentSnapshot: null,
          keyframes: [
            {
              ...blob.keyframes[0],
              frame: { ...blob.keyframes[0].frame, roster: {} },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          difficulty: 'normal',
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          trials: ['half-budget'],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          keyframes: [
            {
              ...blob.keyframes[0],
              frame: { ...blob.keyframes[0].frame, deck: null },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          keyframes: [
            {
              ...blob.keyframes[0],
              phase: 'result',
              frame: { ...blob.keyframes[0].frame, phase: 'result', lastResult: null },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          keyframes: [
            {
              ...blob.keyframes[0],
              frame: { ...blob.keyframes[0].frame, diagnosis: 'unknown-diagnosis' },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          outcome: { ...blob.outcome, status: 'won' },
          keyframes: [
            {
              ...blob.keyframes[0],
              phase: 'lost',
              frame: {
                ...blob.keyframes[0].frame,
                phase: 'lost',
                status: 'lost',
                loseReason: 'reviewFreeze',
              },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          keyframes: [
            {
              ...blob.keyframes[0],
              phase: 'won',
              frame: { ...blob.keyframes[0].frame, phase: 'won', status: 'playing' },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          outcome: { ...blob.outcome, status: 'lost', loseReason: 'reviewFreeze' },
          keyframes: [
            {
              ...blob.keyframes[0],
              phase: 'lost',
              frame: {
                ...blob.keyframes[0].frame,
                phase: 'lost',
                status: 'lost',
                loseReason: 'techDebt',
              },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({ ...blob, outcome: { ...blob.outcome, diagnosis: 'unknown-diagnosis' } }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          contentSnapshot: {
            cards: [
              {
                id: 'card-with-invalid-effect',
                name: 'カード',
                rarity: 'common',
                cost: 1,
                focusCost: 1,
                description: [],
                base: { codingSpeedMul: 'bad' },
              } as never,
            ],
            relics: [],
          },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          contentSnapshot: {
            cards: [],
            relics: [
              {
                id: 'relic-with-invalid-effect',
                name: 'レリック',
                description: '',
                effects: { incidentRateMul: 'bad' },
              } as never,
            ],
          },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          contentSnapshot: {
            cards: [],
            relics: [
              {
                id: 'relic-with-invalid-passive',
                name: 'レリック',
                description: '',
                passives: { moraleDamageMul: 'bad' },
              } as never,
            ],
          },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          keyframes: [
            {
              ...blob.keyframes[0],
              frame: { ...blob.keyframes[0].frame, shop: {} as never },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          keyframes: [
            {
              ...blob.keyframes[0],
              phase: 'result',
              frame: { ...blob.keyframes[0].frame, phase: 'won' },
            },
          ],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'invalid-data' });
    expect(
      parseReplayFile(
        serializeReplay({
          ...blob,
          ruleset: { version: CURRENT_RUN_RULESET.version, fingerprint: 'different-ruleset' },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'ruleset-mismatch' });
  });

  it('GameHandleのファイル取込は上限を守り、セーブとメタ進行へ書き込まない', async () => {
    const replayStorage = new MemoryReplayStorage();
    const runStorage = new MemoryRunStorage();
    const meta = defaultMeta();
    const game = createGame({ initialMeta: meta, runStorage });
    await game.attachReplay(replayStorage);

    for (let index = 0; index < REPLAY_MAX_COUNT + 1; index += 1) {
      const result = await game.importReplayFile(
        serializeReplay(
          makeBlob({
            id: `ri133-import-${index}`,
            seed: `ri133-import-${index}`,
            finishedAt: 1_000 + index,
            ruleset: CURRENT_RUN_RULESET,
          }),
        ),
      );
      expect(result).toMatchObject({ ok: true });
    }

    expect(game.listReplays()).toHaveLength(REPLAY_MAX_COUNT);
    expect(game.listReplays().some((replay) => replay.id === 'ri133-import-0')).toBe(false);
    expect(await runStorage.load()).toBeNull();
    expect(game.getMeta()).toEqual(meta);
  });

  it('不一致ファイルの取込失敗で既存リプレイを変更しない', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ initialMeta: defaultMeta() });
    const existing = makeBlob({
      id: 'ri133-existing',
      seed: 'ri133-existing',
      ruleset: CURRENT_RUN_RULESET,
    });
    await replayStorage.save(existing);
    await game.attachReplay(replayStorage);

    const rejected = await game.importReplayFile(
      serializeReplay({
        ...existing,
        id: 'ri133-mismatch',
        ruleset: { version: CURRENT_RUN_RULESET.version, fingerprint: 'different-ruleset' },
      }),
    );
    expect(rejected).toMatchObject({ ok: false, reason: 'ruleset-mismatch' });
    expect(game.listReplays().map((replay) => replay.id)).toEqual(['ri133-existing']);
  });

  it('同じIDの別内容リプレイは既存記録を変更せず拒否する', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ initialMeta: defaultMeta() });
    const existing = makeBlob({
      id: 'ri133-duplicate',
      seed: 'ri133-existing',
      ruleset: CURRENT_RUN_RULESET,
    });
    await replayStorage.save(existing);
    await game.attachReplay(replayStorage);

    const rejected = await game.importReplayFile(
      serializeReplay({
        ...existing,
        outcome: { ...existing.outcome, score: 999 },
      }),
    );

    expect(rejected).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(await replayStorage.get(existing.id)).toEqual(existing);
  });

  it('重なった同一IDの取込を直列化し、後続をduplicateとして拒否する', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const first = makeBlob({
      id: 'ri133-queued-duplicate',
      seed: 'ri133-queued-first',
      ruleset: CURRENT_RUN_RULESET,
    });
    const second = makeBlob({
      id: first.id,
      seed: 'ri133-queued-second',
      ruleset: CURRENT_RUN_RULESET,
    });

    const [firstResult, secondResult] = await Promise.all([
      game.importReplayFile(serializeReplay(first)),
      game.importReplayFile(serializeReplay(second)),
    ]);

    expect(firstResult).toMatchObject({ ok: true });
    expect(secondResult).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(await replayStorage.get(first.id)).toEqual(first);
  });

  it('リプレイ保存後の一覧更新失敗はevictedではなくstorageを返し、既存キャッシュを保持する', async () => {
    const inner = new MemoryReplayStorage();
    const existing = makeBlob({
      id: 'ri133-list-failure-existing',
      seed: 'ri133-list-failure-existing',
      ruleset: CURRENT_RUN_RULESET,
    });
    await inner.save(existing);
    let failList = false;
    const replayStorage: ReplayStorage = {
      list: async () => {
        if (failList) throw new Error('list failed');
        return inner.list();
      },
      get: (id) => inner.get(id),
      save: (blob) => inner.save(blob),
      clear: () => inner.clear(),
    };
    const game = createGame({ initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    failList = true;

    const imported = makeBlob({
      id: 'ri133-list-failure-imported',
      seed: 'ri133-list-failure-imported',
      ruleset: CURRENT_RUN_RULESET,
    });
    const result = await game.importReplayFile(serializeReplay(imported));

    expect(result).toMatchObject({ ok: false, reason: 'storage' });
    expect(await inner.get(imported.id)).toEqual(imported);
    expect(game.listReplays().map((replay) => replay.id)).toEqual([existing.id]);
  });

  it('同一内容の冪等再取込でも一覧キャッシュを更新する', async () => {
    const inner = new MemoryReplayStorage();
    const existing = makeBlob({
      id: 'ri133-idempotent-cache',
      seed: 'ri133-idempotent-cache',
      ruleset: CURRENT_RUN_RULESET,
    });
    await inner.save(existing);
    let failList = true;
    const replayStorage: ReplayStorage = {
      list: async () => {
        if (failList) throw new Error('list failed');
        return inner.list();
      },
      get: (id) => inner.get(id),
      save: (blob) => inner.save(blob),
      clear: () => inner.clear(),
    };
    const game = createGame({ initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);

    const failed = await game.importReplayFile(serializeReplay(existing));
    expect(failed).toMatchObject({ ok: false, reason: 'storage' });
    expect(game.listReplays()).toEqual([]);

    failList = false;
    const retried = await game.importReplayFile(serializeReplay(existing));
    expect(retried).toMatchObject({ ok: true });
    expect(game.listReplays().map((replay) => replay.id)).toEqual([existing.id]);
  });

  it('上限適用で取込対象自身が削除された場合は成功にしない', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ initialMeta: defaultMeta() });
    for (let index = 0; index < REPLAY_MAX_COUNT; index += 1) {
      await replayStorage.save(
        makeBlob({
          id: `ri133-newer-${index}`,
          seed: `ri133-newer-${index}`,
          finishedAt: 2_000 + index,
          ruleset: CURRENT_RUN_RULESET,
        }),
      );
    }
    await game.attachReplay(replayStorage);

    const result = await game.importReplayFile(
      serializeReplay(
        makeBlob({
          id: 'ri133-too-old',
          seed: 'ri133-too-old',
          finishedAt: 1_000,
          ruleset: CURRENT_RUN_RULESET,
        }),
      ),
    );

    expect(result).toMatchObject({ ok: false, reason: 'evicted' });
    expect(game.listReplays()).toHaveLength(REPLAY_MAX_COUNT);
    expect(game.listReplays().some((replay) => replay.id === 'ri133-too-old')).toBe(false);
  });
});
