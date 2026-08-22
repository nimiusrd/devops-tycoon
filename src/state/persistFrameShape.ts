/**
 * 途中セーブ／リプレイ共有用の入れ子構造検査。
 *
 * hydrate は必須オブジェクトを代入するだけなので、roster や member.stats を null にしても例外にならない。
 * 画面が members / stats / traits 等を参照する前に、外部 JSON の形を拒否する。
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
  if (!isRosterShape(value.roster)) return false;
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
  if (value.shop !== undefined && value.shop !== null && !isShopShape(value.shop)) return false;
  if (value.phase === 'shop' && !isShopShape(value.shop)) return false;
  if (value.beat !== undefined && !isNullableObject(value.beat)) return false;
  if (value.quarterReview !== undefined && !isNullableObject(value.quarterReview)) return false;
  return true;
}

function isShopCardOfferShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.defId === 'string' &&
    typeof value.cost === 'number' &&
    typeof value.bought === 'boolean'
  );
}

function isShopRelicShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.cost === 'number' &&
    typeof value.bought === 'boolean'
  );
}

function isShopRecruitShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return typeof value.cost === 'number' && typeof value.bought === 'boolean';
}

/** ShopScreen が cards.map する前に、陳列の形を拒否する。 */
function isShopShape(value: unknown): boolean {
  if (!isObject(value) || !Array.isArray(value.cards) || !value.cards.every(isShopCardOfferShape)) {
    return false;
  }
  if (value.relic !== undefined && !isShopRelicShape(value.relic)) return false;
  if (value.recruit !== undefined && !isShopRecruitShape(value.recruit)) return false;
  return value.introSupportGranted === undefined || typeof value.introSupportGranted === 'boolean';
}

function isRosterShape(value: unknown): boolean {
  if (!isObject(value) || !Array.isArray(value.members) || typeof value.nextId !== 'number') {
    return false;
  }
  return value.members.every(isMemberShape);
}

function isMemberStatsShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.implementation === 'number' &&
    typeof value.review === 'number' &&
    typeof value.aiMastery === 'number'
  );
}

function isMemberShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return false;
  if (value.rank !== 'junior' && value.rank !== 'middle' && value.rank !== 'senior') return false;
  if (typeof value.level !== 'number' || typeof value.xp !== 'number') return false;
  if (typeof value.stamina !== 'number' || typeof value.staminaMax !== 'number') return false;
  if (typeof value.onLeave !== 'boolean' || typeof value.aiAssigned !== 'boolean') return false;
  if (
    value.assignment !== 'coding' &&
    value.assignment !== 'review' &&
    value.assignment !== 'bench'
  ) {
    return false;
  }
  if (!isMemberStatsShape(value.stats)) return false;
  return Array.isArray(value.traits) && value.traits.every((trait) => typeof trait === 'string');
}
