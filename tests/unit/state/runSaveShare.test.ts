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
