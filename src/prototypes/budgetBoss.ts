/** RI-262: 同じ予算から、仕事群ごとに既存施策を選ぶ固定試作。 */
import { getCard } from '../data/cards';
import { playCardFromHand, playCost } from '../sim/cards';
import { createOrgState } from '../sim/org';
import { createRng } from '../sim/rng';
import { discountedShopPrice } from '../sim/run/shopPrice';
import { createSprint, resolveSprintConfig, stepSprint } from '../sim/sprint';
import type { TaskKind } from '../sim/types';

const DEFAULT_BUDGET = 18;
const GOAL = { minDone: 23, minCriticalDone: 10 };

const CARD_IDS = ['auto-test', 'copilot'] as const;
type CardId = (typeof CARD_IDS)[number];
type BatchId = 'routine-first' | 'critical' | 'routine-last';

interface Batch {
  id: BatchId;
  kind: TaskKind;
  highValue: boolean;
  taskCount: number;
  maxTicks: number;
}

const BATCHES: readonly Batch[] = [
  { id: 'routine-first', kind: 'routine', highValue: false, taskCount: 12, maxTicks: 12 },
  { id: 'critical', kind: 'complex', highValue: true, taskCount: 12, maxTicks: 27 },
  { id: 'routine-last', kind: 'routine', highValue: false, taskCount: 12, maxTicks: 12 },
];

const SCENARIO = 'default';
const AI_ENABLED = true;
const CARD_LEVEL = 1;
const SHOP_DISCOUNT = 0;

function offer(cardId: CardId) {
  const def = getCard(cardId);
  if (!def) throw new Error(`試作で使うカードがありません: ${cardId}`);
  return {
    cardId,
    level: CARD_LEVEL,
    price: discountedShopPrice(def.cost, SHOP_DISCOUNT),
    focusCost: playCost(def.focusCost, CARD_LEVEL),
    effects: { ...def.base },
  };
}

function batchConfig(batch: Batch) {
  return resolveSprintConfig(SCENARIO, {
    taskCount: batch.taskCount,
    codingSlots: 4,
    maxTicks: batch.maxTicks,
    minCompleteTick: 0,
  });
}

export function previewBudgetBoss(state: BudgetBossState) {
  return {
    startingBudget: state.startingBudget,
    goal: { ...GOAL },
    scenario: SCENARIO,
    startingOrg: createOrgState(SCENARIO, AI_ENABLED),
    shopDiscount: SHOP_DISCOUNT,
    cards: CARD_IDS.map(offer),
    batches: BATCHES.map((batch) => ({
      id: batch.id,
      kind: batch.kind,
      highValue: batch.highValue,
      config: batchConfig(batch),
    })),
  };
}

export interface BudgetBossDecision {
  readonly batchId: BatchId;
  readonly cardId: CardId | null;
}

interface BatchOutcome {
  input: BudgetBossDecision;
  spent: number;
  focusSpent: number;
  ticks: number;
  codingPassed: number;
  done: number;
  delivered: number;
  rework: number;
  incidents: number;
  timedOut: boolean;
}

export interface BudgetBossState {
  readonly seed: string;
  readonly startingBudget: number;
  readonly batches: readonly Readonly<BatchOutcome>[];
}

export function createBudgetBoss(seed: string, startingBudget = DEFAULT_BUDGET): BudgetBossState {
  if (!Number.isSafeInteger(startingBudget) || startingBudget < 0) {
    throw new RangeError('開始予算は非負の整数にしてください');
  }
  return { seed, startingBudget, batches: [] };
}

function spentSoFar(state: BudgetBossState): number {
  return state.batches.reduce((total, batch) => total + batch.spent, 0);
}

export function viewBudgetBoss(state: BudgetBossState) {
  const spent = spentSoFar(state);
  const done = state.batches.reduce((total, batch) => total + batch.done, 0);
  const criticalDone = state.batches.find(({ input }) => input.batchId === 'critical')?.done ?? 0;
  const nextBatch = BATCHES[state.batches.length]?.id ?? null;
  return {
    nextBatch,
    spent,
    remainingBudget: state.startingBudget - spent,
    done,
    criticalDone,
    delivered: state.batches.reduce((total, batch) => total + batch.delivered, 0),
    rework: state.batches.reduce((total, batch) => total + batch.rework, 0),
    incidents: state.batches.reduce((total, batch) => total + batch.incidents, 0),
    cleared:
      nextBatch === null ? done >= GOAL.minDone && criticalDone >= GOAL.minCriticalDone : null,
  };
}

/** 仕事群の開始時に1回だけ選択し、その仕事群を期限まで進める。null は無支出で進行する。 */
export function advanceBudgetBoss(
  state: BudgetBossState,
  input: BudgetBossDecision,
): BudgetBossState {
  const batch = BATCHES[state.batches.length];
  if (!batch || batch.id !== input.batchId) return state;
  const { cardId } = input;
  if (cardId !== null && !CARD_IDS.includes(cardId)) return state;

  const spent = cardId === null ? 0 : offer(cardId).price;
  if (spent > state.startingBudget - spentSoFar(state)) return state;

  const org = createOrgState(SCENARIO, AI_ENABLED);
  const seed = `${state.seed}:${batch.id}`;
  const sprint = createSprint(batchConfig(batch), org, createRng(`${seed}:layout`));
  for (const task of sprint.tasks) {
    task.kind = batch.kind;
    task.highValue = batch.highValue;
  }
  if (cardId !== null) {
    sprint.cardPiles.hand = [0];
    const play = playCardFromHand(sprint, org, [{ defId: cardId, level: CARD_LEVEL }], 0);
    if (!play.ok) throw new Error(`試作のカードを発動できません: ${cardId}`);
  }

  const rng = createRng(seed);
  let ticks = 0;
  while (!sprint.complete) {
    ticks += 1;
    stepSprint(sprint, org, rng, ticks);
  }
  const codingPassed = sprint.tasks.filter(
    ({ lane }) => lane !== 'backlog' && lane !== 'coding',
  ).length;
  const { doneCount, delivered, reworkCount, incidentCount, focusSpent, timedOut } = sprint.metrics;
  return {
    ...state,
    batches: [
      ...state.batches,
      {
        input: { ...input },
        spent,
        focusSpent,
        ticks,
        codingPassed,
        done: doneCount,
        delivered,
        rework: reworkCount,
        incidents: incidentCount,
        timedOut: timedOut ?? false,
      },
    ],
  };
}
