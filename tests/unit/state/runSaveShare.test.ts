import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { createRunEngine } from '../../../src/sim/run/engine';
import { defaultMeta } from '../../../src/state/meta';
import { MemoryReplayStorage } from '../../../src/state/replayPersistence';
import {
  CURRENT_RUN_RULESET,
  MemoryRunStorage,
  RUN_SAVE_SCHEMA_VERSION,
  toRunSave,
  type RunSave,
} from '../../../src/state/runPersistence';
import {
  parseRunSaveShare,
  RUN_SAVE_SHARE_REASON_MESSAGE,
  serializeRunSave,
} from '../../../src/state/runSaveShare';

function makeRunSave(seed = 'ri133-run-save'): RunSave {
  const engine = createRunEngine({ seed });
  engine.startRun('easy', [], seed);
  const state = engine.exportPersistState();
  const frame = engine.exportReplayFrame();
  if (!state || !frame) throw new Error('failed to export run save fixture');
  return toRunSave(state, 1234, [{ phase: 'setup', label: '編成', frame }]);
}

function makeResultRunSave(seed: string): RunSave {
  const save = makeRunSave(seed);
  save.state.phase = 'result';
  save.summary.phase = 'result';
  save.state.lastResult = {
    done: 3,
    delivered: 4,
    maxCombo: 2,
    aiAssistedPct: 10,
    reviewQueueMax: 1,
    rework: 0,
    incidents: 0,
    contained: 0,
    spread: 0,
    seniorHpDelta: 0,
    actionCounts: {},
    grade: 'B',
    title: '安定運用',
    diagnosis: '順調',
    timeline: [],
    events: [],
    fireEvents: [],
    focusRemaining: 8,
    focusMax: 10,
    autoContainCount: 0,
  };
  return save;
}

function makeQuarterReviewRunSave(seed: string): RunSave {
  const save = makeRunSave(seed);
  save.state.phase = 'quarterReview';
  save.summary.phase = 'quarterReview';
  save.state.quarterReview = {
    goal: { ...save.state.quarterGoal },
    outcome: 'met',
    trust: { ...save.state.stakeholderTrust },
    progress: [],
    missedReasons: [],
    availableAdjustments: [],
    bossCleared: true,
  };
  return save;
}

function makeShopRunSave(seed: string): RunSave {
  const save = makeRunSave(seed);
  save.state.phase = 'shop';
  save.summary.phase = 'shop';
  save.state.shop = {
    cards: [{ defId: 'docs', cost: 4, bought: false }],
    relic: { id: 'postmortem', cost: 12, bought: false },
    recruit: { cost: 8, bought: false },
  };
  return save;
}

function makeDraftRunSave(seed: string): RunSave {
  const save = makeRunSave(seed);
  save.state.phase = 'draft';
  save.summary.phase = 'draft';
  save.state.draft = ['docs', 'focus'];
  return save;
}

function makeBeatRunSave(seed: string): RunSave {
  const save = makeRunSave(seed);
  save.state.phase = 'beat';
  save.summary.phase = 'beat';
  save.state.beat = { eventId: 'urgent-demo', kind: 'decision' };
  return save;
}

describe('途中セーブのファイル共有（RI-133）', () => {
  it('JSON を往復しても同じセーブを再開できる', () => {
    const save = makeRunSave();
    const raw = serializeRunSave(save);
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(RUN_SAVE_SCHEMA_VERSION);
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('state');
    expect(parsed).not.toHaveProperty('preferredCardIds');
    expect(parsed).not.toHaveProperty('scenario');

    const loaded = parseRunSaveShare(raw);
    expect(loaded).toEqual({ ok: true, save });
  });

  it.each([
    ['壊れた JSON', '{', 'corrupt'],
    ['配列', '[]', 'corrupt'],
    ['版が整数でない', JSON.stringify({ schemaVersion: '8' }), 'corrupt'],
    [
      '未対応版',
      JSON.stringify({ schemaVersion: 99, summary: {}, state: {} }),
      'unsupported_version',
    ],
  ] as const)('%sなら理由付きで拒否する', (_label, raw, reason) => {
    expect(parseRunSaveShare(raw)).toEqual({
      ok: false,
      reason,
      message: RUN_SAVE_SHARE_REASON_MESSAGE[reason],
    });
  });

  it('ルールセット不明と不一致は拒否し、開始レシピと混ぜない', () => {
    const save = makeRunSave('ri133-ruleset');
    expect(
      parseRunSaveShare(
        JSON.stringify({
          ...save,
          ruleset: null,
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'ruleset_unknown' });

    expect(
      parseRunSaveShare(
        JSON.stringify({
          ...save,
          ruleset: { version: CURRENT_RUN_RULESET.version, fingerprint: 'other-ruleset' },
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'ruleset_mismatch' });

    expect(
      parseRunSaveShare(
        JSON.stringify({
          schemaVersion: 1,
          seed: 'recipe',
          difficulty: 'easy',
          trials: [],
          scenario: 'default',
          preferredCardIds: [],
        }),
      ),
    ).toMatchObject({ ok: false, reason: 'unsupported_version' });
  });

  it('取り込み成功時はラン保存だけを置き換え、メタとリプレイは触らない', async () => {
    const existing = makeRunSave('ri133-existing');
    const incoming = makeRunSave('ri133-incoming');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const replayStorage = new MemoryReplayStorage();
    const meta = { ...defaultMeta(), points: 17, completedDailies: ['2026-08-01'] };
    const game = createGame({
      seed: 'ri133-game',
      initialMeta: meta,
      runStorage,
      initialRunSave: existing,
    });
    await game.attachReplay(replayStorage);

    const result = await game.importRunSaveText(serializeRunSave(incoming));
    expect(result.ok).toBe(true);
    expect(game.hasResumableRun()).toBe(true);
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-incoming');
    expect(game.getMeta().points).toBe(17);
    expect(game.getMeta().completedDailies).toEqual(['2026-08-01']);
    expect(game.listReplays()).toEqual([]);
    expect((await runStorage.load())?.summary.seed).toBe('ri133-incoming');
    expect((await runStorage.load())?.schemaVersion).toBe(RUN_SAVE_SCHEMA_VERSION);
  });

  it('拒否時は既存セーブを自動削除しない', async () => {
    const existing = makeRunSave('ri133-keep');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const rejected = await game.importRunSaveText('{');
    expect(rejected).toEqual({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep');
    expect(game.exportRunSaveText()).toContain('ri133-keep');
  });

  it('要約の dailyDate が state と食い違うと拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-daily');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-daily-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incomingEngine = createRunEngine({ seed: 'ri133-daily-share' });
    incomingEngine.startRun('normal', [], 'ri133-daily-share', {
      kind: 'daily',
      dailyDate: '2026-08-22',
    });
    const persist = incomingEngine.exportPersistState();
    const frame = incomingEngine.exportReplayFrame();
    if (!persist || !frame) throw new Error('daily persist missing');
    const incoming = toRunSave(persist, 2000, [{ phase: 'setup', label: '編成', frame }]);
    expect(incoming.summary.runKind).toBe('daily');
    expect(incoming.summary.dailyDate).toBe('2026-08-22');

    const raw = JSON.parse(serializeRunSave(incoming)) as { summary: Record<string, unknown> };
    delete raw.summary.dailyDate;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-daily');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-daily');
  });

  it('roster.members の stats が null なら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-stats');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-stats-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-null-stats');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { roster: { members: Array<{ stats?: unknown; traits?: unknown }> } };
    };
    raw.state.roster.members[0]!.stats = null;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-stats');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-stats');
  });

  it('roster.members の traits が配列でなければ拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-traits');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-traits-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-bad-traits');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { roster: { members: Array<{ traits?: unknown }> } };
    };
    raw.state.roster.members[0]!.traits = null;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-traits');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-traits');
  });

  it('取り込み中の破棄は保留中の途中セーブを復活させない', async () => {
    let current: RunSave | null = makeRunSave('ri133-incompat-keep');
    current.ruleset = { version: CURRENT_RUN_RULESET.version, fingerprint: 'other-ruleset' };
    let finishSave: (() => void) | undefined;
    let saveStarted!: () => void;
    const whenSaveStarted = new Promise<void>((resolve) => {
      saveStarted = resolve;
    });
    const runStorage = {
      async load() {
        return current;
      },
      async save(save: RunSave) {
        if (save.summary.seed === 'ri133-late-after-discard') {
          saveStarted();
          await new Promise<void>((resolve) => {
            finishSave = resolve;
          });
        }
        current = save;
      },
      async clear() {
        current = null;
      },
    };
    const game = createGame({
      seed: 'ri133-discard-import',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: current,
    });
    expect(game.getRunSaveIssue()?.kind).toBe('ruleset-mismatch');
    expect(game.hasResumableRun()).toBe(false);

    const importing = game.importRunSaveText(
      serializeRunSave(makeRunSave('ri133-late-after-discard')),
    );
    await whenSaveStarted;
    game.clearRunSave();
    finishSave?.();
    await importing;
    expect(game.hasResumableRun()).toBe(false);
    expect(game.getRunSaveSummary()).toBeNull();
    expect(game.getRunSaveIssue()).toBeNull();
    expect(await runStorage.load()).toBeNull();
  });

  it.each([
    [
      'fireEvents',
      (result: { fireEvents?: unknown }) => {
        result.fireEvents = [null];
      },
    ],
    [
      'timeline',
      (result: { timeline?: unknown }) => {
        result.timeline = [null];
      },
    ],
    [
      'events',
      (result: { events?: unknown }) => {
        result.events = [null];
      },
    ],
  ] as const)(
    'result の lastResult.%s 要素が null なら拒否し、既存セーブは残す',
    async (field, mutate) => {
      const existing = makeRunSave(`ri133-keep-result-${field}`);
      const runStorage = new MemoryRunStorage();
      await runStorage.save(existing);
      const game = createGame({
        seed: `ri133-keep-result-${field}-game`,
        initialMeta: defaultMeta(),
        runStorage,
        initialRunSave: existing,
      });

      const incoming = makeResultRunSave(`ri133-null-${field}`);
      const raw = JSON.parse(serializeRunSave(incoming)) as {
        state: { lastResult: { fireEvents?: unknown; timeline?: unknown; events?: unknown } };
      };
      mutate(raw.state.lastResult);
      const rejected = await game.importRunSaveText(JSON.stringify(raw));
      expect(rejected).toMatchObject({
        ok: false,
        reason: 'corrupt',
        message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
      });
      expect(game.getRunSaveSummary()?.seed).toBe(`ri133-keep-result-${field}`);
      expect((await runStorage.load())?.summary.seed).toBe(`ri133-keep-result-${field}`);
    },
  );

  it('state.org が空オブジェクトなら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-org');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-org-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-empty-org');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: { org?: unknown } };
    raw.state.org = {};
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-org');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-org');
  });

  it('extras.teams の要素が空オブジェクトなら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-teams');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-teams-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-empty-teams');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { extras: { teams?: unknown } };
    };
    raw.state.extras.teams = [{}];
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-teams');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-teams');
  });

  it('deck の level が数値でなければ拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-deck');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-deck-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-bad-deck');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { deck: Array<{ defId?: string; level?: unknown }> };
    };
    raw.state.deck = [{ defId: 'docs', level: 'bad' }];
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-deck');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-deck');
  });

  it('quarterGoal が空オブジェクトなら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-goal');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-goal-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-empty-goal');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: { quarterGoal?: unknown } };
    raw.state.quarterGoal = {};
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-goal');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-goal');
  });

  it('extras.baseConfig が空オブジェクトなら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-config');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-config-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-empty-config');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { extras: { baseConfig?: unknown } };
    };
    raw.state.extras.baseConfig = {};
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-config');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-config');
  });

  it('state.totals.delivered が欠けると拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-totals');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-totals-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-missing-delivered');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { totals: Record<string, unknown> };
    };
    delete raw.state.totals.delivered;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-totals');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-totals');
  });

  it('result フェーズで lastResult が空オブジェクトなら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-result');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-result-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeResultRunSave('ri133-empty-result');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: { lastResult?: unknown } };
    raw.state.lastResult = {};
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-result');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-result');
  });

  it('lastResult.gradeRatio が非数なら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-grade-ratio');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-grade-ratio-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeResultRunSave('ri133-broken-grade-ratio');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { lastResult: Record<string, unknown> };
    };
    raw.state.lastResult.gradeRatio = 'broken';
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    raw.state.lastResult.gradeRatio = Number.POSITIVE_INFINITY;
    const rejectedInf = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejectedInf).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-grade-ratio');
  });

  it('lastResult.stabilizingGrants が負数なら拒否し、省略は許可する', async () => {
    const existing = makeRunSave('ri133-keep-grants');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-grants-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const omitted = makeResultRunSave('ri133-omit-grants');
    const omittedRaw = JSON.parse(serializeRunSave(omitted));
    const omittedOk = await game.importRunSaveText(JSON.stringify(omittedRaw));
    expect(omittedOk).toMatchObject({ ok: true });

    const incoming = makeResultRunSave('ri133-neg-grants');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { lastResult: Record<string, unknown> };
    };
    raw.state.lastResult.stabilizingGrants = -1;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
  });

  it('lastResult.gradePenalties が非数なら拒否し、省略は許可する', async () => {
    const existing = makeRunSave('ri133-keep-penalties');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-penalties-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const omitted = makeResultRunSave('ri133-omit-penalties');
    const omittedRaw = JSON.parse(serializeRunSave(omitted));
    const omittedOk = await game.importRunSaveText(JSON.stringify(omittedRaw));
    expect(omittedOk).toMatchObject({ ok: true });

    const incoming = makeResultRunSave('ri133-broken-penalties');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { lastResult: Record<string, unknown> };
    };
    raw.state.lastResult.gradePenalties = { rework: 'broken' };
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
  });

  it('同梱キーフレームの seed が本体と食い違うなら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-kf-seed');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-kf-seed-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-kf-seed');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      replayKeyframes: Array<{ frame: { seed?: string } }>;
    };
    raw.replayKeyframes[0]!.frame.seed = 'not-the-save-seed';
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-kf-seed');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-kf-seed');
  });

  it('quarterReview フェーズで本体が null なら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-review');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-review-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeQuarterReviewRunSave('ri133-null-review');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { quarterReview?: unknown };
    };
    raw.state.quarterReview = null;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-review');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-review');
  });

  it('ショップフェーズで shop が空オブジェクトなら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-shop');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-shop-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeShopRunSave('ri133-empty-shop');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: { shop?: unknown } };
    raw.state.shop = {};
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-shop');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-shop');
  });

  it('draft フェーズで候補配列が null なら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-draft');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-draft-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeDraftRunSave('ri133-null-draft');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: { draft?: unknown } };
    raw.state.draft = null;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-draft');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-draft');
  });

  it('draft フェーズの正常な途中セーブは取り込める', async () => {
    const runStorage = new MemoryRunStorage();
    const game = createGame({
      seed: 'ri133-draft-ok-game',
      initialMeta: defaultMeta(),
      runStorage,
    });
    const incoming = makeDraftRunSave('ri133-draft-ok');
    const accepted = await game.importRunSaveText(serializeRunSave(incoming));
    expect(accepted.ok).toBe(true);
    expect(game.getRunSaveSummary()?.phase).toBe('draft');
    expect((await runStorage.load())?.state.draft).toEqual(['docs', 'focus']);
  });

  it('beat フェーズで本体が空オブジェクトなら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-beat');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-beat-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeBeatRunSave('ri133-empty-beat');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: { beat?: unknown } };
    raw.state.beat = {};
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-beat');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-beat');
  });

  it('beat フェーズの未知 eventId は拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-beat-id');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-beat-id-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeBeatRunSave('ri133-unknown-beat');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { beat?: { eventId?: string; kind?: string } };
    };
    raw.state.beat = { eventId: 'not-a-real-event', kind: 'decision' };
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-beat-id');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-beat-id');
  });

  it('beat フェーズの正常な途中セーブは取り込める', async () => {
    const runStorage = new MemoryRunStorage();
    const game = createGame({
      seed: 'ri133-beat-ok-game',
      initialMeta: defaultMeta(),
      runStorage,
    });
    const incoming = makeBeatRunSave('ri133-beat-ok');
    const accepted = await game.importRunSaveText(serializeRunSave(incoming));
    expect(accepted.ok).toBe(true);
    expect(game.getRunSaveSummary()?.phase).toBe('beat');
    expect((await runStorage.load())?.state.beat).toEqual({
      eventId: 'urgent-demo',
      kind: 'decision',
    });
  });

  it('lastGrowth が空オブジェクトなら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-growth');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-growth-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-empty-growth');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: { lastGrowth?: unknown } };
    raw.state.lastGrowth = {};
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-growth');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-growth');
  });

  it('trendHistory の要素が null なら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-trend');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-trend-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-null-trend');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: { trendHistory?: unknown } };
    raw.state.trendHistory = [null];
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-trend');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-trend');
  });

  it('extras.teamRosters の値が null なら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-rosters');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-rosters-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-null-team-roster');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { extras: { teamRosters?: Record<string, unknown> } };
    };
    raw.state.extras.teamRosters = { 'other-team': null };
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-rosters');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-rosters');
  });

  it('ショップフェーズの正常な途中セーブは取り込める', async () => {
    const runStorage = new MemoryRunStorage();
    const game = createGame({
      seed: 'ri133-shop-ok-game',
      initialMeta: defaultMeta(),
      runStorage,
    });
    const incoming = makeShopRunSave('ri133-shop-ok');
    const accepted = await game.importRunSaveText(serializeRunSave(incoming));
    expect(accepted.ok).toBe(true);
    expect(game.getRunSaveSummary()?.phase).toBe('shop');
    expect((await runStorage.load())?.state.shop?.cards).toEqual([
      { defId: 'docs', cost: 4, bought: false },
    ]);
  });

  it('roster.members の要素が null なら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-member');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-member-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-null-member');
    const raw = JSON.parse(serializeRunSave(incoming)) as {
      state: { roster: { members: unknown[] } };
    };
    raw.state.roster.members[0] = null;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-member');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-member');
  });

  it('同梱キーフレームが欠けた途中セーブは拒否する', async () => {
    const save = makeRunSave('ri133-kf-drop');
    const raw = JSON.parse(serializeRunSave(save)) as {
      replayKeyframes: Array<{ frame: Record<string, unknown> }>;
    };
    delete raw.replayKeyframes[0]!.frame.trials;
    expect(parseRunSaveShare(JSON.stringify(raw))).toMatchObject({
      ok: false,
      reason: 'corrupt',
    });
  });

  it('ラン開始後は保留中の途中セーブ取り込みを反映しない', async () => {
    let current: RunSave | null = null;
    const runStorage = {
      async load() {
        return current;
      },
      async save(save: RunSave) {
        if (save.summary.seed === 'ri133-late-import') {
          await new Promise((resolve) => {
            setTimeout(resolve, 40);
          });
        }
        current = save;
      },
      async clear() {
        current = null;
      },
    };
    const game = createGame({
      seed: 'ri133-cancel-import',
      initialMeta: defaultMeta(),
      runStorage,
    });
    const importing = game.importRunSaveText(serializeRunSave(makeRunSave('ri133-late-import')));
    game.startRun('easy', [], 'started-after-import');
    await importing;
    expect(game.getRunSaveSummary()?.seed).toBe('started-after-import');
    expect((await runStorage.load())?.summary.seed).toBe('started-after-import');
  });

  it('state.roster が null なら拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-roster');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-roster-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-null-roster');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: Record<string, unknown> };
    raw.state.roster = null;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-roster');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-roster');
  });

  it('後から始めた取り込みが先に完了しても最後の選択だけを残す', async () => {
    let current: RunSave | null = null;
    const runStorage = {
      async load() {
        return current;
      },
      async save(save: RunSave) {
        await new Promise((resolve) => {
          setTimeout(resolve, save.summary.seed === 'ri133-slow-a' ? 40 : 0);
        });
        current = save;
      },
      async clear() {
        current = null;
      },
    };
    const existing = makeRunSave('ri133-keep-serial');
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-serial-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const first = game.importRunSaveText(serializeRunSave(makeRunSave('ri133-slow-a')));
    const second = game.importRunSaveText(serializeRunSave(makeRunSave('ri133-fast-b')));
    await Promise.all([first, second]);
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-fast-b');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-fast-b');
  });

  it('state.trials が欠けると拒否し、既存セーブは残す', async () => {
    const existing = makeRunSave('ri133-keep-trials');
    const runStorage = new MemoryRunStorage();
    await runStorage.save(existing);
    const game = createGame({
      seed: 'ri133-keep-trials-game',
      initialMeta: defaultMeta(),
      runStorage,
      initialRunSave: existing,
    });

    const incoming = makeRunSave('ri133-broken-trials');
    const raw = JSON.parse(serializeRunSave(incoming)) as { state: Record<string, unknown> };
    delete raw.state.trials;
    const rejected = await game.importRunSaveText(JSON.stringify(raw));
    expect(rejected).toMatchObject({
      ok: false,
      reason: 'corrupt',
      message: RUN_SAVE_SHARE_REASON_MESSAGE.corrupt,
    });
    expect(game.getRunSaveSummary()?.seed).toBe('ri133-keep-trials');
    expect((await runStorage.load())?.summary.seed).toBe('ri133-keep-trials');
  });
});
