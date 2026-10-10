/** RI-176: 予約集中力は通常介入と別口座。条件成立tickで一度だけ先に解決する。 */
export type ProcedureScenario = 'calm' | 'crisis' | 'untargetable';
export type ProcedureStrategy = 'react' | 'reserve' | 'refund';
export type ProcedureInput =
  { type: 'reserve' } | { type: 'cancel' } | { type: 'tick'; manual?: 'ship' | 'firefight' };
export interface ProcedureState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  scenario: ProcedureScenario;
  availableFocus: number;
  reservedFocus: number;
  availableSpent: number;
  reservedSpent: number;
  incidents: number;
  actionable: boolean;
  lossPerIncident: number;
  incidentLoss: number;
  shippedValue: number;
  armed: boolean;
  fired: boolean;
  held: boolean;
  firedTick: number | null;
  arrivals: number[];
  resolutions: string[];
  inputs: ProcedureInput[];
}
const arrivalsFor: Record<ProcedureScenario, number[]> = {
  calm: [0, 0, 0, 0, 1, 0, 0],
  crisis: [0, 0, 2, 0, 0, 0, 0],
  untargetable: [0, 0, 2, 0, 0, 0, 0],
};
export function createProcedurePrototype(
  seed: string,
  scenario: ProcedureScenario,
): ProcedureState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 6,
    scenario,
    availableFocus: 6,
    reservedFocus: 0,
    availableSpent: 0,
    reservedSpent: 0,
    incidents: 0,
    actionable: scenario !== 'untargetable',
    lossPerIncident: 5,
    incidentLoss: 0,
    shippedValue: 0,
    armed: false,
    fired: false,
    held: false,
    firedTick: null,
    arrivals: [...arrivalsFor[scenario]],
    resolutions: [],
    inputs: [],
  };
}
export function viewProcedure(state: ProcedureState) {
  return {
    tick: state.tick,
    availableFocus: state.availableFocus,
    reservedFocus: state.reservedFocus,
    incidents: state.incidents,
    armed: state.armed,
    fired: state.fired,
    held: state.held,
    firedTick: state.firedTick,
  };
}
export function applyProcedureInput(state: ProcedureState, input: ProcedureInput): ProcedureState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'reserve') {
    if (state.armed || state.fired || state.availableFocus < 2) return state;
  } else if (input.type === 'cancel') {
    const refundable = state.tick === 0 || state.held;
    if (!state.armed || state.fired || !refundable) return state;
  }
  const next = structuredClone(state);
  if (input.type === 'reserve') {
    next.availableFocus -= 2;
    next.reservedFocus += 2;
    next.armed = true;
  } else if (input.type === 'cancel') {
    next.availableFocus += next.reservedFocus;
    next.reservedFocus = 0;
    next.armed = false;
    next.held = false;
  } else {
    next.tick += 1;
    const arrived = next.arrivals[next.tick] ?? 0;
    next.incidents += arrived;
    const notes = [`t${next.tick}:arrive+${arrived}`];
    if (next.armed && !next.fired && next.incidents >= 2) {
      if (next.actionable && next.reservedFocus >= 2) {
        next.incidents -= 1;
        next.reservedFocus -= 2;
        next.reservedSpent += 2;
        next.fired = true;
        next.firedTick = next.tick;
        next.armed = false;
        notes.push('auto');
      } else {
        next.held = true;
        notes.push('auto:hold');
      }
    } else notes.push('auto:skip');
    if (input.manual === 'ship' && next.availableFocus >= 2) {
      next.availableFocus -= 2;
      next.availableSpent += 2;
      next.shippedValue += 9;
      notes.push('manual:ship');
    } else if (
      input.manual === 'firefight' &&
      next.actionable &&
      next.incidents > 0 &&
      next.availableFocus >= 2
    ) {
      next.availableFocus -= 2;
      next.availableSpent += 2;
      next.incidents -= 1;
      notes.push('manual:firefight');
    } else if (input.manual) notes.push(`manual:skip:${input.manual}`);
    next.incidentLoss += next.incidents * next.lossPerIncident;
    notes.push(`loss:${next.incidents * next.lossPerIncident}`);
    next.resolutions.push(notes.join(','));
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeProcedure(state: ProcedureState) {
  return {
    availableFocus: state.availableFocus,
    reservedFocus: state.reservedFocus,
    availableSpent: state.availableSpent,
    reservedSpent: state.reservedSpent,
    incidents: state.incidents,
    incidentLoss: state.incidentLoss,
    shippedValue: state.shippedValue,
    fired: state.fired,
    firedTick: state.firedTick,
    held: state.held,
    resolutions: state.resolutions,
    netValue: state.shippedValue - state.incidentLoss,
  };
}
export function chooseProcedureAction(
  state: ProcedureState,
  strategy: ProcedureStrategy,
): ProcedureInput {
  if (
    strategy !== 'react' &&
    !state.armed &&
    !state.fired &&
    state.reservedFocus === 0 &&
    state.tick === 0
  )
    return { type: 'reserve' };
  if (strategy === 'refund' && state.held && state.armed) return { type: 'cancel' };
  const revealed = state.incidents + (state.arrivals[state.tick + 1] ?? 0);
  const auto = state.armed && !state.fired && revealed >= 2 && state.actionable;
  const after = auto ? revealed - 1 : revealed;
  if (state.actionable && after > 0 && state.availableFocus >= 2)
    return { type: 'tick', manual: 'firefight' };
  if (!state.actionable && state.availableFocus >= 2) return { type: 'tick', manual: 'ship' };
  if (after === 0 && state.availableFocus > 2) return { type: 'tick', manual: 'ship' };
  return { type: 'tick' };
}
export function compareProcedureStrategies(seed: string) {
  return (['calm', 'crisis', 'untargetable'] as const).flatMap((scenario) =>
    (scenario === 'untargetable'
      ? (['reserve', 'refund'] as const)
      : (['react', 'reserve'] as const)
    ).map((strategy) => {
      const initial = createProcedurePrototype(seed, scenario);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
        const next = applyProcedureInput(state, chooseProcedureAction(state, strategy));
        if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.tick}`);
        state = next;
      }
      return {
        scenario,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeProcedure(state),
      };
    }),
  );
}
