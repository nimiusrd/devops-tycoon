/**
 * 危険状態の反実仮想評価（RI-101 / SPEC 第19.1 F-8・F-9）。
 *
 * 同一乱数状態から無介入と適用可能介入を分岐し、敗北遅延・回避・危険域離脱・
 * 敗因変化だけを有効手として集計する。what-if の同 seed 再実行とは別系統。
 */
import { canApplyAction } from '../actions';
import { assignableTasks } from '../assignTask';
import type { ActionId } from '../types';
import { activeDangerReasons, listApplicableActions, type DangerLoseReason } from './dangerZone';
import { RunEngine } from './engine';
import type { CounterfactualFrame } from './persist';
import type { LoseReason, RunStatus } from './types';

/** 無介入 1 + 介入ブランチの上限。超過分は評価せず skipped に残す。 */
export const DEFAULT_MAX_ACTION_BRANCHES = 8;
/** フォーク後に進める追加スプリント数の既定。 */
export const DEFAULT_MAX_SPRINTS = 4;

export interface CounterfactualOrigin {
  sprintsPlayed: number;
  quarter: number;
  index: number;
}

export interface CounterfactualBranchResult {
  /** `null` は無介入ベースライン。 */
  actionId: ActionId | null;
  sprintsToLose: number | null;
  leftDanger: boolean;
  loseReason: LoseReason | null;
  status: RunStatus;
  truncated: boolean;
}

export interface CounterfactualEvaluation {
  origin: CounterfactualOrigin;
  originDangers: DangerLoseReason[];
  applicableActions: ActionId[];
  skippedActions: ActionId[];
  baseline: CounterfactualBranchResult;
  branches: CounterfactualBranchResult[];
}

export interface CounterfactualEvaluateOptions {
  maxSprints?: number;
  maxActionBranches?: number;
  /** 省略時はフレーム復元時点の機械的発動可能手。 */
  actions?: readonly ActionId[];
}

export function restoreCounterfactualEngine(frame: CounterfactualFrame): RunEngine {
  const engine = new RunEngine({
    seed: frame.persist.seed,
    difficulty: frame.persist.difficulty,
    trials: frame.persist.trials,
  });
  engine.hydrateCounterfactualFrame(frame);
  return engine;
}

function applyChoice(engine: RunEngine, id: ActionId): void {
  const s = engine.snapshot();
  if (s.phase !== 'sprint' || !s.sprint) return;
  if (id === 'assignTask' && !canApplyAction('assignTask', s.sprint, s.org, s.sprintTick).ok) {
    const task = assignableTasks(s.sprint)[0];
    if (task) {
      engine.dispatch('assignTask', { taskId: task.id, lane: 'coding' });
    }
    return;
  }
  engine.dispatch(id);
}

function originDangersLeft(origin: ReadonlySet<DangerLoseReason>, engine: RunEngine): boolean {
  if (origin.size === 0) return false;
  return activeDangerReasons(engine).every((reason) => !origin.has(reason));
}

function driveIdle(
  engine: RunEngine,
  originDangers: ReadonlySet<DangerLoseReason>,
  maxSprints: number,
): Omit<CounterfactualBranchResult, 'actionId'> {
  const startPlayed = engine.snapshot().sprintsPlayed;
  let leftDanger = originDangersLeft(originDangers, engine);
  let guard = 0;
  while (engine.snapshot().status === 'playing' && guard < 4_000) {
    guard += 1;
    const s = engine.snapshot();
    if (s.sprintsPlayed - startPlayed >= maxSprints && s.phase !== 'sprint') {
      return {
        sprintsToLose: null,
        leftDanger,
        loseReason: null,
        status: s.status,
        truncated: true,
      };
    }
    if (originDangersLeft(originDangers, engine)) leftDanger = true;
    switch (s.phase) {
      case 'setup':
        engine.beginSetupSprint();
        break;
      case 'sprint':
        engine.step(1_000_000);
        break;
      case 'result':
        engine.acknowledgeResult();
        break;
      case 'draft':
        engine.skipDraft();
        break;
      case 'evolution':
        engine.finishEvolution();
        break;
      case 'beat':
        engine.resolveBeat(0);
        break;
      case 'shop':
        engine.leaveShop();
        break;
      case 'rest':
        engine.restChoose('heal');
        break;
      case 'recruit':
        engine.recruitChoose('skip');
        break;
      case 'quarterReview': {
        const review = s.quarterReview;
        if (review?.outcome === 'missed_adjustable') {
          const pick = review.availableAdjustments[0] ?? 'cut_scope';
          engine.chooseGoalAdjustment(pick);
        } else {
          engine.acknowledgeQuarterReview();
        }
        break;
      }
      default:
        return {
          sprintsToLose: null,
          leftDanger,
          loseReason: engine.snapshot().loseReason ?? null,
          status: engine.snapshot().status,
          truncated: true,
        };
    }
  }
  const end = engine.snapshot();
  if (originDangersLeft(originDangers, engine)) leftDanger = true;
  return {
    sprintsToLose: end.status === 'lost' ? end.sprintsPlayed : null,
    leftDanger,
    loseReason: end.loseReason ?? null,
    status: end.status,
    truncated: end.status === 'playing',
  };
}

function runBranch(
  frame: CounterfactualFrame,
  actionId: ActionId | null,
  originDangers: ReadonlySet<DangerLoseReason>,
  maxSprints: number,
): CounterfactualBranchResult {
  const engine = restoreCounterfactualEngine(frame);
  if (actionId) applyChoice(engine, actionId);
  return { actionId, ...driveIdle(engine, originDangers, maxSprints) };
}

export function evaluateCounterfactual(
  frame: CounterfactualFrame,
  options: CounterfactualEvaluateOptions = {},
): CounterfactualEvaluation {
  const maxSprints = options.maxSprints ?? DEFAULT_MAX_SPRINTS;
  const maxActionBranches = options.maxActionBranches ?? DEFAULT_MAX_ACTION_BRANCHES;
  const probe = restoreCounterfactualEngine(frame);
  const snap = probe.snapshot();
  const origin: CounterfactualOrigin = {
    sprintsPlayed: snap.sprintsPlayed,
    quarter: snap.quarterNumber,
    index: snap.sprintIndexInQuarter,
  };
  const dangers = activeDangerReasons(probe);
  const originDangers = new Set(dangers);
  const applicable = [...(options.actions ?? listApplicableActions(probe))];
  const toEval = applicable.slice(0, maxActionBranches);
  const skippedActions = applicable.slice(maxActionBranches);
  const baseline = runBranch(frame, null, originDangers, maxSprints);
  const branches = toEval.map((id) => runBranch(frame, id, originDangers, maxSprints));
  return {
    origin,
    originDangers: dangers,
    applicableActions: applicable,
    skippedActions,
    baseline,
    branches,
  };
}

/** ベースラインに対して介入が有効か（F-8 / F-9 共通の集計規則）。 */
export function isEffectiveChoice(
  baseline: CounterfactualBranchResult,
  branch: CounterfactualBranchResult,
): boolean {
  const delayed =
    branch.sprintsToLose != null &&
    baseline.sprintsToLose != null &&
    branch.sprintsToLose > baseline.sprintsToLose;
  const avoided = baseline.status === 'lost' && branch.status !== 'lost';
  const leftDanger = branch.leftDanger && !baseline.leftDanger;
  const reasonChanged =
    baseline.loseReason != null &&
    branch.loseReason != null &&
    branch.loseReason !== baseline.loseReason;
  return delayed || avoided || leftDanger || reasonChanged;
}

export function effectiveActionsOf(evaluation: CounterfactualEvaluation): ActionId[] {
  return evaluation.branches
    .filter((branch) => branch.actionId && isEffectiveChoice(evaluation.baseline, branch))
    .map((branch) => branch.actionId as ActionId);
}

export interface F8RecoveryJudgment {
  lastEffectiveSprints: number | null;
  gap: number | null;
  hasRecovery: boolean;
}

/** F-8: 有効手が残る最後の時点と、敗北までのギャップ。機械的非空手だけでは有効にしない。 */
export function judgeF8Recovery(
  samples: readonly { sprintsPlayed: number; effectiveActions: readonly string[] }[],
  loseSprints: number,
): F8RecoveryJudgment {
  let lastEffectiveSprints: number | null = null;
  for (const sample of samples) {
    if (sample.effectiveActions.length > 0) lastEffectiveSprints = sample.sprintsPlayed;
  }
  return {
    lastEffectiveSprints,
    gap: lastEffectiveSprints == null ? null : Math.max(0, loseSprints - lastEffectiveSprints),
    hasRecovery: lastEffectiveSprints != null,
  };
}

export interface F9EffectiveSetJudgment {
  byReason: Record<string, string[]>;
  distinctEffectiveSetCount: number;
}

/** F-9: 敗因ごとの有効手集合。機械的発動可能集合とは別に数える。 */
export function judgeF9EffectiveSets(
  runs: readonly { loseReason: LoseReason; effectiveActions: readonly string[] }[],
): F9EffectiveSetJudgment {
  const union = new Map<LoseReason, Set<string>>();
  for (const run of runs) {
    let set = union.get(run.loseReason);
    if (!set) {
      set = new Set();
      union.set(run.loseReason, set);
    }
    for (const id of run.effectiveActions) set.add(id);
  }
  const byReason: Record<string, string[]> = {};
  const keys: string[] = [];
  for (const [reason, set] of [...union.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const actions = [...set].sort();
    byReason[reason] = actions;
    keys.push(actions.join(','));
  }
  return {
    byReason,
    distinctEffectiveSetCount: new Set(keys).size,
  };
}
