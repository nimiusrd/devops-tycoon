/** RI-176: 予約集中力は通常介入と別口座。条件成立で一度だけ解決し、基準は手動より先。 */
export type ProcedureScenario = 'calm' | 'crisis' | 'untargetable';
export type ProcedureStrategy = 'react' | 'reserve' | 'refund';
export type ProcedureResolveOrder = 'auto-first' | 'manual-first';
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
/** 初回比較の規則。出荷と手動火消しの費用は規則に含めず、資源として固定する。 */
export interface ProcedureRules {
  reserveAmount: number;
  incidentThreshold: number;
  resolveOrder: ProcedureResolveOrder;
}
export const baselineProcedureRules: ProcedureRules = {
  reserveAmount: 2,
  incidentThreshold: 2,
  resolveOrder: 'auto-first',
};
/** 初回と同じ資源。感度では動かさない。 */
const manualCost = 2;
const shipValue = 9;
const focusPool = 6;
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
    availableFocus: focusPool,
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
function applyManual(next: ProcedureState, input: ProcedureInput, notes: string[]) {
  if (input.type !== 'tick') return;
  if (input.manual === 'ship' && next.availableFocus >= manualCost) {
    next.availableFocus -= manualCost;
    next.availableSpent += manualCost;
    next.shippedValue += shipValue;
    notes.push('manual:ship');
  } else if (
    input.manual === 'firefight' &&
    next.actionable &&
    next.incidents > 0 &&
    next.availableFocus >= manualCost
  ) {
    next.availableFocus -= manualCost;
    next.availableSpent += manualCost;
    next.incidents -= 1;
    notes.push('manual:firefight');
  } else if (input.manual) notes.push(`manual:skip:${input.manual}`);
}
function applyAuto(next: ProcedureState, notes: string[], rules: ProcedureRules) {
  if (
    next.armed &&
    !next.fired &&
    next.incidents >= rules.incidentThreshold &&
    next.incidents > 0
  ) {
    if (next.actionable && next.reservedFocus >= rules.reserveAmount) {
      next.incidents -= 1;
      next.reservedFocus -= rules.reserveAmount;
      next.reservedSpent += rules.reserveAmount;
      next.fired = true;
      next.firedTick = next.tick;
      next.armed = false;
      notes.push('auto');
    } else {
      next.held = true;
      notes.push('auto:hold');
    }
  } else notes.push('auto:skip');
}
export function applyProcedureInput(
  state: ProcedureState,
  input: ProcedureInput,
  rules: ProcedureRules = baselineProcedureRules,
): ProcedureState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'reserve') {
    if (state.armed || state.fired || state.availableFocus < rules.reserveAmount) return state;
  } else if (input.type === 'cancel') {
    const refundable = state.tick === 0 || state.held;
    if (!state.armed || state.fired || !refundable) return state;
  }
  const next = structuredClone(state);
  if (input.type === 'reserve') {
    next.availableFocus -= rules.reserveAmount;
    next.reservedFocus += rules.reserveAmount;
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
    if (rules.resolveOrder === 'manual-first') {
      applyManual(next, input, notes);
      applyAuto(next, notes, rules);
    } else {
      applyAuto(next, notes, rules);
      applyManual(next, input, notes);
    }
    const loss = next.incidents * next.lossPerIncident;
    next.incidentLoss += loss;
    notes.push(`loss:${loss}`);
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
  rules: ProcedureRules = baselineProcedureRules,
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
  const manualFirst = rules.resolveOrder === 'manual-first';
  const manualClears =
    manualFirst && state.actionable && revealed > 0 && state.availableFocus >= manualCost;
  const seen = manualClears ? revealed - 1 : revealed;
  const auto =
    state.armed &&
    !state.fired &&
    seen >= rules.incidentThreshold &&
    seen > 0 &&
    state.actionable &&
    state.reservedFocus >= rules.reserveAmount;
  const after = manualFirst
    ? Math.max(0, revealed - (manualClears ? 1 : 0) - (auto ? 1 : 0))
    : auto
      ? revealed - 1
      : revealed;
  const incidentsRemain = manualFirst ? revealed > 0 : after > 0;
  if (state.actionable && incidentsRemain && state.availableFocus >= manualCost)
    return { type: 'tick', manual: 'firefight' };
  if (!state.actionable && state.availableFocus >= manualCost)
    return { type: 'tick', manual: 'ship' };
  if (after === 0 && state.availableFocus > manualCost) return { type: 'tick', manual: 'ship' };
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

const FACTOR_SEED = 'RI-176';
const FACTOR_SCENARIOS = ['calm', 'crisis', 'untargetable'] as const;
export type ProcedurePreference = 'reserved' | 'manual' | 'tie';
export interface ProcedureFactorRun {
  inputs: ProcedureInput[];
  result: ReturnType<typeof summarizeProcedure>;
}
export interface ProcedureScenarioComparison {
  scenario: ProcedureScenario;
  preference: ProcedurePreference;
  margin: number;
  manual: ProcedureFactorRun;
  reserved: ProcedureFactorRun;
}
export interface ProcedureFactorPoint {
  axis: string;
  parameter: string;
  rules: ProcedureRules;
  scenarios: ProcedureScenarioComparison[];
}
export interface ProcedureFactorReversal {
  axis: string;
  scenario: ProcedureScenario;
  before: { parameter: string; preference: ProcedurePreference; manual: number; reserved: number };
  after: { parameter: string; preference: ProcedurePreference; manual: number; reserved: number };
}
function cloneRules(rules: ProcedureRules): ProcedureRules {
  return { ...rules };
}
function withRules(patch: Partial<ProcedureRules>): ProcedureRules {
  return { ...baselineProcedureRules, ...patch };
}
function preferenceOf(manual: number, reserved: number): ProcedurePreference {
  if (reserved > manual) return 'reserved';
  if (manual > reserved) return 'manual';
  return 'tie';
}
function runProcedure(
  scenario: ProcedureScenario,
  strategy: 'react' | 'reserve',
  rules: ProcedureRules,
): ProcedureFactorRun {
  let state = createProcedurePrototype(FACTOR_SEED, scenario);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
    const next = applyProcedureInput(state, chooseProcedureAction(state, strategy, rules), rules);
    if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeProcedure(state) };
}
function point(axis: string, parameter: string, rules: ProcedureRules): ProcedureFactorPoint {
  const scenarios = FACTOR_SCENARIOS.map((scenario) => {
    const manual = runProcedure(scenario, 'react', rules);
    const reserved = runProcedure(scenario, 'reserve', rules);
    const manualNet = manual.result.netValue;
    const reservedNet = reserved.result.netValue;
    return {
      scenario,
      preference: preferenceOf(manualNet, reservedNet),
      margin: reservedNet - manualNet,
      manual,
      reserved,
    };
  });
  return { axis, parameter, rules: cloneRules(rules), scenarios };
}
function reversalsOf(rows: ProcedureFactorPoint[]): ProcedureFactorReversal[] {
  const found: ProcedureFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const scenario of FACTOR_SCENARIOS) {
      const earlier = before.scenarios.find((item) => item.scenario === scenario);
      const later = after.scenarios.find((item) => item.scenario === scenario);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        scenario,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          manual: earlier.manual.result.netValue,
          reserved: earlier.reserved.result.netValue,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          manual: later.manual.result.netValue,
          reserved: later.reserved.result.netValue,
        },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、予約額・条件件数・手動との順序を一つずつ動かす。固定戦略。 */
export function compareProcedureFactorReversals() {
  const sweeps = {
    reserveAmount: [0, 1, 2, 3, 4, 5, 6].map((reserveAmount) =>
      point('reserveAmount', String(reserveAmount), withRules({ reserveAmount })),
    ),
    incidentThreshold: [1, 2, 3, 4].map((incidentThreshold) =>
      point('incidentThreshold', String(incidentThreshold), withRules({ incidentThreshold })),
    ),
    resolveOrder: (['auto-first', 'manual-first'] as const).map((resolveOrder) =>
      point('resolveOrder', resolveOrder, withRules({ resolveOrder })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizon: 6,
      focus: focusPool,
      manualCost,
      shipValue,
      lossPerIncident: 5,
      arrivals: {
        calm: [...arrivalsFor.calm],
        crisis: [...arrivalsFor.crisis],
        untargetable: [...arrivalsFor.untargetable],
      },
      decision: {
        manual: 'react',
        reserved: 'reserve',
        score: 'shippedValue - incidentLoss',
        leaveManualSlot:
          '対象を消せる盤面で残件が無いとき、利用可能集中力が手動費用を超える場合だけ出荷する',
        noDelayForTrigger: '手動が先でも、条件件数を残すために火消しを遅らせない',
      },
      baseline: cloneRules(baselineProcedureRules),
      held: {
        reserveAmount: '予約額だけを動かす。条件2件、自動が先。手動費用2、出荷9、損失5',
        incidentThreshold: '条件件数だけを動かす。予約額2、自動が先',
        resolveOrder: '手動との順序だけを動かす。予約額2、条件2件',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
  };
}
