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
const IMPL_TICKS = 3;
const VERIFY_TICKS: Record<VerifyMethod, number> = { script: 1, walkthrough: 3 };
const SHIP_VALUE = 12;
const SCENARIOS: Record<VerifyScenario, { horizon: number; shared: number; other: number }> = {
  low: { horizon: 5, shared: 4, other: 0 },
  high: { horizon: 8, shared: 14, other: 0 },
  other: { horizon: 8, shared: 14, other: 5 },
};

export function createVerificationPrototype(seed: string, scenario: VerifyScenario): VerifyState {
  const preset = SCENARIOS[scenario];
  return {
    version: 1,
    seed,
    scenario,
    tick: 0,
    horizon: preset.horizon,
    implMethod: 'script',
    implTicks: IMPL_TICKS,
    verifyMethod: null,
    implLeft: IMPL_TICKS,
    verifyLeft: 0,
    sharedPenalty: preset.shared,
    otherPenalty: preset.other,
    caughtShared: false,
    shipped: null,
    resolutions: [],
    inputs: [],
  };
}

export function viewVerification(state: VerifyState) {
  return {
    tick: state.tick,
    implMethod: state.implMethod,
    verifyMethod: state.verifyMethod,
    implLeft: state.implLeft,
    verifyLeft: state.verifyLeft,
    methods: {
      script: { ticks: VERIFY_TICKS.script, catches: 'none' },
      walkthrough: { ticks: VERIFY_TICKS.walkthrough, catches: 'assumption' },
    },
    ignoredRisk: 'load',
  };
}

function isMethod(method: string): method is VerifyMethod {
  return method === 'script' || method === 'walkthrough';
}

export function applyVerificationInput(state: VerifyState, input: VerifyInput): VerifyState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'verify') return assignMethod(state, input.method);
  if (state.verifyMethod === null) return state;
  return workTick(state);
}

function assignMethod(state: VerifyState, method: string): VerifyState {
  if (!isMethod(method) || state.tick > 0 || state.verifyMethod === method) return state;
  const next = structuredClone(state);
  next.verifyMethod = method;
  next.verifyLeft = VERIFY_TICKS[method];
  next.inputs.push({ type: 'verify', method });
  return next;
}

function workTick(state: VerifyState): VerifyState {
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
      next.shipped = SHIP_VALUE - shared - next.otherPenalty;
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
