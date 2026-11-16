/** RI-203: 基準では megaPrMaker が分割2回で消え、後継を一度だけ得る。感度比較だけ回数と係数を変える。 */

export type PrototypeTrait = 'megaPrMaker' | 'prSplitter';
export type TraitBoard = 'rush' | 'congested';
export type TraitStrategy = 'ship' | 'train';
export type TraitPreference = 'train' | 'ship' | 'tie';
export interface TraitEffect {
  trait: PrototypeTrait | null;
  value: number;
  load: number;
}
export interface TraitPerson {
  id: string;
  traits: PrototypeTrait[];
  experience: number;
}
export type TraitInput = { type: 'ship' } | { type: 'split' };
export interface TraitState {
  version: 1;
  seed: string;
  board: TraitBoard;
  tick: number;
  horizon: number;
  loadWeight: number;
  value: number;
  load: number;
  transitions: number;
  person: TraitPerson;
  inputs: TraitInput[];
}
/** 初回と同じ資源。負荷の重み null は盤面の既定を使う。感度では一つの欄だけを変える。 */
export interface TraitFactorRules {
  requiredSplits: number;
  successorValue: number;
  loadWeight: number | null;
}

export const SPLIT_EXPERIENCE = 2;
const MEGA_VALUE = 6;
const MEGA_LOAD = 4;
const SUCCESSOR_LOAD = 1;
const EFFECTS: Record<PrototypeTrait, TraitEffect> = {
  megaPrMaker: { trait: 'megaPrMaker', value: MEGA_VALUE, load: MEGA_LOAD },
  prSplitter: { trait: 'prSplitter', value: 4, load: SUCCESSOR_LOAD },
};
const BOARDS: Record<TraitBoard, { horizon: number; loadWeight: number }> = {
  rush: { horizon: 3, loadWeight: 1 },
  congested: { horizon: 6, loadWeight: 2 },
};
export const baselineTraitRules: TraitFactorRules = {
  requiredSplits: SPLIT_EXPERIENCE,
  successorValue: EFFECTS.prSplitter.value,
  loadWeight: null,
};
const FACTOR_BOARDS = ['rush', 'congested'] as const;

export function traitEffect(
  traits: readonly PrototypeTrait[],
  rules: TraitFactorRules = baselineTraitRules,
): TraitEffect {
  if (traits.includes('prSplitter')) {
    return { trait: 'prSplitter', value: rules.successorValue, load: SUCCESSOR_LOAD };
  }
  if (traits.includes('megaPrMaker')) return { ...EFFECTS.megaPrMaker };
  return { trait: null, value: 3, load: 2 };
}

export function createTraitExperiencePrototype(
  seed: string,
  board: TraitBoard,
  traits: readonly PrototypeTrait[] = ['megaPrMaker'],
  rules: TraitFactorRules = baselineTraitRules,
): TraitState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: preset.horizon,
    loadWeight: rules.loadWeight ?? preset.loadWeight,
    value: 0,
    load: 0,
    transitions: 0,
    person: { id: 'ren', traits: [...traits], experience: 0 },
    inputs: [],
  };
}

export function viewTraitExperience(
  state: TraitState,
  rules: TraitFactorRules = baselineTraitRules,
) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    loadWeight: state.loadWeight,
    requiredSplits: rules.requiredSplits,
    personId: state.person.id,
    traits: [...state.person.traits],
    experience: state.person.experience,
    effect: traitEffect(state.person.traits, rules),
    effects: {
      megaPrMaker: { ...EFFECTS.megaPrMaker },
      prSplitter: {
        trait: 'prSplitter' as const,
        value: rules.successorValue,
        load: SUCCESSOR_LOAD,
      },
    },
  };
}

export function applyTraitInput(
  state: TraitState,
  input: TraitInput,
  rules: TraitFactorRules = baselineTraitRules,
): TraitState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'split') return split(state, rules);
  if (input.type !== 'ship') return state;
  const next = structuredClone(state);
  const effect = traitEffect(next.person.traits, rules);
  next.value += effect.value;
  next.load += effect.load;
  next.tick += 1;
  next.inputs.push({ type: 'ship' });
  return next;
}

function split(state: TraitState, rules: TraitFactorRules): TraitState {
  const next = structuredClone(state);
  next.person.experience += 1;
  grant(next, rules.requiredSplits);
  next.tick += 1;
  next.inputs.push({ type: 'split' });
  return next;
}

function grant(state: TraitState, requiredSplits: number): void {
  const person = state.person;
  if (person.experience < requiredSplits) return;
  const hasMega = person.traits.includes('megaPrMaker');
  const hasSplit = person.traits.includes('prSplitter');
  if (!hasMega) return;
  person.traits = person.traits.filter((trait) => trait !== 'megaPrMaker');
  if (hasSplit || state.transitions > 0) return;
  person.traits.push('prSplitter');
  state.transitions += 1;
}

export function summarizeTraitExperience(
  state: TraitState,
  rules: TraitFactorRules = baselineTraitRules,
) {
  return {
    id: state.person.id,
    traits: [...state.person.traits],
    experience: state.person.experience,
    transitions: state.transitions,
    value: state.value,
    load: state.load,
    score: state.value - state.load * state.loadWeight,
    effect: traitEffect(state.person.traits, rules),
  };
}

export function chooseTraitAction(
  state: TraitState,
  strategy: TraitStrategy,
  rules: TraitFactorRules = baselineTraitRules,
): TraitInput {
  if (
    strategy === 'train' &&
    state.person.experience < rules.requiredSplits &&
    state.person.traits.includes('megaPrMaker') &&
    !state.person.traits.includes('prSplitter')
  ) {
    return { type: 'split' };
  }
  return { type: 'ship' };
}

export function compareTraitExperience(seed = 'RI-203') {
  return (['rush', 'congested'] as const).flatMap((board) =>
    (['ship', 'train'] as const).map((strategy) => {
      const initial = createTraitExperiencePrototype(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 20) throw new Error(`${board}:${strategy}`);
        const next = applyTraitInput(state, chooseTraitAction(state, strategy));
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeTraitExperience(state),
      };
    }),
  );
}

export interface TraitFactorRun {
  initial: TraitState;
  inputs: TraitInput[];
  result: ReturnType<typeof summarizeTraitExperience>;
}
export interface TraitFactorBoard {
  board: TraitBoard;
  horizon: number;
  loadWeight: number;
  train: TraitFactorRun;
  ship: TraitFactorRun;
  preference: TraitPreference;
  margin: number;
}
export interface TraitFactorPoint {
  axis: keyof TraitFactorRules;
  parameter: string;
  rules: TraitFactorRules;
  boards: TraitFactorBoard[];
}
export interface TraitFactorReversal {
  axis: keyof TraitFactorRules;
  board: TraitBoard;
  before: { parameter: string; preference: TraitPreference; train: number; ship: number };
  after: { parameter: string; preference: TraitPreference; train: number; ship: number };
}

function cloneRules(rules: TraitFactorRules): TraitFactorRules {
  return { ...rules };
}
function withRules(patch: Partial<TraitFactorRules>): TraitFactorRules {
  return { ...baselineTraitRules, ...patch };
}
function preferenceOf(train: number, ship: number): TraitPreference {
  if (train > ship) return 'train';
  if (ship > train) return 'ship';
  return 'tie';
}
function runTrait(
  board: TraitBoard,
  strategy: TraitStrategy,
  rules: TraitFactorRules,
): TraitFactorRun {
  const initial = createTraitExperiencePrototype('RI-203', board, ['megaPrMaker'], rules);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 20) throw new Error(`${board}:${strategy}:${rules.requiredSplits}`);
    const next = applyTraitInput(state, chooseTraitAction(state, strategy, rules), rules);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeTraitExperience(state, rules) };
}
function factorPoint(
  axis: keyof TraitFactorRules,
  parameter: string,
  rules: TraitFactorRules,
): TraitFactorPoint {
  const boards = FACTOR_BOARDS.map((board) => {
    const train = runTrait(board, 'train', rules);
    const ship = runTrait(board, 'ship', rules);
    return {
      board,
      horizon: train.initial.horizon,
      loadWeight: train.initial.loadWeight,
      train,
      ship,
      preference: preferenceOf(train.result.score, ship.result.score),
      margin: train.result.score - ship.result.score,
    };
  });
  return { axis, parameter, rules: cloneRules(rules), boards };
}
function reversalsOf(rows: TraitFactorPoint[]): TraitFactorReversal[] {
  const found: TraitFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      const earlier = before.boards.find((item) => item.board === board);
      const later = after.boards.find((item) => item.board === board);
      if (!earlier || !later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        board,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          train: earlier.train.result.score,
          ship: earlier.ship.result.score,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          train: later.train.result.score,
          ship: later.ship.result.score,
        },
      });
    }
  }
  return found;
}

/** 初回と同じ資源で、必要回数・後継の価値・負荷の重みを一つずつ動かす。固定戦略。 */
export function compareTraitFactorReversals() {
  const sweeps = {
    requiredSplits: [1, 2, 3, 4, 5, 6, 7].map((requiredSplits) =>
      factorPoint('requiredSplits', String(requiredSplits), withRules({ requiredSplits })),
    ),
    successorValue: [-2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8].map((successorValue) =>
      factorPoint('successorValue', String(successorValue), withRules({ successorValue })),
    ),
    loadWeight: [0, 1, 2, 3, 4].map((loadWeight) =>
      factorPoint('loadWeight', String(loadWeight), withRules({ loadWeight })),
    ),
  };
  return {
    conditions: {
      seed: 'RI-203',
      personId: 'ren',
      startingTrait: 'megaPrMaker',
      megaValue: MEGA_VALUE,
      megaLoad: MEGA_LOAD,
      successorLoad: SUCCESSOR_LOAD,
      boards: FACTOR_BOARDS.map((board) => ({
        board,
        horizon: BOARDS[board].horizon,
        loadWeight: BOARDS[board].loadWeight,
      })),
      decision: {
        train: '必要回数まで分割してから出荷',
        ship: '毎tick出荷',
        score: 'value - load * loadWeight',
        preference: '経験側の差引が大きいとき経験、出荷継続が大きいとき出荷、同じとき同点',
      },
      baseline: cloneRules(baselineTraitRules),
      held: {
        requiredSplits:
          '必要回数だけを1から7まで動かす。後継の価値は4、後継の負荷は1、巨大PRは価値6・負荷4。負荷の重みは急ぐ盤面1、混雑盤面2。0は経験方針が分割しないので含めない。',
        successorValue:
          '後継の価値だけを-2から8まで動かす。必要回数は2、後継の負荷は1、巨大PRは価値6・負荷4。負荷の重みは盤面のまま。',
        loadWeight:
          '負荷の重みだけを0から4まで、両盤面へ同じ値で置く。期末は急ぐ3、混雑6。必要回数は2、後継の価値は4、後継の負荷は1。',
      },
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
