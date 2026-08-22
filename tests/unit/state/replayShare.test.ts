import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { RunEngine } from '../../../src/sim/run/engine';
import { defaultMeta } from '../../../src/state/meta';
import {
  REPLAY_MAX_COUNT,
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  type ReplayBlob,
} from '../../../src/state/replay';
import { MemoryReplayStorage, type ReplayStorage } from '../../../src/state/replayPersistence';
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

function makeWonReplay(partial: Partial<ReplayBlob> & Pick<ReplayBlob, 'id' | 'seed'>): ReplayBlob {
  const engine = new RunEngine({ seed: partial.seed, difficulty: 'easy' });
  engine.startRun('easy', [], partial.seed);
  const internals = engine as unknown as { phase: string; status: string };
  internals.phase = 'won';
  internals.status = 'won';
  const frame = engine.exportReplayFrame();
  if (!frame) throw new Error('won frame export failed');
  return makeReplay({
    ...partial,
    outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 10, ...partial.outcome },
    keyframes: partial.keyframes ?? [{ phase: 'won', frame }],
  });
}

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
    contentSnapshot:
      partial.contentSnapshot ??
      snapshotReplayContent(partial.keyframes ?? [{ phase: 'setup', frame }]),
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

  it('不一致ルールセットのリプレイを読み取り専用で取り込める', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-mismatch-import', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const replay = makeReplay({
      id: 'mismatch-share',
      seed: 'mismatch-share',
      ruleset: { version: 999, fingerprint: 'recorded-before-current' },
    });
    const result = await game.importReplayText(serializeReplay(replay));
    expect(result.ok).toBe(true);
    expect(game.openReplay('mismatch-share', 0)).not.toBeNull();
    expect(game.getActiveReplayInfo()?.ruleset).toEqual({
      version: 999,
      fingerprint: 'recorded-before-current',
    });
  });

  it('ルールセット不明と不一致は読み取り専用で取り込み、開始レシピ混入は拒否する', () => {
    const replay = makeReplay({ id: 'share-b', seed: 'ri133-replay-b' });
    const unknown = parseReplayShare(
      JSON.stringify({ ...replay, schemaVersion: 1, ruleset: null }),
    );
    expect(unknown.ok).toBe(true);
    if (unknown.ok) {
      expect(unknown.replay.ruleset).toBeNull();
      expect(unknown.replay.id).toBe('share-b');
    }

    const mismatched = parseReplayShare(
      JSON.stringify({
        ...replay,
        ruleset: { version: CURRENT_RUN_RULESET.version, fingerprint: 'other-ruleset' },
      }),
    );
    expect(mismatched.ok).toBe(true);
    if (mismatched.ok) {
      expect(mismatched.replay.ruleset).toEqual({
        version: CURRENT_RUN_RULESET.version,
        fingerprint: 'other-ruleset',
      });
    }

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

  it('上限いっぱいでも古い共有ファイルの取り込みを残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-pin-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);

    for (let i = 0; i < REPLAY_MAX_COUNT; i += 1) {
      const extra = makeReplay({
        id: `filled-${i}`,
        seed: `filled-${i}`,
        finishedAt: 20_000 + i,
      });
      expect((await game.importReplayText(serializeReplay(extra))).ok).toBe(true);
    }
    expect(game.listReplays()).toHaveLength(REPLAY_MAX_COUNT);

    const older = makeReplay({
      id: 'older-import',
      seed: 'older-import',
      finishedAt: 1,
    });
    const imported = await game.importReplayText(serializeReplay(older));
    expect(imported.ok).toBe(true);
    expect(game.listReplays()).toHaveLength(REPLAY_MAX_COUNT);
    expect(game.listReplays().some((item) => item.id === 'older-import')).toBe(true);
    expect(game.openReplay('older-import', 0)).not.toBeNull();
  });

  it('キーフレームの必須状態が欠けると拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-broken-frame', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-frame', seed: 'keep-frame' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'broken-frame', seed: 'broken-frame' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: Record<string, unknown> }>;
    };
    delete raw.keyframes[0]!.frame.trials;
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-frame']);
  });

  it('未知の診断種別は拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-unknown-diagnosis', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-diagnosis', seed: 'keep-diagnosis' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'bad-diagnosis', seed: 'bad-diagnosis' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: Record<string, unknown> }>;
    };
    raw.keyframes[0]!.frame.diagnosis = 'unknownDiagnosis';
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-diagnosis']);
  });

  it('フレームの seed がトップレベルと食い違うなら拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-seed-mismatch', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-seed', seed: 'keep-seed' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'other-seed', seed: 'other-seed' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: { seed?: string } }>;
    };
    raw.keyframes[0]!.frame.seed = 'not-the-replay-seed';
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-seed']);
  });

  it('contentSnapshot から参照カードを欠かすと拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-snap-gap', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-snap', seed: 'keep-snap' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'gap-snap', seed: 'gap-snap' });
    replay.keyframes[0]!.frame.deck = [{ defId: 'docs', level: 1 }];
    replay.contentSnapshot = snapshotReplayContent(replay.keyframes);
    expect(replay.contentSnapshot.cards.some((card) => card.id === 'docs')).toBe(true);
    const raw = JSON.parse(serializeReplay(replay)) as {
      contentSnapshot: { cards: Array<{ id: string }> };
    };
    raw.contentSnapshot.cards = raw.contentSnapshot.cards.filter((card) => card.id !== 'docs');
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-snap']);
  });

  it('終端キーフレームの status が outcome と食い違うなら拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-status-mismatch', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-status', seed: 'keep-status' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeWonReplay({ id: 'won-as-lost', seed: 'won-as-lost' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: { status?: string } }>;
    };
    raw.keyframes[0]!.frame.status = 'lost';
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-status']);
  });

  it('勝利キーフレームと outcome が一致するリプレイは取り込める', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-won-ok', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const replay = makeWonReplay({ id: 'won-ok', seed: 'won-ok' });
    const accepted = await game.importReplayText(serializeReplay(replay));
    expect(accepted.ok).toBe(true);
    const opened = game.openReplay('won-ok');
    expect(opened?.phase).toBe('won');
    expect(opened?.status).toBe('won');
  });

  it('キーフレームの member.stats が null なら拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-null-stats-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-stats', seed: 'keep-stats' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'null-stats', seed: 'null-stats' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{
        frame: { roster: { members: Array<{ stats?: unknown; traits?: unknown }> } };
      }>;
    };
    raw.keyframes[0]!.frame.roster.members[0]!.stats = null;
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-stats']);
  });

  it('キーフレームの member.traits が配列でなければ拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-bad-traits-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-traits', seed: 'keep-traits' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'bad-traits', seed: 'bad-traits' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: { roster: { members: Array<{ traits?: unknown }> } } }>;
    };
    raw.keyframes[0]!.frame.roster.members[0]!.traits = { focus: true };
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-traits']);
  });

  it('キーフレームの member が null なら拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-null-member-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-member', seed: 'keep-member' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'null-member', seed: 'null-member' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: { roster: { members: unknown[] } } }>;
    };
    raw.keyframes[0]!.frame.roster.members[0] = null;
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-member']);
  });

  it('キーフレームの lastResult.fireEvents 要素が null なら拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-null-fire-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-fire', seed: 'keep-fire' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'null-fire', seed: 'null-fire' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: { lastResult?: unknown } }>;
    };
    raw.keyframes[0]!.frame.lastResult = {
      done: 1,
      delivered: 1,
      maxCombo: 0,
      aiAssistedPct: 0,
      reviewQueueMax: 0,
      rework: 0,
      incidents: 0,
      contained: 0,
      spread: 0,
      seniorHpDelta: 0,
      actionCounts: {},
      grade: 'C',
      title: '記録',
      diagnosis: '記録',
      timeline: [],
      events: [],
      fireEvents: [null],
      focusRemaining: 0,
      focusMax: 10,
      autoContainCount: 0,
    };
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-fire']);
  });

  it('キーフレームの lastGrowth が空オブジェクトなら拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-empty-growth-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-growth', seed: 'keep-growth' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'empty-growth', seed: 'empty-growth' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: { lastGrowth?: unknown } }>;
    };
    raw.keyframes[0]!.frame.lastGrowth = {};
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-growth']);
  });

  it('キーフレームの trendHistory 要素が null なら拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-null-trend-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-trend', seed: 'keep-trend' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'null-trend', seed: 'null-trend' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: { trendHistory?: unknown } }>;
    };
    raw.keyframes[0]!.frame.trendHistory = [null];
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-trend']);
  });

  it('キーフレームの extras.teamRosters が null なら拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-null-rosters-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-rosters', seed: 'keep-rosters' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'null-rosters', seed: 'null-rosters' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: { extras: { teamRosters?: Record<string, unknown> } } }>;
    };
    raw.keyframes[0]!.frame.extras.teamRosters = { 'other-team': null };
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-rosters']);
  });

  it('キーフレームの roster が null なら拒否し、既存リプレイは残す', async () => {
    const replayStorage = new MemoryReplayStorage();
    const game = createGame({ seed: 'ri133-null-roster-replay', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-roster', seed: 'keep-roster' });
    expect(await game.importReplay(existing)).toBe(true);

    const replay = makeReplay({ id: 'null-roster', seed: 'null-roster' });
    const raw = JSON.parse(serializeReplay(replay)) as {
      keyframes: Array<{ frame: Record<string, unknown> }>;
    };
    raw.keyframes[0]!.frame.roster = null;
    const rejected = await game.importReplayText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: REPLAY_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.listReplays().map((item) => item.id)).toEqual(['keep-roster']);
  });

  it('保存後の一覧取得失敗では取り込み成功と既存キャッシュを残す', async () => {
    const inner = new MemoryReplayStorage();
    let failNextList = false;
    const replayStorage: ReplayStorage = {
      list: async () => {
        if (failNextList) {
          failNextList = false;
          throw new Error('forced list failure');
        }
        return inner.list();
      },
      get: (id) => inner.get(id),
      save: (blob, options) => inner.save(blob, options),
      clear: () => inner.clear(),
    };
    const game = createGame({ seed: 'ri133-list-fail', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({ id: 'keep-listed', seed: 'keep-listed', finishedAt: 1000 });
    expect(await game.importReplay(existing)).toBe(true);

    failNextList = true;
    const incoming = makeReplay({
      id: 'after-list-fail',
      seed: 'after-list-fail',
      finishedAt: 2000,
    });
    const imported = await game.importReplayText(serializeReplay(incoming));
    expect(imported.ok).toBe(true);
    expect(game.listReplays().map((item) => item.id)).toEqual(['after-list-fail', 'keep-listed']);
    expect((await inner.list()).map((item) => item.id)).toEqual(['after-list-fail', 'keep-listed']);
  });

  it('一覧再取得失敗時は同一 ID のキャッシュも取り込んだ内容へ置き換える', async () => {
    const inner = new MemoryReplayStorage();
    let failNextList = false;
    const replayStorage: ReplayStorage = {
      list: async () => {
        if (failNextList) {
          failNextList = false;
          throw new Error('forced list failure');
        }
        return inner.list();
      },
      get: (id) => inner.get(id),
      save: (blob, options) => inner.save(blob, options),
      clear: () => inner.clear(),
    };
    const game = createGame({ seed: 'ri133-same-id-list-fail', initialMeta: defaultMeta() });
    await game.attachReplay(replayStorage);
    const existing = makeReplay({
      id: 'same-id',
      seed: 'old-seed',
      finishedAt: 1000,
      outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 1 },
    });
    expect(await game.importReplay(existing)).toBe(true);

    failNextList = true;
    const incoming = makeReplay({
      id: 'same-id',
      seed: 'new-seed',
      finishedAt: 2000,
      outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 99 },
    });
    const imported = await game.importReplayText(serializeReplay(incoming));
    expect(imported.ok).toBe(true);
    expect(game.listReplays()).toHaveLength(1);
    expect(game.listReplays()[0]?.seed).toBe('new-seed');
    expect(game.listReplays()[0]?.outcome.score).toBe(99);
    expect(game.exportReplayText('same-id')).toContain('"score": 99');
    expect((await inner.get('same-id'))?.outcome.score).toBe(99);
  });
});
