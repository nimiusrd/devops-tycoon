import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { RunEngine } from '../../../src/sim/run/engine';
import { defaultMeta } from '../../../src/state/meta';
import {
  REPLAY_MAX_COUNT,
  REPLAY_SCHEMA_VERSION,
  type ReplayBlob,
} from '../../../src/state/replay';
import { MemoryReplayStorage } from '../../../src/state/replayPersistence';
import {
  CURRENT_RUN_RULESET,
  MemoryRunStorage,
  toRunSave,
} from '../../../src/state/runPersistence';
import {
  parseReplayShare,
  REPLAY_SHARE_REASON_MESSAGE,
  serializeReplay,
} from '../../../src/state/replayShare';

function makeReplay(partial: Partial<ReplayBlob> & Pick<ReplayBlob, 'id' | 'seed'>): ReplayBlob {
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
    ruleset: partial.ruleset ?? { ...CURRENT_RUN_RULESET },
    contentSnapshot: partial.contentSnapshot ?? { cards: [], relics: [] },
  };
}

describe('リプレイのファイル共有（RI-133）', () => {
  it('JSON を往復しても同じリプレイになる', () => {
    const replay = makeReplay({ id: 'share-a', seed: 'ri133-replay' });
    const raw = serializeReplay(replay);
    expect(raw).toContain('"schemaVersion"');
    expect(parseReplayShare(raw)).toEqual({ ok: true, replay });
  });

  it.each([
    ['壊れた JSON', '{', 'corrupt'],
    ['配列', '[]', 'corrupt'],
    ['版が整数でない', JSON.stringify({ schemaVersion: '2' }), 'corrupt'],
    ['未対応版', JSON.stringify({ schemaVersion: 9, id: 'x', seed: 'x' }), 'unsupported_version'],
  ] as const)('%sなら理由付きで拒否する', (_label, raw, reason) => {
    expect(parseReplayShare(raw)).toEqual({
      ok: false,
      reason,
      message: REPLAY_SHARE_REASON_MESSAGE[reason],
    });
  });

  it('ルールセット不明と不一致、開始レシピ混入を拒否する', () => {
    const replay = makeReplay({ id: 'share-b', seed: 'ri133-replay-b' });
    expect(
      parseReplayShare(JSON.stringify({ ...replay, schemaVersion: 1, ruleset: null })),
    ).toEqual({
      ok: false,
      reason: 'ruleset_unknown',
      message: REPLAY_SHARE_REASON_MESSAGE.ruleset_unknown,
    });
    expect(
      parseReplayShare(
        JSON.stringify({
          ...replay,
          ruleset: { version: CURRENT_RUN_RULESET.version, fingerprint: 'other-ruleset' },
        }),
      ),
    ).toEqual({
      ok: false,
      reason: 'ruleset_mismatch',
      message: REPLAY_SHARE_REASON_MESSAGE.ruleset_mismatch,
    });
    expect(
      parseReplayShare(
        JSON.stringify({
          schemaVersion: 1,
          seed: 'recipe',
          difficulty: 'easy',
          trials: [],
          scenario: 'default',
          preferredCardIds: [],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'corrupt' });
  });

  it('取り込みは既存上限に従い、途中セーブとメタは触らない', async () => {
    const runStorage = new MemoryRunStorage();
    const existingSaveEngine = new RunEngine({ seed: 'keep-save', difficulty: 'easy' });
    existingSaveEngine.startRun('easy', [], 'keep-save');
    const persist = existingSaveEngine.exportPersistState();
    if (!persist) throw new Error('persist missing');
    const existingSave = toRunSave(persist, 1);
    await runStorage.save(existingSave);

    const replayStorage = new MemoryReplayStorage();
    const meta = { ...defaultMeta(), points: 21, completedDailies: ['2026-08-02'] };
    const game = createGame({
      seed: 'ri133-replay-game',
      initialMeta: meta,
      runStorage,
      initialRunSave: existingSave,
    });
    await game.attachReplay(replayStorage);

    const imported = makeReplay({ id: 'share-new', seed: 'ri133-new', finishedAt: 9_000 });
    const result = await game.importReplayText(serializeReplay(imported));
    expect(result.ok).toBe(true);
    expect(game.listReplays().map((item) => item.id)).toEqual(['share-new']);
    expect(game.exportReplayText('share-new')).toContain('share-new');
    expect(game.getRunSaveSummary()?.seed).toBe('keep-save');
    expect(game.getMeta().points).toBe(21);
    expect(game.getMeta().completedDailies).toEqual(['2026-08-02']);

    for (let i = 0; i < REPLAY_MAX_COUNT + 2; i += 1) {
      const extra = makeReplay({
        id: `cap-${i}`,
        seed: `cap-${i}`,
        finishedAt: 10_000 + i,
      });
      const extraResult = await game.importReplayText(serializeReplay(extra));
      expect(extraResult.ok).toBe(true);
    }
    expect(game.listReplays()).toHaveLength(REPLAY_MAX_COUNT);
    expect(game.listReplays().some((item) => item.id === 'share-new')).toBe(false);
  });

  it('拒否時は既存リプレイを自動削除しない', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-keep-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep', seed: 'keep' });
    expect(await game.importReplay(existing)).toBe(true);

    const rejected = await game.importReplayText('{');
    expect(rejected).toEqual({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep']);
  });
});
