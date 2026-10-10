/** RI-203: megaPrMaker は分割を2回経験したときだけ消え、後継を一度だけ得る。 */

export type PrototypeTrait = 'megaPrMaker' | 'prSplitter';
export type TraitBoard = 'rush' | 'congested';
export type TraitStrategy = 'ship' | 'train';
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

export const SPLIT_EXPERIENCE = 2;
const EFFECTS: Record<PrototypeTrait, TraitEffect> = {
  megaPrMaker: { trait: 'megaPrMaker', value: 6, load: 4 },
  prSplitter: { trait: 'prSplitter', value: 4, load: 1 },
};
const BOARDS: Record<TraitBoard, { horizon: number; loadWeight: number }> = {
  rush: { horizon: 3, loadWeight: 1 },
  congested: { horizon: 6, loadWeight: 2 },
};

export function traitEffect(traits: readonly PrototypeTrait[]): TraitEffect {
  if (traits.includes('prSplitter')) return { ...EFFECTS.prSplitter };
  if (traits.includes('megaPrMaker')) return { ...EFFECTS.megaPrMaker };
  return { trait: null, value: 3, load: 2 };
}

export function createTraitExperiencePrototype(
  seed: string,
  board: TraitBoard,
  traits: readonly PrototypeTrait[] = ['megaPrMaker'],
): TraitState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: preset.horizon,
    loadWeight: preset.loadWeight,
    value: 0,
    load: 0,
    transitions: 0,
    person: { id: 'ren', traits: [...traits], experience: 0 },
    inputs: [],
  };
}

export function viewTraitExperience(state: TraitState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    loadWeight: state.loadWeight,
    requiredSplits: SPLIT_EXPERIENCE,
    personId: state.person.id,
    traits: [...state.person.traits],
    experience: state.person.experience,
    effect: traitEffect(state.person.traits),
    effects: structuredClone(EFFECTS),
  };
}

export function applyTraitInput(state: TraitState, input: TraitInput): TraitState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'split') return split(state);
  if (input.type !== 'ship') return state;
  const next = structuredClone(state);
  const effect = traitEffect(next.person.traits);
  next.value += effect.value;
  next.load += effect.load;
  next.tick += 1;
  next.inputs.push({ type: 'ship' });
  return next;
}

function split(state: TraitState): TraitState {
  const next = structuredClone(state);
  next.person.experience += 1;
  grant(next);
  next.tick += 1;
  next.inputs.push({ type: 'split' });
  return next;
}

function grant(state: TraitState): void {
  const person = state.person;
  if (person.experience < SPLIT_EXPERIENCE) return;
  const hasMega = person.traits.includes('megaPrMaker');
  const hasSplit = person.traits.includes('prSplitter');
  if (!hasMega) return;
  person.traits = person.traits.filter((trait) => trait !== 'megaPrMaker');
  if (hasSplit || state.transitions > 0) return;
  person.traits.push('prSplitter');
  state.transitions += 1;
}

export function summarizeTraitExperience(state: TraitState) {
  return {
    id: state.person.id,
    traits: [...state.person.traits],
    experience: state.person.experience,
    transitions: state.transitions,
    value: state.value,
    load: state.load,
    score: state.value - state.load * state.loadWeight,
    effect: traitEffect(state.person.traits),
  };
}

export function chooseTraitAction(state: TraitState, strategy: TraitStrategy): TraitInput {
  if (
    strategy === 'train' &&
    state.person.experience < SPLIT_EXPERIENCE &&
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
