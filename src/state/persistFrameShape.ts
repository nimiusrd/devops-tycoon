/**
 * 途中セーブ／リプレイ共有用の入れ子構造検査。
 *
 * hydrate は必須オブジェクトを代入するだけなので、roster などを null にしても例外にならない。
 * 画面が members 等を参照する前に、外部 JSON の形を拒否する。
 */

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNullableObject(value: unknown): boolean {
  return value === null || isObject(value);
}

/** 復元後に UI / エンジンが参照する必須オブジェクトと配列があるか。 */
export function isPersistFrameShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!Array.isArray(value.trials)) return false;
  if (!Array.isArray(value.deck)) return false;
  if (!Array.isArray(value.relics)) return false;
  if (!Array.isArray(value.goalAdjustmentsTaken)) return false;
  if (!Array.isArray(value.reviewHistory)) return false;
  if (!isObject(value.org)) return false;
  if (!isObject(value.evolution) || typeof value.evolution.points !== 'number') return false;
  if (!isObject(value.evolution.unlocked)) return false;
  if (!isObject(value.roster) || !Array.isArray(value.roster.members)) return false;
  if (typeof value.roster.nextId !== 'number') return false;
  if (!isObject(value.pendingSprintModifiers)) return false;
  if (!isObject(value.totals)) return false;
  if (!isObject(value.quarterTotals)) return false;
  if (!isObject(value.quarterGoal)) return false;
  if (!isObject(value.stakeholderTrust)) return false;
  if (!isObject(value.zoom)) return false;
  if (!isObject(value.extras)) return false;
  if (!Array.isArray(value.extras.allowedCards)) return false;
  if (!Array.isArray(value.extras.allowedRelics)) return false;
  if (!isObject(value.extras.baseConfig)) return false;
  if (!isObject(value.extras.orgAdjust)) return false;
  if (value.pendingShopHandIndices !== undefined && !Array.isArray(value.pendingShopHandIndices)) {
    return false;
  }
  if (value.draft !== undefined && value.draft !== null && !Array.isArray(value.draft)) {
    return false;
  }
  if (value.lastGrowth !== undefined && !isNullableObject(value.lastGrowth)) return false;
  if (value.lastResult !== undefined && !isNullableObject(value.lastResult)) return false;
  if (value.shop !== undefined && !isNullableObject(value.shop)) return false;
  if (value.beat !== undefined && !isNullableObject(value.beat)) return false;
  if (value.quarterReview !== undefined && !isNullableObject(value.quarterReview)) return false;
  return true;
}
