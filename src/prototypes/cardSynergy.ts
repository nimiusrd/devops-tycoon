/** RI-184: 両方を発動したときだけ定型仕事の自動処理を足す。係数への再加算はしない。 */
export type CardId = 'test' | 'ai';
export type SynergyBoard = 'routine' | 'incident';
export type SynergyStrategy = 'none' | 'test' | 'ai' | 'both';
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
  incidentQueue: number;
  routineCleared: number;
  incidentCleared: number;
  autoCleared: number;
  inputs: SynergyInput[];
}
const BASE_ROUTINE = 1;
const CARD_ROUTINE = 1;
const AUTO_ROUTINE = 1;
const INCIDENT_THROUGHPUT = 1;

export function manualRoutine(state: SynergyState): number {
  return BASE_ROUTINE + (state.test ? CARD_ROUTINE : 0) + (state.ai ? CARD_ROUTINE : 0);
}
export function autoRoutine(state: SynergyState): number {
  return state.test && state.ai ? AUTO_ROUTINE : 0;
}
export function createSynergyPrototype(
  seed: number,
  board: SynergyBoard,
  horizon = 6,
): SynergyState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    board,
    focus: 2,
    focusSpent: 0,
    ownedTest: true,
    ownedAi: true,
    test: false,
    ai: false,
    routineQueue: 0,
    incidentQueue: 0,
    routineCleared: 0,
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
    manualRoutine: manualRoutine(state),
    autoRoutine: autoRoutine(state),
    incidentThroughput: INCIDENT_THROUGHPUT,
    autoCleared: state.autoCleared,
  };
}
export function applySynergyInput(state: SynergyState, input: SynergyInput): SynergyState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'activate') {
    const active = input.id === 'test' ? state.test : state.ai;
    if (active || state.focus < 1) return state;
  }
  const next = structuredClone(state);
  if (input.type === 'activate') {
    next.focus -= 1;
    next.focusSpent += 1;
    if (input.id === 'test') next.test = true;
    else next.ai = true;
  } else {
    next.tick += 1;
    next.routineQueue += next.board === 'routine' ? 4 : 0;
    next.incidentQueue += next.board === 'incident' ? 4 : 0;
    const auto = Math.min(next.routineQueue, autoRoutine(next));
    next.routineQueue -= auto;
    next.autoCleared += auto;
    next.routineCleared += auto;
    const manual = Math.min(next.routineQueue, manualRoutine(next));
    next.routineQueue -= manual;
    next.routineCleared += manual;
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
    incidentCleared: state.incidentCleared,
    autoCleared: state.autoCleared,
    focusSpent: state.focusSpent,
    netValue: state.routineCleared + state.incidentCleared - state.focusSpent,
  };
}
export function compareSynergyStrategies() {
  const plans: { board: SynergyBoard; strategy: SynergyStrategy }[] = [
    { board: 'routine', strategy: 'none' },
    { board: 'routine', strategy: 'test' },
    { board: 'routine', strategy: 'ai' },
    { board: 'routine', strategy: 'both' },
    { board: 'incident', strategy: 'none' },
    { board: 'incident', strategy: 'test' },
    { board: 'incident', strategy: 'ai' },
    { board: 'incident', strategy: 'both' },
  ];
  return plans.map(({ board, strategy }) => {
    const initial = createSynergyPrototype(1, board);
    let state = initial;
    const cards: CardId[] =
      strategy === 'both' ? ['test', 'ai'] : strategy === 'none' ? [] : [strategy];
    for (const id of cards) state = applySynergyInput(state, { type: 'activate', id });
    while (state.tick < state.horizon) state = applySynergyInput(state, { type: 'tick' });
    return {
      board,
      seed: 1,
      strategy,
      initial,
      inputs: state.inputs,
      result: summarizeSynergy(state),
    };
  });
}
