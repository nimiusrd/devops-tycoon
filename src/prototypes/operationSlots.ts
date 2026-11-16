/** RI-183: 所持数とは別の運用枠。軽量2つか大型1つかを仕事の内訳で選ぶ。費用比較も通常ランへは出さない。 */
export type PolicyId = 'lint' | 'tests' | 'platform';
export type Workload = 'routine' | 'migration';
export type SlotStrategy = 'lights' | 'platform';
export type MultiSprintStrategy = 'keep-lights' | 'keep-platform' | 'switch-to-platform';
export type SlotInput =
  | { type: 'enable' | 'disable'; id: PolicyId }
  | { type: 'tick' }
  | { type: 'workload'; workload: Workload };
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
  /** tick が 1 以上の有効化・無効化の費用。未指定なら 1。tick 0 は常に 1。 */
  switchCost?: number;
  /** 大型施策の 1tick 維持。未指定なら定義値。 */
  platformUpkeep?: number;
}
function policy(id: PolicyId): PolicyDef {
  const found = POLICIES.find((item) => item.id === id);
  if (!found) throw new Error(`unknown policy ${id}`);
  return found;
}
function toggleCost(state: SlotState): number {
  if (state.tick === 0) return 1;
  return state.switchCost ?? 1;
}
function upkeepOf(state: SlotState, id: PolicyId): number {
  if (id === 'platform' && state.platformUpkeep !== undefined) return state.platformUpkeep;
  return policy(id).upkeep;
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
  const upkeepPerTick = state.active.reduce((sum, id) => sum + upkeepOf(state, id), 0);
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
  const cost = toggleCost(state);
  if (input.type === 'enable') {
    const slots = policy(input.id).slots;
    if (
      state.active.includes(input.id) ||
      state.focus < cost ||
      usedSlots(state) + slots > state.slotCap
    )
      return state;
  } else if (input.type === 'disable' && (!state.active.includes(input.id) || state.focus < cost)) {
    return state;
  }
  const next = structuredClone(state);
  if (input.type === 'enable') {
    next.focus -= cost;
    next.focusSpent += cost;
    next.active = [...next.active, input.id];
  } else if (input.type === 'disable') {
    next.focus -= cost;
    next.focusSpent += cost;
    next.active = next.active.filter((id) => id !== input.id);
  } else if (input.type === 'workload') {
    next.workload = input.workload;
  } else if (input.type === 'tick') {
    next.tick += 1;
    const bonus = next.active.reduce((sum, id) => sum + policy(id)[next.workload], 0);
    const upkeep = next.active.reduce((sum, id) => sum + upkeepOf(next, id), 0);
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

const TICKS_PER_SPRINT = 6;
const MULTI_SPRINTS = ['routine', 'migration'] as const;
const SWEEP_FOCUS = 30;
const UPKEEP_VALUES = [0, 1, 2, 3, 4] as const;
const SWITCH_COSTS = [1, 2, 3, 4] as const;
const MULTI_STRATEGIES = ['keep-lights', 'keep-platform', 'switch-to-platform'] as const;

export function describeOperationSlotCounts(counts: {
  ownedCount: number;
  slotCap: number;
  freeSlots: number;
}): string {
  return `所持${counts.ownedCount}枚。同時に運用できる枠は${counts.slotCap}。空き枠は${counts.freeSlots}。`;
}

export function createMultiSprintState(platformUpkeep: number, switchCost: number): SlotState {
  return {
    ...createSlotPrototype(1, 'routine', TICKS_PER_SPRINT * MULTI_SPRINTS.length),
    focus: SWEEP_FOCUS,
    platformUpkeep,
    switchCost,
  };
}

function sprintTicks(): SlotInput[] {
  return Array.from({ length: TICKS_PER_SPRINT }, () => ({ type: 'tick' }));
}

function multiSprintInputs(): Record<MultiSprintStrategy, SlotInput[]> {
  const first = sprintTicks();
  const bridge: SlotInput[] = [{ type: 'workload', workload: 'migration' }];
  const second = sprintTicks();
  return {
    'keep-lights': [
      { type: 'enable', id: 'lint' },
      { type: 'enable', id: 'tests' },
      ...first,
      ...bridge,
      ...second,
    ],
    'keep-platform': [{ type: 'enable', id: 'platform' }, ...first, ...bridge, ...second],
    'switch-to-platform': [
      { type: 'enable', id: 'lint' },
      { type: 'enable', id: 'tests' },
      ...first,
      ...bridge,
      { type: 'disable', id: 'lint' },
      { type: 'disable', id: 'tests' },
      { type: 'enable', id: 'platform' },
      ...second,
    ],
  };
}

export interface CostPoint {
  platformUpkeep: number;
  switchCost: number;
  results: Record<MultiSprintStrategy, ReturnType<typeof summarizeSlots>>;
  lightsVersusPlatform: 'lights' | 'platform' | 'tie';
  leaders: MultiSprintStrategy[];
}

export interface CostReversal {
  axis: 'platformUpkeep' | 'switchCost';
  question: 'lights-versus-platform' | 'leaders';
  before: {
    platformUpkeep: number;
    switchCost: number;
    lightsVersusPlatform: CostPoint['lightsVersusPlatform'];
    leaders: MultiSprintStrategy[];
    nets: Record<MultiSprintStrategy, number>;
  };
  after: CostReversal['before'];
}

function play(state: SlotState, inputs: readonly SlotInput[]): SlotState {
  return inputs.reduce((current, input) => applySlotInput(current, input), state);
}

function runStrategy(
  platformUpkeep: number,
  switchCost: number,
  strategy: MultiSprintStrategy,
  inputs: readonly SlotInput[],
) {
  const state = play(createMultiSprintState(platformUpkeep, switchCost), inputs);
  if (state.inputs.length !== inputs.length) {
    throw new Error(`plan rejected for ${strategy} upkeep=${platformUpkeep} switch=${switchCost}`);
  }
  return summarizeSlots(state);
}

function costPoint(
  platformUpkeep: number,
  switchCost: number,
  inputs: Record<MultiSprintStrategy, SlotInput[]>,
): CostPoint {
  const results = {
    'keep-lights': runStrategy(platformUpkeep, switchCost, 'keep-lights', inputs['keep-lights']),
    'keep-platform': runStrategy(
      platformUpkeep,
      switchCost,
      'keep-platform',
      inputs['keep-platform'],
    ),
    'switch-to-platform': runStrategy(
      platformUpkeep,
      switchCost,
      'switch-to-platform',
      inputs['switch-to-platform'],
    ),
  };
  const lights = results['keep-lights'].netValue;
  const platform = results['keep-platform'].netValue;
  const lightsVersusPlatform =
    lights === platform ? 'tie' : lights > platform ? 'lights' : 'platform';
  const best = Math.max(...MULTI_STRATEGIES.map((id) => results[id].netValue));
  return {
    platformUpkeep,
    switchCost,
    results,
    lightsVersusPlatform,
    leaders: MULTI_STRATEGIES.filter((id) => results[id].netValue === best),
  };
}

function brief(row: CostPoint): CostReversal['before'] {
  return {
    platformUpkeep: row.platformUpkeep,
    switchCost: row.switchCost,
    lightsVersusPlatform: row.lightsVersusPlatform,
    leaders: row.leaders,
    nets: {
      'keep-lights': row.results['keep-lights'].netValue,
      'keep-platform': row.results['keep-platform'].netValue,
      'switch-to-platform': row.results['switch-to-platform'].netValue,
    },
  };
}

function reversals(rows: CostPoint[], axis: CostReversal['axis']): CostReversal[] {
  const found: CostReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    if (before.lightsVersusPlatform !== after.lightsVersusPlatform) {
      found.push({
        axis,
        question: 'lights-versus-platform',
        before: brief(before),
        after: brief(after),
      });
    }
    if (before.leaders.join('|') !== after.leaders.join('|')) {
      found.push({ axis, question: 'leaders', before: brief(before), after: brief(after) });
    }
  }
  return found;
}

/** 定型→移行の2スプリント。維持費と切替費用は片方だけ動かす。固定戦略の計算。 */
export function compareMultiSprintCosts() {
  const inputs = multiSprintInputs();
  const upkeepSweep = UPKEEP_VALUES.map((platformUpkeep) => costPoint(platformUpkeep, 1, inputs));
  const switchCostSweep = SWITCH_COSTS.map((switchCost) => costPoint(1, switchCost, inputs));
  return {
    conditions: {
      seed: 1,
      ticksPerSprint: TICKS_PER_SPRINT,
      sprints: [...MULTI_SPRINTS],
      focus: SWEEP_FOCUS,
      openingToggleCost: 1,
      switchCostAppliesWhenTickAtLeast: 1,
      heldWhenSweepingUpkeep: { switchCost: 1 },
      heldWhenSweepingSwitchCost: { platformUpkeep: 1 },
      upkeepValues: [...UPKEEP_VALUES],
      switchCosts: [...SWITCH_COSTS],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
    },
    inputs,
    upkeepSweep,
    switchCostSweep,
    reversals: [
      ...reversals(upkeepSweep, 'platformUpkeep'),
      ...reversals(switchCostSweep, 'switchCost'),
    ],
  };
}
