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
    expect(game.dispatch('pairReview')).toEqual({ ok: false, reason: 'complete' });
    expect(game.beginSetupSprint().phase).toBe(opened!.phase);

    game.exitReplay();
    expect(game.isReplayMode()).toBe(false);
    expect(game.phase()).toBe('title');
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
});
