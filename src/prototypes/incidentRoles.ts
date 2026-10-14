/** RI-253: 障害ボスの担当を復旧・調査・説明に分ける。通常ランには接続しない。 */

export type IncidentBoard = 'brief' | 'lasting';
export type IncidentStrategy = 'recovery' | 'split';
export type IncidentRole = 'recovery' | 'investigation' | 'explanation';
export type IncidentInput =
  | { type: 'view' }
  | { type: 'recovery' }
  | { type: 'split' }
  | { type: 'work' }
  | { type: 'assign'; recovery: number; investigation: number; explanation: number };

export interface RoleAssignment {
  recovery: number;
  investigation: number;
  explanation: number;
}

export interface IncidentPeriod {
  tick: number;
  action: IncidentStrategy | 'work' | 'assign';
  recovery: number;
  investigation: number;
  explanation: number;
  assignment: RoleAssignment;
  ship: number;
  penalty: number;
  score: number;
}

export interface IncidentState {
  version: 1;
  seed: string;
  board: IncidentBoard;
  tick: number;
  horizon: number;
  slots: number;
  progressPerPerson: number;
  baselineRecovery: number;
  reassignmentSlotCost: number;
  recoveryNeed: number;
  investigationNeed: number;
  explanationNeed: number;
  earlyShipTick: number;
  earlyShip: number;
  lateShip: number;
  incompleteRate: number;
  strategy: IncidentStrategy | null;
  recovery: number;
  investigation: number;
  explanation: number;
  recoveryTime: number | null;
  ship: number;
  penalty: number;
  recurrencePenalty: number;
  trustPenalty: number;
  reassignmentCost: number;
  previous: RoleAssignment | null;
  periods: IncidentPeriod[];
  inputs: IncidentInput[];
}

const SLOTS = 3;
const PROGRESS_PER_PERSON = 2;
const BASELINE_RECOVERY = 1;
const RECOVERY_NEED = 6;
const INVESTIGATION_NEED = 4;
const EXPLANATION_NEED = 4;
const EMPTY_ASSIGNMENT: RoleAssignment = { recovery: 0, investigation: 0, explanation: 0 };

const BOARDS: Record<
  IncidentBoard,
  {
    workTicks: number;
    earlyShipTick: number;
    earlyShip: number;
    lateShip: number;
    incompleteRate: number;
  }
> = {
  brief: { workTicks: 2, earlyShipTick: 1, earlyShip: 16, lateShip: 4, incompleteRate: 1 },
  lasting: { workTicks: 3, earlyShipTick: 3, earlyShip: 12, lateShip: 12, incompleteRate: 5 },
};

function scoreOf(state: IncidentState): number {
  return state.ship - state.penalty;
}

function sameAssignment(left: RoleAssignment, right: RoleAssignment): boolean {
  return (
    left.recovery === right.recovery &&
    left.investigation === right.investigation &&
    left.explanation === right.explanation
  );
}

function assignmentSum(assignment: RoleAssignment): number {
  return assignment.recovery + assignment.investigation + assignment.explanation;
}

function isSlotCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function pushPeriod(
  state: IncidentState,
  action: IncidentPeriod['action'],
  assignment: RoleAssignment,
) {
  state.periods.push({
    tick: state.tick,
    action,
    recovery: state.recovery,
    investigation: state.investigation,
    explanation: state.explanation,
    assignment,
    ship: state.ship,
    penalty: state.penalty,
    score: scoreOf(state),
  });
  state.tick += 1;
}

export function createIncidentRoles(seed: string, board: IncidentBoard): IncidentState {
  const spec = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: spec.workTicks + 1,
    slots: SLOTS,
    progressPerPerson: PROGRESS_PER_PERSON,
    baselineRecovery: BASELINE_RECOVERY,
    reassignmentSlotCost: 1,
    recoveryNeed: RECOVERY_NEED,
    investigationNeed: INVESTIGATION_NEED,
    explanationNeed: EXPLANATION_NEED,
    earlyShipTick: spec.earlyShipTick,
    earlyShip: spec.earlyShip,
    lateShip: spec.lateShip,
    incompleteRate: spec.incompleteRate,
    strategy: null,
    recovery: 0,
    investigation: 0,
    explanation: 0,
    recoveryTime: null,
    ship: 0,
    penalty: 0,
    recurrencePenalty: 0,
    trustPenalty: 0,
    reassignmentCost: 0,
    previous: null,
    periods: [],
    inputs: [],
  };
}

function recoveryPlan(): RoleAssignment {
  return { recovery: SLOTS, investigation: 0, explanation: 0 };
}

function splitPlan(): RoleAssignment {
  return { recovery: 1, investigation: 1, explanation: 1 };
}

function applyAssignment(
  state: IncidentState,
  assignment: RoleAssignment,
  action: 'work' | 'assign',
): IncidentState {
  if (
    !isSlotCount(assignment.recovery) ||
    !isSlotCount(assignment.investigation) ||
    !isSlotCount(assignment.explanation)
  ) {
    return state;
  }
  const switching = state.previous !== null && !sameAssignment(state.previous, assignment);
  const slots = switching ? state.slots - state.reassignmentSlotCost : state.slots;
  if (assignmentSum(assignment) > slots) return state;

  const next = structuredClone(state);
  if (switching) next.reassignmentCost += next.reassignmentSlotCost;
  next.recovery += next.baselineRecovery + assignment.recovery * next.progressPerPerson;
  next.investigation += assignment.investigation * next.progressPerPerson;
  next.explanation += assignment.explanation * next.progressPerPerson;
  if (next.recovery >= next.recoveryNeed && next.recoveryTime === null) {
    next.recoveryTime = next.tick;
    next.ship = next.recoveryTime <= next.earlyShipTick ? next.earlyShip : next.lateShip;
  }
  if (next.investigation < next.investigationNeed) {
    next.penalty += next.incompleteRate;
    next.recurrencePenalty += next.incompleteRate;
  }
  if (next.explanation < next.explanationNeed) {
    next.penalty += next.incompleteRate;
    next.trustPenalty += next.incompleteRate;
  }
  next.previous = { ...assignment };
  pushPeriod(next, action, assignment);
  next.inputs.push(
    action === 'work'
      ? { type: 'work' }
      : {
          type: 'assign',
          recovery: assignment.recovery,
          investigation: assignment.investigation,
          explanation: assignment.explanation,
        },
  );
  return next;
}

export function applyIncidentRoles(state: IncidentState, input: IncidentInput): IncidentState {
  if (input.type === 'view') return state;
  if (input.type === 'recovery' || input.type === 'split') {
    if (state.strategy !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.strategy = input.type;
    pushPeriod(next, input.type, EMPTY_ASSIGNMENT);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (state.tick >= state.horizon) return state;
  if (input.type === 'work') {
    if (state.strategy === null) return state;
    return applyAssignment(
      state,
      state.strategy === 'recovery' ? recoveryPlan() : splitPlan(),
      'work',
    );
  }
  if (input.type !== 'assign') return state;
  return applyAssignment(
    state,
    {
      recovery: input.recovery,
      investigation: input.investigation,
      explanation: input.explanation,
    },
    'assign',
  );
}

export function summarizeIncidentRoles(state: IncidentState) {
  return {
    score: scoreOf(state),
    ship: state.ship,
    penalty: state.penalty,
    recoveryTime: state.recoveryTime,
    recurrence: Math.max(0, state.investigationNeed - state.investigation),
    trustGap: Math.max(0, state.explanationNeed - state.explanation),
    recurrencePenalty: state.recurrencePenalty,
    trustPenalty: state.trustPenalty,
    reassignmentCost: state.reassignmentCost,
    path: state.periods.map((period) => period.score),
    lost: false,
    spreadCapConnected: false,
    shipFloorConnected: false,
  };
}

export function chooseIncidentAction(
  state: IncidentState,
  strategy: IncidentStrategy,
): IncidentInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.strategy === null) return { type: strategy };
  return { type: 'work' };
}

function runIncident(seed: string, board: IncidentBoard, strategy: IncidentStrategy) {
  const initial = createIncidentRoles(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseIncidentAction(state, strategy);
    const next = applyIncidentRoles(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeIncidentRoles(state) };
}

export function compareIncidentRoles(seed = 'RI-253') {
  return (['brief', 'lasting'] as const).flatMap((board) =>
    (['recovery', 'split'] as const).map((strategy) => ({
      board,
      strategy,
      ...runIncident(seed, board, strategy),
    })),
  );
}

function preview(state: IncidentState, strategy: IncidentStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 8) break;
    const next = applyIncidentRoles(cursor, chooseIncidentAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeIncidentRoles(cursor);
  return {
    strategy,
    score: summary.score,
    recoveryTime: summary.recoveryTime,
    recurrence: summary.recurrence,
    trustGap: summary.trustGap,
    recurrencePenalty: summary.recurrencePenalty,
    trustPenalty: summary.trustPenalty,
    reassignmentCost: summary.reassignmentCost,
  };
}

export function viewIncidentRoles(state: IncidentState) {
  return {
    tick: state.tick,
    board: state.board,
    slots: state.slots,
    baselineRecovery: state.baselineRecovery,
    reassignmentSlotCost: state.reassignmentSlotCost,
    recoveryNeed: state.recoveryNeed,
    investigationNeed: state.investigationNeed,
    explanationNeed: state.explanationNeed,
    earlyShipTick: state.earlyShipTick,
    earlyShip: state.earlyShip,
    lateShip: state.lateShip,
    incompleteRate: state.incompleteRate,
    strategy: state.strategy,
    choices: state.strategy === null ? (['recovery', 'split'] as const) : [],
    recovery: state.recovery,
    investigation: state.investigation,
    explanation: state.explanation,
    spreadCapConnected: false,
    shipFloorConnected: false,
    integration: 'keep-spread-cap-and-ship-floor',
    forecasts:
      state.strategy === null
        ? (['recovery', 'split'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}
