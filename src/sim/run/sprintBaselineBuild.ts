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

/**
 * 高負荷（elite）スプリントのタスク量倍率の代表値（normal）。
 * 実際の適用と playtest 採点は難易度別の `eliteTaskMul` を使う。
 */
export const ELITE_TASK_MUL = 1.12;

/**
 * 難易度別の elite タスク倍率（RI-75）。
 * hard/nightmare は非効率で長尾になりやすいので倍率を抑え、easy は帯下限を確保する。
 */
export function eliteTaskMul(difficulty: DifficultyId): number {
  switch (difficulty) {
    case 'easy':
      return 1.18;
    case 'normal':
      return 1.12;
    case 'hard':
      return 1.1;
    case 'nightmare':
      return 1.15;
  }
}

/**
 * 通常/elite スプリントのタスク数下限（RI-75）。
 * ベースタスク数へ適用し、その後に elite / 一時 modifier を掛ける。
 * 絶対下限30秒は `minCompleteTick` 側で担保する。
 */
export function normalTaskFloor(difficulty: DifficultyId): number {
  switch (difficulty) {
    case 'easy':
      return 55;
    case 'normal':
      return 50;
    case 'hard':
      return 42;
    case 'nightmare':
      // 非効率で長い。絶対下限は minCompleteTick 側で担保する。
      return 32;
  }
}

/**
 * スプリント完了の最小 tick（RI-75）。
 * エンジンは完了後に sprintTick++ するため、表示 tick が絶対下限30秒以上になる値にする。
 * `MS_PER_TICK_1X=780` → 表示39 tick ≒ 30.4s になるよう 38。
 */
export const SPRINT_MIN_COMPLETE_TICK = 38;

/**
 * ボススプリントのタスク数下限（RI-75）。
 * easy/normal は通常より長く、hard/nightmare は終盤消耗の長尾を抑える。
 */
export function bossTaskFloor(difficulty: DifficultyId): number {
  switch (difficulty) {
    case 'easy':
      return 68;
    case 'normal':
      return 58;
    case 'hard':
      return 52;
    case 'nightmare':
      return 56;
  }
}

/**
 * ボスの最大 tick（RI-75）。
 * エンジンは `stepSprint(tick)` の後に `sprintTick++` するため、完了時の表示 tick は +1 される。
 * `MS_PER_TICK_1X=780` で完了時壁時計が180秒以内になるよう 229 とする（229→表示230 tick≒179.4s）。
 * テンポ定数を変えたら `sprintTempo` 側の対応テストと同期すること。
 */
export const BOSS_MAX_TICKS = 229;

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
    kind === 'elite'
      ? eliteTaskMul(ctx.difficulty)
      : isBoss
        ? (getBoss(ctx.bossId)?.taskCountMul ?? 1)
        : 1;
  // RI-75: 床はベースへ。elite 倍率と休息などの一時減衰は床の後に掛け、差が消えないようにする。
  const taskFloor = isBoss ? bossTaskFloor(ctx.difficulty) : normalTaskFloor(ctx.difficulty);
  const flooredBase = Math.max(taskFloor, ctx.baseConfig.taskCount);
  const taskCount = Math.max(1, Math.round(flooredBase * baseMul * (modifiers.taskCountMul ?? 1)));
  const config: SprintConfig = {
    ...ctx.baseConfig,
    taskCount,
    // RI-75: 早期ドレインでも絶対下限30秒を割らない。
    minCompleteTick: SPRINT_MIN_COMPLETE_TICK,
    // RI-75: ボスは §3.1 上限（180秒）で打ち切り、消耗時の長尾を防ぐ。
    ...(isBoss ? { maxTicks: Math.min(ctx.baseConfig.maxTicks, BOSS_MAX_TICKS) } : {}),
    focusMax: Math.max(
      1,
      ctx.baseConfig.focusMax +
        fold.focusBonus +
        formation.focusBonus +
        (modifiers.focusMaxAdd ?? 0),
    ),
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
