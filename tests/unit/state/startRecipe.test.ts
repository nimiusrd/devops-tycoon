import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { createRunEngine } from '../../../src/sim/run/engine';
import {
  DAILY_RUN_DIFFICULTY,
  DAILY_RUN_TRIALS,
  dailySeed,
  defaultMeta,
  MAX_PREFERRED_CARDS,
} from '../../../src/state/meta';
import {
  loadStartRecipe,
  parseStartRecipe,
  serializeStartRecipe,
  START_RECIPE_REASON_MESSAGE,
  START_RECIPE_SCHEMA_VERSION,
  type StartRecipeInput,
} from '../../../src/state/startRecipe';

const SAMPLE: StartRecipeInput = {
  seed: 'org-share-1',
  difficulty: 'easy',
  trials: ['low-focus', 'half-budget'],
  scenario: 'copilot',
  preferredCardIds: ['docs'],
};

function startFromRecipe(input: StartRecipeInput) {
  const engine = createRunEngine({ seed: input.seed });
  engine.setPreferredCards(input.preferredCardIds);
  engine.startRun(input.difficulty, input.trials, input.seed, {
    kind: 'normal',
    scenario: input.scenario,
  });
  return engine;
}

describe('開始レシピ共有（RI-127）', () => {
  it('版付き JSON を往復しても同じ開始条件になる', () => {
    const raw = serializeStartRecipe({ ...SAMPLE, preferredCardIds: [] });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(START_RECIPE_SCHEMA_VERSION);
    expect(parsed.preferredCardIds).toEqual([]);
    expect(parsed).not.toHaveProperty('unlockedDifficulties');
    expect(parsed).not.toHaveProperty('unlockedCards');

    const loaded = loadStartRecipe(raw, defaultMeta());
    expect(loaded).toEqual({
      ok: true,
      recipe: {
        schemaVersion: START_RECIPE_SCHEMA_VERSION,
        ...SAMPLE,
        preferredCardIds: [],
      },
    });
  });

  it('preferredCardIds 省略は空の研修方針とし、受信側の既存方針は使わない', () => {
    const { preferredCardIds: _omit, ...withoutPreferred } = {
      schemaVersion: START_RECIPE_SCHEMA_VERSION,
      ...SAMPLE,
    };
    const receiver = { ...defaultMeta(), preferredCardIds: ['copilot'] };
    const loaded = loadStartRecipe(JSON.stringify(withoutPreferred), receiver);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.recipe.preferredCardIds).toEqual([]);
  });

  it.each([
    ['null', null],
    ['文字列', 'docs'],
    ['オブジェクト', { id: 'docs' }],
  ])('preferredCardIds が%sなら破損として拒否する', (_label, preferredCardIds) => {
    const raw = JSON.stringify({
      schemaVersion: START_RECIPE_SCHEMA_VERSION,
      seed: 'x',
      difficulty: 'easy',
      trials: [],
      scenario: 'default',
      preferredCardIds,
    });
    expect(loadStartRecipe(raw, defaultMeta())).toEqual({
      ok: false,
      reason: 'corrupt',
      message: START_RECIPE_REASON_MESSAGE.corrupt,
    });
  });

  it('受信側方針が異なる場合もレシピ側を採用する', () => {
    const receiver = { ...defaultMeta(), preferredCardIds: ['copilot'] };
    const loaded = loadStartRecipe(serializeStartRecipe(SAMPLE), receiver);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.recipe.preferredCardIds).toEqual(['docs']);
  });

  it.each([
    { name: '破損 JSON', raw: '{not-json', reason: 'corrupt' as const },
    {
      name: '未対応版',
      raw: serializeStartRecipe(SAMPLE).replace('"schemaVersion": 1', '"schemaVersion": 2'),
      reason: 'unsupported_version' as const,
    },
    {
      name: '未知の難易度',
      raw: JSON.stringify({
        schemaVersion: 1,
        seed: 'x',
        difficulty: 'legend',
        trials: [],
        scenario: 'default',
        preferredCardIds: [],
      }),
      reason: 'unknown_difficulty' as const,
    },
    {
      name: '未知の試練',
      raw: JSON.stringify({
        schemaVersion: 1,
        seed: 'x',
        difficulty: 'easy',
        trials: ['no-such-trial'],
        scenario: 'default',
        preferredCardIds: [],
      }),
      reason: 'unknown_trial' as const,
    },
    {
      name: '重複する試練',
      raw: JSON.stringify({
        schemaVersion: 1,
        seed: 'x',
        difficulty: 'easy',
        trials: ['low-focus', 'low-focus'],
        scenario: 'default',
        preferredCardIds: [],
      }),
      reason: 'duplicate_trial' as const,
    },
    {
      name: '未知のシナリオ',
      raw: JSON.stringify({
        schemaVersion: 1,
        seed: 'x',
        difficulty: 'easy',
        trials: [],
        scenario: 'custom-org',
        preferredCardIds: [],
      }),
      reason: 'unknown_scenario' as const,
    },
    {
      name: '未知のカード',
      raw: JSON.stringify({
        schemaVersion: 1,
        seed: 'x',
        difficulty: 'easy',
        trials: [],
        scenario: 'default',
        preferredCardIds: ['no-such-card'],
      }),
      reason: 'unknown_card' as const,
    },
    {
      name: '優先カード重複',
      raw: JSON.stringify({
        schemaVersion: 1,
        seed: 'x',
        difficulty: 'easy',
        trials: [],
        scenario: 'default',
        preferredCardIds: ['docs', 'docs'],
      }),
      reason: 'preferred_duplicate' as const,
    },
    {
      name: '優先カード上限超過',
      raw: JSON.stringify({
        schemaVersion: 1,
        seed: 'x',
        difficulty: 'easy',
        trials: [],
        scenario: 'default',
        preferredCardIds: ['docs', 'copilot', 'auto-test'],
      }),
      reason: 'preferred_over_cap' as const,
    },
  ])('$name は理由付きで拒否する', ({ raw, reason }) => {
    const loaded = loadStartRecipe(raw, defaultMeta());
    expect(loaded).toEqual({
      ok: false,
      reason,
      message: START_RECIPE_REASON_MESSAGE[reason],
    });
  });

  it('未解放の難易度と未解放カードは開始せず、sanitize しない', () => {
    expect(MAX_PREFERRED_CARDS).toBe(2);
    const hard = loadStartRecipe(
      serializeStartRecipe({ ...SAMPLE, difficulty: 'hard', preferredCardIds: [] }),
      defaultMeta(),
    );
    expect(hard).toMatchObject({ ok: false, reason: 'locked_difficulty' });

    const lockedCard = loadStartRecipe(
      serializeStartRecipe({ ...SAMPLE, preferredCardIds: ['devin'] }),
      defaultMeta(),
    );
    expect(lockedCard).toMatchObject({ ok: false, reason: 'locked_card' });
    expect(
      parseStartRecipe(serializeStartRecipe({ ...SAMPLE, preferredCardIds: ['devin'] })).ok,
    ).toBe(true);
  });

  it('同一 seed・同一解放・同一ルールセットなら開始スナップショットが一致する', () => {
    const loaded = loadStartRecipe(serializeStartRecipe(SAMPLE), defaultMeta());
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const a = startFromRecipe(loaded.recipe);
    const b = startFromRecipe(loaded.recipe);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.exportPersistState()?.extras.preferredCardIds).toEqual(['docs']);
    expect(a.snapshot()).toMatchObject({
      phase: 'setup',
      seed: SAMPLE.seed,
      difficulty: SAMPLE.difficulty,
      trials: SAMPLE.trials,
      scenario: SAMPLE.scenario,
    });
  });

  it('レシピ適用後のデイリーは識別子と研修方針無視を維持する', () => {
    const dateStr = '2026-08-18';
    const reachDraft = (preferred: string[]): string[] => {
      const game = createGame({
        seed: 'title',
        initialMeta: { ...defaultMeta(), preferredCardIds: preferred },
      });
      const loaded = loadStartRecipe(serializeStartRecipe(SAMPLE), game.getMeta());
      expect(loaded.ok).toBe(true);
      if (loaded.ok) game.setPreferredCardIds(loaded.recipe.preferredCardIds);
      expect(game.getMeta().preferredCardIds).toEqual(['docs']);
      const started = game.startDailyRun(dateStr);
      expect(started.phase).toBe('setup');
      expect(started.runKind).toBe('daily');
      expect(started.dailyDate).toBe(dateStr);
      expect(started.seed).toBe(dailySeed(dateStr));
      expect(started.difficulty).toBe(DAILY_RUN_DIFFICULTY);
      expect(started.trials).toEqual([...DAILY_RUN_TRIALS]);
      expect(started.scenario).toBe('default');

      let s = game.getState();
      let guard = 0;
      while (s.phase !== 'draft' && s.status === 'playing' && guard < 5000) {
        guard += 1;
        switch (s.phase) {
          case 'setup':
            game.beginSetupSprint();
            break;
          case 'sprint':
            game.step(1_000_000);
            break;
          case 'result':
            game.acknowledgeResult();
            break;
          default:
            guard = 5000;
            break;
        }
        s = game.getState();
      }
      expect(s.phase).toBe('draft');
      return s.draft ?? [];
    };

    expect(reachDraft(['copilot'])).toEqual(reachDraft([]));
  });
});
