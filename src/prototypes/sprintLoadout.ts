import { getBoss } from '../data/bosses';
import { dealHand } from '../sim/cards';
import { createRng } from '../sim/rng';
import type { CardInstance } from '../sim/types';
import {
  createHandExchangePrototype,
  exchangeHandCard,
  playHandExchangeCard,
  tickHandExchangePrototype,
  type HandExchangeState,
} from './handExchange';

export const SPRINT_LOADOUT_LIMITS = { min: 3, max: 6 } as const;
export type LoadoutBoss = 'big-release' | 'security-audit';

/** RI-187: 所持インスタンスの位置、持ち込み候補、実手札を分ける。 */
export interface SprintLoadoutState {
  version: 1;
  seed: string | number;
  collection: CardInstance[];
  selected: number[];
  sprintNumber: number;
  current: HandExchangeState | null;
}

export function createSprintLoadoutPrototype(seed: string | number): SprintLoadoutState {
  const base = createHandExchangePrototype(seed);
  return {
    version: 1,
    seed,
    collection: base.deck,
    selected: base.deck.map((_, i) => i),
    sprintNumber: 0,
    current: null,
  };
}

/** 期首・完了後に変更する。選択順では抽選を操作できないよう所持位置で正規化する。 */
export function selectSprintLoadout(
  state: SprintLoadoutState,
  indices: readonly number[],
): SprintLoadoutState {
  if (state.current && !state.current.sprint.complete) return state;
  if (
    indices.length < SPRINT_LOADOUT_LIMITS.min ||
    indices.length > SPRINT_LOADOUT_LIMITS.max ||
    new Set(indices).size !== indices.length ||
    indices.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= state.collection.length,
    )
  )
    return state;
  return { ...state, selected: [...indices].sort((a, b) => a - b) };
}

/** 抽選は候補位置で行い、カードの恒久的な所持位置へ写す。未選択は保持するが配らない。 */
export function beginSprintLoadout(
  state: SprintLoadoutState,
  boss: LoadoutBoss,
): SprintLoadoutState {
  if (state.current && !state.current.sprint.complete) return state;
  const sprintNumber = state.sprintNumber + 1;
  const current = createHandExchangePrototype(
    `${state.seed}:sprint:${sprintNumber}`,
    boss === 'big-release' ? 'coding' : 'review',
  );
  current.deck = structuredClone(state.current?.deck ?? state.collection);
  current.sprintDeckIndices = [...state.selected];
  if (state.current) current.org = structuredClone(state.current.org);
  else current.org.quality = 45; // 品質50が問われる監査へ準備する固定比較条件。
  current.sprint.metrics.seniorHpStart = current.org.seniorHp;
  const piles = dealHand(state.selected.length, createRng(`${state.seed}:loadout:${sprintNumber}`));
  current.sprint.cardPiles = {
    hand: piles.hand.map((index) => state.selected[index]),
    drawOrder: piles.drawOrder.map((index) => state.selected[index]),
    discard: [],
    played: [],
  };
  return { ...state, sprintNumber, collection: structuredClone(current.deck), current };
}

export function playSprintLoadoutCard(
  state: SprintLoadoutState,
  index: number,
): SprintLoadoutState {
  if (!state.current) return state;
  const current = playHandExchangeCard(state.current, index);
  return current === state.current
    ? state
    : { ...state, current, collection: structuredClone(current.deck) };
}

export function exchangeSprintLoadoutCard(
  state: SprintLoadoutState,
  index: number,
): SprintLoadoutState {
  if (!state.current) return state;
  const result = exchangeHandCard(state.current, index);
  return result.ok ? { ...state, current: result.state } : state;
}

export function tickSprintLoadout(
  state: SprintLoadoutState,
  interrupt = false,
): SprintLoadoutState {
  if (!state.current) return state;
  const current = tickHandExchangePrototype(state.current, interrupt);
  return current === state.current ? state : { ...state, current };
}

/** 手札内に目的カードが無ければ1回だけ交換し、発動1枚＋残集中力を介入へ回す。 */
export function compareSprintLoadouts(seed: string | number, boss: LoadoutBoss) {
  const choices = { speed: [0, 1, 2], quality: [3, 4, 5], broad: [0, 1, 2, 3, 4, 5] } as const;
  const desired = boss === 'big-release' ? 'copilot' : 'auto-test';
  return (Object.keys(choices) as (keyof typeof choices)[]).map((strategy) => {
    let state = beginSprintLoadout(
      selectSprintLoadout(createSprintLoadoutPrototype(seed), choices[strategy]),
      boss,
    );
    const initialHand = [...state.current!.sprint.cardPiles.hand];
    const findDesired = () =>
      state.current!.sprint.cardPiles.hand.find(
        (index) => state.collection[index].defId === desired,
      );
    if (findDesired() === undefined)
      state = exchangeSprintLoadoutCard(state, state.current!.sprint.cardPiles.hand[0]);
    const index = findDesired() ?? state.current!.sprint.cardPiles.hand[0];
    state = playSprintLoadoutCard(state, index);
    while (!state.current!.sprint.complete) state = tickSprintLoadout(state, true);
    const current = state.current!;
    return {
      strategy,
      boss,
      candidates: [...state.selected],
      initialHand,
      selected: state.collection[index].defId,
      desiredInInitialHand: initialHand.some((i) => state.collection[i].defId === desired),
      delivered: current.sprint.metrics.delivered,
      completed: current.sprint.metrics.completedCount,
      quality: current.org.quality,
      auditQualityRequirement: getBoss('security-audit')!.clear.minQuality!,
      auditQualityMet: current.org.quality >= getBoss('security-audit')!.clear.minQuality!,
      focusSpent: current.sprint.metrics.focusSpent,
      focusRemaining: current.sprint.focus,
      exchanges: current.exchanges,
      interventions: current.sprint.metrics.interventionsUsed,
    };
  });
}
