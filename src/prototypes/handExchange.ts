import { applyAction } from '../sim/actions';
import { dealHand, playCardFromHand } from '../sim/cards';
import { createOrgState } from '../sim/org';
import { createRng, createRngFromState, getRngState } from '../sim/rng';
import {
  createSprint,
  isAwaitingMinCompleteTick,
  resolveSprintConfig,
  stepSprint,
} from '../sim/sprint';
import type { CardInstance, OrgState, SprintState } from '../sim/types';

/** RI-186: 通常ランから隔離した、既存カード・工程を使う手札交換試作。 */
export interface HandExchangeState {
  version: 1;
  deck: CardInstance[];
  /** 未指定なら全所持カード。持ち込み試作では当該スプリントの対象位置を保存する。 */
  sprintDeckIndices?: number[];
  org: OrgState;
  sprint: SprintState;
  tick: number;
  rngState: number;
  paused: boolean;
  exchanges: number;
}

export const HAND_EXCHANGE_POLICY = { focusCost: 2, maxExchanges: 2 } as const;

export function createHandExchangePrototype(
  seed: string | number,
  workload: 'coding' | 'review' = 'coding',
): HandExchangeState {
  const org = createOrgState('default', false);
  const deck = ['copilot', 'feature-flags', 'docs', 'review-bot', 'auto-test', 'pr-size-limit'].map(
    (defId) => ({ defId, level: 1 }),
  );
  const rng = createRng(`${seed}:sprint`);
  const sprint = createSprint(
    resolveSprintConfig('default', {
      taskCount: 16,
      maxTicks: 8,
      minCompleteTick: 0,
      focusMax: 8,
    }),
    org,
    rng,
  );
  // 同じ仕事を工程だけ変えて比較する。カードの有利不利を出荷実測で見る。
  sprint.tasks.forEach((task) => {
    task.kind = 'routine';
    task.lane = workload;
  });
  sprint.cardPiles = dealHand(deck.length, createRng(`${seed}:hand`));
  return {
    version: 1,
    deck,
    org,
    sprint,
    tick: 0,
    rngState: getRngState(rng),
    paused: false,
    exchanges: 0,
  };
}

export type HandExchangeFailure =
  | 'paused'
  | 'complete'
  | 'limit'
  | 'no-card'
  | 'no-draw'
  | 'invalid'
  | 'no-focus';

/** 山札枯渇時に捨て札を再利用しない。失敗では全状態と乱数位置を維持する。 */
export function exchangeHandCard(
  state: HandExchangeState,
  deckIndex: number,
):
  | { ok: true; state: HandExchangeState; drawnIndex: number }
  | { ok: false; state: HandExchangeState; reason: HandExchangeFailure } {
  const { sprint } = state;
  let reason: HandExchangeFailure | undefined;
  const handIndex = sprint.cardPiles.hand.indexOf(deckIndex);
  const drawnIndex = sprint.cardPiles.drawOrder[0];
  const allCards = Object.values(sprint.cardPiles).flat();
  const expected = state.sprintDeckIndices ?? state.deck.map((_, index) => index);
  if (state.paused) reason = 'paused';
  else if (sprint.complete || isAwaitingMinCompleteTick(sprint)) reason = 'complete';
  else if (state.exchanges >= HAND_EXCHANGE_POLICY.maxExchanges) reason = 'limit';
  else if (handIndex < 0) reason = 'no-card';
  else if (drawnIndex === undefined) reason = 'no-draw';
  else if (
    expected.some((index) => !Number.isInteger(index) || index < 0 || !state.deck[index]) ||
    new Set(expected).size !== expected.length ||
    allCards.length !== expected.length ||
    new Set(allCards).size !== allCards.length ||
    allCards.some((index) => !Number.isInteger(index) || !expected.includes(index))
  )
    reason = 'invalid';
  else if (sprint.focus < HAND_EXCHANGE_POLICY.focusCost) reason = 'no-focus';
  if (reason) return { ok: false, state, reason };

  const next = structuredClone(state);
  next.sprint.cardPiles.hand.splice(handIndex, 1, drawnIndex!);
  next.sprint.cardPiles.drawOrder.shift();
  next.sprint.cardPiles.discard.push(deckIndex);
  next.sprint.focus -= HAND_EXCHANGE_POLICY.focusCost;
  next.sprint.metrics.focusSpent += HAND_EXCHANGE_POLICY.focusCost;
  next.exchanges += 1;
  return { ok: true, state: next, drawnIndex: drawnIndex! };
}

export function playHandExchangeCard(
  state: HandExchangeState,
  deckIndex: number,
): HandExchangeState {
  if (state.paused) return state;
  const next = structuredClone(state);
  const result = playCardFromHand(next.sprint, next.org, next.deck, deckIndex);
  return result.ok ? next : state;
}

/** 同一入力から再開できるよう、シミュレーション乱数の消費位置を保存する。 */
export function tickHandExchangePrototype(
  state: HandExchangeState,
  interrupt = false,
): HandExchangeState {
  if (state.paused || state.sprint.complete) return state;
  const next = structuredClone(state);
  const rng = createRngFromState(state.rngState);
  next.tick += 1;
  if (interrupt) applyAction('interruptReview', next.sprint, next.org, rng, next.tick);
  stepSprint(next.sprint, next.org, rng, next.tick);
  next.rngState = getRngState(rng);
  return next;
}

/** 先頭1枚だけ発動し、残集中力は割り込みレビューに使う共通方針。 */
export function compareHandExchangeStrategies(
  seed: string | number,
  workload: 'coding' | 'review',
) {
  return ([0, 1, 2] as const).map((attempts) => {
    let state = createHandExchangePrototype(seed, workload);
    const initialHand = [...state.sprint.cardPiles.hand];
    for (let i = 0; i < attempts; i += 1)
      state = exchangeHandCard(state, state.sprint.cardPiles.hand[0]).state;
    const selected = state.sprint.cardPiles.hand[0];
    state = playHandExchangeCard(state, selected);
    while (!state.sprint.complete) state = tickHandExchangePrototype(state, true);
    return {
      attempts,
      initialHand,
      selected: state.deck[selected].defId,
      exchanges: state.exchanges,
      delivered: state.sprint.metrics.delivered,
      completed: state.sprint.metrics.completedCount,
      unfinished: 16 - state.sprint.metrics.completedCount,
      focusSpent: state.sprint.metrics.focusSpent,
      focusRemaining: state.sprint.focus,
      interventions: state.sprint.metrics.interventionsUsed,
      seniorHp: state.org.seniorHp,
      techDebt: state.org.techDebt,
    };
  });
}
