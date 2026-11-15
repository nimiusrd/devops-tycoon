/** RI-184: 両方を発動したときだけ定型の自動処理を足す。係数へは再加算しない。 */
export type CardId = 'test' | 'ai';
export type SynergyBoard = 'routine' | 'incident' | 'complex';
export type SynergyStrategy = 'none' | 'test' | 'ai' | 'both';
export type SynergyPhase = 'unmet' | 'ready' | 'active';
export type SynergyInput = { type: 'activate'; id: CardId } | { type: 'tick' };
export interface SynergyState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  board: SynergyBoard;
  focus: number;
  focusSpent: number;
  ownedTest: boolean;
  ownedAi: boolean;
  test: boolean;
  ai: boolean;
  routineQueue: number;
  complexQueue: number;
  incidentQueue: number;
  routineCleared: number;
  complexCleared: number;
  incidentCleared: number;
  autoCleared: number;
  inputs: SynergyInput[];
}
export const SYNERGY_RULE = {
  requiredCards: ['test', 'ai'] as const,
  costPerCard: 1,
  autoPerTick: 1,
  autoAddsToCoefficient: false,
  activeBoard: 'routine' as const,
};
export const SYNERGY_COMPARISON = {
  seed: 1,
  horizon: 6,
  focus: 2,
  inflowPerTick: 4,
  boards: ['routine', 'incident', 'complex'] as const,
  strategies: ['none', 'test', 'ai', 'both'] as const,
  fixedStrategy: true,
  humanPlaytest: false,
};
export const SYNERGY_STATUS_TEXT: Record<SynergyPhase, string> = {
  unmet: '未成立。テストとAIを各集中力1で発動',
  ready: '成立。テストとAIは発動済み。この仕事では自動処理なし',
  active: '発動中。定型を1件自動処理',
};
const BASE_ROUTINE = 1;
const CARD_ROUTINE = 1;
const INCIDENT_THROUGHPUT = 1;

function cardActive(state: SynergyState, id: CardId): boolean {
  return id === 'test' ? state.test : state.ai;
}
export function synergyEstablished(state: SynergyState): boolean {
  return SYNERGY_RULE.requiredCards.every((id) => cardActive(state, id));
}
export function manualRoutine(state: SynergyState): number {
  return BASE_ROUTINE + (state.test ? CARD_ROUTINE : 0) + (state.ai ? CARD_ROUTINE : 0);
}
export function autoRoutine(state: SynergyState): number {
  return state.board === SYNERGY_RULE.activeBoard && synergyEstablished(state)
    ? SYNERGY_RULE.autoPerTick
    : 0;
}
export function synergyPhase(state: SynergyState): SynergyPhase {
  if (!synergyEstablished(state)) return 'unmet';
  return autoRoutine(state) > 0 ? 'active' : 'ready';
}
export function synergyStatusText(state: SynergyState): string {
  return SYNERGY_STATUS_TEXT[synergyPhase(state)];
}
export function createSynergyPrototype(
  seed: number,
  board: SynergyBoard,
  horizon = SYNERGY_COMPARISON.horizon,
): SynergyState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    board,
    focus: SYNERGY_COMPARISON.focus,
    focusSpent: 0,
    ownedTest: true,
    ownedAi: true,
    test: false,
    ai: false,
    routineQueue: 0,
    complexQueue: 0,
    incidentQueue: 0,
    routineCleared: 0,
    complexCleared: 0,
    incidentCleared: 0,
    autoCleared: 0,
    inputs: [],
  };
}
export function viewSynergy(state: SynergyState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    board: state.board,
    focus: state.focus,
    owned: { test: state.ownedTest, ai: state.ownedAi },
    active: { test: state.test, ai: state.ai },
    established: synergyEstablished(state),
    manualRoutine: manualRoutine(state),
    autoRoutine: autoRoutine(state),
    incidentThroughput: INCIDENT_THROUGHPUT,
    autoCleared: state.autoCleared,
    statusText: synergyStatusText(state),
  };
}
export function applySynergyInput(state: SynergyState, input: SynergyInput): SynergyState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'activate') {
    const active = cardActive(state, input.id);
    if (active || state.focus < SYNERGY_RULE.costPerCard) return state;
  }
  const next = structuredClone(state);
  if (input.type === 'activate') {
    next.focus -= SYNERGY_RULE.costPerCard;
    next.focusSpent += SYNERGY_RULE.costPerCard;
    if (input.id === 'test') next.test = true;
    else next.ai = true;
  } else {
    next.tick += 1;
    const inflow = SYNERGY_COMPARISON.inflowPerTick;
    next.routineQueue += next.board === 'routine' ? inflow : 0;
    next.complexQueue += next.board === 'complex' ? inflow : 0;
    next.incidentQueue += next.board === 'incident' ? inflow : 0;
    const auto = Math.min(next.routineQueue, autoRoutine(next));
    next.routineQueue -= auto;
    next.autoCleared += auto;
    next.routineCleared += auto;
    const manual = Math.min(next.routineQueue, manualRoutine(next));
    next.routineQueue -= manual;
    next.routineCleared += manual;
    const complex = Math.min(next.complexQueue, manualRoutine(next));
    next.complexQueue -= complex;
    next.complexCleared += complex;
    const incident = Math.min(next.incidentQueue, INCIDENT_THROUGHPUT);
    next.incidentQueue -= incident;
    next.incidentCleared += incident;
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeSynergy(state: SynergyState) {
  return {
    test: state.test,
    ai: state.ai,
    routineCleared: state.routineCleared,
    complexCleared: state.complexCleared,
    incidentCleared: state.incidentCleared,
    autoCleared: state.autoCleared,
    focusSpent: state.focusSpent,
    netValue:
      state.routineCleared + state.complexCleared + state.incidentCleared - state.focusSpent,
  };
}
export interface SynergyRow {
  board: SynergyBoard;
  seed: number;
  strategy: SynergyStrategy;
  initial: SynergyState;
  inputs: SynergyInput[];
  result: ReturnType<typeof summarizeSynergy>;
}
export function compareSynergyStrategies(): SynergyRow[] {
  const plans = SYNERGY_COMPARISON.boards.flatMap((board) =>
    SYNERGY_COMPARISON.strategies.map((strategy) => ({ board, strategy })),
  );
  return plans.map(({ board, strategy }) => {
    const initial = createSynergyPrototype(SYNERGY_COMPARISON.seed, board);
    let state = initial;
    const cards: CardId[] =
      strategy === 'both' ? ['test', 'ai'] : strategy === 'none' ? [] : [strategy];
    for (const id of cards) state = applySynergyInput(state, { type: 'activate', id });
    while (state.tick < state.horizon) state = applySynergyInput(state, { type: 'tick' });
    return {
      board,
      seed: SYNERGY_COMPARISON.seed,
      strategy,
      initial,
      inputs: state.inputs,
      result: summarizeSynergy(state),
    };
  });
}
export function splitSynergyResults(results: readonly SynergyRow[]) {
  const beatsSingleAndNone: SynergyBoard[] = [];
  const losesToSingleOrNone: SynergyBoard[] = [];
  const autoClearedWhenBoth: Record<SynergyBoard, number> = {
    routine: 0,
    incident: 0,
    complex: 0,
  };
  for (const board of SYNERGY_COMPARISON.boards) {
    const net = (strategy: SynergyStrategy) =>
      results.find((row) => row.board === board && row.strategy === strategy)!.result.netValue;
    const both = net('both');
    const beats = both > net('test') && both > net('ai') && both > net('none');
    (beats ? beatsSingleAndNone : losesToSingleOrNone).push(board);
    autoClearedWhenBoth[board] = results.find(
      (row) => row.board === board && row.strategy === 'both',
    )!.result.autoCleared;
  }
  return { beatsSingleAndNone, losesToSingleOrNone, autoClearedWhenBoth };
}
export function synergyComparison() {
  const results = compareSynergyStrategies();
  return {
    conditions: {
      seed: SYNERGY_COMPARISON.seed,
      horizon: SYNERGY_COMPARISON.horizon,
      focus: SYNERGY_COMPARISON.focus,
      inflowPerTick: SYNERGY_COMPARISON.inflowPerTick,
      requiredCards: [...SYNERGY_RULE.requiredCards],
      costPerCard: SYNERGY_RULE.costPerCard,
      costForBoth: SYNERGY_RULE.costPerCard * SYNERGY_RULE.requiredCards.length,
      autoPerTick: SYNERGY_RULE.autoPerTick,
      autoAddsToCoefficient: SYNERGY_RULE.autoAddsToCoefficient,
      activeBoard: SYNERGY_RULE.activeBoard,
      boards: [...SYNERGY_COMPARISON.boards],
      strategies: [...SYNERGY_COMPARISON.strategies],
      fixedStrategy: SYNERGY_COMPARISON.fixedStrategy,
      humanPlaytest: SYNERGY_COMPARISON.humanPlaytest,
    },
    results,
    split: splitSynergyResults(results),
  };
}
