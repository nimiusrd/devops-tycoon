import {
  beginSprintLoadout,
  createSprintLoadoutPrototype,
  playSprintLoadoutCard,
  selectSprintLoadout,
  tickSprintLoadout,
  type LoadoutBoss,
  type SprintLoadoutState,
} from './sprintLoadout';

export const CARD_RETIREMENT_POLICY = { budgetCost: 5, minimumOwned: 3 } as const;

/** RI-188: 廃止カードはインスタンス位置を保つ墓標にし、同IDの別カードを廃止しない。 */
export interface CardRetirementState {
  version: 1;
  loadout: SprintLoadoutState;
  budget: number;
  retired: number[];
  lastRetiredAfter: number | null;
}

export function createCardRetirementPrototype(seed: string | number): CardRetirementState {
  return {
    version: 1,
    loadout: createSprintLoadoutPrototype(seed),
    budget: 20,
    retired: [],
    lastRetiredAfter: null,
  };
}

export function availableRetirementCards(state: CardRetirementState): number[] {
  return state.loadout.collection
    .map((_, index) => index)
    .filter((index) => !state.retired.includes(index));
}

export function selectRetirementLoadout(
  state: CardRetirementState,
  indices: readonly number[],
): CardRetirementState {
  if (indices.some((index) => state.retired.includes(index))) return state;
  const loadout = selectSprintLoadout(state.loadout, indices);
  return loadout === state.loadout ? state : { ...state, loadout };
}

/** 1スプリント境界につき1枚。返金・復活・baselineの巻き戻しを行わない。 */
export function retireCard(
  state: CardRetirementState,
  index: number,
  nextCandidates?: readonly number[],
): CardRetirementState {
  if (state.loadout.current && !state.loadout.current.sprint.complete) return state;
  if (
    !Number.isInteger(index) ||
    !availableRetirementCards(state).includes(index) ||
    availableRetirementCards(state).length <= CARD_RETIREMENT_POLICY.minimumOwned ||
    state.lastRetiredAfter === state.loadout.sprintNumber ||
    state.budget <= CARD_RETIREMENT_POLICY.budgetCost
  )
    return state;
  const candidates = nextCandidates ?? state.loadout.selected.filter((i) => i !== index);
  if (candidates.includes(index) || candidates.some((i) => state.retired.includes(i))) return state;
  const loadout = selectSprintLoadout(state.loadout, candidates);
  if (loadout === state.loadout) return state;
  return {
    ...state,
    loadout,
    budget: state.budget - CARD_RETIREMENT_POLICY.budgetCost,
    retired: [...state.retired, index],
    lastRetiredAfter: state.loadout.sprintNumber,
  };
}

export function beginRetirementSprint(
  state: CardRetirementState,
  boss: LoadoutBoss,
): CardRetirementState {
  if (state.loadout.selected.some((index) => state.retired.includes(index))) return state;
  const loadout = beginSprintLoadout(state.loadout, boss);
  return loadout === state.loadout ? state : { ...state, loadout };
}

export function playRetirementCard(state: CardRetirementState, index: number): CardRetirementState {
  if (state.retired.includes(index)) return state;
  const loadout = playSprintLoadoutCard(state.loadout, index);
  return loadout === state.loadout ? state : { ...state, loadout };
}

export function tickRetirementSprint(
  state: CardRetirementState,
  interrupt = false,
): CardRetirementState {
  const loadout = tickSprintLoadout(state.loadout, interrupt);
  return loadout === state.loadout ? state : { ...state, loadout };
}

/** 運用維持費を捏造せず、「持ち込まない」でも同じ引きになるかを対照比較する。 */
export function compareCardRetirementStrategies(seed: string | number, boss: LoadoutBoss) {
  return (['keep', 'omit', 'retire'] as const).map((strategy) => {
    let state = createCardRetirementPrototype(seed);
    // 仕事と合わない1枚を除く。所持位置は全方針で共通。
    const index = boss === 'big-release' ? 3 : 0;
    const candidates = state.loadout.selected.filter((i) => i !== index);
    if (strategy === 'omit') state = selectRetirementLoadout(state, candidates);
    if (strategy === 'retire') state = retireCard(state, index);
    state = beginRetirementSprint(state, boss);
    const hand = [...state.loadout.current!.sprint.cardPiles.hand];
    const desired = boss === 'big-release' ? 'copilot' : 'auto-test';
    const selected = hand.find((i) => state.loadout.collection[i].defId === desired) ?? hand[0];
    state = playRetirementCard(state, selected);
    while (!state.loadout.current!.sprint.complete) state = tickRetirementSprint(state, true);
    const current = state.loadout.current!;
    return {
      strategy,
      removedIndex: strategy === 'keep' ? null : index,
      hand,
      selected: state.loadout.collection[selected].defId,
      delivered: current.sprint.metrics.delivered,
      quality: current.org.quality,
      budget: state.budget,
      activeOwned: availableRetirementCards(state).length,
      candidateCount: state.loadout.selected.length,
      focusSpent: current.sprint.metrics.focusSpent,
      foregone: state.retired.map((i) => state.loadout.collection[i].defId),
    };
  });
}
