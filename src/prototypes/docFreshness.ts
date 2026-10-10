/** RI-192: 仕様書の量と鮮度は別。通常ランのdocumentation量とは接続しない。 */
export type DocScenario = 'stable' | 'changed';
export type DocStrategy = 'ignore' | 'add' | 'expand' | 'refresh';
export type Freshness = 'none' | 'fresh' | 'stale';
export type DocInput = { type: 'add' | 'refresh' | 'use' };
export interface DocState {
  version: 1;
  seed: string;
  scenario: DocScenario;
  tick: number;
  horizon: number;
  changeAt: number;
  quantity: number;
  freshness: Freshness;
  value: number;
  resolutions: string[];
  inputs: DocInput[];
}
const SCORE: Record<Freshness, number> = { fresh: 5, none: 2, stale: -4 };
const SCENARIOS: Record<DocScenario, { horizon: number; changeAt: number }> = {
  stable: { horizon: 6, changeAt: 0 },
  changed: { horizon: 8, changeAt: 3 },
};

export function createDocPrototype(seed: string, scenario: DocScenario): DocState {
  const preset = SCENARIOS[scenario];
  return {
    version: 1,
    seed,
    scenario,
    tick: 0,
    horizon: preset.horizon,
    changeAt: preset.changeAt,
    quantity: 0,
    freshness: 'none',
    value: 0,
    resolutions: [],
    inputs: [],
  };
}

export function viewDoc(state: DocState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    changeAt: state.changeAt,
    quantity: state.quantity,
    freshness: state.freshness,
    value: state.value,
    scores: SCORE,
  };
}

export function applyDocInput(state: DocState, input: DocInput): DocState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'add' && state.quantity >= 2) return state;
  if (input.type === 'refresh' && state.freshness !== 'stale') return state;
  const next = structuredClone(state);
  next.tick += 1;
  const notes = [`t${next.tick}:${input.type}`];
  if (next.changeAt !== 0 && next.tick === next.changeAt && next.freshness === 'fresh') {
    next.freshness = 'stale';
    notes.push('stale:spec-change');
  } else if (next.changeAt !== 0 && next.tick === next.changeAt) {
    notes.push(next.quantity === 0 ? 'change:no-doc' : 'change:already-stale');
  }
  if (input.type === 'add') {
    next.quantity += 1;
    if (next.freshness === 'none') next.freshness = 'fresh';
    notes.push(`qty:${next.quantity}`, `freshness:${next.freshness}`);
  } else if (input.type === 'refresh') {
    next.freshness = 'fresh';
    notes.push(`qty:${next.quantity}`, 'freshness:fresh');
  } else {
    const gained = SCORE[next.freshness];
    next.value += gained;
    notes.push(`score:${gained}`, `freshness:${next.freshness}`);
  }
  next.resolutions.push(notes.join(','));
  next.inputs.push({ type: input.type });
  return next;
}

export function summarizeDoc(state: DocState) {
  return {
    tick: state.tick,
    quantity: state.quantity,
    freshness: state.freshness,
    value: state.value,
    resolutions: state.resolutions,
    netValue: state.value,
  };
}

export function chooseDocAction(state: DocState, strategy: DocStrategy): DocInput {
  if (strategy !== 'ignore' && state.quantity === 0) return { type: 'add' };
  if (strategy === 'expand' && state.quantity < 2) return { type: 'add' };
  if (strategy === 'refresh' && state.freshness === 'stale') return { type: 'refresh' };
  return { type: 'use' };
}

const COMPARE_ROWS: { scenario: DocScenario; strategies: DocStrategy[] }[] = [
  { scenario: 'stable', strategies: ['add', 'refresh', 'expand', 'ignore'] },
  { scenario: 'changed', strategies: ['refresh', 'ignore', 'add', 'expand'] },
];

export function compareDocStrategies(seed: string) {
  return COMPARE_ROWS.flatMap(({ scenario, strategies }) =>
    strategies.map((strategy) => {
      const initial = createDocPrototype(seed, scenario);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 40) throw new Error(`${scenario}:${strategy}`);
        const action = chooseDocAction(state, strategy);
        const next = applyDocInput(state, action);
        if (next === state) throw new Error(`${scenario}:${strategy} tick ${state.tick}`);
        state = next;
      }
      return { scenario, strategy, initial, inputs: state.inputs, result: summarizeDoc(state) };
    }),
  );
}
