/**
 * 既存コンテンツ正本から、ルールセット指紋へ入れるゲーム影響フィールドだけを射影する。
 *
 * 値は `src/data/` と開始シナリオの定義を正本のまま読む。表示専用フィールドは落とす。
 * 配列は定義順を保持する。
 */
import { compareCanonicalStrings } from './balance/canonical';
import { ACHIEVEMENT_DEFS, type AchievementDef } from './achievements';
import { ACTION_CONTENT_DEFS, type ActionContentDef } from './actions';
import { BOSS_DEFS, type BossDef } from './bosses';
import { CARD_DEFS, RARITY_WEIGHT } from './cards';
import { DEPARTMENT_DEFS } from './departments';
import { DIFFICULTY_DEFS, TRIAL_DEFS, type DifficultyDef, type TrialDef } from './difficulties';
import { EVENT_DEFS, RECRUIT_SKIP_MORALE, effectiveKind, type EventDef } from './events';
import { EVOLUTION_NODES, type EvolutionNodeDef } from './evolution';
import { GOAL_ADJUSTMENT_DEFS, type GoalAdjustmentDef } from './goalAdjustments';
import { LEVER_DEFS } from './levers';
import { RECRUIT_ARCHETYPES, STARTER_ARCHETYPES, type MemberArchetype } from './members';
import { RELIC_DEFS, type RelicDef } from './relics';
import { TRAIT_DEFS, type TraitDef } from './traits';
import { UNLOCK_DEFS, type UnlockDef } from './unlocks';
import { DEFAULT_SCENARIO, SCENARIOS, SCENARIO_ORDER, type Scenario } from '../sim/scenarios';
import type { CardDef } from '../sim/types';
import type { DepartmentDef, LeverDef } from '../sim/orgscale/types';

export function projectCards(defs: readonly CardDef[] = CARD_DEFS) {
  return defs.map(({ id, rarity, cost, focusCost, base }) => ({
    id,
    rarity,
    cost,
    focusCost,
    base,
  }));
}

export function projectEvents(defs: readonly EventDef[] = EVENT_DEFS) {
  return defs.map((def) => ({
    id: def.id,
    kind: effectiveKind(def),
    weight: def.weight ?? 1,
    triggers: def.triggers,
    minSignal: def.minSignal,
    maxSignal: def.maxSignal,
    choices: def.choices.map((choice) => ({
      outcome: choice.outcome,
      leadsTo: choice.leadsTo,
    })),
  }));
}

export function projectDifficulties(
  defs: readonly DifficultyDef[] = Object.values(DIFFICULTY_DEFS),
) {
  return defs
    .map(
      ({
        id,
        org,
        taskCountMul,
        globalEffects,
        startBudget,
        bossTargetMul,
        aiDependencyPerTask,
      }) => ({
        id,
        org,
        taskCountMul,
        globalEffects,
        startBudget,
        bossTargetMul,
        aiDependencyPerTask,
      }),
    )
    .sort((left, right) => compareCanonicalStrings(left.id, right.id));
}

export function projectTrials(defs: readonly TrialDef[] = TRIAL_DEFS) {
  return defs.map(
    ({
      id,
      focusDelta,
      budgetMul,
      effects,
      aiDependencyDriftPerSprint,
      frontierModelCostPerDependency,
      scoreMul,
    }) => ({
      id,
      focusDelta,
      budgetMul,
      effects,
      aiDependencyDriftPerSprint,
      frontierModelCostPerDependency,
      scoreMul,
    }),
  );
}

export function projectBosses(defs: readonly BossDef[] = BOSS_DEFS) {
  return defs.map(({ id, taskCountMul, incidentMul, clear }) => ({
    id,
    taskCountMul,
    incidentMul,
    clear,
  }));
}

export function projectRelics(defs: readonly RelicDef[] = RELIC_DEFS) {
  return defs.map(({ id, effects, passives }) => ({ id, effects, passives }));
}

export function projectTraits(defs: readonly TraitDef[] = TRAIT_DEFS) {
  return defs.map(({ id, modifiers }) => ({ id, modifiers }));
}

export function projectEvolution(defs: readonly EvolutionNodeDef[] = EVOLUTION_NODES) {
  return defs.map(({ id, branch, cost, requires, effects, focusBonus, codingSlotBonus }) => ({
    id,
    branch,
    cost,
    requires,
    effects,
    focusBonus,
    codingSlotBonus,
  }));
}

export function projectGoalAdjustments(defs: readonly GoalAdjustmentDef[] = GOAL_ADJUSTMENT_DEFS) {
  return defs.map(
    ({
      id,
      negotiator,
      trustDelta,
      budgetDelta,
      goalEffects,
      orgEffects,
      nextBudgetCapDelta,
      pauseAiDebuff,
      reorgReset,
      nextQuarterEffects,
    }) => ({
      id,
      negotiator,
      trustDelta,
      budgetDelta,
      goalEffects,
      orgEffects,
      nextBudgetCapDelta,
      pauseAiDebuff,
      reorgReset,
      nextQuarterEffects,
    }),
  );
}

export function projectLevers(defs: readonly LeverDef[] = LEVER_DEFS) {
  return defs.map(({ id, scope, cost, effect }) => ({ id, scope, cost, effect }));
}

export function projectMembers(
  starters: readonly MemberArchetype[] = STARTER_ARCHETYPES,
  recruits: readonly MemberArchetype[] = RECRUIT_ARCHETYPES,
) {
  const projectArchetype = ({ id, rank, stats, traits, preferred }: MemberArchetype) => ({
    id,
    rank,
    stats,
    traits,
    preferred,
  });
  return {
    starters: starters.map(projectArchetype),
    recruits: recruits.map(projectArchetype),
  };
}

export function projectUnlocks(defs: readonly UnlockDef[] = UNLOCK_DEFS) {
  return defs.map(({ id, kind, contentId, cost, requires }) => ({
    id,
    kind,
    contentId,
    cost,
    requires,
  }));
}

export function projectDepartments(defs: readonly DepartmentDef[] = DEPARTMENT_DEFS) {
  return defs.map(({ id, teamCount }) => ({ id, teamCount }));
}

export function projectActions(defs: readonly ActionContentDef[] = ACTION_CONTENT_DEFS) {
  return defs.map((def) => ({
    id: def.id,
    stabilizesFlow: def.stabilizesFlow === true,
  }));
}

export function projectScenarios(
  order: readonly Scenario['id'][] = SCENARIO_ORDER,
  scenarios: Readonly<Record<Scenario['id'], Scenario>> = SCENARIOS,
  defaultId: Scenario['id'] = DEFAULT_SCENARIO,
) {
  return {
    defaultId,
    entries: order.map((id) => {
      const scenario = scenarios[id];
      return {
        id: scenario.id,
        org: scenario.org,
        sprint: scenario.sprint,
        orgDelta: scenario.orgDelta,
        globalEffects: scenario.globalEffects,
      };
    }),
  };
}

export function projectAchievements(defs: readonly AchievementDef[] = ACHIEVEMENT_DEFS) {
  return defs.map(({ id }) => ({ id }));
}

/** 指紋入力用のコンテンツカタログ。seed や表示専用値は含めない。 */
export function projectContentCatalog() {
  return {
    cards: projectCards(),
    rarityWeight: RARITY_WEIGHT,
    events: projectEvents(),
    recruitSkipMorale: RECRUIT_SKIP_MORALE,
    difficulties: projectDifficulties(),
    trials: projectTrials(),
    bosses: projectBosses(),
    relics: projectRelics(),
    traits: projectTraits(),
    evolution: projectEvolution(),
    goalAdjustments: projectGoalAdjustments(),
    levers: projectLevers(),
    members: projectMembers(),
    unlocks: projectUnlocks(),
    departments: projectDepartments(),
    actions: projectActions(),
    scenarios: projectScenarios(),
    achievements: projectAchievements(),
  };
}
