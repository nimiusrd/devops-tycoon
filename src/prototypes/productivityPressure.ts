/** RI-245: PR数の達成は見かけの指標で、実得点には足さない。分割は1スプリントで打ち切る。 */

export type PressureBoard = 'fragmented' | 'coupled';
export type PressureStrategy = 'comply' | 'explain';
export type PressureInput = { type: 'view' } | { type: 'comply' } | { type: 'explain' };

export interface PressureOutcome {
  prCount: number;
  delivery: number;
  rework: number;
  explanation: number;
}

export interface PressureState {
  version: 1;
  seed: string;
  board: PressureBoard;
  tick: number;
  horizon: number;
  required: number;
  prCount: number;
  delivery: number;
  rework: number;
  explanation: number;
  choice: PressureStrategy | null;
  inputs: PressureInput[];
}

const REQUIRED = 4;
const OUTCOME: Record<PressureBoard, Record<PressureStrategy, PressureOutcome>> = {
  fragmented: {
    comply: { prCount: 4, delivery: 12, rework: 0, explanation: 0 },
    explain: { prCount: 2, delivery: 6, rework: 0, explanation: 3 },
  },
  coupled: {
    comply: { prCount: 4, delivery: 4, rework: 4, explanation: 0 },
    explain: { prCount: 2, delivery: 14, rework: 0, explanation: 3 },
  },
};

function scoreOf(state: Pick<PressureState, 'delivery' | 'rework' | 'explanation'>): number {
  return state.delivery - state.rework - state.explanation;
}

export function createProductivityPressure(seed: string, board: PressureBoard): PressureState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 1,
    required: REQUIRED,
    prCount: 0,
    delivery: 0,
    rework: 0,
    explanation: 0,
    choice: null,
    inputs: [],
  };
}

export function applyProductivityPressure(
  state: PressureState,
  input: PressureInput,
): PressureState {
  if (input.type === 'view') return state;
  if (state.tick !== 0 || state.choice) return state;
  if (input.type !== 'comply' && input.type !== 'explain') return state;
  const outcome = OUTCOME[state.board][input.type];
  const next = structuredClone(state);
  next.prCount = outcome.prCount;
  next.delivery = outcome.delivery;
  next.rework = outcome.rework;
  next.explanation = outcome.explanation;
  next.choice = input.type;
  next.tick = 1;
  next.inputs.push({ type: input.type });
  return next;
}

export function summarizeProductivityPressure(state: PressureState) {
  return {
    prCount: state.prCount,
    required: state.required,
    met: state.prCount >= state.required,
    delivery: state.delivery,
    rework: state.rework,
    explanation: state.explanation,
    score: scoreOf(state),
    choice: state.choice,
    lost: false,
  };
}

export function choosePressureAction(
  state: PressureState,
  strategy: PressureStrategy,
): PressureInput {
  if (state.tick >= state.horizon || state.choice) return { type: 'view' };
  return { type: strategy };
}

function runPressure(seed: string, board: PressureBoard, strategy: PressureStrategy) {
  const initial = createProductivityPressure(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 4) throw new Error(`${board}:${strategy}`);
    const input = choosePressureAction(state, strategy);
    const next = applyProductivityPressure(state, input);
    if (next === state) throw new Error(`${board}:${strategy}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeProductivityPressure(state) };
}

export function compareProductivityPressures(seed = 'RI-245') {
  return (['fragmented', 'coupled'] as const).flatMap((board) =>
    (['comply', 'explain'] as const).map((strategy) => ({
      board,
      strategy,
      ...runPressure(seed, board, strategy),
    })),
  );
}

function forecast(board: PressureBoard, strategy: PressureStrategy) {
  const outcome = OUTCOME[board][strategy];
  return {
    strategy,
    ...outcome,
    met: outcome.prCount >= REQUIRED,
    score: scoreOf(outcome),
  };
}

export function viewProductivityPressure(state: PressureState) {
  const summary = summarizeProductivityPressure(state);
  return {
    tick: state.tick,
    required: state.required,
    prCount: state.prCount,
    delivery: state.delivery,
    apparent: 'pr-count',
    real: 'delivery-minus-burden',
    met: summary.met,
    rework: state.rework,
    explanation: state.explanation,
    score: summary.score,
    reason: 'visible-pr-count',
    helpsWhen: 'independent-fixes',
    hindersWhen: 'coupled-flow',
    choices: state.choice ? [] : (['comply', 'explain'] as const),
    forecasts: (['comply', 'explain'] as const).map((strategy) => forecast(state.board, strategy)),
  };
}
