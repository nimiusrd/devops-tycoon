/**
 * スプリント初期入力の組み立て（本番 beginSprint と what-if 試算で共有）。
 *
 * RunEngine インスタンスに依存しない純関数なので、Web Worker からも呼べる。
 */
import { getBoss } from '../../data/bosses';
import { PACING_BALANCE } from '../../data/balance/pacing';
import { RUN_BALANCE } from '../../data/balance/run';
import { combineEffects, deckEffects } from '../cards';
import { clamp } from '../clamp';
import { foldFormationEffects } from '../member';
import type { RosterState } from '../member/types';
import type { OrgState, ScenarioId, SprintConfig } from '../types';
import { foldRunEffects, toEffects, withBossEffects } from './effects';
import { applyGoalCarryoverToEffects } from './quarterReview';
import type { SprintBaselineInput } from './sprintBaseline';
import type {
  DifficultyId,
  EvolutionState,
  GoalAdjustmentId,
  SprintKind,
  SprintModifierDelta,
} from './types';

const ELITE_TASK_MULTIPLIERS = {
  easy: PACING_BALANCE.eliteTaskMultiplierEasy.value,
  normal: PACING_BALANCE.eliteTaskMultiplierNormal.value,
  hard: PACING_BALANCE.eliteTaskMultiplierHard.value,
  nightmare: PACING_BALANCE.eliteTaskMultiplierNightmare.value,
} satisfies Record<DifficultyId, number>;

const NORMAL_TASK_FLOORS = {
  easy: PACING_BALANCE.normalTaskFloorEasy.value,
  normal: PACING_BALANCE.normalTaskFloorNormal.value,
  hard: PACING_BALANCE.normalTaskFloorHard.value,
  nightmare: PACING_BALANCE.normalTaskFloorNightmare.value,
} satisfies Record<DifficultyId, number>;

const BOSS_TASK_FLOORS = {
  easy: PACING_BALANCE.bossTaskFloorEasy.value,
  normal: PACING_BALANCE.bossTaskFloorNormal.value,
  hard: PACING_BALANCE.bossTaskFloorHard.value,
  nightmare: PACING_BALANCE.bossTaskFloorNightmare.value,
} satisfies Record<DifficultyId, number>;

/**
 * 難易度別の elite タスク倍率（RI-75）。
 * hard/nightmare は非効率で長尾になりやすいので倍率を抑え、easy は帯下限を確保する。
 */
export function eliteTaskMul(difficulty: DifficultyId): number {
  return ELITE_TASK_MULTIPLIERS[difficulty];
}

/**
 * 通常/elite スプリントのタスク数下限（RI-75）。
 * ベースタスク数へ適用し、その後に elite / 一時 modifier を掛ける。
 * 絶対下限30秒は `minCompleteTick` 側で担保する。
 */
export function normalTaskFloor(difficulty: DifficultyId): number {
  return NORMAL_TASK_FLOORS[difficulty];
}

/**
 * スプリント完了の最小 tick（RI-75）。
 * エンジンは完了後に sprintTick++ するため、表示 tick が絶対下限30秒以上になる値にする。
 * `MS_PER_TICK_1X=780` → §3.1 通常スプリント代表下限 60s になるよう 77（表示78 tick ≒ 60.8s）。
 * 絶対最短 30s は `meetsSprintAbsoluteMin` 側の床として残す。
 */
export const SPRINT_MIN_COMPLETE_TICK = PACING_BALANCE.sprintMinCompleteTick.value;

/**
 * ボス完了に必要な最小 tick。表示 tick は +1 されるため、116 tick で約90.5秒になる。
 * 安定化による結果再校正後も §3.1 のボス最短90秒を守り、タスク量・出荷には介入しない。
 */
export const BOSS_MIN_COMPLETE_TICK = PACING_BALANCE.bossMinCompleteTick.value;

/**
 * ボススプリントのタスク数下限（RI-75）。
 * easy/normal は通常より長く、hard/nightmare は終盤消耗の長尾を抑える。
 */
export function bossTaskFloor(difficulty: DifficultyId): number {
  return BOSS_TASK_FLOORS[difficulty];
}

/**
 * ボスの最大 tick（RI-75）。
 * エンジンは `stepSprint(tick)` の後に `sprintTick++` するため、完了時の表示 tick は +1 される。
 * `MS_PER_TICK_1X=780` で完了時壁時計が180秒以内になるよう 229 とする（229→表示230 tick≒179.4s）。
 * テンポ定数を変えたら `sprintTempo` 側の対応テストと同期すること。
 */
export const BOSS_MAX_TICKS = PACING_BALANCE.bossMaxTicks.value;

/**
 * スプリント間のギャップでシニア体力が回復する割合（満タンまでの差分に対して）。
 * 1 回の過負荷は尾を引くが、持続的な過負荷だけが燃え尽きへ至るようにする緩衝。
 */
export const BETWEEN_SPRINT_RECOVERY = PACING_BALANCE.betweenSprintRecovery.value;

/** 実ランと what-if が共有する、スプリント間のシニアHP回復式。 */
export function recoverSeniorHpBetweenSprints(seniorHp: number): number {
  return clamp(seniorHp + (100 - seniorHp) * BETWEEN_SPRINT_RECOVERY, 0, 100);
}

export interface SprintBaselineBuildContext {
  relics: string[];
  evolution: EvolutionState;
  difficulty: DifficultyId;
  trials: string[];
  /** ツール別シナリオ（RI-103。未指定は default）。 */
  scenario?: ScenarioId;
  bossId: string;
  /**
   * @deprecated RI-83: `goalCarryoverQuarter` / `goalCarryoverId` を使う。
   * 旧 what-if / テスト互換のため残す（pause_ai_rollout として解釈）。
   */
  pauseAiDebuffQuarter?: number | null;
  /** 目標修正キャリーオーバーが有効な四半期（RI-83）。 */
  goalCarryoverQuarter?: number | null;
  /** 目標修正キャリーオーバーの ID（RI-83）。 */
  goalCarryoverId?: GoalAdjustmentId | null;
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

export interface AiDependencyPressureOptions {
  /**
   * インフラコストを課金するか（RI-88）。
   * 試練中は毎スプリント、通常ランはボス開始時のみ。
   */
  billInfraCost?: boolean;
}

/**
 * スプリント開始時の AI 依存圧力を適用する（RI-88）。
 */
export function applyTrialAiDependencyPressure(
  org: OrgState,
  budget: number,
  ctx: Pick<
    SprintBaselineBuildContext,
    'relics' | 'evolution' | 'difficulty' | 'trials' | 'scenario'
  > & {
    deck: { defId: string; level: number }[];
  },
  options: AiDependencyPressureOptions = {},
): number {
  const fold = foldRunEffects({
    deck: ctx.deck,
    relics: ctx.relics,
    evolution: ctx.evolution,
    difficulty: ctx.difficulty,
    trials: ctx.trials,
    scenario: ctx.scenario,
  });
  org.aiDependency = clamp(org.aiDependency + fold.aiDependencyDriftPerSprint, 0, 100);
  const bill = options.billInfraCost ?? ctx.trials.includes('frontier-dependency');
  if (!bill) return budget;
  const modelCost = computeInfraCost(
    org.aiDependency,
    fold.frontierModelCostPerDependency,
    fold.effects.infraCostMul,
  );
  return Math.max(0, budget - modelCost);
}

/** インフラ／モデル利用コスト（RI-88）。1 未満は 0、以上は ceil。 */
export function computeInfraCost(aiDependency: number, rate: number, infraCostMul: number): number {
  const raw = clamp(aiDependency, 0, 100) * Math.max(0, rate) * Math.max(0, infraCostMul);
  if (raw < RUN_BALANCE.infraMinimumBillableRaw.value) return 0;
  return Math.ceil(raw);
}

/** インフラコストの内訳（テスト・UI 向け）。 */
export function previewInfraCost(
  aiDependency: number,
  ctx: Pick<
    SprintBaselineBuildContext,
    'relics' | 'evolution' | 'difficulty' | 'trials' | 'scenario'
  > & {
    deck: { defId: string; level: number }[];
  },
): { rate: number; infraCostMul: number; cost: number } {
  const fold = foldRunEffects({
    deck: ctx.deck,
    relics: ctx.relics,
    evolution: ctx.evolution,
    difficulty: ctx.difficulty,
    trials: ctx.trials,
    scenario: ctx.scenario,
  });
  const rate = fold.frontierModelCostPerDependency;
  const infraCostMul = fold.effects.infraCostMul;
  return { rate, infraCostMul, cost: computeInfraCost(aiDependency, rate, infraCostMul) };
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
    scenario: ctx.scenario,
  });
  const formation = foldFormationEffects(roster);
  let effects = combineEffects(fold.effects, toEffects(formation.effects));
  if (playedCards.length > 0) {
    effects = combineEffects(effects, deckEffects(playedCards));
  }
  if (isBoss) effects = withBossEffects(effects, ctx.bossId);
  const carryoverQuarter = ctx.goalCarryoverQuarter ?? ctx.pauseAiDebuffQuarter ?? null;
  const carryoverId =
    ctx.goalCarryoverId ??
    (ctx.pauseAiDebuffQuarter === ctx.quarterNumber ? 'pause_ai_rollout' : null);
  effects = applyGoalCarryoverToEffects(effects, carryoverId, carryoverQuarter, ctx.quarterNumber);
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
  // ボスは山場として通常より長い床を守る。休息 mul でボス床を割り込ませない。
  const taskFloor = isBoss ? bossTaskFloor(ctx.difficulty) : normalTaskFloor(ctx.difficulty);
  const flooredBase = Math.max(taskFloor, ctx.baseConfig.taskCount);
  const scaled = Math.max(1, Math.round(flooredBase * baseMul * (modifiers.taskCountMul ?? 1)));
  const taskCount = isBoss ? Math.max(taskFloor, scaled) : scaled;
  const config: SprintConfig = {
    ...ctx.baseConfig,
    taskCount,
    // RI-75: 早期ドレインでも絶対下限30秒を割らない。全難易度のボスは §3.1 の90秒下限も守る。
    minCompleteTick: isBoss ? BOSS_MIN_COMPLETE_TICK : SPRINT_MIN_COMPLETE_TICK,
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
    aiMasteryNorm: formation.aiMasteryNorm,
    reviewLoadAdd: modifiers.reviewLoadAdd,
  };
}
