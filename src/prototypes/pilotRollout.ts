/** RI-226: 施策1種を試験1チームか即全社で入れる。RI-217 の基盤仕事へは未接続。 */

export type PilotTeamId = 'pilot' | 'north' | 'south';
export type PilotBoard = 'good' | 'harm' | 'spike';
export type PilotStrategy = 'now' | 'expand' | 'stop';
export type PilotScope = 'pilot' | 'all' | 'stop';
export type PilotInput = { type: 'scope'; scope: PilotScope } | { type: 'view' };

export interface PilotObservation {
  tick: number;
  pilotShip: number;
  otherShip: number;
  delta: number;
  kind: 'observed';
}

export interface PilotState {
  version: 1;
  seed: string;
  board: PilotBoard;
  tick: number;
  horizon: number;
  base: number;
  effect: number;
  incidentIfAll: number;
  expandFee: number;
  adopted: PilotTeamId[];
  sawPilot: boolean;
  incidentPaid: boolean;
  feePaid: number;
  incident: number;
  shipped: number;
  periodShip: Record<PilotTeamId, number>;
  observations: PilotObservation[];
  inputs: PilotInput[];
}

const TEAMS: readonly PilotTeamId[] = ['pilot', 'north', 'south'];
const BASE = 5;
const EXPAND_FEE = 2;

const BOARDS: Record<PilotBoard, { effect: number; incidentIfAll: number }> = {
  good: { effect: 4, incidentIfAll: 0 },
  harm: { effect: -3, incidentIfAll: 0 },
  spike: { effect: 4, incidentIfAll: 20 },
};

const PLANS: Record<PilotStrategy, readonly PilotScope[]> = {
  now: ['all', 'all', 'all'],
  expand: ['pilot', 'all', 'all'],
  stop: ['pilot', 'stop', 'stop'],
};

export function createPilotRollout(seed: string, board: PilotBoard): PilotState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    base: BASE,
    effect: preset.effect,
    incidentIfAll: preset.incidentIfAll,
    expandFee: EXPAND_FEE,
    adopted: [],
    sawPilot: false,
    incidentPaid: false,
    feePaid: 0,
    incident: 0,
    shipped: 0,
    periodShip: { pilot: 0, north: 0, south: 0 },
    observations: [],
    inputs: [],
  };
}

function isScope(value: string): value is PilotScope {
  return value === 'pilot' || value === 'all' || value === 'stop';
}

function adoptedFor(scope: PilotScope): PilotTeamId[] {
  if (scope === 'all') return [...TEAMS];
  if (scope === 'pilot') return ['pilot'];
  return [];
}

/** 試験中の効果は pilot だけに足す。全社化しても pilot へは一度だけ足し、観測差は因果効果にしない。 */
export function applyPilotScope(state: PilotState, scope: string): PilotState {
  if (state.tick >= state.horizon || !isScope(scope)) return state;
  const next = structuredClone(state);
  const adopted = adoptedFor(scope);
  let incident = 0;
  if (scope === 'all' && !next.sawPilot && !next.incidentPaid && next.incidentIfAll > 0) {
    incident = next.incidentIfAll;
    next.incidentPaid = true;
  }
  if (scope === 'all' && next.sawPilot && next.feePaid === 0) next.feePaid = next.expandFee;
  const periodShip = { pilot: 0, north: 0, south: 0 };
  for (const team of TEAMS) {
    periodShip[team] = next.base + (adopted.includes(team) ? next.effect : 0);
    next.shipped += periodShip[team];
  }
  next.shipped -= incident;
  next.incident += incident;
  next.periodShip = periodShip;
  if (scope === 'pilot') {
    next.sawPilot = true;
    next.observations.push({
      tick: next.tick,
      pilotShip: periodShip.pilot,
      otherShip: periodShip.north + periodShip.south,
      delta: periodShip.pilot - next.base,
      kind: 'observed',
    });
  }
  next.adopted = adopted;
  next.tick += 1;
  next.inputs.push({ type: 'scope', scope });
  return next;
}

export function applyPilotRollout(state: PilotState, input: PilotInput): PilotState {
  if (input.type === 'view') return state;
  if (input.type !== 'scope') return state;
  return applyPilotScope(state, input.scope);
}

export function viewPilotRollout(state: PilotState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    effect: state.effect,
    adopted: [...state.adopted],
    waiting: TEAMS.filter((team) => !state.adopted.includes(team)),
    incidentIfSkipTrial: state.sawPilot || state.incidentPaid ? 0 : state.incidentIfAll,
    feeIfExpand: state.sawPilot && state.feePaid === 0 ? state.expandFee : 0,
    observations: state.observations.map((item) => ({ ...item })),
  };
}

export function summarizePilotRollout(state: PilotState) {
  return {
    shipped: state.shipped,
    fee: state.feePaid,
    incident: state.incident,
    observed: state.observations.reduce((sum, item) => sum + item.delta, 0),
    score: state.shipped - state.feePaid,
    lost: false,
  };
}

export function choosePilotAction(state: PilotState, strategy: PilotStrategy): PilotInput {
  return { type: 'scope', scope: PLANS[strategy][state.tick] ?? 'stop' };
}

export function comparePilotRollouts(seed = 'RI-226') {
  return (['good', 'harm', 'spike'] as const).flatMap((board) =>
    (['now', 'expand', 'stop'] as const).map((strategy) => {
      const initial = createPilotRollout(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = choosePilotAction(state, strategy);
        const next = applyPilotRollout(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizePilotRollout(state),
      };
    }),
  );
}
