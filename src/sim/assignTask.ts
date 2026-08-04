/**
 * タスク差配の対象解決・レーン移動・偏重ペナルティ（RI-30 / SPEC 第6.1）。
 *
 * `actions.ts` の EFFECTS から切り出した純関数。UI の武装→ドラッグと
 * `target` 省略時の後方互換自動選択の両方から使う。
 */
import type { ActionTarget, Lane, OrgState, SprintState, Task, TaskKind } from './types';
import { AI_DEP_PER_TASK } from './model';

/** タスク差配で進める Coding 進捗量（UI プレビューと共有）。 */
export const ASSIGN_PROGRESS = 0.5;
/** タスク差配の士気低下（UI プレビューと共有）。 */
export const ASSIGN_MORALE_COST = 3;

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

function spendStat(current: number, amount: number): { next: number; spent: number } {
  const next = clamp(current - amount, 0, 100);
  return { next, spent: current - next };
}

/** 差配可能なタスク（Coding、および Coding へ上げられる Backlog）。 */
export function assignableTasks(sprint: SprintState): Task[] {
  const codingCount = sprint.tasks.filter((t) => t.lane === 'coding').length;
  const canLiftBacklog = codingCount < sprint.config.codingSlots;
  return sprint.tasks.filter(
    (t) => t.lane === 'coding' || (t.lane === 'backlog' && canLiftBacklog),
  );
}

/** PR分割の候補（Review 優先 → Coding・未 split。後方互換の自動選択順）。 */
export function splitPrCandidates(sprint: SprintState): Task[] {
  const review = sprint.tasks.filter((t) => t.lane === 'review' && !t.split);
  const coding = sprint.tasks.filter((t) => t.lane === 'coding' && !t.split);
  return [...review, ...coding];
}

/** タスク規模から理想の担当を返す（SPEC「複雑→シニア、定型→AI」）。 */
export function idealAssignee(kind: TaskKind): 'ai' | 'senior' | null {
  if (kind === 'routine') return 'ai';
  if (kind === 'complex') return 'senior';
  return null;
}

/** kind と assignee が理想どおりか。 */
export function isIdealAssignment(kind: TaskKind, assignee: 'ai' | 'senior'): boolean {
  const ideal = idealAssignee(kind);
  if (ideal === null) return true;
  return ideal === assignee;
}

/**
 * 担当の既定値。`target.assignee` 省略時に使う。
 * routine→ai（AI 無効時は senior）、complex→senior、normal→現状維持相当（aiEnabled なら現状の aiAssisted）。
 */
export function defaultAssignee(task: Task, org: OrgState): 'ai' | 'senior' {
  const ideal = idealAssignee(task.kind);
  if (ideal === 'ai') return org.aiEnabled ? 'ai' : 'senior';
  if (ideal === 'senior') return 'senior';
  if (task.aiAssisted && org.aiEnabled) return 'ai';
  return 'senior';
}

/** WIP を見てレーン移動できるか。 */
export function canMoveToLane(sprint: SprintState, task: Task, lane: Lane): boolean {
  if (task.lane === lane) return true;
  if (lane !== 'backlog' && lane !== 'coding' && lane !== 'review') return false;
  // Part 1: backlog/coding 間のみ。review への移動は拒否（差配は実装フェーズ前）。
  if (lane === 'review') return false;
  if (task.lane !== 'backlog' && task.lane !== 'coding') return false;
  if (lane === 'coding' && task.lane === 'backlog') {
    const codingCount = sprint.tasks.filter((t) => t.lane === 'coding').length;
    if (codingCount >= sprint.config.codingSlots) return false;
  }
  return true;
}

/** target 省略時は Coding 内の complex 優先（従来挙動）。 */
export function resolveAssignTaskTarget(
  sprint: SprintState,
  target?: ActionTarget,
): Task | undefined {
  if (target) {
    const task = sprint.tasks.find((t) => t.id === target.taskId);
    if (!task) return undefined;
    if (task.lane !== 'backlog' && task.lane !== 'coding') return undefined;
    return task;
  }
  const coding = sprint.tasks.filter((t) => t.lane === 'coding');
  return coding.find((t) => t.kind === 'complex') ?? coding[0];
}

/** PR分割の対象解決（省略時は Review→Coding の順で complex 優先。従来互換）。 */
export function resolveSplitPrTarget(sprint: SprintState, target?: ActionTarget): Task | undefined {
  if (target) {
    const task = sprint.tasks.find((t) => t.id === target.taskId);
    if (!task) return undefined;
    if (task.split) return undefined;
    if (task.lane !== 'review' && task.lane !== 'coding') return undefined;
    return task;
  }
  const candidates = splitPrCandidates(sprint);
  return candidates.find((t) => t.kind === 'complex') ?? candidates[0];
}

/**
 * 偏重を加味した士気コスト。
 * 理想差配は半減、ミスマッチはフル + streak ボーナス。
 */
export function computeAssignMoraleCost(
  kind: TaskKind,
  assignee: 'ai' | 'senior',
  mismatchStreak: number,
): number {
  if (isIdealAssignment(kind, assignee)) {
    return Math.max(1, Math.floor(ASSIGN_MORALE_COST / 2));
  }
  return ASSIGN_MORALE_COST + Math.min(3, mismatchStreak);
}

/**
 * `applyAssignTaskEffect` と同じ前提を盤面非破壊で判定する（RI-89）。
 * target 省略時は自動選択対象の有無のみ見る。
 */
export function canApplyAssignTaskTarget(
  sprint: SprintState,
  org: OrgState,
  target?: ActionTarget,
): boolean {
  const task = resolveAssignTaskTarget(sprint, target);
  if (!task) return false;

  // Backlog 上の進捗は intake で消えるため、明示的な Backlog ドロップは拒否する。
  if (target?.lane === 'backlog') return false;

  // 失敗時にレーンを動かさないよう、担当の妥当性を先に検査する。
  if (target?.assignee === 'ai' && !org.aiEnabled) return false;

  if (target?.lane && target.lane !== task.lane) {
    if (!canMoveToLane(sprint, task, target.lane)) return false;
  }

  // Backlog に残る場合は Coding へ上げられる必要がある（効果適用時と同じ）。
  const laneAfter = target?.lane && target.lane !== task.lane ? target.lane : task.lane;
  if (laneAfter === 'backlog') {
    if (!canMoveToLane(sprint, task, 'coding')) return false;
  }
  return true;
}

/** タスク差配を適用する。成功時はペイロード、失敗時は false。 */
export function applyAssignTaskEffect(
  sprint: SprintState,
  org: OrgState,
  target?: ActionTarget,
): { affectedTaskIds: number[]; moraleCost: number } | false {
  if (!canApplyAssignTaskTarget(sprint, org, target)) return false;
  const task = resolveAssignTaskTarget(sprint, target)!;
  const assignee = target?.assignee ?? defaultAssignee(task, org);

  if (target?.lane && target.lane !== task.lane) {
    task.lane = target.lane;
  }

  // Backlog に残ったまま加速すると intake で進捗が消えるため Coding へ上げる。
  if (task.lane === 'backlog') {
    task.lane = 'coding';
  }

  const wantAi = assignee === 'ai' && org.aiEnabled;
  if (wantAi && !task.aiAssisted) {
    // intake() と同様、AI 割当への切替で依存度を上げる。
    const gain = sprint.config.aiDependencyPerTask ?? AI_DEP_PER_TASK;
    org.aiDependency = clamp(org.aiDependency + gain, 0, 100);
  }
  task.aiAssisted = wantAi;

  task.progress = clamp(task.progress + ASSIGN_PROGRESS, 0, 0.999);
  task.split = true;

  const skew = sprint.metrics.assignmentSkew ?? { mismatchStreak: 0 };
  const ideal = isIdealAssignment(task.kind, assignee);
  const cost = computeAssignMoraleCost(task.kind, assignee, skew.mismatchStreak);
  skew.mismatchStreak = ideal ? 0 : skew.mismatchStreak + 1;
  sprint.metrics.assignmentSkew = skew;

  const morale = spendStat(org.morale, cost);
  org.morale = morale.next;
  return { affectedTaskIds: [task.id], moraleCost: morale.spent };
}
