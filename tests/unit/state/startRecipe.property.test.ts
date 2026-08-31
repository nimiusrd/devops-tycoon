import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CARD_DEFS } from '../../../src/data/cards';
import { DIFFICULTY_ORDER, TRIAL_DEFS } from '../../../src/data/difficulties';
import { metaUnlockContentIds } from '../../../src/data/unlocks';
import { SCENARIO_ORDER } from '../../../src/sim/scenarios';
import { defaultMeta, MAX_PREFERRED_CARDS } from '../../../src/state/meta';
import {
  parseStartRecipe,
  serializeStartRecipe,
  START_RECIPE_REASON_MESSAGE,
  START_RECIPE_SCHEMA_VERSION,
  validateStartRecipe,
  type StartRecipe,
  type StartRecipeInput,
  type StartRecipeReason,
} from '../../../src/state/startRecipe';
import { propertyParameters } from '../helpers/property';

const TRIAL_IDS = TRIAL_DEFS.map(({ id }) => id);
const CARD_IDS = CARD_DEFS.map(({ id }) => id);
const LOCKED_CARD_IDS = metaUnlockContentIds().cards;

const seedArbitrary = fc.oneof(
  fc.constantFrom('0', ' ', '\0', '🚀'),
  fc.string({ minLength: 1, maxLength: 64 }),
);
const difficultyArbitrary = fc.constantFrom(...DIFFICULTY_ORDER);
const trialsArbitrary = fc.uniqueArray(fc.constantFrom(...TRIAL_IDS), {
  maxLength: TRIAL_IDS.length,
});
const scenarioArbitrary = fc.constantFrom(...SCENARIO_ORDER);
const preferredCardsArbitrary = fc.uniqueArray(fc.constantFrom(...CARD_IDS), {
  maxLength: MAX_PREFERRED_CARDS,
});

const validRecipeInputArbitrary: fc.Arbitrary<StartRecipeInput> = fc.record({
  seed: seedArbitrary,
  difficulty: difficultyArbitrary,
  trials: trialsArbitrary,
  scenario: scenarioArbitrary,
  preferredCardIds: preferredCardsArbitrary,
});

const unsupportedVersionArbitrary = fc.oneof(
  fc.integer({ min: -1_000, max: 0 }),
  fc.integer({ min: START_RECIPE_SCHEMA_VERSION + 1, max: 1_000 }),
);

function expectFailure(raw: string, reason: StartRecipeReason): void {
  expect(parseStartRecipe(raw)).toEqual({
    ok: false,
    reason,
    message: START_RECIPE_REASON_MESSAGE[reason],
  });
}

function recipeObject(input: StartRecipeInput): Record<string, unknown> {
  return JSON.parse(serializeStartRecipe(input)) as Record<string, unknown>;
}

describe('開始レシピ共有 property', () => {
  // 要件: 全ての有効な開始条件を損失なく往復する。検出例: 空配列やUnicode seedを省略する。
  it('有効な開始レシピをserialize/parseして同じ値へ戻す', () => {
    fc.assert(
      fc.property(validRecipeInputArbitrary, (input) => {
        expect(parseStartRecipe(serializeStartRecipe(input))).toEqual({
          ok: true,
          recipe: { schemaVersion: START_RECIPE_SCHEMA_VERSION, ...input },
        });
      }),
      propertyParameters(),
    );
  });

  // 要件: 一度解析したレシピは正規形。検出例: 再直列化のたびに配列順や省略項目を変える。
  it('解析後の再serializeで正規化済みJSONが変化しない', () => {
    fc.assert(
      fc.property(validRecipeInputArbitrary, (input) => {
        const first = serializeStartRecipe(input);
        const parsed = parseStartRecipe(first);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(serializeStartRecipe(parsed.recipe)).toBe(first);
      }),
      propertyParameters(),
    );
  });

  // 要件: 不正JSON・必須項目の欠落/型違い・未対応版を理由付きで拒否する。
  // 検出例: schemaVersionを丸める、欠落フィールドを暗黙の既定値で補う。
  it('構造破損と未対応schemaをcorruptまたはunsupported_versionで拒否する', () => {
    fc.assert(
      fc.property(
        validRecipeInputArbitrary,
        unsupportedVersionArbitrary,
        fc.string({ maxLength: 64 }),
        (input, unsupportedVersion, fragment) => {
          expectFailure(`not-json:${fragment}`, 'corrupt');

          const requiredFields = ['seed', 'difficulty', 'trials', 'scenario'] as const;
          const invalidValues: Record<(typeof requiredFields)[number], unknown> = {
            seed: 1,
            difficulty: false,
            trials: 'low-focus',
            scenario: [],
          };
          for (const field of requiredFields) {
            const missing = recipeObject(input);
            delete missing[field];
            expectFailure(JSON.stringify(missing), 'corrupt');

            const wrongType = recipeObject(input);
            wrongType[field] = invalidValues[field];
            expectFailure(JSON.stringify(wrongType), 'corrupt');
          }

          const unsupported = recipeObject(input);
          unsupported.schemaVersion = unsupportedVersion;
          expectFailure(JSON.stringify(unsupported), 'unsupported_version');
        },
      ),
      propertyParameters(),
    );
  });

  // 要件: 未知IDをsanitizeせず対象別に拒否する。検出例: unknown scenarioをdefaultへ落とす。
  it('各ドメインの未知IDを対応する理由で拒否する', () => {
    fc.assert(
      fc.property(validRecipeInputArbitrary, fc.uuid(), (input, suffix) => {
        const unknown = `unknown:${suffix}`;
        const cases: Array<[Record<string, unknown>, StartRecipeReason]> = [
          [{ ...recipeObject(input), difficulty: unknown }, 'unknown_difficulty'],
          [{ ...recipeObject(input), trials: [unknown] }, 'unknown_trial'],
          [{ ...recipeObject(input), scenario: unknown }, 'unknown_scenario'],
          [{ ...recipeObject(input), preferredCardIds: [unknown] }, 'unknown_card'],
        ];
        for (const [value, reason] of cases) {
          expectFailure(JSON.stringify(value), reason);
        }
      }),
      propertyParameters(),
    );
  });

  // 要件: 試練/カードは一意で、優先カードは上限以内。検出例: Set化で重複を黙って除去する。
  it('重複と優先カード上限超過を正確な理由で拒否する', () => {
    fc.assert(
      fc.property(
        validRecipeInputArbitrary,
        fc.constantFrom(...TRIAL_IDS),
        fc.constantFrom(...CARD_IDS),
        fc.uniqueArray(fc.constantFrom(...CARD_IDS), {
          minLength: MAX_PREFERRED_CARDS + 1,
          maxLength: MAX_PREFERRED_CARDS + 1,
        }),
        (input, trialId, cardId, tooManyCards) => {
          expectFailure(
            JSON.stringify({ ...recipeObject(input), trials: [trialId, trialId] }),
            'duplicate_trial',
          );
          expectFailure(
            JSON.stringify({ ...recipeObject(input), preferredCardIds: [cardId, cardId] }),
            'preferred_duplicate',
          );
          expectFailure(
            JSON.stringify({ ...recipeObject(input), preferredCardIds: tooManyCards }),
            'preferred_over_cap',
          );
        },
      ),
      propertyParameters(),
    );
  });

  // 要件: 受信側で必要な難易度/カードが解放済みの場合だけ開始可能。
  // 検出例: 片方の解放だけ確認する、または未解放カードを黙って削除する。
  it('解放を1つ除くとlocked_difficultyまたはlocked_cardになる', () => {
    const unlockRecipeArbitrary = fc.record({
      seed: seedArbitrary,
      difficulty: difficultyArbitrary,
      trials: trialsArbitrary,
      scenario: scenarioArbitrary,
      preferredCardIds: fc.uniqueArray(fc.constantFrom(...LOCKED_CARD_IDS), {
        minLength: 1,
        maxLength: Math.min(MAX_PREFERRED_CARDS, LOCKED_CARD_IDS.length),
      }),
    });

    fc.assert(
      fc.property(unlockRecipeArbitrary, (input) => {
        const recipe: StartRecipe = {
          schemaVersion: START_RECIPE_SCHEMA_VERSION,
          ...input,
        };
        const fullyUnlocked = {
          ...defaultMeta(),
          unlockedDifficulties: [...DIFFICULTY_ORDER],
          unlockedCards: [...CARD_IDS],
        };
        expect(validateStartRecipe(recipe, fullyUnlocked)).toEqual({ ok: true, recipe });

        const withoutDifficulty = {
          ...fullyUnlocked,
          unlockedDifficulties: fullyUnlocked.unlockedDifficulties.filter(
            (difficulty) => difficulty !== recipe.difficulty,
          ),
        };
        expect(validateStartRecipe(recipe, withoutDifficulty)).toMatchObject({
          ok: false,
          reason: 'locked_difficulty',
        });

        const requiredCard = recipe.preferredCardIds[0];
        const withoutCard = {
          ...fullyUnlocked,
          unlockedCards: fullyUnlocked.unlockedCards.filter((card) => card !== requiredCard),
        };
        expect(validateStartRecipe(recipe, withoutCard)).toMatchObject({
          ok: false,
          reason: 'locked_card',
        });
      }),
      propertyParameters(),
    );
  });
});
