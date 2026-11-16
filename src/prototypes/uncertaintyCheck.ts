/** RI-196: 兆候は確認対象であり、実リスクは確認完了まで公開しない。 */
import { createRng, getRngState } from '../sim/rng';

export type Signal = 'clear' | 'uncertain';
export type Verifier = 'thin' | 'thick';
export type UncertaintyPolicy = 'ship' | 'flagged' | 'all';
export type UncertaintyInput =
  { type: 'check'; id: string } | { type: 'ship'; id: string } | { type: 'tick' };
export interface UncertaintyTask {
  id: string;
  signal: Signal;
  actualRisk: number;
  value: number;
  checkTicksSpent: number;
  riskReduced: number | null;
  shipped: boolean;
  checkLeft: number;
  shipLeft: number;
}
export interface UncertaintyState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  verifier: Verifier;
  generation: number;
  tasks: UncertaintyTask[];
  inputs: UncertaintyInput[];
}
export interface UncertaintySignals {
  alarm: Signal;
  flagged: Signal;
  miss: Signal;
}
/** 省略した項目は初回比較のまま。リスクと出荷価値は上書きしない。 */
export interface UncertaintyOverrides {
  checkTicks?: number;
  unfinishedPenalty?: number;
  signals?: UncertaintySignals;
}
const CHECK_TICKS: Record<Verifier, number> = { thin: 3, thick: 1 };
const PENALTY = 3;
const TASK_SPECS = [
  { id: 'alarm', signal: 'uncertain', actualRisk: 0, value: 10 },
  { id: 'flagged', signal: 'uncertain', actualRisk: 6, value: 10 },
  { id: 'miss', signal: 'clear', actualRisk: 4, value: 10 },
] as const;
export function createUncertaintyPrototype(
  seed: number,
  horizon: number,
  verifier: Verifier,
  overrides: UncertaintyOverrides = {},
): UncertaintyState {
  const rng = createRng(seed);
  rng();
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    verifier,
    generation: getRngState(rng),
    tasks: TASK_SPECS.map((task) => ({
      id: task.id,
      signal: overrides.signals?.[task.id] ?? task.signal,
      actualRisk: task.actualRisk,
      value: task.value,
      checkTicksSpent: 0,
      riskReduced: null,
      shipped: false,
      checkLeft: 0,
      shipLeft: 0,
    })),
    inputs: [],
  };
}
function busy(task: UncertaintyTask) {
  return task.checkLeft > 0 || task.shipLeft > 0;
}
export function viewUncertainty(state: UncertaintyState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    verifier: state.verifier,
    generation: state.generation,
    checkTicks: CHECK_TICKS[state.verifier],
    tasks: state.tasks.map((task) => ({
      id: task.id,
      signal: task.signal,
      value: task.value,
      shipped: task.shipped,
      checkTicksSpent: task.checkTicksSpent,
      riskReduced: task.riskReduced,
    })),
  };
}
export function applyUncertaintyInput(
  state: UncertaintyState,
  input: UncertaintyInput,
  overrides: UncertaintyOverrides = {},
): UncertaintyState {
  if (state.tick >= state.horizon) return state;
  const active = state.tasks.find(busy);
  if (input.type === 'tick' && !active && state.tasks.every((task) => task.shipped)) {
    const next = structuredClone(state);
    next.tick += 1;
    next.inputs.push({ type: 'tick' });
    return next;
  }
  if (input.type !== 'tick' && active) return state;
  if (input.type === 'tick' && !active) return state;
  const target = input.type === 'tick' ? active : state.tasks.find((task) => task.id === input.id);
  if (!target) return state;
  if (
    input.type === 'check' &&
    (target.shipped || target.checkTicksSpent > 0 || target.riskReduced !== null)
  ) {
    return state;
  }
  if (input.type === 'ship' && target.shipped) return state;
  const next = structuredClone(state);
  const task = next.tasks.find((item) => item.id === target.id)!;
  if (input.type === 'check') task.checkLeft = overrides.checkTicks ?? CHECK_TICKS[next.verifier];
  else if (input.type === 'ship') task.shipLeft = 1;
  else {
    next.tick += 1;
    if (task.checkLeft > 0) {
      task.checkLeft -= 1;
      task.checkTicksSpent += 1;
      if (task.checkLeft === 0) task.riskReduced = task.actualRisk;
    } else {
      task.shipLeft -= 1;
      if (task.shipLeft === 0) task.shipped = true;
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeUncertainty(
  state: UncertaintyState,
  overrides: UncertaintyOverrides = {},
) {
  const tasks = state.tasks.map((task) => ({
    id: task.id,
    signal: task.signal,
    shipped: task.shipped,
    checkTicksSpent: task.checkTicksSpent,
    riskReduced: task.riskReduced,
    realizedRisk: task.shipped && task.riskReduced === null ? task.actualRisk : 0,
    falseAlarm: task.signal === 'uncertain' && task.riskReduced === 0,
    missedSignal: task.signal === 'clear' && task.actualRisk > 0,
  }));
  const shippedValue = state.tasks.reduce((sum, task) => sum + (task.shipped ? task.value : 0), 0);
  const realizedRisk = tasks.reduce((sum, task) => sum + task.realizedRisk, 0);
  const unfinishedPenalty =
    state.tasks.filter((task) => !task.shipped).length * (overrides.unfinishedPenalty ?? PENALTY);
  return {
    tasks,
    shippedValue,
    realizedRisk,
    checkTicks: state.tasks.reduce((sum, task) => sum + task.checkTicksSpent, 0),
    riskReduced: state.tasks.reduce((sum, task) => sum + (task.riskReduced ?? 0), 0),
    unfinishedPenalty,
    netValue: shippedValue - realizedRisk - unfinishedPenalty,
  };
}
export function chooseUncertaintyAction(
  state: UncertaintyState,
  policy: UncertaintyPolicy,
): UncertaintyInput {
  if (state.tasks.some(busy)) return { type: 'tick' };
  const pendingCheck = state.tasks.find(
    (task) =>
      !task.shipped &&
      task.riskReduced === null &&
      task.checkTicksSpent === 0 &&
      (policy === 'all' || (policy === 'flagged' && task.signal === 'uncertain')),
  );
  if (policy !== 'ship' && pendingCheck) return { type: 'check', id: pendingCheck.id };
  const pendingShip = state.tasks.find((task) => !task.shipped);
  if (pendingShip) return { type: 'ship', id: pendingShip.id };
  return { type: 'tick' };
}
export function compareUncertaintyPolicies(seed = 196) {
  return (['thin', 'thick'] as const).flatMap((verifier) =>
    ([5, 10] as const).flatMap((horizon) =>
      (['ship', 'flagged', 'all'] as const).map((policy) => {
        const initial = createUncertaintyPrototype(seed, horizon, verifier);
        let state = initial;
        let guard = 0;
        while (state.tick < horizon) {
          if (++guard > 80) throw new Error(`${verifier}:${horizon}:${policy}`);
          const next = applyUncertaintyInput(state, chooseUncertaintyAction(state, policy));
          if (next === state) throw new Error(`${verifier}:${horizon}:${policy}@${state.tick}`);
          state = next;
        }
        return {
          verifier,
          horizon,
          policy,
          initial,
          inputs: state.inputs,
          result: summarizeUncertainty(state),
        };
      }),
    ),
  );
}

const FACTOR_SEED = 196;
const FACTOR_HORIZONS = [5, 10] as const;
const BASELINE_SIGNALS: UncertaintySignals = {
  alarm: 'uncertain',
  flagged: 'uncertain',
  miss: 'clear',
};
const HIT_BOARDS: readonly UncertaintySignals[] = [
  { alarm: 'uncertain', flagged: 'clear', miss: 'clear' },
  { alarm: 'uncertain', flagged: 'uncertain', miss: 'clear' },
  { alarm: 'clear', flagged: 'uncertain', miss: 'clear' },
  { alarm: 'clear', flagged: 'uncertain', miss: 'uncertain' },
];
type UncertaintyFactorAxis = 'hitRate' | 'checkTicks' | 'unfinishedPenalty';
type UncertaintyResource = 'thin' | 'thick' | 'ticks';
type UncertaintyPreference = 'check' | 'ship' | 'tie';
interface UncertaintyFactorRun {
  inputs: UncertaintyInput[];
  result: ReturnType<typeof summarizeUncertainty>;
}
interface UncertaintyFactorCell {
  horizon: number;
  resource: UncertaintyResource;
  checkTicks: number;
  preference: UncertaintyPreference;
  margin: number;
  ship: UncertaintyFactorRun;
  check: UncertaintyFactorRun;
}
interface UncertaintyFactorPoint {
  axis: UncertaintyFactorAxis;
  parameter: string;
  hits: number;
  signals: UncertaintySignals;
  unfinishedPenalty: number;
  cells: UncertaintyFactorCell[];
}
interface UncertaintyFactorReversal {
  axis: UncertaintyFactorAxis;
  resource: UncertaintyResource;
  horizon: number;
  before: { parameter: string; preference: UncertaintyPreference; ship: number; check: number };
  after: { parameter: string; preference: UncertaintyPreference; ship: number; check: number };
}
function signalHits(signals: UncertaintySignals): number {
  return TASK_SPECS.filter((task) => {
    const marked = signals[task.id] === 'uncertain';
    const risky = task.actualRisk > 0;
    return marked === risky;
  }).length;
}
function preferenceOf(shipNet: number, checkNet: number): UncertaintyPreference {
  if (checkNet > shipNet) return 'check';
  if (shipNet > checkNet) return 'ship';
  return 'tie';
}
function runFactor(
  horizon: number,
  verifier: Verifier,
  policy: 'ship' | 'flagged',
  overrides: UncertaintyOverrides,
): UncertaintyFactorRun {
  let state = createUncertaintyPrototype(FACTOR_SEED, horizon, verifier, overrides);
  let guard = 0;
  while (state.tick < horizon) {
    if (++guard > 80) throw new Error(`${policy}:${horizon}`);
    const next = applyUncertaintyInput(state, chooseUncertaintyAction(state, policy), overrides);
    if (next === state) throw new Error(`${policy}:${horizon}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeUncertainty(state, overrides) };
}
function factorCell(
  horizon: number,
  resource: UncertaintyResource,
  checkTicks: number,
  signals: UncertaintySignals,
  unfinishedPenalty: number,
): UncertaintyFactorCell {
  const overrides = { checkTicks, unfinishedPenalty, signals };
  const verifier: Verifier = resource === 'thick' ? 'thick' : 'thin';
  const ship = runFactor(horizon, verifier, 'ship', overrides);
  const check = runFactor(horizon, verifier, 'flagged', overrides);
  const shipNet = ship.result.netValue;
  const checkNet = check.result.netValue;
  return {
    horizon,
    resource,
    checkTicks,
    preference: preferenceOf(shipNet, checkNet),
    margin: checkNet - shipNet,
    ship,
    check,
  };
}
function resourceCells(signals: UncertaintySignals, penalty: number): UncertaintyFactorCell[] {
  return (['thin', 'thick'] as const).flatMap((resource) =>
    FACTOR_HORIZONS.map((horizon) =>
      factorCell(horizon, resource, CHECK_TICKS[resource], signals, penalty),
    ),
  );
}
function factorPoint(
  axis: UncertaintyFactorAxis,
  parameter: string,
  signals: UncertaintySignals,
  unfinishedPenalty: number,
  cells: UncertaintyFactorCell[],
): UncertaintyFactorPoint {
  return {
    axis,
    parameter,
    hits: signalHits(signals),
    signals: { ...signals },
    unfinishedPenalty,
    cells,
  };
}
function reversalsOf(rows: UncertaintyFactorPoint[]): UncertaintyFactorReversal[] {
  const found: UncertaintyFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const earlier of before.cells) {
      const later = after.cells.find(
        (cell) => cell.resource === earlier.resource && cell.horizon === earlier.horizon,
      );
      if (!later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        resource: earlier.resource,
        horizon: earlier.horizon,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          ship: earlier.ship.result.netValue,
          check: earlier.check.result.netValue,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          ship: later.ship.result.netValue,
          check: later.check.result.netValue,
        },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、的中率・確認tick・未出荷ペナルティを一つずつ動かす。固定戦略。 */
export function compareUncertaintyFactorReversals() {
  const hitRate = HIT_BOARDS.map((signals) => {
    const hits = signalHits(signals);
    return factorPoint('hitRate', `${hits}/3`, signals, PENALTY, resourceCells(signals, PENALTY));
  });
  const checkTicks = [1, 2, 3, 4, 5].map((ticks) =>
    factorPoint(
      'checkTicks',
      String(ticks),
      BASELINE_SIGNALS,
      PENALTY,
      FACTOR_HORIZONS.map((horizon) =>
        factorCell(horizon, 'ticks', ticks, BASELINE_SIGNALS, PENALTY),
      ),
    ),
  );
  const unfinishedPenalty = [0, 1, 3, 6].map((penalty) =>
    factorPoint(
      'unfinishedPenalty',
      String(penalty),
      BASELINE_SIGNALS,
      penalty,
      resourceCells(BASELINE_SIGNALS, penalty),
    ),
  );
  const sweeps = { hitRate, checkTicks, unfinishedPenalty };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizons: [...FACTOR_HORIZONS],
      resources: {
        tasks: TASK_SPECS.map((task) => ({
          id: task.id,
          actualRisk: task.actualRisk,
          value: task.value,
        })),
        shipTicks: 1,
        baselineCheckTicks: { ...CHECK_TICKS },
        baselinePenalty: PENALTY,
        baselineSignals: { ...BASELINE_SIGNALS },
      },
      decision: {
        ship: 'ship',
        check: 'flagged',
        score: 'shippedValue - realizedRisk - unfinishedPenalty',
        margin: 'check - ship',
      },
      hitDefinition:
        'リスクがある仕事は uncertain、リスクが無い仕事は clear のとき的中。率は的中件数/3',
      hitOrder:
        '0/3は本命flaggedの兆候を外す。1/3は初回。2/3は誤警報alarmの兆候を消す。3/3は見落としmissに兆候を付ける。隣同士は兆候が一つだけ違う',
      sameRateNotSwept: '同じ2/3でも誤警報を残し見落としに兆候を足す並びは動かしていない',
      held: {
        hitRate: '兆候だけを動かす。確認tickは薄3・厚1、罰は3。リスク0・6・4は固定',
        checkTicks:
          '確認tickだけを動かす。期末5と10。兆候は初回、罰は3。薄い3と厚い1はこの軸の1と3',
        unfinishedPenalty: '罰だけを動かす。兆候は初回、確認tickは薄3・厚1',
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      allPolicyRecomputed: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [hitRate, checkTicks, unfinishedPenalty].flatMap((rows) => reversalsOf(rows)),
  };
}
