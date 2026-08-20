/**
 * 実行結果に影響するコンテンツ定義の生成カタログ（RI-115）。
 *
 * ここでは既存の定義を複製せず、実行系が読む項目だけを射影する。表示名・説明・
 * 色・アイコンなどの表示メタデータは含めない。バランスレジストリも別の入力であり、
 * このカタログへ数値を再コピーしない。
 */
import { ACHIEVEMENT_DEFS } from './achievements';
import { ACTION_CONTENT_DEFS, type ActionContentDef } from './actions';
import { CARD_DEFS, RARITY_WEIGHT } from './cards';
import { BOSS_DEFS } from './bosses';
import { DEPARTMENT_DEFS } from './departments';
import { DIFFICULTY_DEFS, TRIAL_DEFS } from './difficulties';
import { EVOLUTION_NODES } from './evolution';
import { EVENT_DEFS, effectiveKind, type EventDef } from './events';
import { GOAL_ADJUSTMENT_DEFS } from './goalAdjustments';
import { LEVER_DEFS } from './levers';
import { MEMBER_NAMES, RECRUIT_ARCHETYPES, STARTER_ARCHETYPES } from './members';
import { RELIC_DEFS } from './relics';
import { SCENARIO_ORDER, SCENARIOS } from '../sim/scenarios';
import { TRAIT_DEFS } from './traits';
import { UNLOCK_DEFS } from './unlocks';
import type { DepartmentDef } from '../sim/orgscale/types';

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
    starter: readonly ContentCatalogEntry[];
    recruit: readonly ContentCatalogEntry[];
  };
  unlocks: readonly ContentCatalogEntry[];
  departments: readonly ContentCatalogEntry[];
  actions: readonly ContentCatalogEntry[];
  startingScenarios: readonly ContentCatalogEntry[];
  achievements: readonly ContentCatalogEntry[];
}

export interface ContentCatalogValidationError {
  category: string;
  message: string;
}

function definedObject(value: object | undefined): Record<string, unknown> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
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

export function projectEvent(definition: EventDef): unknown {
  return {
    kind: effectiveKind(definition),
    weight: definition.weight ?? 1,
    triggers: definedObject(definition.triggers),
    minSignal: definedObject(definition.minSignal),
    maxSignal: definedObject(definition.maxSignal),
    choices: definition.choices.map((choice) => ({
      outcome: definedObject(choice.outcome),
      leadsTo: choice.leadsTo ?? 'sprint',
    })),
  };
}

export function projectDepartment(definition: DepartmentDef): unknown {
  return { teamCount: definition.teamCount };
}

export function projectAction(definition: ActionContentDef): unknown {
  return { stabilizesFlow: definition.stabilizesFlow ?? false };
}

const difficultyDefinitions = Object.values(DIFFICULTY_DEFS);

export const CONTENT_CATALOG: ContentCatalog = {
  rarityWeights: { ...RARITY_WEIGHT },
  cards: ordered(CARD_DEFS, (definition) => ({
    rarity: definition.rarity,
    cost: definition.cost,
    focusCost: definition.focusCost,
    base: definedObject(definition.base),
  })),
  events: ordered(EVENT_DEFS, projectEvent),
  difficulties: ordered(difficultyDefinitions, (definition) => ({
    org: definedObject(definition.org),
    taskCountMul: definition.taskCountMul,
    globalEffects: definedObject(definition.globalEffects),
    startBudget: definition.startBudget,
    bossTargetMul: definition.bossTargetMul,
    aiDependencyPerTask: definition.aiDependencyPerTask ?? null,
  })),
  trials: ordered(TRIAL_DEFS, (definition) => ({
    focusDelta: definition.focusDelta ?? null,
    budgetMul: definition.budgetMul ?? null,
    effects: definedObject(definition.effects),
    aiDependencyDriftPerSprint: definition.aiDependencyDriftPerSprint ?? null,
    frontierModelCostPerDependency: definition.frontierModelCostPerDependency ?? null,
    scoreMul: definition.scoreMul,
  })),
  bosses: ordered(BOSS_DEFS, (definition) => ({
    taskCountMul: definition.taskCountMul,
    incidentMul: definition.incidentMul,
    clear: definedObject(definition.clear),
  })),
  relics: ordered(RELIC_DEFS, (definition) => ({
    effects: definedObject(definition.effects),
    passives: definedObject(definition.passives),
  })),
  traits: ordered(TRAIT_DEFS, (definition) => ({
    modifiers: definedObject(definition.modifiers),
  })),
  evolution: ordered(EVOLUTION_NODES, (definition) => ({
    branch: definition.branch,
    cost: definition.cost,
    requires: definition.requires ?? null,
    effects: definedObject(definition.effects),
    focusBonus: definition.focusBonus ?? null,
    codingSlotBonus: definition.codingSlotBonus ?? null,
  })),
  goalAdjustments: ordered(GOAL_ADJUSTMENT_DEFS, (definition) => ({
    negotiator: definition.negotiator,
    trustDelta: definedObject(definition.trustDelta),
    budgetDelta: definition.budgetDelta,
    goalEffects: definedObject(definition.goalEffects),
    orgEffects: definedObject(definition.orgEffects),
    nextBudgetCapDelta: definition.nextBudgetCapDelta ?? null,
    pauseAiDebuff: definition.pauseAiDebuff ?? false,
    reorgReset: definition.reorgReset ?? false,
    nextQuarterEffects: definedObject(definition.nextQuarterEffects),
  })),
  levers: ordered(LEVER_DEFS, (definition) => ({
    scope: definition.scope,
    cost: definition.cost,
    effect: definedObject(definition.effect),
  })),
  members: {
    namePool: [...MEMBER_NAMES],
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
      preferred: definition.preferred,
    })),
  },
  unlocks: ordered(UNLOCK_DEFS, (definition) => ({
    kind: definition.kind,
    contentId: definition.contentId,
    cost: definition.cost,
    requires: definition.requires ?? null,
  })),
  departments: ordered(DEPARTMENT_DEFS, projectDepartment),
  actions: ordered(ACTION_CONTENT_DEFS, projectAction),
  startingScenarios: ordered(
    SCENARIO_ORDER.map((id) => SCENARIOS[id]),
    (definition) => ({
      org: definedObject(definition.org),
      sprint: definedObject(definition.sprint),
      orgDelta: definedObject(definition.orgDelta),
      globalEffects: definedObject(definition.globalEffects),
    }),
  ),
  achievements: ordered(ACHIEVEMENT_DEFS, () => ({})),
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
  if (JSON.stringify(difficultyKeys) !== JSON.stringify(difficultyIds)) {
    errors.push({
      category: 'difficulties',
      message: '定義オブジェクトのキー順とカタログ順が一致しません',
    });
  }
  const scenarioIds = SCENARIO_ORDER;
  const catalogScenarioIds = catalog.startingScenarios.map((entry) => entry.id);
  if (JSON.stringify(scenarioIds) !== JSON.stringify(catalogScenarioIds)) {
    errors.push({ category: 'startingScenarios', message: '開始シナリオ順が正本と一致しません' });
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
