/**
 * 組織シナリオの開始レシピ（SPEC 第23章 / RI-127）。
 *
 * タイトルの開始条件だけを版付き JSON で受け渡す。メタの解放状態、
 * カスタム orgDelta、途中セーブ／リプレイは含めない。
 * 未知 ID や未解放は sanitize せず、理由付きで拒否する。
 */
import { CARD_DEFS } from '../data/cards';
import { DIFFICULTY_DEFS, getTrial } from '../data/difficulties';
import { SCENARIOS } from '../sim/scenarios';
import type { DifficultyId } from '../sim/run/types';
import type { ScenarioId } from '../sim/types';
import { MAX_PREFERRED_CARDS, unlockedContent, type MetaState } from './meta';

/** 開始レシピスキーマ版。非互換時は拒否する（RI-116 前はルールセット識別子を持たない）。 */
export const START_RECIPE_SCHEMA_VERSION = 1;

/** タイトルで共有する開始条件。 */
export interface StartRecipe {
  schemaVersion: typeof START_RECIPE_SCHEMA_VERSION;
  seed: string;
  difficulty: DifficultyId;
  trials: string[];
  scenario: ScenarioId;
  /** 研修方針。書き出しは空配列を含めて必ず格納する。 */
  preferredCardIds: string[];
}

/** 書き出し入力（版は直列化側で付与する）。 */
export type StartRecipeInput = Omit<StartRecipe, 'schemaVersion'>;

export type StartRecipeReason =
  | 'corrupt'
  | 'unsupported_version'
  | 'unknown_difficulty'
  | 'unknown_trial'
  | 'duplicate_trial'
  | 'unknown_scenario'
  | 'unknown_card'
  | 'locked_difficulty'
  | 'locked_card'
  | 'preferred_over_cap'
  | 'preferred_duplicate';

export const START_RECIPE_REASON_MESSAGE: Record<StartRecipeReason, string> = {
  corrupt: '開始レシピが壊れているか、読み取れません。',
  unsupported_version: '未対応の開始レシピ版です。',
  unknown_difficulty: '未知の難易度が含まれています。',
  unknown_trial: '未知の試練が含まれています。',
  duplicate_trial: '試練 ID が重複しています。',
  unknown_scenario: '未知のシナリオが含まれています。',
  unknown_card: '未知の施策カードが含まれています。',
  locked_difficulty: '未解放の難易度が含まれています。',
  locked_card: '未解放の優先施策が含まれています。',
  preferred_over_cap: '研修方針が上限を超えています。',
  preferred_duplicate: '研修方針のカード ID が重複しています。',
};

export interface StartRecipeOk {
  ok: true;
  recipe: StartRecipe;
}

export interface StartRecipeErr {
  ok: false;
  reason: StartRecipeReason;
  message: string;
}

export type StartRecipeResult = StartRecipeOk | StartRecipeErr;

const CARD_IDS = new Set(CARD_DEFS.map((card) => card.id));

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fail(reason: StartRecipeReason): StartRecipeErr {
  return { ok: false, reason, message: START_RECIPE_REASON_MESSAGE[reason] };
}

function isDifficultyId(value: string): value is DifficultyId {
  return Object.prototype.hasOwnProperty.call(DIFFICULTY_DEFS, value);
}

function isKnownScenario(value: string): value is ScenarioId {
  return Object.prototype.hasOwnProperty.call(SCENARIOS, value);
}

function preferredCardIdsFrom(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  if (!value.every((id) => typeof id === 'string')) return null;
  return [...value];
}

/** 現在の開始条件を版付き JSON 文字列にする。`preferredCardIds` は空配列でも必ず入れる。 */
export function serializeStartRecipe(input: StartRecipeInput): string {
  const recipe: StartRecipe = {
    schemaVersion: START_RECIPE_SCHEMA_VERSION,
    seed: input.seed,
    difficulty: input.difficulty,
    trials: [...input.trials],
    scenario: input.scenario,
    preferredCardIds: [...input.preferredCardIds],
  };
  return `${JSON.stringify(recipe, null, 2)}\n`;
}

/**
 * JSON を構造検査する。未知 ID・重複・上限超過は拒否する。
 * `sanitizePreferredCardIds` やシナリオの default 落ちは使わない。
 */
export function parseStartRecipe(raw: string): StartRecipeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail('corrupt');
  }
  if (!isObject(parsed)) return fail('corrupt');
  if (typeof parsed.schemaVersion !== 'number' || !Number.isInteger(parsed.schemaVersion)) {
    return fail('corrupt');
  }
  if (parsed.schemaVersion !== START_RECIPE_SCHEMA_VERSION) return fail('unsupported_version');
  if (typeof parsed.seed !== 'string' || parsed.seed.length === 0) return fail('corrupt');
  if (typeof parsed.difficulty !== 'string') return fail('corrupt');
  if (!Array.isArray(parsed.trials) || !parsed.trials.every((id) => typeof id === 'string')) {
    return fail('corrupt');
  }
  if (typeof parsed.scenario !== 'string') return fail('corrupt');

  const preferredCardIds = preferredCardIdsFrom(parsed.preferredCardIds);
  if (preferredCardIds === null) return fail('corrupt');

  if (!isDifficultyId(parsed.difficulty)) return fail('unknown_difficulty');

  const trials: string[] = [];
  const seenTrials = new Set<string>();
  for (const id of parsed.trials) {
    if (!getTrial(id)) return fail('unknown_trial');
    if (seenTrials.has(id)) return fail('duplicate_trial');
    seenTrials.add(id);
    trials.push(id);
  }

  if (!isKnownScenario(parsed.scenario)) return fail('unknown_scenario');

  if (preferredCardIds.length > MAX_PREFERRED_CARDS) return fail('preferred_over_cap');
  const seenCards = new Set<string>();
  for (const id of preferredCardIds) {
    if (!CARD_IDS.has(id)) return fail('unknown_card');
    if (seenCards.has(id)) return fail('preferred_duplicate');
    seenCards.add(id);
  }

  return {
    ok: true,
    recipe: {
      schemaVersion: START_RECIPE_SCHEMA_VERSION,
      seed: parsed.seed,
      difficulty: parsed.difficulty,
      trials,
      scenario: parsed.scenario,
      preferredCardIds,
    },
  };
}

/** 受信側メタの解放状態と照合する。未解放は黙って除去せず拒否する。 */
export function validateStartRecipe(recipe: StartRecipe, meta: MetaState): StartRecipeResult {
  if (!meta.unlockedDifficulties.includes(recipe.difficulty)) return fail('locked_difficulty');
  const unlockedCards = unlockedContent(meta).cards;
  for (const id of recipe.preferredCardIds) {
    if (!unlockedCards.has(id)) return fail('locked_card');
  }
  return { ok: true, recipe };
}

/** 文字列を解析し、受信側メタで開始可能ならレシピを返す。 */
export function loadStartRecipe(raw: string, meta: MetaState): StartRecipeResult {
  const parsed = parseStartRecipe(raw);
  if (!parsed.ok) return parsed;
  return validateStartRecipe(parsed.recipe, meta);
}
