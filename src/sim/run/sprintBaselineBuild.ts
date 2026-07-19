/**
 * スプリント初期入力の組み立て（本番 beginSprint と what-if 試算で共有）。
 *
 * RunEngine インスタンスに依存しない純関数なので、Web Worker からも呼べる。
 */
import { getBoss } from '../../data/bosses';
import { combineEffects, deckEffects } from '../cards';
import { foldFormationEffects } from '../member';
import type { RosterState } from '../member/types';
import type { OrgState, SprintConfig } from '../types';
import { foldRunEffects, toEffects, withBossEffects } from './effects';
import { PAUSE_AI_DEBUFF_MUL } from './quarterReview';
import type { SprintBaselineInput } from './sprintBaseline';
import type { DifficultyId, EvolutionState, SprintKind, SprintModifierDelta } from './types';

/** 高負荷（elite）スプリントのタスク量倍率。 */
export const ELITE_TASK_MUL = 1.6;

/**
 * スプリント間のギャップでシニア体力が回復する割合（満タンまでの差分に対して）。
 * 1 回の過負荷は尾を引くが、持続的な過負荷だけが燃え尽きへ至るようにする緩衝。
 */
export const BETWEEN_SPRINT_RECOVERY = 0.5;

export interface SprintBaselineBuildContext {
  relics: string[];
  evolution: EvolutionState;
  difficulty: DifficultyId;
  trials: string[];
  bossId: string;
  pauseAiDebuffQuarter: number | null;
  quarterNumber: number;
  baseConfig: SprintConfig;
}

export interface SprintBaselineBuildParams {
  deck: { defId: string; level: number }[];
  roster: RosterState;
  org: OrgState;
  kind: SprintKind;
  modifiers: SprintModifierDelta;
  seed: string;
  /** what-if: 次スプリントで発動すると仮定するカード（RI-30）。 */
  playedCards?: { defId: string; level: number }[];
}

/**
 * 試練「フロンティアモデル依存」のスプリント開始時コストを適用する。
 * 依存度が高いほど高価なモデルへ安易に寄り、予算消費も増える。
 */
export function applyTrialAiDependencyPressure(
  org: OrgState,
  budget: number,
  ctx: Pick<SprintBaselineBuildContext, 'relics' | 'evolution' | 'difficulty' | 'trials'> & {
    deck: { defId: string; level: number }[];
  },
): number {
  const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
  const { aiDependencyDriftPerSprint, frontierModelCostPerDependency } = foldRunEffects({
    deck: ctx.deck,
    relics: ctx.relics,
    evolution: ctx.evolution,
    difficulty: ctx.difficulty,
    trials: ctx.trials,
  });
  org.aiDependency = clamp(org.aiDependency + aiDependencyDriftPerSprint, 0, 100);
  const modelCost = Math.ceil(org.aiDependency * frontierModelCostPerDependency);
  return Math.max(0, budget - modelCost);
}

/**
 * 指定したデッキ・編成から次スプリントの純粋な初期入力を組み立てる。
 * 本番起動と RI-46 の試算で共有し、候補試算中に実ランの状態を変更しない。
 */
export function buildSprintBaselineInput(
  ctx: SprintBaselineBuildContext,
  params: SprintBaselineBuildParams,
): SprintBaselineInput {
  const { deck, roster, org, kind, modifiers, seed, playedCards = [] } = params;
  const isBoss = kind === 'boss';
  const fold = foldRunEffects({
    deck,
    relics: ctx.relics,
    evolution: ctx.evolution,
    difficulty: ctx.difficulty,
    trials: ctx.trials,
  });
  const formation = foldFormationEffects(roster);
  let effects = combineEffects(fold.effects, toEffects(formation.effects));
  if (playedCards.length > 0) {
    effects = combineEffects(effects, deckEffects(playedCards));
  }
  if (isBoss) effects = withBossEffects(effects, ctx.bossId);
  if (ctx.pauseAiDebuffQuarter === ctx.quarterNumber) {
    effects = {
      ...effects,
      codingSpeedMul: effects.codingSpeedMul * PAUSE_AI_DEBUFF_MUL,
      routineSpeedMul: effects.routineSpeedMul * PAUSE_AI_DEBUFF_MUL,
    };
  }
  if (modifiers.reworkRateAdd) {
    effects = { ...effects, reworkRateAdd: effects.reworkRateAdd + modifiers.reworkRateAdd };
  }
  const baseMul =
    kind === 'elite' ? ELITE_TASK_MUL : isBoss ? (getBoss(ctx.bossId)?.taskCountMul ?? 1) : 1;
  const mul = baseMul * (modifiers.taskCountMul ?? 1);
  // RI-62: ボスは 90 秒帯の下限を確保（通常スプリントの下限は触らない）。
  const taskFloor = isBoss ? 26 : 4;
  const config: SprintConfig = {
    ...ctx.baseConfig,
    taskCount: Math.max(taskFloor, Math.round(ctx.baseConfig.taskCount * mul)),
    focusMax: Math.max(1, ctx.baseConfig.focusMax + fold.focusBonus + formation.focusBonus),
    codingSlots: Math.max(
      0,
      ctx.baseConfig.codingSlots + fold.codingSlotBonus + formation.codingSlotBonus,
    ),
  };
  return {
    seed,
    config: { ...config },
    org: structuredClone(org),
    cardEffects: { ...effects },
    aiAdoptionShare: formation.aiAdoptionShare,
    reviewLoadAdd: modifiers.reviewLoadAdd,
  };
}
