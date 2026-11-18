import { getCard } from '../data/cards';
import { playCardFromHand, playCost } from '../sim/cards';
import { REVIEW_HP_COST, taskValue } from '../sim/model';
import { createOrgState } from '../sim/org';
import { createRng, createRngFromState, getRngState } from '../sim/rng';
import { createSprint, resolveSprintConfig, stepSprint, summarizeSprint } from '../sim/sprint';
import type { CardInstance, OrgState, SprintState, Task } from '../sim/types';

/** RI-266: 通常ラン・storage・報酬へ接続しない、順序だけを選ぶ実sim試作。 */
export const REVIEW_MANAGER_RULESET = 'ri266-review-manager-v1';
export const REVIEW_MANAGER_LIMITS = { ticks: 60, tasks: 12, seedLength: 128, saveBytes: 65536 };
const CARD_ID = 'auto-test';
type Group = 'important' | 'ordinary';
export type ReviewManagerInput = { type: 'start' } | { type: 'tick'; order?: number[] };
export interface ReviewManagerOptions {
  budget: number;
  maxTicks: number;
}
export interface ReviewManagerState {
  version: 1;
  ruleset: typeof REVIEW_MANAGER_RULESET;
  seed: string;
  options: ReviewManagerOptions;
  phase: 'ready' | 'running' | 'completed' | 'failed';
  current: {
    org: OrgState;
    sprint: SprintState;
    deck: CardInstance[];
    tick: number;
    rngState: number;
    budget: number;
    wait: Record<number, number>;
    reviews: Record<number, number>;
  } | null;
  investmentLog: {
    tick: 0;
    card: typeof CARD_ID;
    outcome: 'applied' | 'insufficient-budget';
    budgetSpent: number;
    focusSpent: number;
  }[];
  inputs: ReviewManagerInput[];
}

export function createReviewManager(
  seed: string,
  options: Partial<ReviewManagerOptions> = {},
): ReviewManagerState {
  const spec = { budget: 24, maxTicks: 24, ...options };
  if (
    typeof seed !== 'string' ||
    seed.length > REVIEW_MANAGER_LIMITS.seedLength ||
    !Number.isInteger(spec.budget) ||
    spec.budget < 0 ||
    spec.budget > 1000 ||
    !Number.isInteger(spec.maxTicks) ||
    spec.maxTicks < 1 ||
    spec.maxTicks > REVIEW_MANAGER_LIMITS.ticks
  )
    throw new Error('Invalid RI-266 configuration');
  return {
    version: 1,
    ruleset: REVIEW_MANAGER_RULESET,
    seed,
    options: spec,
    phase: 'ready',
    current: null,
    investmentLog: [],
    inputs: [],
  };
}

export function viewReviewManager(state: ReviewManagerState) {
  const card = getCard(CARD_ID)!;
  return {
    phase: state.phase,
    policy: {
      card: CARD_ID,
      level: 1,
      trigger: 'start-once' as const,
      acquisitionCost: card.cost,
      playFocusCost: playCost(card.focusCost, 1),
      effects: { ...card.base },
    },
    initialBudget: state.options.budget,
    initialFocus: 8,
    orderFocusCost: 0,
    maxTicks: state.options.maxTicks,
    reviewQueue:
      state.current?.sprint.tasks
        .filter((t) => t.lane === 'review')
        .map((t) => ({
          id: t.id,
          group: groupOf(t),
          kind: t.kind,
          baseValue: taskValue(t),
          waitTicks: state.current!.wait[t.id],
          reworkAttempts: t.reworkAttempts,
        })) ?? [],
    investmentLog: structuredClone(state.investmentLog),
  };
}

function groupOf(task: Task): Group {
  return task.highValue ? 'important' : 'ordinary';
}

function isInput(value: unknown): value is ReviewManagerInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (input.type === 'start') return keys.length === 1;
  return (
    input.type === 'tick' &&
    keys.every((k) => k === 'type' || k === 'order') &&
    (input.order === undefined ||
      (Array.isArray(input.order) &&
        input.order.length <= REVIEW_MANAGER_LIMITS.tasks &&
        input.order.every(
          (id) => Number.isInteger(id) && id >= 0 && id < REVIEW_MANAGER_LIMITS.tasks,
        ) &&
        new Set(input.order).size === input.order.length))
  );
}

/** 不成立入力は費用・時計・RNG・履歴を変えず同じ参照を返す。 */
export function applyReviewManager(state: ReviewManagerState, input: unknown): ReviewManagerState {
  if (
    state.version !== 1 ||
    state.ruleset !== REVIEW_MANAGER_RULESET ||
    !isInput(input) ||
    state.phase === 'completed' ||
    state.phase === 'failed'
  )
    return state;
  if (input.type === 'start') {
    if (state.phase !== 'ready') return state;
    const card = getCard(CARD_ID)!;
    const next = structuredClone(state);
    next.inputs.push({ type: 'start' });
    if (state.options.budget < card.cost) {
      next.phase = 'failed';
      next.investmentLog.push({
        tick: 0,
        card: CARD_ID,
        outcome: 'insufficient-budget',
        budgetSpent: 0,
        focusSpent: 0,
      });
      return next;
    }
    const org = createOrgState('default', true);
    const rng = createRng(`${REVIEW_MANAGER_RULESET}:${state.seed}`);
    const sprint = createSprint(
      resolveSprintConfig('default', {
        taskCount: REVIEW_MANAGER_LIMITS.tasks,
        focusMax: 8,
        minCompleteTick: 0,
        maxTicks: state.options.maxTicks,
      }),
      org,
      rng,
    );
    // 履歴の捏造ではなく開始用fixture。全12件がレビュー待ち、4件が高価値の複雑変更。
    for (const task of sprint.tasks) {
      task.lane = 'review';
      task.aiAssisted = true;
      task.highValue = task.id % 3 === 2;
      task.kind = task.highValue ? 'complex' : 'routine';
    }
    const deck: CardInstance[] = [{ defId: CARD_ID, level: 1 }];
    sprint.cardPiles.hand = [0];
    const played = playCardFromHand(sprint, org, deck, 0);
    if (!played.ok) throw new Error('RI-266 fixed investment must be playable');
    next.current = {
      org,
      sprint,
      deck,
      tick: 0,
      rngState: getRngState(rng),
      budget: state.options.budget - card.cost,
      wait: Object.fromEntries(sprint.tasks.map((t) => [t.id, 0])),
      reviews: Object.fromEntries(sprint.tasks.map((t) => [t.id, 0])),
    };
    next.phase = 'running';
    next.investmentLog.push({
      tick: 0,
      card: CARD_ID,
      outcome: 'applied',
      budgetSpent: card.cost,
      focusSpent: sprint.metrics.focusSpent,
    });
    return next;
  }
  if (state.phase !== 'running' || !state.current) return state;
  const queue = state.current.sprint.tasks.filter((t) => t.lane === 'review');
  if (
    input.order &&
    (input.order.length !== queue.length || !queue.every((t) => input.order!.includes(t.id)))
  )
    return state;
  const next = structuredClone(state);
  const current = next.current!;
  const sprint = current.sprint;
  for (const task of queue) current.wait[task.id] += 1;
  if (input.order) {
    const byId = new Map(sprint.tasks.map((t) => [t.id, t]));
    let index = 0;
    // レビュー用の配列位置だけを入れ替え、他工程の並びは保持する。
    sprint.tasks = sprint.tasks.map((t) =>
      t.lane === 'review' ? byId.get(input.order![index++])! : t,
    );
  }
  const rng = createRngFromState(current.rngState);
  current.tick += 1;
  stepSprint(sprint, current.org, rng, current.tick);
  current.rngState = getRngState(rng);
  // 実reviewOneの出荷/手戻り/点火から試行回数を数える。延焼による点火はレビューに数えない。
  const reviewed = sprint.tasks
    .filter((t) => t.lane === 'done' && queue.some((q) => q.id === t.id))
    .map((t) => t.id);
  for (const event of sprint.events.filter((event) => event.tick === current.tick)) {
    if (
      ((event.kind === 'ignite' && event.source === 'review') ||
        (event.kind === 'combo-break' && event.reason === 'rework')) &&
      event.taskId !== undefined
    )
      reviewed.push(event.taskId);
  }
  for (const id of reviewed) current.reviews[id] += 1;
  // 次tickの対照はID順。選択がないtickは自動で順序方針を維持しない。
  sprint.tasks.sort((a, b) => a.id - b.id);
  next.inputs.push(
    input.order === undefined ? { type: 'tick' } : { type: 'tick', order: [...input.order] },
  );
  if (sprint.complete) next.phase = 'completed';
  return next;
}

export function summarizeReviewManager(state: ReviewManagerState) {
  if (!state.current || state.phase !== 'completed') return null;
  const { sprint, org, wait, reviews, tick, budget, rngState } = state.current;
  const result = summarizeSprint(sprint, org);
  const groups = Object.fromEntries(
    (['important', 'ordinary'] as const).map((group) => {
      const tasks = sprint.tasks.filter((t) => groupOf(t) === group);
      const attempts = tasks.reduce((sum, t) => sum + reviews[t.id], 0);
      return [
        group,
        {
          total: tasks.length,
          done: tasks.filter((t) => t.lane === 'done').length,
          // コンボ/AI倍率の配賦を捏造しない。実出荷ポイントは全体deliveredだけ。
          completedBaseValue: tasks
            .filter((t) => t.lane === 'done')
            .reduce((sum, t) => sum + taskValue(t), 0),
          reviewOccupancyTicks: tasks.reduce((sum, t) => sum + wait[t.id], 0),
          reviewAttempts: attempts,
          // HP0でのclampや自然回復を含まない要求量。実残体力とは区別する。
          reviewHpDemand:
            attempts *
            REVIEW_HP_COST *
            sprint.cardEffects.seniorHpCostMul *
            sprint.cardEffects.reviewHpCostMul,
          autoContainHpSpent: sprint.fireEvents.reduce(
            (sum, e) =>
              sum +
              (e.kind === 'auto-contain' && tasks.some((t) => t.id === e.taskId) ? e.hpCost : 0),
            0,
          ),
        },
      ];
    }),
  );
  return {
    ticks: tick,
    delivered: result.delivered,
    done: result.done,
    timedOut: result.timedOut ?? false,
    seniorHp: org.seniorHp,
    techDebt: org.techDebt,
    incidents: result.incidents,
    rework: result.rework,
    spread: result.spread,
    budget,
    focus: sprint.focus,
    focusSpent: sprint.metrics.focusSpent,
    groups,
    rngState,
    reward: 0,
  };
}

/** 保存は最大61入力とRNGチェックポイント。実sim状態は同rulesetで再構築する。 */
export function saveReviewManager(state: ReviewManagerState): string {
  return JSON.stringify({
    version: state.version,
    ruleset: state.ruleset,
    seed: state.seed,
    options: state.options,
    inputs: state.inputs,
    rngState: state.current?.rngState ?? null,
  });
}

export function restoreReviewManager(json: string): ReviewManagerState | null {
  if (
    typeof json !== 'string' ||
    json.length > REVIEW_MANAGER_LIMITS.saveBytes ||
    new TextEncoder().encode(json).length > REVIEW_MANAGER_LIMITS.saveBytes
  )
    return null;
  try {
    const value = JSON.parse(json);
    if (
      !value ||
      value.version !== 1 ||
      value.ruleset !== REVIEW_MANAGER_RULESET ||
      !value.options ||
      !Number.isInteger(value.options.maxTicks) ||
      !Number.isInteger(value.options.budget) ||
      !Array.isArray(value.inputs) ||
      value.inputs.length > REVIEW_MANAGER_LIMITS.ticks + 1
    )
      return null;
    let state = createReviewManager(value.seed, value.options);
    for (const input of value.inputs) {
      const next = applyReviewManager(state, input);
      if (next === state) return null;
      state = next;
    }
    return (state.current?.rngState ?? null) === value.rngState ? state : null;
  } catch {
    return null;
  }
}

export function compareReviewManager(seed: string, maxTicks = 24) {
  return (['none', 'important-first', 'ordinary-first'] as const).map((policy) => {
    let state = applyReviewManager(createReviewManager(seed, { maxTicks }), { type: 'start' });
    const initial = structuredClone(state.current);
    while (state.phase === 'running') {
      const queue = state.current!.sprint.tasks.filter((t) => t.lane === 'review');
      const order =
        policy === 'none'
          ? undefined
          : [...queue]
              .sort((a, b) => {
                const priority = Number(b.highValue) - Number(a.highValue);
                return (policy === 'important-first' ? priority : -priority) || a.id - b.id;
              })
              .map((t) => t.id);
      state = applyReviewManager(state, order ? { type: 'tick', order } : { type: 'tick' });
    }
    return {
      seed,
      maxTicks,
      policy,
      initial,
      inputs: state.inputs,
      investmentLog: state.investmentLog,
      result: summarizeReviewManager(state)!,
    };
  });
}
