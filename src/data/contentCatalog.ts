/**
 * 実行結果に影響するコンテンツ定義の生成カタログ（RI-115）。
 *
 * ここでは既存の定義を複製せず、実行系が読む項目だけを射影する。表示名・説明・
 * 色・アイコンなどの表示メタデータは含めない。バランスレジストリも別の入力であり、
 * このカタログへ数値を再コピーしない。
 */
import { ACHIEVEMENT_DEFS, ACHIEVEMENT_IDS } from './achievements';
import {
  ACTION_CONTENT_DEFS,
  STABILITY_FLAG_IGNORED_ACTION_IDS,
  type ActionContentDef,
} from './actions';
import { CARD_DEFS, RARITY_WEIGHT } from './cards';
import { BOSS_DEFS, type BossDef } from './bosses';
import { DEPARTMENT_DEFS } from './departments';
import { compareCanonicalStrings } from './balance/canonical';
import { PROCESS_BALANCE } from './balance/process';
import {
  DAILY_RUN_DIFFICULTY,
  DAILY_RUN_TRIALS,
  DIFFICULTY_DEFS,
  DIFFICULTY_ORDER,
  TRIAL_DEFS,
} from './difficulties';
import { EVOLUTION_NODES } from './evolution';
import { EVENT_DEFS, effectiveKind, type EventDef, type EventOutcome } from './events';
import {
  GOAL_ADJUSTMENT_DEFS,
  PAUSE_AI_DEBUFF_MUL,
  type GoalAdjustmentDef,
} from './goalAdjustments';
import { LEVER_DEFS } from './levers';
import {
  MEMBER_NAMES,
  RECRUIT_ARCHETYPES,
  STARTER_ARCHETYPES,
  STARTER_DEFAULT_AI_ARCHETYPE_ID,
} from './members';
import { RELIC_DEFS, type RelicDef } from './relics';
import { DEFAULT_SCENARIO, SCENARIOS } from '../sim/scenarios';
import { IDENTITY_TRAIT_MODIFIERS, TRAIT_DEFS } from './traits';
import { UNLOCK_DEFS } from './unlocks';
import { IDENTITY_CARD_EFFECTS } from '../sim/model';
import type { DepartmentDef, LeverDef } from '../sim/orgscale/types';

/** カタログの 1 行。`execution` は表示メタデータを含まない射影。 */
export interface ContentCatalogEntry {
  id: string;
  order: number;
  execution: unknown;
}

export interface ContentCatalog {
  rarityWeights: Readonly<Record<string, number>>;
  cards: readonly ContentCatalogEntry[];
  events: readonly ContentCatalogEntry[];
  difficulties: readonly ContentCatalogEntry[];
  trials: readonly ContentCatalogEntry[];
  bosses: readonly ContentCatalogEntry[];
  relics: readonly ContentCatalogEntry[];
  traits: readonly ContentCatalogEntry[];
  evolution: readonly ContentCatalogEntry[];
  goalAdjustments: readonly ContentCatalogEntry[];
  levers: readonly ContentCatalogEntry[];
  members: {
    /** 表示名ではなく、createTeamRoster の抽選・重複回避に使う実行入力。 */
    namePool: readonly string[];
    /** 初期ロスターで AI 配布対象にするスターターアーキタイプ ID。 */
    defaultAiArchetypeId: string;
    starter: readonly ContentCatalogEntry[];
    recruit: readonly ContentCatalogEntry[];
  };
  unlocks: readonly ContentCatalogEntry[];
  departments: readonly ContentCatalogEntry[];
  actions: readonly ContentCatalogEntry[];
  startingScenarios: readonly ContentCatalogEntry[];
  achievements: readonly ContentCatalogEntry[];
  difficultyOrder: readonly string[];
  defaultScenarioId: string;
  daily: {
    readonly difficulty: string;
    readonly trials: readonly string[];
  };
}

export interface ContentCatalogValidationError {
  category: string;
  message: string;
}

function definedObject(value: object | undefined): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function omitIdentity(value: object | undefined, identity: object): Record<string, unknown> {
  const identityRecord = identity as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(definedObject(value)).filter(([key, item]) => identityRecord[key] !== item),
  );
}

function omitSignalFactors(value: object | undefined, identity: number): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(definedObject(value)).filter(([, item]) => item !== identity),
  );
}

const ADDITIVE_PASSIVE_IDENTITY = {
  moraleDamageMul: 1,
  restHealBonus: 0,
  shopDiscount: 0,
} as const;

const OUTCOME_IDENTITY: Record<string, unknown> = {
  delivered: 0,
  morale: 0,
  seniorHp: 0,
  techDebt: 0,
  budget: 0,
  quality: 0,
  testCoverage: 0,
  aiLiteracy: 0,
  aiDependency: 0,
  grantRecruit: false,
  preserveAboveLose: false,
};

const TRUST_IDENTITY: Record<string, unknown> = {
  management: 0,
  customers: 0,
  team: 0,
};

const NEXT_SPRINT_IDENTITY: Record<string, unknown> = {
  reviewLoadAdd: 0,
  reworkRateAdd: 0,
  taskCountMul: 1,
  focusMaxAdd: 0,
};

function omitEmpty(value: Record<string, unknown>): Record<string, unknown> | undefined {
  return Object.keys(value).length === 0 ? undefined : value;
}

function projectOutcome(outcome: EventOutcome): Record<string, unknown> {
  const projected = omitIdentity(outcome, OUTCOME_IDENTITY);
  delete projected.trust;
  delete projected.nextSprint;
  delete projected.onRecruitFail;

  const trust = omitEmpty(omitIdentity(outcome.trust, TRUST_IDENTITY));
  if (trust) projected.trust = trust;

  const nextSprint = omitEmpty(omitIdentity(outcome.nextSprint, NEXT_SPRINT_IDENTITY));
  if (nextSprint) projected.nextSprint = nextSprint;

  if (outcome.grantRecruit && outcome.onRecruitFail) {
    const nested = projectRecruitFailOutcome(outcome.onRecruitFail);
    if (Object.keys(nested).length > 0) projected.onRecruitFail = nested;
  }
  return projected;
}

function projectRecruitFailOutcome(outcome: EventOutcome): Record<string, unknown> {
  const projected = projectOutcome(outcome);
  delete projected.grantCard;
  delete projected.grantRelic;
  delete projected.nextSprint;
  delete projected.grantRecruit;
  delete projected.onRecruitFail;
  return projected;
}

function ordered<T extends { id: string }>(
  definitions: readonly T[],
  project: (definition: T) => unknown,
): readonly ContentCatalogEntry[] {
  return definitions.map((definition, order) => ({
    id: definition.id,
    order,
    execution: project(definition),
  }));
}

function orderedById<T extends { id: string }>(
  definitions: readonly T[],
  project: (definition: T) => unknown,
): readonly ContentCatalogEntry[] {
  return ordered(
    [...definitions].sort((left, right) => compareCanonicalStrings(left.id, right.id)),
    project,
  );
}

export function projectEvent(definition: EventDef): unknown {
  return {
    kind: effectiveKind(definition),
    weight: definition.weight ?? 1,
    triggers: omitSignalFactors(definition.triggers, 0),
    minSignal: omitSignalFactors(definition.minSignal, 0),
    maxSignal: omitSignalFactors(definition.maxSignal, 1),
    choices: definition.choices.map((choice) => ({
      outcome: projectOutcome(choice.outcome),
      leadsTo: choice.leadsTo ?? 'sprint',
    })),
  };
}

export function projectDepartment(definition: DepartmentDef): unknown {
  return { teamCount: definition.teamCount };
}

export function projectAction(definition: ActionContentDef): unknown {
  return {
    stabilizesFlow: STABILITY_FLAG_IGNORED_ACTION_IDS.has(definition.id)
      ? false
      : (definition.stabilizesFlow ?? false),
  };
}

export function projectRelic(definition: RelicDef): unknown {
  return {
    effects: omitIdentity(definition.effects, IDENTITY_CARD_EFFECTS),
    passives: omitIdentity(definition.passives, ADDITIVE_PASSIVE_IDENTITY),
  };
}

const GOAL_EFFECTS_IDENTITY: Record<string, unknown> = {
  deliveryMul: 1,
  deliveryAdd: 0,
  qualityAdd: 0,
  moraleAdd: 0,
  techDebtLimitAdd: 0,
  incidentLimitAdd: 0,
  aiAdoptionAdd: 0,
};

const ORG_EFFECTS_IDENTITY: Record<string, unknown> = {
  deliveryScoreMul: 1,
  techDebtDelta: 0,
  moraleDelta: 0,
  seniorHpDelta: 0,
  qualityDelta: 0,
};

const NEXT_QUARTER_IDENTITY: Record<string, unknown> = {
  ...IDENTITY_CARD_EFFECTS,
  techDebtDelta: 0,
  seniorHpDelta: 0,
};

function assignProjected(
  target: Record<string, unknown>,
  key: string,
  value: Record<string, unknown> | undefined,
): void {
  if (value) target[key] = value;
}

export function projectGoalAdjustment(definition: GoalAdjustmentDef): unknown {
  const projected: Record<string, unknown> = {
    reorgReset: definition.reorgReset ?? false,
    nextBudgetCapDelta: definition.nextBudgetCapDelta ?? null,
  };
  if (definition.pauseAiDebuff) {
    projected.pauseAiDebuff = true;
    projected.pauseAiDebuffMul = PAUSE_AI_DEBUFF_MUL;
  } else {
    projected.pauseAiDebuff = false;
  }
  if (definition.budgetDelta !== 0) projected.budgetDelta = definition.budgetDelta;
  assignProjected(
    projected,
    'trustDelta',
    omitEmpty(omitIdentity(definition.trustDelta, TRUST_IDENTITY)),
  );
  assignProjected(
    projected,
    'goalEffects',
    omitEmpty(omitIdentity(definition.goalEffects, GOAL_EFFECTS_IDENTITY)),
  );
  assignProjected(
    projected,
    'orgEffects',
    omitEmpty(omitIdentity(definition.orgEffects, ORG_EFFECTS_IDENTITY)),
  );
  assignProjected(
    projected,
    'nextQuarterEffects',
    omitEmpty(omitIdentity(definition.nextQuarterEffects, NEXT_QUARTER_IDENTITY)),
  );
  return projected;
}

function achievementConditionKey(id: string): string {
  const found = (Object.entries(ACHIEVEMENT_IDS) as [string, string][]).find(
    ([, value]) => value === id,
  );
  if (!found) {
    throw new Error(`実績 ID に対応する条件キーがありません: ${id}`);
  }
  return found[0];
}

const ORG_ADJUST_IDENTITY: Record<string, unknown> = {
  aiDependencyDelta: 0,
  reviewQueueDelta: 0,
  incidentDelta: 0,
  moraleDelta: 0,
  techDebtDelta: 0,
  extraTeams: 0,
  infraBoost: 0,
};

const SCENARIO_ORG_DELTA_IDENTITY: Record<string, unknown> = {
  aiDependencyBase: 0,
  aiLiteracy: 0,
  testCoverage: 0,
  documentation: 0,
  quality: 0,
  securityLevel: 0,
  morale: 0,
  seniorHp: 0,
};

const BOSS_CLEAR_MIN_IDENTITY: Record<string, unknown> = {
  minSprintDelivered: 0,
  minAiPct: 0,
  minMorale: 0,
  minQuality: 0,
};

export function projectLever(definition: LeverDef): unknown {
  return {
    scope: definition.scope,
    cost: definition.cost,
    effect: omitIdentity(definition.effect, ORG_ADJUST_IDENTITY),
  };
}

export function projectBoss(definition: BossDef): unknown {
  return {
    taskCountMul: definition.taskCountMul,
    incidentMul: definition.incidentMul,
    clear: omitIdentity(definition.clear, BOSS_CLEAR_MIN_IDENTITY),
  };
}

export function projectScenarioOrgDelta(delta: object | undefined): Record<string, unknown> {
  return omitIdentity(delta, SCENARIO_ORG_DELTA_IDENTITY);
}

const difficultyDefinitions = Object.values(DIFFICULTY_DEFS);

export const CONTENT_CATALOG: ContentCatalog = {
  rarityWeights: { ...RARITY_WEIGHT },
  cards: ordered(CARD_DEFS, (definition) => ({
    rarity: definition.rarity,
    cost: definition.cost,
    focusCost: definition.focusCost,
    base: omitIdentity(definition.base, IDENTITY_CARD_EFFECTS),
  })),
  events: ordered(EVENT_DEFS, projectEvent),
  difficulties: orderedById(difficultyDefinitions, (definition) => ({
    org: definedObject(definition.org),
    taskCountMul: definition.taskCountMul,
    globalEffects: omitIdentity(definition.globalEffects, IDENTITY_CARD_EFFECTS),
    startBudget: definition.startBudget,
    bossTargetMul: definition.bossTargetMul,
    aiDependencyPerTask:
      definition.aiDependencyPerTask ?? PROCESS_BALANCE.aiDependencyPerTask.value,
  })),
  trials: orderedById(TRIAL_DEFS, (definition) => ({
    focusDelta: definition.focusDelta ?? 0,
    budgetMul: definition.budgetMul ?? 1,
    effects: omitIdentity(definition.effects, IDENTITY_CARD_EFFECTS),
    aiDependencyDriftPerSprint: definition.aiDependencyDriftPerSprint ?? 0,
    frontierModelCostPerDependency: definition.frontierModelCostPerDependency ?? 0,
    scoreMul: definition.scoreMul,
  })),
  bosses: ordered(BOSS_DEFS, projectBoss),
  relics: ordered(RELIC_DEFS, projectRelic),
  traits: orderedById(TRAIT_DEFS, (definition) => ({
    modifiers: omitIdentity(definition.modifiers, IDENTITY_TRAIT_MODIFIERS),
  })),
  evolution: orderedById(EVOLUTION_NODES, (definition) => ({
    cost: definition.cost,
    requires: definition.requires ?? null,
    effects: omitIdentity(definition.effects, IDENTITY_CARD_EFFECTS),
    focusBonus: definition.focusBonus ?? 0,
    codingSlotBonus: definition.codingSlotBonus ?? 0,
  })),
  goalAdjustments: ordered(GOAL_ADJUSTMENT_DEFS, projectGoalAdjustment),
  levers: ordered(LEVER_DEFS, projectLever),
  members: {
    namePool: [...MEMBER_NAMES],
    defaultAiArchetypeId: STARTER_DEFAULT_AI_ARCHETYPE_ID,
    starter: ordered(STARTER_ARCHETYPES, (definition) => ({
      rank: definition.rank,
      stats: definedObject(definition.stats),
      traits: [...definition.traits],
      preferred: definition.preferred,
    })),
    recruit: ordered(RECRUIT_ARCHETYPES, (definition) => ({
      rank: definition.rank,
      stats: definedObject(definition.stats),
      traits: [...definition.traits],
    })),
  },
  unlocks: orderedById(UNLOCK_DEFS, (definition) => ({
    kind: definition.kind,
    contentId: definition.contentId,
    cost: definition.cost,
    requires: definition.requires ?? null,
  })),
  departments: ordered(DEPARTMENT_DEFS, projectDepartment),
  actions: ordered(ACTION_CONTENT_DEFS, projectAction),
  startingScenarios: orderedById(Object.values(SCENARIOS), (definition) => ({
    sprint: definedObject(definition.sprint),
    orgDelta: projectScenarioOrgDelta(definition.orgDelta),
    globalEffects: omitIdentity(definition.globalEffects, IDENTITY_CARD_EFFECTS),
  })),
  achievements: orderedById(ACHIEVEMENT_DEFS, (definition) => ({
    conditionKey: achievementConditionKey(definition.id),
  })),
  difficultyOrder: [...DIFFICULTY_ORDER],
  defaultScenarioId: DEFAULT_SCENARIO,
  daily: {
    difficulty: DAILY_RUN_DIFFICULTY,
    trials: [...DAILY_RUN_TRIALS],
  },
};

function validateEntryList(
  category: string,
  entries: readonly ContentCatalogEntry[],
  errors: ContentCatalogValidationError[],
): void {
  const seen = new Set<string>();
  entries.forEach((entry, index) => {
    if (seen.has(entry.id)) errors.push({ category, message: `重複した ID: ${entry.id}` });
    seen.add(entry.id);
    if (entry.order !== index) {
      errors.push({
        category,
        message: `定義順が不連続: ${entry.id} (${entry.order} != ${index})`,
      });
    }
  });
}

function ensureReference(
  errors: ContentCatalogValidationError[],
  category: string,
  reference: string,
  ids: ReadonlySet<string>,
): void {
  if (!ids.has(reference)) errors.push({ category, message: `未知の参照: ${reference}` });
}

/** カタログの重複・順序・定義間参照を検証する。 */
export function validateContentCatalog(
  catalog: ContentCatalog,
): readonly ContentCatalogValidationError[] {
  const errors: ContentCatalogValidationError[] = [];
  const lists: ReadonlyArray<readonly [string, readonly ContentCatalogEntry[]]> = [
    ['cards', catalog.cards],
    ['events', catalog.events],
    ['difficulties', catalog.difficulties],
    ['trials', catalog.trials],
    ['bosses', catalog.bosses],
    ['relics', catalog.relics],
    ['traits', catalog.traits],
    ['evolution', catalog.evolution],
    ['goalAdjustments', catalog.goalAdjustments],
    ['levers', catalog.levers],
    ['members.starter', catalog.members.starter],
    ['members.recruit', catalog.members.recruit],
    ['unlocks', catalog.unlocks],
    ['departments', catalog.departments],
    ['actions', catalog.actions],
    ['startingScenarios', catalog.startingScenarios],
    ['achievements', catalog.achievements],
  ];
  for (const [category, entries] of lists) validateEntryList(category, entries, errors);

  const cardIds = new Set(CARD_DEFS.map((definition) => definition.id));
  const relicIds = new Set(RELIC_DEFS.map((definition) => definition.id));
  const traitIds = new Set(TRAIT_DEFS.map((definition) => definition.id));
  const achievementIds = new Set(ACHIEVEMENT_DEFS.map((definition) => definition.id));
  const evolutionIds = new Set(EVOLUTION_NODES.map((definition) => definition.id));

  for (const definition of EVENT_DEFS) {
    for (const choice of definition.choices) {
      if (choice.outcome.grantCard) {
        ensureReference(errors, `events.${definition.id}`, choice.outcome.grantCard, cardIds);
      }
      if (choice.outcome.grantRelic) {
        ensureReference(errors, `events.${definition.id}`, choice.outcome.grantRelic, relicIds);
      }
    }
  }
  for (const definition of UNLOCK_DEFS) {
    ensureReference(
      errors,
      `unlocks.${definition.id}`,
      definition.contentId,
      definition.kind === 'card' ? cardIds : relicIds,
    );
    if (definition.requires) {
      ensureReference(errors, `unlocks.${definition.id}`, definition.requires, achievementIds);
    }
  }
  for (const definition of STARTER_ARCHETYPES) {
    for (const trait of definition.traits)
      ensureReference(errors, `members.${definition.id}`, trait, traitIds);
  }
  for (const definition of RECRUIT_ARCHETYPES) {
    for (const trait of definition.traits)
      ensureReference(errors, `members.${definition.id}`, trait, traitIds);
  }
  for (const definition of EVOLUTION_NODES) {
    if (definition.requires)
      ensureReference(errors, `evolution.${definition.id}`, definition.requires, evolutionIds);
  }

  const difficultyKeys = Object.keys(DIFFICULTY_DEFS);
  const difficultyIds = catalog.difficulties.map((entry) => entry.id);
  if (
    JSON.stringify([...difficultyKeys].sort(compareCanonicalStrings)) !==
    JSON.stringify(difficultyIds)
  ) {
    errors.push({
      category: 'difficulties',
      message: '難易度 ID 集合または ID 順が正本と一致しません',
    });
  }
  const catalogScenarioIds = catalog.startingScenarios.map((entry) => entry.id);
  if (
    JSON.stringify([...Object.keys(SCENARIOS)].sort(compareCanonicalStrings)) !==
    JSON.stringify(catalogScenarioIds)
  ) {
    errors.push({
      category: 'startingScenarios',
      message: '開始シナリオ ID 集合または ID 順が正本と一致しません',
    });
  }
  if (!new Set(catalogScenarioIds).has(catalog.defaultScenarioId)) {
    errors.push({
      category: 'defaultScenarioId',
      message: `未知の参照: ${catalog.defaultScenarioId}`,
    });
  }

  const difficultyIdSet = new Set(difficultyKeys);
  if (
    catalog.difficultyOrder.length !== difficultyKeys.length ||
    new Set(catalog.difficultyOrder).size !== difficultyKeys.length ||
    catalog.difficultyOrder.some((id) => !difficultyIdSet.has(id))
  ) {
    errors.push({
      category: 'difficultyOrder',
      message: '難易度 ID の完全な順列ではありません',
    });
  }
  if (!difficultyIdSet.has(catalog.daily.difficulty)) {
    errors.push({
      category: 'daily.difficulty',
      message: `未知の参照: ${catalog.daily.difficulty}`,
    });
  }
  const trialIds = new Set(TRIAL_DEFS.map((definition) => definition.id));
  for (const trialId of catalog.daily.trials) {
    ensureReference(errors, 'daily.trials', trialId, trialIds);
  }

  const starterById = new Map(catalog.members.starter.map((entry) => [entry.id, entry]));
  const defaultAi = starterById.get(catalog.members.defaultAiArchetypeId);
  if (!defaultAi) {
    errors.push({
      category: 'members.defaultAiArchetypeId',
      message: `未知の参照: ${catalog.members.defaultAiArchetypeId}`,
    });
  } else if ((defaultAi.execution as { preferred?: unknown }).preferred !== 'coding') {
    errors.push({
      category: 'members.defaultAiArchetypeId',
      message: 'coding アーキタイプではありません',
    });
  }

  return errors;
}

const initialValidationErrors = validateContentCatalog(CONTENT_CATALOG);
if (initialValidationErrors.length > 0) {
  throw new Error(
    `CONTENT_CATALOG validation failed: ${initialValidationErrors
      .map((error) => `${error.category}: ${error.message}`)
      .join('; ')}`,
  );
}
