/** RI-183: 所持数とは別の運用枠。軽量2つか大型1つかを仕事の内訳で選ぶ。 */
export type PolicyId = 'lint' | 'tests' | 'platform';
export type Workload = 'routine' | 'migration';
export type SlotStrategy = 'lights' | 'platform';
export type SlotInput = { type: 'enable' | 'disable'; id: PolicyId } | { type: 'tick' };
interface PolicyDef {
  id: PolicyId;
  slots: number;
  routine: number;
  migration: number;
  upkeep: number;
}
const POLICIES: readonly PolicyDef[] = [
  { id: 'lint', slots: 1, routine: 1, migration: 0, upkeep: 0 },
  { id: 'tests', slots: 1, routine: 1, migration: 0, upkeep: 0 },
  { id: 'platform', slots: 2, routine: 2, migration: 4, upkeep: 1 },
];
export interface SlotState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  workload: Workload;
  slotCap: number;
  owned: PolicyId[];
  active: PolicyId[];
  focus: number;
  focusSpent: number;
  basePerTick: number;
  earnedValue: number;
  upkeepPaid: number;
  inputs: SlotInput[];
}
function policy(id: PolicyId): PolicyDef {
  const found = POLICIES.find((item) => item.id === id);
  if (!found) throw new Error(`unknown policy ${id}`);
  return found;
}
export function usedSlots(state: SlotState): number {
  return state.active.reduce((sum, id) => sum + policy(id).slots, 0);
}
export function createSlotPrototype(seed: number, workload: Workload, horizon = 6): SlotState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    workload,
    slotCap: 2,
    owned: ['lint', 'tests', 'platform'],
    active: [],
    focus: 3,
    focusSpent: 0,
    basePerTick: 1,
    earnedValue: 0,
    upkeepPaid: 0,
    inputs: [],
  };
}
export function viewSlots(state: SlotState) {
  const bonusPerTick = state.active.reduce((sum, id) => sum + policy(id)[state.workload], 0);
  const upkeepPerTick = state.active.reduce((sum, id) => sum + policy(id).upkeep, 0);
  return {
    tick: state.tick,
    horizon: state.horizon,
    workload: state.workload,
    slotCap: state.slotCap,
    owned: state.owned,
    active: state.active,
    usedSlots: usedSlots(state),
    freeSlots: state.slotCap - usedSlots(state),
    focus: state.focus,
    basePerTick: state.basePerTick,
    bonusPerTick,
    upkeepPerTick,
  };
}
export function applySlotInput(state: SlotState, input: SlotInput): SlotState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'enable') {
    const slots = policy(input.id).slots;
    if (
      state.active.includes(input.id) ||
      state.focus < 1 ||
      usedSlots(state) + slots > state.slotCap
    )
      return state;
  } else if (input.type === 'disable' && (!state.active.includes(input.id) || state.focus < 1)) {
    return state;
  }
  const next = structuredClone(state);
  if (input.type === 'enable') {
    next.focus -= 1;
    next.focusSpent += 1;
    next.active = [...next.active, input.id];
  } else if (input.type === 'disable') {
    next.focus -= 1;
    next.focusSpent += 1;
    next.active = next.active.filter((id) => id !== input.id);
  } else {
    next.tick += 1;
    const bonus = next.active.reduce((sum, id) => sum + policy(id)[next.workload], 0);
    const upkeep = next.active.reduce((sum, id) => sum + policy(id).upkeep, 0);
    next.earnedValue += next.basePerTick + bonus;
    next.upkeepPaid += upkeep;
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeSlots(state: SlotState) {
  return {
    active: state.active,
    usedSlots: usedSlots(state),
    ownedCount: state.owned.length,
    earnedValue: state.earnedValue,
    upkeepPaid: state.upkeepPaid,
    focusSpent: state.focusSpent,
    netValue: state.earnedValue - state.upkeepPaid - state.focusSpent,
  };
}
export function compareSlotStrategies() {
  const plans: { workload: Workload; strategy: SlotStrategy }[] = [
    { workload: 'routine', strategy: 'lights' },
    { workload: 'routine', strategy: 'platform' },
    { workload: 'migration', strategy: 'lights' },
    { workload: 'migration', strategy: 'platform' },
  ];
  return plans.map(({ workload, strategy }) => {
    const initial = createSlotPrototype(1, workload);
    let state = initial;
    const enables: PolicyId[] = strategy === 'lights' ? ['lint', 'tests'] : ['platform'];
    for (const id of enables) state = applySlotInput(state, { type: 'enable', id });
    while (state.tick < state.horizon) state = applySlotInput(state, { type: 'tick' });
    return {
      workload,
      seed: 1,
      strategy,
      initial,
      inputs: state.inputs,
      result: summarizeSlots(state),
    };
  });
}
