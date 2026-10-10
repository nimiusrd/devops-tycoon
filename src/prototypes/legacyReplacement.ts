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
export function createLegacyPrototype(seed: string, horizon: number): LegacyState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    mode: 'legacy',
    tasks: ['migrate-a', 'migrate-b', 'migrate-c'].map((id) => ({ id, done: false })),
    legacyValue: 0,
    dualValue: 0,
    modernValue: 0,
    inputs: [],
  };
}
function doneCount(state: LegacyState) {
  return state.tasks.filter((task) => task.done).length;
}
export function applyLegacyInput(state: LegacyState, input: LegacyInput): LegacyState {
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
    next.modernValue += 8;
    next.tick += 1;
  } else if (next.mode === 'dual') {
    next.dualValue += 2;
    next.tick += 1;
  } else {
    next.legacyValue += 4;
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
