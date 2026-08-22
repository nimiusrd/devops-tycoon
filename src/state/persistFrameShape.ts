/**
 * 途中セーブ／リプレイ共有用の入れ子構造検査。
 *
 * hydrate は必須オブジェクトを代入するだけなので、roster や member.stats を null にしても例外にならない。
 * 画面が members / stats / traits 等を参照する前に、外部 JSON の形を拒否する。
 */
import { effectiveKind, getEvent } from '../data/events';
import { isDiagnosisType } from '../sim/diagnosis';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
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
  if (value.extras.teamRosters !== undefined) {
    if (!isObject(value.extras.teamRosters)) return false;
    if (!Object.values(value.extras.teamRosters).every(isRosterShape)) return false;
  }
  if (value.pendingShopHandIndices !== undefined && !Array.isArray(value.pendingShopHandIndices)) {
    return false;
  }
  if (value.draft !== undefined && value.draft !== null && !isStringArray(value.draft)) {
    return false;
  }
  if (value.phase === 'draft' && !isStringArray(value.draft)) return false;
  if (
    value.lastGrowth !== undefined &&
    value.lastGrowth !== null &&
    !isGrowthOutcomeShape(value.lastGrowth)
  ) {
    return false;
  }
  if (
    value.lastResult !== undefined &&
    value.lastResult !== null &&
    !isSprintResultShape(value.lastResult)
  ) {
    return false;
  }
  if (value.phase === 'result' && !isSprintResultShape(value.lastResult)) return false;
  if (value.shop !== undefined && value.shop !== null && !isShopShape(value.shop)) return false;
  if (value.phase === 'shop' && !isShopShape(value.shop)) return false;
  if (value.beat !== undefined && value.beat !== null && !isBeatShape(value.beat)) return false;
  if (value.phase === 'beat' && !isBeatShape(value.beat)) return false;
  if (
    value.quarterReview !== undefined &&
    value.quarterReview !== null &&
    !isQuarterReviewShape(value.quarterReview)
  ) {
    return false;
  }
  if (value.phase === 'quarterReview' && !isQuarterReviewShape(value.quarterReview)) return false;
  if (value.trendHistory !== undefined) {
    if (
      !Array.isArray(value.trendHistory) ||
      !value.trendHistory.every(isQuarterTrendSnapshotShape)
    ) {
      return false;
    }
  }
  return true;
}

const QUARTER_OUTCOMES = new Set([
  'exceeded',
  'met',
  'missed_adjustable',
  'missed_crisis',
  'reorg_required',
  'shutdown',
]);

function isQuarterGoalShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.deliveryTarget === 'number' &&
    typeof value.qualityTarget === 'number' &&
    typeof value.techDebtLimit === 'number' &&
    typeof value.moraleTarget === 'number' &&
    typeof value.incidentLimit === 'number'
  );
}

function isStakeholderTrustShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.management === 'number' &&
    typeof value.customers === 'number' &&
    typeof value.team === 'number'
  );
}

function isGoalKpiProgressShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    typeof value.target === 'number' &&
    typeof value.actual === 'number' &&
    (value.status === 'exceeded' || value.status === 'met' || value.status === 'missed')
  );
}

/** QuarterReviewScreen が outcome / goal / progress を参照する前に拒否する。 */
function isQuarterReviewShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!QUARTER_OUTCOMES.has(String(value.outcome))) return false;
  if (!isQuarterGoalShape(value.goal) || !isStakeholderTrustShape(value.trust)) return false;
  if (!Array.isArray(value.progress) || !value.progress.every(isGoalKpiProgressShape)) return false;
  if (
    !Array.isArray(value.missedReasons) ||
    !value.missedReasons.every((r) => typeof r === 'string')
  ) {
    return false;
  }
  if (
    !Array.isArray(value.availableAdjustments) ||
    !value.availableAdjustments.every((id) => typeof id === 'string')
  ) {
    return false;
  }
  return typeof value.bossCleared === 'boolean';
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

function isSprintResultShape(value: unknown): boolean {
  if (!isObject(value) || !isObject(value.actionCounts)) return false;
  if (!Array.isArray(value.timeline) || !Array.isArray(value.events)) return false;
  if (!Array.isArray(value.fireEvents)) return false;
  if (typeof value.grade !== 'string' || typeof value.title !== 'string') return false;
  if (typeof value.diagnosis !== 'string') return false;
  return (
    typeof value.done === 'number' &&
    typeof value.delivered === 'number' &&
    typeof value.maxCombo === 'number' &&
    typeof value.aiAssistedPct === 'number' &&
    typeof value.reviewQueueMax === 'number' &&
    typeof value.rework === 'number' &&
    typeof value.incidents === 'number' &&
    typeof value.contained === 'number' &&
    typeof value.spread === 'number' &&
    typeof value.seniorHpDelta === 'number' &&
    typeof value.focusRemaining === 'number' &&
    typeof value.focusMax === 'number' &&
    typeof value.autoContainCount === 'number'
  );
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

/** SprintResultScreen が promotions / wentOnLeave / leveledUp を参照する前に拒否する。 */
function isGrowthOutcomeShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!Array.isArray(value.promotions) || !value.promotions.every(isGrowthPromotionShape)) {
    return false;
  }
  if (!isStringArray(value.leveledUp)) return false;
  if (!Array.isArray(value.wentOnLeave) || !value.wentOnLeave.every(isGrowthLeaveShape)) {
    return false;
  }
  return typeof value.docGain === 'number';
}

function isGrowthPromotionShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.to === 'junior' || value.to === 'middle' || value.to === 'senior')
  );
}

function isGrowthLeaveShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return typeof value.id === 'string' && typeof value.name === 'string';
}

/** BeatScreen が getEvent(eventId) する前に、既知イベントと種別を拒否する。 */
function isBeatShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.kind !== 'judgment' && value.kind !== 'decision') return false;
  if (typeof value.eventId !== 'string') return false;
  const def = getEvent(value.eventId);
  return !!def && effectiveKind(def) === value.kind;
}

function isTeamHealth(value: unknown): boolean {
  return value === 'healthy' || value === 'congested' || value === 'reviewHell';
}

function isQuarterTrendDeptShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  return (
    typeof value.deptId === 'string' &&
    typeof value.aiDependency === 'number' &&
    typeof value.techDebt === 'number' &&
    typeof value.morale === 'number' &&
    isTeamHealth(value.health)
  );
}

function isQuarterTrendCompanyShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (
    typeof value.shipping !== 'number' ||
    typeof value.aiDependency !== 'number' ||
    typeof value.techDebt !== 'number' ||
    typeof value.morale !== 'number' ||
    typeof value.onFire !== 'number' ||
    typeof value.healthRank !== 'string' ||
    typeof value.selfRank !== 'number'
  ) {
    return false;
  }
  if (value.selfRanks !== undefined) {
    if (!isObject(value.selfRanks)) return false;
    if (!Object.values(value.selfRanks).every((rank) => typeof rank === 'number')) return false;
  }
  return true;
}

/** OrgTrendHistory が quarterNumber / kpis を参照する前に拒否する。 */
function isQuarterTrendSnapshotShape(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (typeof value.quarterNumber !== 'number' || !isDiagnosisType(value.diagnosis)) return false;
  if (!Array.isArray(value.kpis) || !value.kpis.every(isGoalKpiProgressShape)) return false;
  if (!isQuarterTrendCompanyShape(value.company)) return false;
  return Array.isArray(value.departments) && value.departments.every(isQuarterTrendDeptShape);
}
