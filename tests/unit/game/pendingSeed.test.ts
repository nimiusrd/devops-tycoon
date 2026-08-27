import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { RunEngine } from '../../../src/sim/run/engine';
import { dailySeed, defaultMeta } from '../../../src/state/meta';
import { REPLAY_SCHEMA_VERSION, type ReplayBlob } from '../../../src/state/replay';
import { MemoryReplayStorage } from '../../../src/state/replayPersistence';

function makeReplay(partial: Pick<ReplayBlob, 'id' | 'seed'>): ReplayBlob {
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
    finishedAt: 1000,
    outcome: {
      status: 'won',
      diagnosis: 'healthyAcceleration',
      score: 10,
    },
    keyframes: [{ phase: 'setup', frame }],
    ruleset: { version: 1, fingerprint: 'pending-seed-test' },
    contentSnapshot: { cards: [], relics: [] },
  };
}

describe('通常ランの pending seed（#369）', () => {
  it('Daily のあと newRun するとタイトル seed は起動時のまま', () => {
    const game = createGame({ seed: 'devops-tycoon' });
    const dateStr = '2026-08-27';
    expect(game.startDailyRun(dateStr).seed).toBe(dailySeed(dateStr));

    const title = game.newRun();
    expect(title.phase).toBe('title');
    expect(title.seed).toBe('devops-tycoon');
    expect(title.runKind).not.toBe('daily');
  });

  it('Daily のあと seed 省略の通常ランは Daily seed を引き継がない', () => {
    const game = createGame({ seed: 'devops-tycoon' });
    game.startDailyRun('2026-08-27');
    game.newRun();

    const started = game.startRun('easy', []);
    expect(started.phase).toBe('setup');
    expect(started.runKind).toBe('normal');
    expect(started.seed).toBe('devops-tycoon');
    expect(started.dailyDate).toBeUndefined();
  });

  it('タイトルが表示する seed を渡しても Daily 後の通常ランは独立する', () => {
    const game = createGame({ seed: 'devops-tycoon' });
    game.startDailyRun('2026-08-27');
    const title = game.newRun();
    const started = game.startRun('easy', [], title.seed);
    expect(started.seed).toBe('devops-tycoon');
    expect(started.runKind).toBe('normal');
  });

  it('リプレイ閲覧は pending seed を上書きせず、通常ランへ漏らさない', async () => {
    const storage = new MemoryReplayStorage();
    const game = createGame({ seed: 'devops-tycoon', initialMeta: defaultMeta() });
    await game.attachReplay(storage);

    const dailyReplaySeed = dailySeed('2026-08-27');
    const blob = makeReplay({ id: 'daily-view', seed: dailyReplaySeed });
    await storage.save(blob);
    await game.attachReplay(storage);

    const opened = game.openReplay(blob.id, 0);
    expect(opened?.seed).toBe(dailyReplaySeed);

    const title = game.exitReplay();
    expect(title.phase).toBe('title');
    expect(title.seed).toBe('devops-tycoon');

    const started = game.startRun('easy', [], title.seed);
    expect(started.seed).toBe('devops-tycoon');
    expect(started.runKind).toBe('normal');
  });

  it('通常ランで明示した seed は次のタイトル pending になる', () => {
    const game = createGame({ seed: 'devops-tycoon' });
    game.startRun('easy', [], 'recipe-custom');
    const title = game.newRun();
    expect(title.seed).toBe('recipe-custom');
    expect(game.startRun('easy', []).seed).toBe('recipe-custom');
  });

  it('newRun に seed を渡すと pending を差し替える', () => {
    const game = createGame({ seed: 'devops-tycoon' });
    game.startDailyRun('2026-08-27');
    const title = game.newRun('explicit-next');
    expect(title.seed).toBe('explicit-next');
    expect(game.startRun('easy', []).seed).toBe('explicit-next');
  });
});
