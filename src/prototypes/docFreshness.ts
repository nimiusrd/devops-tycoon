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
export interface DocScores {
  fresh: number;
  none: number;
  stale: number;
}
/** 初回比較の利用得点。古い資料の減点は stale。 */
export const baselineDocScores: DocScores = { fresh: 5, none: 2, stale: -4 };
const SCENARIOS: Record<DocScenario, { horizon: number; changeAt: number }> = {
  stable: { horizon: 6, changeAt: 0 },
  changed: { horizon: 8, changeAt: 3 },
};

export function createDocPrototype(
  seed: string,
  scenario: DocScenario,
  changeAt?: number,
): DocState {
  const preset = SCENARIOS[scenario];
  return {
    version: 1,
    seed,
    scenario,
    tick: 0,
    horizon: preset.horizon,
    changeAt: scenario === 'changed' && changeAt !== undefined ? changeAt : preset.changeAt,
    quantity: 0,
    freshness: 'none',
    value: 0,
    resolutions: [],
    inputs: [],
  };
}

export function viewDoc(state: DocState, scores: DocScores = baselineDocScores) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    changeAt: state.changeAt,
    quantity: state.quantity,
    freshness: state.freshness,
    value: state.value,
    scores: { fresh: scores.fresh, none: scores.none, stale: scores.stale },
  };
}

export function applyDocInput(
  state: DocState,
  input: DocInput,
  scores: DocScores = baselineDocScores,
): DocState {
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
    const gained = scores[next.freshness];
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

const FACTOR_SEED = 'RI-192';
const CHANGE_TICKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const STALE_SCORES = [-8, -4, -2, 0, 2, 3, 4, 5] as const;
export type DocPreference = 'refresh' | 'add' | 'tie';
export interface DocFactorRules {
  changeAt: number;
  fresh: number;
  none: number;
  stale: number;
}
export interface DocFactorRun {
  inputs: DocInput[];
  result: ReturnType<typeof summarizeDoc>;
}
export interface DocFactorPoint {
  axis: 'changeAt' | 'staleScore';
  parameter: string;
  rules: DocFactorRules;
  preference: DocPreference;
  margin: number;
  sameAsFirstComparison: boolean;
  refresh: DocFactorRun;
  add: DocFactorRun;
}
export interface DocFactorReversal {
  axis: DocFactorPoint['axis'];
  before: { parameter: string; preference: DocPreference; refresh: number; add: number };
  after: { parameter: string; preference: DocPreference; refresh: number; add: number };
}
const baselineFactorRules: DocFactorRules = {
  changeAt: 3,
  fresh: baselineDocScores.fresh,
  none: baselineDocScores.none,
  stale: baselineDocScores.stale,
};
function preferenceOf(refreshNet: number, addNet: number): DocPreference {
  if (refreshNet > addNet) return 'refresh';
  if (addNet > refreshNet) return 'add';
  return 'tie';
}
function rulesMatchBaseline(rules: DocFactorRules) {
  return (
    rules.changeAt === baselineFactorRules.changeAt &&
    rules.fresh === baselineFactorRules.fresh &&
    rules.none === baselineFactorRules.none &&
    rules.stale === baselineFactorRules.stale
  );
}
function runDocFactor(rules: DocFactorRules, strategy: 'refresh' | 'add'): DocFactorRun {
  const scores = { fresh: rules.fresh, none: rules.none, stale: rules.stale };
  let state = createDocPrototype(FACTOR_SEED, 'changed', rules.changeAt);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 40) throw new Error(`${rules.changeAt}:${rules.stale}:${strategy}`);
    const action = chooseDocAction(state, strategy);
    const next = applyDocInput(state, action, scores);
    if (next === state) throw new Error(`${rules.changeAt}:${strategy} tick ${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeDoc(state) };
}
function factorPoint(
  axis: DocFactorPoint['axis'],
  parameter: string,
  rules: DocFactorRules,
): DocFactorPoint {
  const refresh = runDocFactor(rules, 'refresh');
  const add = runDocFactor(rules, 'add');
  return {
    axis,
    parameter,
    rules: { ...rules },
    preference: preferenceOf(refresh.result.netValue, add.result.netValue),
    margin: refresh.result.netValue - add.result.netValue,
    sameAsFirstComparison: rulesMatchBaseline(rules),
    refresh,
    add,
  };
}
function reversalsOf(rows: DocFactorPoint[]): DocFactorReversal[] {
  const found: DocFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        refresh: before.refresh.result.netValue,
        add: before.add.result.netValue,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        refresh: after.refresh.result.netValue,
        add: after.add.result.netValue,
      },
    });
  }
  return found;
}
/** 初回と同じ資源で、変更tickと古い資料の得点を一つずつ動かす。固定戦略。 */
export function compareDocFactorReversals() {
  const sweeps = {
    changeAt: CHANGE_TICKS.map((changeAt) =>
      factorPoint('changeAt', String(changeAt), { ...baselineFactorRules, changeAt }),
    ),
    staleScore: STALE_SCORES.map((stale) =>
      factorPoint('staleScore', String(stale), { ...baselineFactorRules, stale }),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      scenario: 'changed' as const,
      horizon: SCENARIOS.changed.horizon,
      decision: { takeNew: 'refresh' as const, keepOld: 'add' as const, score: 'netValue' },
      baseline: { ...baselineFactorRules },
      held: {
        changeAt: '変更tickだけを動かす。古い資料の得点は-4。新しい5、資料なし2、期末8',
        staleScore: '古い資料の得点だけを動かす。変更tickは3。新しい5、資料なし2、期末8',
      },
      quantityCap: 2,
      addTickScores: false,
      refreshTickScores: false,
      specChangeBeforeAction: true,
      omitted: '安定盤面、資料なし、2枚までは初回JSONのまま再出力しない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [...reversalsOf(sweeps.changeAt), ...reversalsOf(sweeps.staleScore)],
  };
}
