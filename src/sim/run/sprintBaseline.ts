/**
 * 無介入ベースライン（RI-55）。
 *
 * 本番スプリントと同じ初期入力・seed から状態を再構築し、介入を行わず完了まで進める。
 * 介入によって乱数消費列が変わるため、結果は厳密な反実仮想ではなく同条件での推定として扱う。
 */
import { BURN_TICKS } from '../model';
import { createRng, type Rng } from '../rng';
import { createSprint, stepSprint, summarizeSprint } from '../sprint';
import type {
  CardEffects,
  OrgState,
  SprintBaselineResult,
  SprintConfig,
  SprintResult,
  SprintState,
} from '../types';

export interface SprintBaselineInput {
  seed: string;
  config: SprintConfig;
  org: OrgState;
  cardEffects: CardEffects;
  aiAdoptionShare: number;
  reviewLoadAdd?: number;
  /** チーム正本から引き継ぐ炎上件数（スプリント metrics には加算しない）。 */
  incidentLoadAdd?: number;
}

/** 同条件シミュレーション中に tick ごとの介入判断へ渡すコンテキスト。 */
export interface SprintSimulationContext {
  sprint: SprintState;
  org: OrgState;
  rng: Rng;
  tick: number;
}

/** stepSprint の直前に呼ばれる介入ポリシー。状態変更は sim 層の公開 API 経由で行う。 */
export type SprintInterventionPolicy = (context: SprintSimulationContext) => void;

/** 本番とベースラインで共有するスプリント初期化。 */
export function createSprintFromBaselineInput(
  input: SprintBaselineInput,
  org: OrgState,
): { sprint: SprintState; rng: ReturnType<typeof createRng> } {
  const rng = createRng(input.seed);
  const sprint = createSprint(input.config, org, rng, input.cardEffects, input.aiAdoptionShare);

  if (input.reviewLoadAdd) {
    let moved = 0;
    for (const task of sprint.tasks) {
      if (moved >= input.reviewLoadAdd) break;
      if (task.lane === 'backlog') {
        task.lane = 'review';
        task.progress = 0;
        moved += 1;
      }
    }
  }

  // 粗粒度で溜まった炎上を詳細盤面へ戻す（igniteTask だと今スプリントの発生件数に乗ってしまう）。
  if (input.incidentLoadAdd) {
    let lit = 0;
    for (const task of sprint.tasks) {
      if (lit >= input.incidentLoadAdd) break;
      if (task.lane !== 'backlog') continue;
      task.lane = 'rework';
      task.incident = true;
      task.burnTicksLeft = BURN_TICKS;
      task.progress = 0;
      lit += 1;
    }
  }

  const reviewQueue = sprint.tasks.filter((t) => t.lane === 'review').length;
  if (reviewQueue > sprint.metrics.reviewQueueMax) {
    sprint.metrics.reviewQueueMax = reviewQueue;
  }

  return { sprint, rng };
}

/**
 * 同一初期条件のスプリントを任意の介入ポリシーで完了まで再実行し、フルリザルトを返す。
 *
 * ポリシーを省略すれば無介入になる。入力は clone して扱うため、比較試行同士で状態を共有しない。
 */
export function runSprintSimulationFull(
  input: SprintBaselineInput,
  interventionPolicy?: SprintInterventionPolicy,
): SprintResult {
  const org = structuredClone(input.org);
  const { sprint, rng } = createSprintFromBaselineInput(input, org);
  let tick = 0;

  while (!sprint.complete && tick <= sprint.config.maxTicks + 1) {
    interventionPolicy?.({ sprint, org, rng, tick });
    stepSprint(sprint, org, rng, tick);
    tick += 1;
  }
  if (!sprint.complete) {
    throw new Error(`Baseline sprint did not complete by tick ${tick}`);
  }

  return summarizeSprint(sprint, org);
}

/**
 * 同一初期条件のスプリントを任意の介入ポリシーで完了まで再実行する。
 *
 * ポリシーを省略すれば無介入になる。入力は clone して扱うため、比較試行同士で状態を共有しない。
 * what-if / RI-56 向けに delivered / spread / maxCombo だけ返す。フル指標は `runSprintSimulationFull`。
 */
export function runSprintSimulation(
  input: SprintBaselineInput,
  interventionPolicy?: SprintInterventionPolicy,
): SprintBaselineResult {
  const result = runSprintSimulationFull(input, interventionPolicy);
  return {
    delivered: result.delivered,
    spread: result.spread,
    maxCombo: result.maxCombo,
  };
}

/** 同一初期条件のスプリントを無介入で完了まで再実行する。 */
export function runNoInterventionBaseline(input: SprintBaselineInput): SprintBaselineResult {
  return runSprintSimulation(input);
}
