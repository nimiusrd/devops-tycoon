import 'fake-indexeddb/auto';
import { deleteDB } from 'idb';
import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from '../../src/game';
import { RunEngine } from '../../src/sim/run/engine';
import { defaultMeta } from '../../src/state/meta';
import {
  buildReplayId,
  normalizeReplay,
  REPLAY_MAX_COUNT,
  REPLAY_SCHEMA_VERSION,
  type ReplayBlob,
} from '../../src/state/replay';
import { IndexedDbReplayStorage, MemoryReplayStorage } from '../../src/state/replayPersistence';
import { MemoryRunStorage } from '../../src/state/runPersistence';

const databases: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((name) => deleteDB(name)));
});

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
  };
}

describe('リプレイ正規化（RI-61）', () => {
  it('正常 blob を往復できる', () => {
    const blob = makeBlob({ id: 'a', seed: 'r1' });
    expect(normalizeReplay(blob)?.id).toBe('a');
  });

  it('壊れた／非互換は null', () => {
    expect(normalizeReplay(null)).toBeNull();
    expect(normalizeReplay({ schemaVersion: 99 })).toBeNull();
    const blob = makeBlob({ id: 'b', seed: 'r2' });
    expect(normalizeReplay({ ...blob, keyframes: [] })).toBeNull();
  });

  it('buildReplayId は seed と時刻を含む', () => {
    expect(buildReplayId('seed-x', 42)).toBe('seed-x:42');
  });
});

describe('IndexedDB リプレイ永続化（RI-61）', () => {
  it('上限超過で古いリプレイを削除する', async () => {
    const name = `devops-tycoon-replay-${databases.length}`;
    databases.push(name);
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
    expect(game.isPaused()).toBe(true);
    expect(game.dispatch('pairReview')).toEqual({ ok: false, reason: 'complete' });
    expect(game.beginSetupSprint().phase).toBe(opened!.phase);

    game.exitReplay();
    expect(game.isReplayMode()).toBe(false);
    expect(game.isPaused()).toBe(false);
    expect(game.phase()).toBe('title');
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
