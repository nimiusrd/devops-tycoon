/**
 * 永続スナップショットを実際の hydrate 経路へ通して検証する。
 *
 * JSON の構造を型アサーションだけで受け入れると、必須配列が null でも
 * parser を通過してしまう。保存済みデータを変更せず、専用エンジンで
 * hydrate できるかだけを確認する。
 */
import { createRunEngine } from './engine';
import { ACTION_IDS } from '../../data/actionIds';
import { getBoss } from '../../data/bosses';
import { effectiveKind, getEvent } from '../../data/events';
import { allGoalAdjustmentIds } from '../../data/goalAdjustments';
import { getCard } from '../../data/cards';
import { getRelic } from '../../data/relics';
import { getTrait, type TraitId } from '../../data/traits';
import { isDiagnosisType } from '../diagnosis';
import type { RunPersistState, RunReplayFrame } from './persist';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasFiniteNumberFields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  if (!isObject(value)) return false;
  if (
    !required.every(
      (key) => typeof value[key] === 'number' && Number.isFinite(value[key] as number),
    )
  ) {
    return false;
  }
  return optional.every(
    (key) =>
      value[key] === undefined ||
      (typeof value[key] === 'number' && Number.isFinite(value[key] as number)),
  );
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function hasValidCardInstance(value: unknown): boolean {
  if (
    !isObject(value) ||
    typeof value.defId !== 'string' ||
    getCard(value.defId) === undefined ||
    !isSafeInteger(value.level) ||
    value.level < 1
  ) {
    return false;
  }
  const level = value.level;
  if (
    value.baselineAppliedLevel !== undefined &&
    (!isSafeInteger(value.baselineAppliedLevel) ||
      value.baselineAppliedLevel < 0 ||
      value.baselineAppliedLevel > level)
  ) {
    return false;
  }
  if (value.baselineAppliedByTeam !== undefined) {
    if (
      !isObject(value.baselineAppliedByTeam) ||
      !Object.values(value.baselineAppliedByTeam).every(
        (appliedLevel) => isSafeInteger(appliedLevel) && appliedLevel >= 0 && appliedLevel <= level,
      )
    ) {
      return false;
    }
  }
  return true;
}

function hasKnownUniqueRelics(value: unknown): value is string[] {
  if (!isStringArray(value)) return false;
  const seen = new Set<string>();
  return value.every((id) => {
    if (seen.has(id) || getRelic(id) === undefined) return false;
    seen.add(id);
    return true;
  });
}

/** セーブから復元する baseConfig は、シミュレーションを暴走させない範囲に限定する。 */
function hasValidPersistBaseConfig(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (
    !isSafeInteger(value.taskCount) ||
    value.taskCount < 1 ||
    value.taskCount > 1_000 ||
    !isSafeInteger(value.codingSlots) ||
    value.codingSlots < 1 ||
    value.codingSlots > 100 ||
    !isSafeInteger(value.maxTicks) ||
    value.maxTicks < 1 ||
    value.maxTicks > 100_000 ||
    !isSafeInteger(value.focusMax) ||
    value.focusMax < 1 ||
    value.focusMax > 100
  ) {
    return false;
  }
  if (
    value.minCompleteTick !== undefined &&
    (!isSafeInteger(value.minCompleteTick) ||
      value.minCompleteTick < 0 ||
      value.minCompleteTick > value.maxTicks)
  ) {
    return false;
  }
  return (
    value.aiDependencyPerTask === undefined ||
    (typeof value.aiDependencyPerTask === 'number' &&
      Number.isFinite(value.aiDependencyPerTask) &&
      value.aiDependencyPerTask >= 0 &&
      value.aiDependencyPerTask <= 100)
  );
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item))
  );
}

function hasValidInterventionEffect(value: unknown): boolean {
  if (!isObject(value) || !ACTION_IDS.includes(value.actionId as (typeof ACTION_IDS)[number])) {
    return false;
  }
  if (!hasFiniteNumberFields(value, ['focusCost', 'gaugeGain'])) return false;
  if (
    !hasFiniteNumberFields(
      value,
      [],
      ['reviewedCount', 'containedTaskId', 'hpCost', 'moraleCost', 'literacyGain', 'focusRefund'],
    )
  ) {
    return false;
  }
  if (value.affectedTaskIds !== undefined && !isFiniteNumberArray(value.affectedTaskIds)) {
    return false;
  }
  if (value.brokeCombo !== undefined && typeof value.brokeCombo !== 'boolean') return false;
  if (value.modifier !== undefined) {
    if (!isObject(value.modifier)) return false;
    if (
      (value.modifier.kind !== 'andon' &&
        value.modifier.kind !== 'overtime' &&
        value.modifier.kind !== 'stability' &&
        value.modifier.kind !== 'throttle') ||
      !hasFiniteNumberFields(value.modifier, ['untilTick'])
    ) {
      return false;
    }
  }
  return true;
}

function hasValidSprintEvent(value: unknown): boolean {
  if (!isObject(value) || !isSafeInteger(value.tick) || value.tick < 0) return false;
  switch (value.kind) {
    case 'intervention':
      return hasValidInterventionEffect(value.effect) && hasFiniteNumberFields(value, ['combo']);
    case 'combo-break':
      return (
        (value.reason === 'rework' ||
          value.reason === 'auto-contain' ||
          value.reason === 'spread' ||
          value.reason === 'light-firefight') &&
        (value.taskId === undefined || isSafeInteger(value.taskId))
      );
    case 'ignite':
      return (
        isSafeInteger(value.taskId) &&
        value.taskId >= 0 &&
        (value.source === 'review' || value.source === 'spread')
      );
    case 'auto-contain':
      return (
        isSafeInteger(value.taskId) && value.taskId >= 0 && hasFiniteNumberFields(value, ['hpCost'])
      );
    case 'spread':
      return (
        isSafeInteger(value.taskId) &&
        value.taskId >= 0 &&
        (value.spreadToTaskId === undefined || isSafeInteger(value.spreadToTaskId))
      );
    case 'contain':
      return (
        isSafeInteger(value.taskId) &&
        value.taskId >= 0 &&
        hasFiniteNumberFields(value, ['combo']) &&
        (value.brokeCombo === undefined || typeof value.brokeCombo === 'boolean')
      );
    default:
      return false;
  }
}

function hasValidTimelineSample(value: unknown): boolean {
  return (
    isObject(value) &&
    hasFiniteNumberFields(value, ['tick', 'reviewQueue', 'burningCount', 'combo', 'seniorHp'])
  );
}

function hasValidGrowth(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (
    !Array.isArray(value.promotions) ||
    !value.promotions.every(
      (promotion) =>
        isObject(promotion) &&
        typeof promotion.id === 'string' &&
        typeof promotion.name === 'string' &&
        (promotion.to === 'junior' || promotion.to === 'middle' || promotion.to === 'senior'),
    )
  ) {
    return false;
  }
  if (!isStringArray(value.leveledUp) || !Array.isArray(value.wentOnLeave)) return false;
  if (
    !value.wentOnLeave.every(
      (member) =>
        isObject(member) && typeof member.id === 'string' && typeof member.name === 'string',
    )
  ) {
    return false;
  }
  return hasFiniteNumberFields(value, ['docGain']);
}

const QUARTER_OUTCOMES = new Set<unknown>([
  'exceeded',
  'met',
  'missed_adjustable',
  'missed_crisis',
  'reorg_required',
  'shutdown',
]);
const GOAL_ADJUSTMENT_IDS = new Set<unknown>(allGoalAdjustmentIds());
const RANKING_KINDS = new Set<unknown>(['overall', 'healthy', 'ai', 'growth']);
const TEAM_HEALTHES = new Set<unknown>(['healthy', 'congested', 'reviewHell']);

function hasValidKpiProgress(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    hasFiniteNumberFields(value, ['target', 'actual']) &&
    (value.status === 'exceeded' || value.status === 'met' || value.status === 'missed')
  );
}

function hasValidTrendHistory(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => {
    if (
      !isObject(entry) ||
      !isSafeInteger(entry.quarterNumber) ||
      entry.quarterNumber < 1 ||
      !isDiagnosisType(entry.diagnosis) ||
      !Array.isArray(entry.kpis) ||
      !entry.kpis.every(hasValidKpiProgress) ||
      !isObject(entry.company) ||
      !hasFiniteNumberFields(entry.company, [
        'shipping',
        'aiDependency',
        'techDebt',
        'morale',
        'onFire',
        'selfRank',
      ]) ||
      typeof entry.company.healthRank !== 'string' ||
      !Array.isArray(entry.departments)
    ) {
      return false;
    }
    if (
      entry.company.selfRanks !== undefined &&
      (!isObject(entry.company.selfRanks) ||
        !Object.entries(entry.company.selfRanks).every(
          ([kind, rank]) =>
            RANKING_KINDS.has(kind) && typeof rank === 'number' && Number.isFinite(rank),
        ))
    ) {
      return false;
    }
    return entry.departments.every(
      (department) =>
        isObject(department) &&
        typeof department.deptId === 'string' &&
        hasFiniteNumberFields(department, ['aiDependency', 'techDebt', 'morale']) &&
        TEAM_HEALTHES.has(department.health),
    );
  });
}

function hasValidRoster(value: unknown): boolean {
  if (!isObject(value) || !Array.isArray(value.members) || !isSafeInteger(value.nextId)) {
    return false;
  }
  if (value.nextId < 0) return false;
  const ids = new Set<string>();
  return value.members.every((member) => {
    if (!isObject(member) || typeof member.id !== 'string' || ids.has(member.id)) return false;
    ids.add(member.id);
    if (
      typeof member.name !== 'string' ||
      (member.rank !== 'junior' && member.rank !== 'middle' && member.rank !== 'senior') ||
      !isSafeInteger(member.level) ||
      member.level < 1 ||
      !hasFiniteNumberFields(member, ['xp', 'stamina', 'staminaMax']) ||
      !isObject(member.stats) ||
      !hasFiniteNumberFields(member.stats, ['implementation', 'review', 'aiMastery']) ||
      !isStringArray(member.traits) ||
      !member.traits.every((trait) => getTrait(trait as TraitId) !== undefined) ||
      (member.assignment !== 'coding' &&
        member.assignment !== 'review' &&
        member.assignment !== 'bench') ||
      typeof member.aiAssigned !== 'boolean' ||
      typeof member.onLeave !== 'boolean'
    ) {
      return false;
    }
    return new Set(member.traits).size === member.traits.length;
  });
}

function hasValidLegacyRoster(value: unknown): boolean {
  if (!isObject(value) || !Array.isArray(value.members)) return false;
  const ids = new Set<string>();
  return value.members.every((member) => {
    if (!isObject(member) || typeof member.id !== 'string' || ids.has(member.id)) return false;
    ids.add(member.id);
    return (
      typeof member.name === 'string' &&
      (member.assignment === 'coding' ||
        member.assignment === 'review' ||
        member.assignment === 'bench') &&
      typeof member.onLeave === 'boolean' &&
      hasFiniteNumberFields(member, ['stamina', 'staminaMax'])
    );
  });
}

function hasValidQuarterReview(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (!QUARTER_OUTCOMES.has(value.outcome)) return false;
  if (
    !hasFiniteNumberFields(
      value.goal,
      ['deliveryTarget', 'qualityTarget', 'techDebtLimit', 'moraleTarget', 'incidentLimit'],
      ['aiAdoptionTarget'],
    ) ||
    !hasFiniteNumberFields(value.trust, ['management', 'customers', 'team']) ||
    typeof value.bossCleared !== 'boolean' ||
    !Array.isArray(value.missedReasons) ||
    !value.missedReasons.every((reason) => typeof reason === 'string') ||
    !Array.isArray(value.availableAdjustments) ||
    !value.availableAdjustments.every((id) => GOAL_ADJUSTMENT_IDS.has(id)) ||
    !Array.isArray(value.progress)
  ) {
    return false;
  }
  return value.progress.every(hasValidKpiProgress);
}

/** 旧リプレイは未知のコンテンツ ID を許容しつつ、表示に必要な形だけ確認する。 */
function hasValidLegacyQuarterReview(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (
    typeof value.outcome !== 'string' ||
    !hasFiniteNumberFields(
      value.goal,
      ['deliveryTarget', 'qualityTarget', 'techDebtLimit', 'moraleTarget', 'incidentLimit'],
      ['aiAdoptionTarget'],
    ) ||
    !hasFiniteNumberFields(value.trust, ['management', 'customers', 'team']) ||
    typeof value.bossCleared !== 'boolean' ||
    !Array.isArray(value.missedReasons) ||
    !value.missedReasons.every((reason) => typeof reason === 'string') ||
    !isStringArray(value.availableAdjustments) ||
    !Array.isArray(value.progress) ||
    !value.progress.every(hasValidKpiProgress)
  ) {
    return false;
  }
  return QUARTER_OUTCOMES.has(value.outcome);
}

function hasValidBeat(value: unknown): boolean {
  if (!isObject(value) || typeof value.eventId !== 'string') return false;
  if (value.kind !== 'judgment' && value.kind !== 'decision') return false;
  const event = getEvent(value.eventId);
  return event !== undefined && effectiveKind(event) === value.kind;
}

function hasValidShopOffer(value: unknown): boolean {
  if (!isObject(value) || !Array.isArray(value.cards)) return false;
  if (
    !value.cards.every(
      (card) =>
        isObject(card) &&
        typeof card.defId === 'string' &&
        getCard(card.defId) !== undefined &&
        hasFiniteNumberFields(card, ['cost']) &&
        typeof card.bought === 'boolean',
    )
  ) {
    return false;
  }
  if (value.relic !== undefined) {
    if (
      !isObject(value.relic) ||
      typeof value.relic.id !== 'string' ||
      getRelic(value.relic.id) === undefined ||
      !hasFiniteNumberFields(value.relic, ['cost']) ||
      typeof value.relic.bought !== 'boolean'
    ) {
      return false;
    }
  }
  if (value.recruit !== undefined) {
    if (!isObject(value.recruit)) return false;
    if (
      !hasFiniteNumberFields(value.recruit, ['cost']) ||
      typeof value.recruit.bought !== 'boolean'
    ) {
      return false;
    }
  }
  return value.introSupportGranted === undefined || typeof value.introSupportGranted === 'boolean';
}

/** エンジンが計算に使う永続数値を、hydrate 前に文字列や非有限値から守る。 */
function hasValidPersistNumbers(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (
    !hasFiniteNumberFields(value, [
      'sprintsPerQuarter',
      'sprintIndexInQuarter',
      'sprintsPlayed',
      'quarterNumber',
      'budget',
    ])
  ) {
    return false;
  }
  if (
    !hasFiniteNumberFields(
      value.org,
      [
        'aiDependency',
        'aiLiteracy',
        'testCoverage',
        'documentation',
        'quality',
        'morale',
        'seniorHp',
        'techDebt',
        'deliveryScore',
      ],
      ['securityLevel'],
    )
  ) {
    return false;
  }
  if (!hasFiniteNumberFields(value.evolution, ['points'])) return false;
  if (
    !hasFiniteNumberFields(
      value.totals,
      [
        'delivered',
        'done',
        'rework',
        'incidents',
        'contained',
        'spread',
        'aiAssisted',
        'completed',
        'reviewQueuePeak',
        'maxCombo',
      ],
      ['consecutiveIncidentSprints'],
    )
  ) {
    return false;
  }
  if (
    !hasFiniteNumberFields(
      value.quarterTotals,
      [
        'delivered',
        'done',
        'rework',
        'incidents',
        'contained',
        'spread',
        'aiAssisted',
        'completed',
        'reviewQueuePeak',
        'maxCombo',
      ],
      ['consecutiveIncidentSprints'],
    )
  ) {
    return false;
  }
  if (
    !hasFiniteNumberFields(
      value.quarterGoal,
      ['deliveryTarget', 'qualityTarget', 'techDebtLimit', 'moraleTarget', 'incidentLimit'],
      ['aiAdoptionTarget'],
    )
  ) {
    return false;
  }
  return hasFiniteNumberFields(value.stakeholderTrust, ['management', 'customers', 'team']);
}

function hasRequiredPersistResult(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (
    !hasFiniteNumberFields(value, [
      'done',
      'delivered',
      'maxCombo',
      'aiAssistedPct',
      'reviewQueueMax',
      'rework',
      'incidents',
      'contained',
      'spread',
      'seniorHpDelta',
      'focusRemaining',
      'focusMax',
      'autoContainCount',
    ])
  ) {
    return false;
  }
  if (
    typeof value.grade !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.diagnosis !== 'string' ||
    !isObject(value.actionCounts) ||
    !Object.entries(value.actionCounts).every(
      ([actionId, count]) =>
        ACTION_IDS.includes(actionId as (typeof ACTION_IDS)[number]) &&
        typeof count === 'number' &&
        Number.isFinite(count),
    ) ||
    !Array.isArray(value.timeline) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.fireEvents) ||
    !value.timeline.every(hasValidTimelineSample) ||
    !value.events.every(hasValidSprintEvent) ||
    !value.fireEvents.every(
      (event) =>
        hasValidSprintEvent(event) &&
        isObject(event) &&
        (event.kind === 'ignite' ||
          event.kind === 'contain' ||
          event.kind === 'auto-contain' ||
          event.kind === 'spread'),
    )
  ) {
    return false;
  }
  if (value.timedOut !== undefined && typeof value.timedOut !== 'boolean') return false;
  if (
    value.baseline !== undefined &&
    !hasFiniteNumberFields(value.baseline, ['delivered', 'spread', 'maxCombo'])
  ) {
    return false;
  }
  return true;
}

function hasValidPersistStructures(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (typeof value.bossId !== 'string' || getBoss(value.bossId) === undefined) return false;
  if (!hasValidTrendHistory(value.trendHistory)) return false;
  if (!hasValidRoster(value.roster)) return false;
  if (value.lastGrowth !== null && !hasValidGrowth(value.lastGrowth)) return false;
  if (value.lastResult !== null && !hasRequiredPersistResult(value.lastResult)) return false;
  if (value.quarterReview !== null && !hasValidQuarterReview(value.quarterReview)) return false;
  if (value.beat !== null && !hasValidBeat(value.beat)) return false;
  if (value.shop !== null && !hasValidShopOffer(value.shop)) return false;
  if (!Array.isArray(value.deck) || !value.deck.every(hasValidCardInstance)) return false;
  if (!hasKnownUniqueRelics(value.relics)) return false;
  if (value.draft !== null && !isStringArray(value.draft)) return false;
  if (!isFiniteNumberArray(value.pendingShopHandIndices)) return false;
  if (
    !isObject(value.evolution) ||
    !hasFiniteNumberFields(value.evolution, ['points']) ||
    !isObject(value.evolution.unlocked) ||
    !Object.values(value.evolution.unlocked).every((unlocked) => unlocked === true)
  ) {
    return false;
  }
  if (!isObject(value.extras)) return false;
  if (!isStringArray(value.extras.allowedCards) || !isStringArray(value.extras.allowedRelics)) {
    return false;
  }
  if (!hasValidPersistBaseConfig(value.extras.baseConfig)) return false;
  if (value.extras.teamRosters !== undefined) {
    if (
      !isObject(value.extras.teamRosters) ||
      !Object.values(value.extras.teamRosters).every(hasValidRoster)
    ) {
      return false;
    }
  }
  return true;
}

/** 旧リプレイのread-only互換性を保ちながら、表示に必要な形だけを検証する。 */
export function canReadLegacyReplayFrame(frame: RunReplayFrame): boolean {
  try {
    if (!isObject(frame) || !hasValidLegacyRoster(frame.roster)) return false;
    if (
      frame.bossId !== undefined &&
      (typeof frame.bossId !== 'string' || getBoss(frame.bossId) === undefined)
    ) {
      return false;
    }
    if (frame.trendHistory !== undefined && !hasValidTrendHistory(frame.trendHistory)) {
      return false;
    }
    if (frame.phase === 'quarterReview' && !hasValidLegacyQuarterReview(frame.quarterReview)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** フェーズ画面が要求する保存済みデータの存在を検証する。 */
export function hasRequiredPersistPhaseState(
  state: Pick<
    RunPersistState | RunReplayFrame,
    'phase' | 'lastResult' | 'draft' | 'beat' | 'shop' | 'quarterReview'
  >,
): boolean {
  switch (state.phase) {
    case 'result':
      return hasRequiredPersistResult(state.lastResult);
    case 'draft':
      return isStringArray(state.draft);
    case 'beat':
      return isObject(state.beat);
    case 'shop':
      return isObject(state.shop);
    case 'quarterReview':
      return isObject(state.quarterReview);
    default:
      return true;
  }
}

export function canHydratePersistState(state: RunPersistState): boolean {
  try {
    if (!hasRequiredPersistPhaseState(state)) return false;
    if (!hasValidPersistStructures(state)) return false;
    if (!hasValidPersistNumbers(state)) return false;
    const engine = createRunEngine({
      seed: state.seed,
      difficulty: state.difficulty,
      trials: state.trials,
    });
    engine.hydratePersistState(state);
    engine.snapshot();
    return true;
  } catch {
    return false;
  }
}

export function canHydrateReplayFrame(frame: RunReplayFrame): boolean {
  try {
    if (!hasRequiredPersistPhaseState(frame)) return false;
    if (!hasValidPersistStructures(frame)) return false;
    if (!hasValidPersistNumbers(frame)) return false;
    const engine = createRunEngine({
      seed: frame.seed,
      difficulty: frame.difficulty,
      trials: frame.trials,
    });
    engine.hydrateReplayFrame(frame);
    engine.snapshot();
    return true;
  } catch {
    return false;
  }
}
