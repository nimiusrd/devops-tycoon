import {
  createParallelPrototype,
  tickParallelPrototype,
  type ParallelState,
} from './parallelConflicts';

export interface MinimumReleaseState {
  version: 1;
  board: ParallelState;
  extraDeferred: boolean;
  trust: number;
  released: { part: 'core' | 'extra' | 'urgent'; tick: number; value: number }[];
  decisions: { kind: 'defer'; tick: number; workLeft: number }[];
}
export type MinimumReleaseInput =
  { kind: 'work'; id: string } | { kind: 'wait' } | { kind: 'defer' };
export type MinimumReleaseStrategy = 'full' | 'minimum';
export type MinimumReleasePressure = 'tight' | 'roomy';
/** 初回比較の資源。差引は公開価値から、失った信頼を1対1で引く。 */
export interface MinimumReleaseRules {
  additionalValue: number;
  trustLoss: number;
  urgentDeadline: number | null;
  promiseTicks: number;
}
export const baselineMinimumReleaseRules: MinimumReleaseRules = {
  additionalValue: 10,
  trustLoss: 1,
  urgentDeadline: null,
  promiseTicks: 0,
};
const START_TRUST = 5;

/** reduce は第3引数に添字を渡す。規則オブジェクトでないときは初回の規則に戻す。 */
function rulesOf(rules?: MinimumReleaseRules): MinimumReleaseRules {
  if (
    typeof rules !== 'object' ||
    rules === null ||
    typeof rules.additionalValue !== 'number' ||
    typeof rules.trustLoss !== 'number' ||
    typeof rules.promiseTicks !== 'number' ||
    (rules.urgentDeadline !== null && typeof rules.urgentDeadline !== 'number')
  )
    return baselineMinimumReleaseRules;
  return rules;
}

export function createMinimumReleasePrototype(
  seed: string | number,
  pressure: MinimumReleasePressure,
  rules: MinimumReleaseRules = baselineMinimumReleaseRules,
): MinimumReleaseState {
  const active = rulesOf(rules);
  const board = createParallelPrototype(seed);
  board.slots = 1;
  board.horizon = pressure === 'tight' ? 5 : 8;
  board.tasks = [
    {
      id: 'core',
      domain: 'product',
      codingLeft: 3,
      integrationLeft: 0,
      completedTick: null,
      value: 6,
    },
    {
      id: 'extra',
      domain: 'product',
      codingLeft: 4,
      integrationLeft: 0,
      completedTick: null,
      value: active.additionalValue,
    },
    {
      id: 'urgent',
      domain: 'platform',
      codingLeft: 2,
      integrationLeft: 0,
      completedTick: null,
      value: 8,
    },
  ];
  return {
    version: 1,
    board,
    extraDeferred: false,
    trust: START_TRUST,
    released: [],
    decisions: [],
  };
}

function periodBoundary(state: MinimumReleaseState, rules: MinimumReleaseRules) {
  return state.board.horizon - rules.promiseTicks;
}
/** 先送りは今期だけ追加を拒む。次期のtickでは残った約束を作業できる。 */
function extraBlocked(state: MinimumReleaseState, rules: MinimumReleaseRules) {
  return state.extraDeferred && state.board.tick < periodBoundary(state, rules);
}

/** 必須だけで成立する出荷を確定し、完全版は追加分だけ加算する。 */
export function tickMinimumReleasePrototype(
  state: MinimumReleaseState,
  input: MinimumReleaseInput,
  rules: MinimumReleaseRules = baselineMinimumReleaseRules,
): MinimumReleaseState {
  const active = rulesOf(rules);
  if (state.board.tick >= state.board.horizon) return state;
  const core = state.board.tasks.find((task) => task.id === 'core')!;
  const extra = state.board.tasks.find((task) => task.id === 'extra')!;
  if (input.kind === 'defer') {
    if (core.completedTick === null || extra.completedTick !== null || state.extraDeferred)
      return state;
    return {
      ...state,
      extraDeferred: true,
      trust: state.trust - active.trustLoss,
      decisions: [
        ...state.decisions,
        {
          kind: 'defer',
          tick: state.board.tick,
          workLeft: extra.codingLeft + extra.integrationLeft,
        },
      ],
    };
  }
  if (
    input.kind === 'work' &&
    input.id === 'extra' &&
    (core.completedTick === null || extraBlocked(state, active))
  )
    return state;
  const board = tickParallelPrototype(state.board, input.kind === 'wait' ? [] : [input.id]);
  if (board === state.board) return state;
  const released = [...state.released];
  for (const task of board.tasks) {
    if (task.completedTick !== board.tick) continue;
    if (
      task.id === 'urgent' &&
      active.urgentDeadline !== null &&
      board.tick > active.urgentDeadline
    )
      continue;
    released.push({
      part: task.id as 'core' | 'extra' | 'urgent',
      tick: board.tick,
      value: task.value,
    });
  }
  return { ...state, board, released };
}

export function chooseMinimumReleaseInput(
  state: MinimumReleaseState,
  strategy: MinimumReleaseStrategy,
  rules: MinimumReleaseRules = baselineMinimumReleaseRules,
): MinimumReleaseInput {
  const active = rulesOf(rules);
  const core = state.board.tasks.find((task) => task.id === 'core')!;
  if (strategy === 'minimum' && !state.extraDeferred && core.completedTick !== null)
    return { kind: 'defer' };
  const task = state.board.tasks.find(
    (item) => item.completedTick === null && !(extraBlocked(state, active) && item.id === 'extra'),
  );
  return task ? { kind: 'work', id: task.id } : { kind: 'wait' };
}

export function summarizeMinimumRelease(state: MinimumReleaseState) {
  const extra = state.board.tasks.find((task) => task.id === 'extra')!;
  return {
    tick: state.board.tick,
    edition: state.released.some((part) => part.part === 'extra')
      ? 'full'
      : state.released.some((part) => part.part === 'core')
        ? 'minimum'
        : 'none',
    value: state.released.reduce((sum, part) => sum + part.value, 0),
    released: state.released,
    trust: state.trust,
    promise:
      extra.completedTick !== null
        ? null
        : {
            part: 'extra',
            deferred: state.extraDeferred,
            workLeft: extra.codingLeft + extra.integrationLeft,
            additionalValue: extra.value,
          },
    workSpent: state.board.history.reduce((sum, input) => sum + input.ids.length, 0),
  };
}

export function startMinimumRelease(
  seed: string | number,
  pressure: MinimumReleasePressure,
  rules: MinimumReleaseRules = baselineMinimumReleaseRules,
): MinimumReleaseState {
  const active = rulesOf(rules);
  const state = createMinimumReleasePrototype(seed, pressure, active);
  if (active.promiseTicks === 0) return state;
  return {
    ...state,
    board: { ...state.board, horizon: state.board.horizon + active.promiseTicks },
  };
}

export interface MinimumReleaseRun {
  inputs: MinimumReleaseInput[];
  decisions: MinimumReleaseState['decisions'];
  summary: ReturnType<typeof summarizeMinimumRelease>;
  trustLost: number;
  net: number;
}
export function runMinimumReleaseStrategy(
  seed: string | number,
  pressure: MinimumReleasePressure,
  strategy: MinimumReleaseStrategy,
  rules: MinimumReleaseRules = baselineMinimumReleaseRules,
): MinimumReleaseRun {
  let state = startMinimumRelease(seed, pressure, rules);
  const inputs: MinimumReleaseInput[] = [];
  let guard = 0;
  while (state.board.tick < state.board.horizon) {
    if (++guard > 40) throw new Error(`${pressure}:${strategy}`);
    const input = chooseMinimumReleaseInput(state, strategy, rules);
    inputs.push(input);
    const next = tickMinimumReleasePrototype(state, input, rules);
    if (next === state) throw new Error(`${pressure}:${strategy} tick ${state.board.tick}`);
    state = next;
  }
  const summary = summarizeMinimumRelease(state);
  const trustLost = START_TRUST - summary.trust;
  return {
    inputs,
    decisions: state.decisions,
    summary,
    trustLost,
    net: summary.value - trustLost,
  };
}

export function compareMinimumReleaseStrategies(seed: string | number) {
  return (['tight', 'roomy'] as const).flatMap((pressure) =>
    (['full', 'minimum'] as const).map((strategy) => {
      const run = runMinimumReleaseStrategy(seed, pressure, strategy);
      return {
        pressure,
        strategy,
        ...run.summary,
        inputs: run.inputs,
        decisions: run.decisions,
      };
    }),
  );
}

const FACTOR_SEED = 'RI-158';
const FACTOR_PRESSURES = ['tight', 'roomy'] as const;
export type MinimumReleasePreference = 'full' | 'minimum' | 'tie';
export interface MinimumReleaseFactorSide {
  strategy: MinimumReleaseStrategy;
  inputs: MinimumReleaseInput[];
  decisions: MinimumReleaseState['decisions'];
  summary: ReturnType<typeof summarizeMinimumRelease>;
  trustLost: number;
  net: number;
}
export interface MinimumReleasePressureComparison {
  pressure: MinimumReleasePressure;
  preference: MinimumReleasePreference;
  margin: number;
  full: MinimumReleaseFactorSide;
  minimum: MinimumReleaseFactorSide;
}
export interface MinimumReleaseFactorPoint {
  axis: string;
  parameter: string;
  rules: MinimumReleaseRules;
  pressures: MinimumReleasePressureComparison[];
}
export interface MinimumReleaseFactorReversal {
  axis: string;
  pressure: MinimumReleasePressure;
  before: {
    parameter: string;
    preference: MinimumReleasePreference;
    full: number;
    minimum: number;
  };
  after: { parameter: string; preference: MinimumReleasePreference; full: number; minimum: number };
}
function cloneRules(rules: MinimumReleaseRules): MinimumReleaseRules {
  return { ...rules };
}
function withRules(patch: Partial<MinimumReleaseRules>): MinimumReleaseRules {
  return { ...baselineMinimumReleaseRules, ...patch };
}
function preferenceOf(full: number, minimum: number): MinimumReleasePreference {
  if (full > minimum) return 'full';
  if (minimum > full) return 'minimum';
  return 'tie';
}
function side(run: MinimumReleaseRun, strategy: MinimumReleaseStrategy): MinimumReleaseFactorSide {
  return { strategy, ...run };
}
function point(
  axis: string,
  parameter: string,
  rules: MinimumReleaseRules,
): MinimumReleaseFactorPoint {
  const pressures = FACTOR_PRESSURES.map((pressure) => {
    const full = side(runMinimumReleaseStrategy(FACTOR_SEED, pressure, 'full', rules), 'full');
    const minimum = side(
      runMinimumReleaseStrategy(FACTOR_SEED, pressure, 'minimum', rules),
      'minimum',
    );
    return {
      pressure,
      preference: preferenceOf(full.net, minimum.net),
      margin: full.net - minimum.net,
      full,
      minimum,
    };
  });
  return { axis, parameter, rules: cloneRules(rules), pressures };
}
function reversalsOf(rows: MinimumReleaseFactorPoint[]): MinimumReleaseFactorReversal[] {
  const found: MinimumReleaseFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const pressure of FACTOR_PRESSURES) {
      const earlier = before.pressures.find((item) => item.pressure === pressure);
      const later = after.pressures.find((item) => item.pressure === pressure);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        pressure,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          full: earlier.full.net,
          minimum: earlier.minimum.net,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          full: later.full.net,
          minimum: later.minimum.net,
        },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、追加価値・信頼低下・別仕事の期限・次期約束の消化を一つずつ動かす。固定戦略。 */
export function compareMinimumReleaseFactorReversals() {
  const sweeps = {
    additionalValue: [0, 4, 6, 7, 8, 10, 14].map((additionalValue) =>
      point('additionalValue', String(additionalValue), withRules({ additionalValue })),
    ),
    trustLoss: [0, 1, 4, 7, 8, 9].map((trustLoss) =>
      point('trustLoss', String(trustLoss), withRules({ trustLoss })),
    ),
    urgentDeadline: [3, 4, 5, 8, null].map((urgentDeadline) =>
      point(
        'urgentDeadline',
        urgentDeadline === null ? 'none' : String(urgentDeadline),
        withRules({ urgentDeadline }),
      ),
    ),
    promiseTicks: [0, 1, 2, 3, 4].map((promiseTicks) =>
      point('promiseTicks', String(promiseTicks), withRules({ promiseTicks })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      pressures: [...FACTOR_PRESSURES],
      horizons: { tight: 5, roomy: 8 },
      slots: 1,
      core: { work: 3, value: 6 },
      extra: { work: 4 },
      urgent: { work: 2, value: 8 },
      startTrust: START_TRUST,
      decision: {
        full: '必須のあと追加を進め、先送りしない',
        minimum: '必須公開の直後に追加を先送りし、別仕事を進める',
        score: 'net = releasedValue - trustLost',
      },
      baseline: cloneRules(baselineMinimumReleaseRules),
      held: {
        additionalValue: '追加価値だけを動かす。信頼低下1、期限なし、次期0',
        trustLoss: '先送りで失う信頼だけを動かす。追加価値10、期限なし、次期0。下限は置かない',
        urgentDeadline:
          '別仕事の完了tickが期限を超えたときだけ公開価値に入れない。作業入力は変えない',
        promiseTicks:
          '今期のあとに同じ1枠で残作業を消化するtick数だけを足す。先送りは今期だけ追加を拒む',
      },
      deferConsumesTick: false,
      coreBeforeExtra: true,
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
