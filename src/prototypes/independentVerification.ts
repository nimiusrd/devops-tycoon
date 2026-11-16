/** RI-194: 実装と検証の手法が違うときだけ共通見落としを見つける。 */
export type VerifyMethod = 'script' | 'walkthrough';
export type VerifyScenario = 'low' | 'high' | 'other';
export type VerifyStrategy = 'same' | 'independent';
export type VerifyInput = { type: 'verify'; method: string } | { type: 'tick' };
export interface VerifyState {
  version: 1;
  seed: string;
  scenario: VerifyScenario;
  tick: number;
  horizon: number;
  implMethod: 'script';
  implTicks: number;
  verifyMethod: VerifyMethod | null;
  implLeft: number;
  verifyLeft: number;
  sharedPenalty: number;
  otherPenalty: number;
  caughtShared: boolean;
  shipped: number | null;
  resolutions: string[];
  inputs: VerifyInput[];
}
const SCENARIOS: Record<VerifyScenario, { horizon: number; shared: number; other: number }> = {
  low: { horizon: 5, shared: 4, other: 0 },
  high: { horizon: 8, shared: 14, other: 0 },
  other: { horizon: 8, shared: 14, other: 5 },
};
/** 初回比較の資源。別手法のtick数は独立性の定義ではない。 */
export interface VerifyRules {
  implTicks: number;
  scriptTicks: number;
  walkthroughTicks: number;
  shipValue: number;
}
export const baselineVerifyRules: VerifyRules = {
  implTicks: 3,
  scriptTicks: 1,
  walkthroughTicks: 3,
  shipValue: 12,
};
const FACTOR_SCENARIOS = ['low', 'high', 'other'] as const;
const VERIFY_TICK_LEVELS = [1, 2, 3, 4, 5, 6] as const;
const SHARED_LEVELS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export function createVerificationPrototype(
  seed: string,
  scenario: VerifyScenario,
  rules: VerifyRules = baselineVerifyRules,
  sharedPenalty?: number,
): VerifyState {
  const preset = SCENARIOS[scenario];
  const shared = sharedPenalty === undefined ? preset.shared : sharedPenalty;
  return {
    version: 1,
    seed,
    scenario,
    tick: 0,
    horizon: preset.horizon,
    implMethod: 'script',
    implTicks: rules.implTicks,
    verifyMethod: null,
    implLeft: rules.implTicks,
    verifyLeft: 0,
    sharedPenalty: shared,
    otherPenalty: preset.other,
    caughtShared: false,
    shipped: null,
    resolutions: [],
    inputs: [],
  };
}

export function viewVerification(state: VerifyState, rules: VerifyRules = baselineVerifyRules) {
  return {
    tick: state.tick,
    implMethod: state.implMethod,
    verifyMethod: state.verifyMethod,
    implLeft: state.implLeft,
    verifyLeft: state.verifyLeft,
    methods: {
      script: { ticks: rules.scriptTicks, catches: 'none' },
      walkthrough: { ticks: rules.walkthroughTicks, catches: 'assumption' },
    },
    ignoredRisk: 'load',
  };
}

function isMethod(method: string): method is VerifyMethod {
  return method === 'script' || method === 'walkthrough';
}

export function applyVerificationInput(
  state: VerifyState,
  input: VerifyInput,
  rules: VerifyRules = baselineVerifyRules,
): VerifyState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'verify') return assignMethod(state, input.method, rules);
  if (state.verifyMethod === null) return state;
  return workTick(state, rules);
}

function ticksOf(method: VerifyMethod, rules: VerifyRules): number {
  return method === 'script' ? rules.scriptTicks : rules.walkthroughTicks;
}

function assignMethod(state: VerifyState, method: string, rules: VerifyRules): VerifyState {
  if (!isMethod(method) || state.tick > 0 || state.verifyMethod === method) return state;
  const next = structuredClone(state);
  next.verifyMethod = method;
  next.verifyLeft = ticksOf(method, rules);
  next.inputs.push({ type: 'verify', method });
  return next;
}

function workTick(state: VerifyState, rules: VerifyRules): VerifyState {
  const next = structuredClone(state);
  next.tick += 1;
  const notes = [`t${next.tick}`];
  if (next.implLeft > 0) {
    next.implLeft -= 1;
    notes.push(`implement:${next.implMethod}`);
  } else if (next.verifyLeft > 0 && next.shipped === null) {
    next.verifyLeft -= 1;
    notes.push(`verify:${next.verifyMethod}`);
    if (next.verifyLeft === 0) {
      next.caughtShared = next.verifyMethod !== next.implMethod;
      const shared = next.caughtShared ? 0 : next.sharedPenalty;
      next.shipped = rules.shipValue - shared - next.otherPenalty;
      notes.push(next.caughtShared ? 'caught:assumption' : 'missed:assumption');
      if (next.otherPenalty > 0) notes.push('missed:load');
      notes.push(`ship:${next.shipped}`);
    }
  } else notes.push('idle');
  next.resolutions.push(notes.join(','));
  next.inputs.push({ type: 'tick' });
  return next;
}

export function summarizeVerification(state: VerifyState) {
  return {
    tick: state.tick,
    verifyMethod: state.verifyMethod,
    implLeft: state.implLeft,
    verifyLeft: state.verifyLeft,
    caughtShared: state.caughtShared,
    shipped: state.shipped,
    resolutions: state.resolutions,
    netValue: state.shipped ?? 0,
  };
}

export function chooseVerificationAction(
  state: VerifyState,
  strategy: VerifyStrategy,
): VerifyInput {
  const method: VerifyMethod = strategy === 'same' ? 'script' : 'walkthrough';
  if (state.tick === 0 && state.verifyMethod !== method) return { type: 'verify', method };
  return { type: 'tick' };
}

const COMPARE_ROWS: { scenario: VerifyScenario; strategies: VerifyStrategy[] }[] = [
  { scenario: 'low', strategies: ['same', 'independent'] },
  { scenario: 'high', strategies: ['independent', 'same'] },
  { scenario: 'other', strategies: ['independent', 'same'] },
];

export function compareVerificationStrategies(seed: string) {
  return COMPARE_ROWS.flatMap(({ scenario, strategies }) =>
    strategies.map((strategy) => {
      const initial = createVerificationPrototype(seed, scenario);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
        const action = chooseVerificationAction(state, strategy);
        const next = applyVerificationInput(state, action);
        if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.tick}`);
        state = next;
      }
      return {
        scenario,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeVerification(state),
      };
    }),
  );
}

export type VerifyPreference = 'independent' | 'same' | 'tie';
export interface VerifyFactorRun {
  scenario: VerifyScenario;
  strategy: VerifyStrategy;
  verifyTicks: number;
  sharedPenalty: number;
  rules: VerifyRules;
  initial: VerifyState;
  inputs: VerifyInput[];
  result: ReturnType<typeof summarizeVerification>;
}
export interface VerifyFactorPoint {
  scenario: VerifyScenario;
  horizon: number;
  otherPenalty: number;
  verifyTicks: number;
  sharedPenalty: number;
  same: number;
  independent: number;
  preference: VerifyPreference;
  independentCaught: boolean;
  independentShipped: boolean;
  runs: VerifyFactorRun[];
}
export interface VerifyFactorReversal {
  factor: 'verifyTicks' | 'sharedPenalty';
  scenario: VerifyScenario;
  before: { level: number; preference: VerifyPreference; same: number; independent: number };
  after: { level: number; preference: VerifyPreference; same: number; independent: number };
  strict: boolean;
}
function cloneRules(rules: VerifyRules): VerifyRules {
  return { ...rules };
}
function preferenceOf(same: number, independent: number): VerifyPreference {
  if (independent > same) return 'independent';
  if (same > independent) return 'same';
  return 'tie';
}
function runVerification(
  seed: string,
  scenario: VerifyScenario,
  strategy: VerifyStrategy,
  rules: VerifyRules,
  sharedPenalty: number,
): VerifyFactorRun {
  const fixed = cloneRules(rules);
  const initial = createVerificationPrototype(seed, scenario, fixed, sharedPenalty);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
    const action = chooseVerificationAction(state, strategy);
    const next = applyVerificationInput(state, action, fixed);
    if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.tick}`);
    state = next;
  }
  return {
    scenario,
    strategy,
    verifyTicks: fixed.walkthroughTicks,
    sharedPenalty,
    rules: fixed,
    initial,
    inputs: state.inputs,
    result: summarizeVerification(state),
  };
}
function factorPoint(
  seed: string,
  scenario: VerifyScenario,
  rules: VerifyRules,
  sharedPenalty: number,
): VerifyFactorPoint {
  const same = runVerification(seed, scenario, 'same', rules, sharedPenalty);
  const independent = runVerification(seed, scenario, 'independent', rules, sharedPenalty);
  return {
    scenario,
    horizon: same.initial.horizon,
    otherPenalty: same.initial.otherPenalty,
    verifyTicks: rules.walkthroughTicks,
    sharedPenalty,
    same: same.result.netValue,
    independent: independent.result.netValue,
    preference: preferenceOf(same.result.netValue, independent.result.netValue),
    independentCaught: independent.result.caughtShared,
    independentShipped: independent.result.shipped !== null,
    runs: [same, independent],
  };
}
function reversals(
  factor: 'verifyTicks' | 'sharedPenalty',
  points: VerifyFactorPoint[],
): VerifyFactorReversal[] {
  const found: VerifyFactorReversal[] = [];
  for (const scenario of FACTOR_SCENARIOS) {
    const rows = points.filter((point) => point.scenario === scenario);
    for (let index = 1; index < rows.length; index += 1) {
      const before = rows[index - 1];
      const after = rows[index];
      if (!before || !after || before.preference === after.preference) continue;
      const level = (point: VerifyFactorPoint) =>
        factor === 'verifyTicks' ? point.verifyTicks : point.sharedPenalty;
      found.push({
        factor,
        scenario,
        before: {
          level: level(before),
          preference: before.preference,
          same: before.same,
          independent: before.independent,
        },
        after: {
          level: level(after),
          preference: after.preference,
          same: after.same,
          independent: after.independent,
        },
        strict: before.preference !== 'tie' && after.preference !== 'tie',
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、別手法の検証tickと共通見落としを一つずつ動かす。固定戦略。 */
export function compareVerificationFactorReversals(seed: string) {
  const verifyPoints = VERIFY_TICK_LEVELS.flatMap((walkthroughTicks) =>
    FACTOR_SCENARIOS.map((scenario) =>
      factorPoint(
        seed,
        scenario,
        { ...baselineVerifyRules, walkthroughTicks },
        SCENARIOS[scenario].shared,
      ),
    ),
  );
  const sharedPoints = SHARED_LEVELS.flatMap((sharedPenalty) =>
    FACTOR_SCENARIOS.map((scenario) =>
      factorPoint(seed, scenario, baselineVerifyRules, sharedPenalty),
    ),
  );
  const boards = Object.fromEntries(
    FACTOR_SCENARIOS.map((scenario) => [
      scenario,
      {
        horizon: SCENARIOS[scenario].horizon,
        sharedPenalty: SCENARIOS[scenario].shared,
        otherPenalty: SCENARIOS[scenario].other,
      },
    ]),
  );
  return {
    conditions: {
      seed,
      boards,
      baseline: cloneRules(baselineVerifyRules),
      verifyTickLevels: [...VERIFY_TICK_LEVELS],
      sharedLevels: [...SHARED_LEVELS],
      same: 'script。同じ担当が続ける',
      independent: 'walkthrough。実装と検証を分ける',
      score: 'netValue。未出荷は0',
      verifyTicks:
        '別手法 walkthrough の検証tick。同じ手法 script は1のまま。独立性は手法が違うことで、tick数ではない',
      sharedPenalty:
        '共通見落とし assumption の大きさ。別手法が捕まえたときは出荷から引かない。負荷は盤面のまま',
      methodAssignConsumesTick: false,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
    },
    verifyTicks: {
      held: '別手法の検証tickだけを1から6にする。見落としと負荷は盤面の初回値。実装3、同じ手法1、出荷12',
      points: verifyPoints,
      reversals: reversals('verifyTicks', verifyPoints),
    },
    sharedPenalty: {
      held: '共通見落としだけを0から14まで1ずつ動かす。別手法は3tick。実装3、同じ手法1、出荷12、負荷は盤面の初回値',
      points: sharedPoints,
      reversals: reversals('sharedPenalty', sharedPoints),
    },
  };
}
