/** RI-179: 置換3件が揃うまで新系の改善は出ない。切替後は旧系の価値を足さない。 */
export interface ReplacementTask {
  id: string;
  done: boolean;
}
export type LegacyMode = 'legacy' | 'dual' | 'modern';
export type LegacyStrategy = 'ship' | 'replace' | 'partial';
export type LegacyInput = { type: 'start' | 'abandon' | 'cutover' | 'migrate' | 'ship' };
export interface LegacyState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  mode: LegacyMode;
  tasks: ReplacementTask[];
  legacyValue: number;
  dualValue: number;
  modernValue: number;
  inputs: LegacyInput[];
}
/** 初回比較の資源。新系出荷は旧系出荷×倍率。 */
export interface LegacyRules {
  migrationTicks: number;
  legacyPerTick: number;
  dualPerTick: number;
  modernMultiplier: number;
}
export const baselineLegacyRules: LegacyRules = {
  migrationTicks: 3,
  legacyPerTick: 4,
  dualPerTick: 2,
  modernMultiplier: 2,
};
const TASK_IDS = ['migrate-a', 'migrate-b', 'migrate-c', 'migrate-d', 'migrate-e', 'migrate-f'];
function replacementTasks(count: number): ReplacementTask[] {
  return Array.from({ length: count }, (_, index) => {
    const id = TASK_IDS[index];
    if (!id) throw new Error(`migration ticks ${count}`);
    return { id, done: false };
  });
}
export function createLegacyPrototype(
  seed: string,
  horizon: number,
  rules: LegacyRules = baselineLegacyRules,
): LegacyState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    mode: 'legacy',
    tasks: replacementTasks(rules.migrationTicks),
    legacyValue: 0,
    dualValue: 0,
    modernValue: 0,
    inputs: [],
  };
}
function doneCount(state: LegacyState) {
  return state.tasks.filter((task) => task.done).length;
}
export function applyLegacyInput(
  state: LegacyState,
  input: LegacyInput,
  rules: LegacyRules = baselineLegacyRules,
): LegacyState {
  if (state.tick >= state.horizon) return state;
  const done = doneCount(state);
  if (input.type === 'start' && state.mode !== 'legacy') return state;
  if (input.type === 'abandon' && state.mode !== 'dual') return state;
  if (input.type === 'cutover' && (state.mode !== 'dual' || done < state.tasks.length))
    return state;
  if (input.type === 'migrate' && (state.mode !== 'dual' || done >= state.tasks.length))
    return state;
  const next = structuredClone(state);
  if (input.type === 'start') next.mode = 'dual';
  else if (input.type === 'abandon') next.mode = 'legacy';
  else if (input.type === 'cutover') next.mode = 'modern';
  else if (input.type === 'migrate') {
    next.tasks.find((task) => !task.done)!.done = true;
    next.tick += 1;
  } else if (next.mode === 'modern') {
    next.modernValue += rules.legacyPerTick * rules.modernMultiplier;
    next.tick += 1;
  } else if (next.mode === 'dual') {
    next.dualValue += rules.dualPerTick;
    next.tick += 1;
  } else {
    next.legacyValue += rules.legacyPerTick;
    next.tick += 1;
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeLegacy(state: LegacyState) {
  return {
    mode: state.mode,
    doneTasks: doneCount(state),
    legacyValue: state.legacyValue,
    dualValue: state.dualValue,
    modernValue: state.modernValue,
    netValue: state.legacyValue + state.dualValue + state.modernValue,
  };
}
export function chooseLegacyAction(state: LegacyState, strategy: LegacyStrategy): LegacyInput {
  if (strategy === 'ship') return { type: 'ship' };
  const limit = strategy === 'partial' ? 2 : state.tasks.length;
  const done = doneCount(state);
  if (state.mode === 'legacy' && done < limit) return { type: 'start' };
  if (state.mode === 'dual' && done < limit) return { type: 'migrate' };
  if (strategy === 'replace' && state.mode === 'dual' && done === state.tasks.length)
    return { type: 'cutover' };
  return { type: 'ship' };
}
export function compareLegacyStrategies(seed: string) {
  return ([5, 10] as const).flatMap((horizon) =>
    (['ship', 'replace', 'partial'] as const).map((strategy) => {
      const initial = createLegacyPrototype(seed, horizon);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 40) throw new Error(`${horizon}:${strategy}`);
        const next = applyLegacyInput(state, chooseLegacyAction(state, strategy));
        if (next === state) throw new Error(`${horizon}:${strategy} tick ${state.tick}`);
        state = next;
      }
      return { horizon, strategy, initial, inputs: state.inputs, result: summarizeLegacy(state) };
    }),
  );
}

const FACTOR_SEED = 'RI-179';
const FACTOR_HORIZONS = [5, 10] as const;
export type LegacyPreference = 'replace' | 'keep' | 'tie';
export interface LegacyFactorRun {
  inputs: LegacyInput[];
  result: ReturnType<typeof summarizeLegacy>;
}
export interface LegacyHorizonComparison {
  horizon: number;
  preference: LegacyPreference;
  margin: number;
  keep: LegacyFactorRun;
  replace: LegacyFactorRun;
}
export interface LegacyFactorPoint {
  axis: string;
  parameter: string;
  rules: LegacyRules;
  horizons: LegacyHorizonComparison[];
}
export interface LegacyFactorReversal {
  axis: string;
  horizon: number;
  before: { parameter: string; preference: LegacyPreference; keep: number; replace: number };
  after: { parameter: string; preference: LegacyPreference; keep: number; replace: number };
}
function cloneRules(rules: LegacyRules): LegacyRules {
  return { ...rules };
}
function withRules(patch: Partial<LegacyRules>): LegacyRules {
  return { ...baselineLegacyRules, ...patch };
}
function preferenceOf(keep: number, replace: number): LegacyPreference {
  if (replace > keep) return 'replace';
  if (keep > replace) return 'keep';
  return 'tie';
}
function runLegacy(
  horizon: number,
  strategy: 'ship' | 'replace',
  rules: LegacyRules,
): LegacyFactorRun {
  let state = createLegacyPrototype(FACTOR_SEED, horizon, rules);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 40) throw new Error(`${horizon}:${strategy}`);
    const next = applyLegacyInput(state, chooseLegacyAction(state, strategy), rules);
    if (next === state) throw new Error(`${horizon}:${strategy} tick ${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeLegacy(state) };
}
function point(axis: string, parameter: string, rules: LegacyRules): LegacyFactorPoint {
  const horizons = FACTOR_HORIZONS.map((horizon) => {
    const keep = runLegacy(horizon, 'ship', rules);
    const replace = runLegacy(horizon, 'replace', rules);
    const keepNet = keep.result.netValue;
    const replaceNet = replace.result.netValue;
    return {
      horizon,
      preference: preferenceOf(keepNet, replaceNet),
      margin: replaceNet - keepNet,
      keep,
      replace,
    };
  });
  return { axis, parameter, rules: cloneRules(rules), horizons };
}
function reversalsOf(rows: LegacyFactorPoint[]): LegacyFactorReversal[] {
  const found: LegacyFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const horizon of FACTOR_HORIZONS) {
      const earlier = before.horizons.find((item) => item.horizon === horizon);
      const later = after.horizons.find((item) => item.horizon === horizon);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        horizon,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          keep: earlier.keep.result.netValue,
          replace: earlier.replace.result.netValue,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          keep: later.keep.result.netValue,
          replace: later.replace.result.netValue,
        },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、置換tick・二重運用の負担・切替後の倍率を一つずつ動かす。固定戦略。 */
export function compareLegacyFactorReversals() {
  const sweeps = {
    migrationTicks: [1, 2, 3, 4, 5, 6].map((migrationTicks) =>
      point('migrationTicks', String(migrationTicks), withRules({ migrationTicks })),
    ),
    dualBurden: [0, 2, 4].map((burden) =>
      point(
        'dualBurden',
        String(burden),
        withRules({ dualPerTick: baselineLegacyRules.legacyPerTick - burden }),
      ),
    ),
    modernMultiplier: [1, 1.5, 2, 2.5, 3].map((modernMultiplier) =>
      point('modernMultiplier', String(modernMultiplier), withRules({ modernMultiplier })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizons: [...FACTOR_HORIZONS],
      decision: { keep: 'ship', replace: 'replace', score: 'netValue' },
      baseline: cloneRules(baselineLegacyRules),
      dualBurdenDefinition: '負担 = 旧系出荷 - 二重出荷。移行tickの出荷は0のまま',
      held: {
        migrationTicks: '件数だけを動かす。各1tick、出荷0。旧系4、二重出荷2、倍率2',
        dualBurden: '負担だけを動かす。件数3、倍率2。移行tickの出荷は0',
        modernMultiplier: '新系出荷 = 旧系4 × 倍率。件数3、二重出荷2',
      },
      migrationYield: 0,
      cutoverConsumesTick: false,
      startConsumesTick: false,
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
