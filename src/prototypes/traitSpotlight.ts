/** RI-241: レビュー鬼は待ちが溢れたときだけ速さが活きる。消費の欠点は残す。 */

import { getTrait } from '../data/traits';

export type SpotlightBoard = 'calm' | 'crisis' | 'absent';
export type SpotlightStrategy = 'steady' | 'spotlight';
export type SpotlightMemberId = 'steady' | 'demon';
export type SpotlightInput =
  { type: 'note' } | { type: 'assign'; member: SpotlightMemberId } | { type: 'view' };

export interface SpotlightMember {
  id: SpotlightMemberId;
  trait: 'reviewDemon' | null;
  present: boolean;
  output: number;
  drain: number;
  stamina: number;
}

export interface SpotlightPeriod {
  tick: number;
  member: SpotlightMemberId;
  cleared: number;
  drain: number;
  value: number;
}

export interface SpotlightState {
  version: 1;
  seed: string;
  board: SpotlightBoard;
  tick: number;
  horizon: number;
  queue: number;
  valuePer: number;
  reason: 'review-backlog';
  trait: 'reviewDemon';
  skipped: boolean;
  members: SpotlightMember[];
  value: number;
  spent: number;
  periods: SpotlightPeriod[];
  inputs: SpotlightInput[];
}

const BASE_OUTPUT = 10;
const BASE_DRAIN = 20;
const STAMINA = 80;
const VALUE_PER = 4;
const QUEUE: Record<SpotlightBoard, number> = { calm: 8, crisis: 40, absent: 40 };

function traitRates() {
  const trait = getTrait('reviewDemon');
  if (!trait?.modifiers.reviewMul || !trait.modifiers.staminaDrainMul) {
    throw new Error('reviewDemon');
  }
  return {
    output: Math.round(BASE_OUTPUT * trait.modifiers.reviewMul),
    drain: Math.round(BASE_DRAIN * trait.modifiers.staminaDrainMul),
  };
}

function member(state: SpotlightState, id: SpotlightMemberId): SpotlightMember {
  const found = state.members.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

function available(item: SpotlightMember): boolean {
  return item.present && item.stamina >= item.drain;
}

export function createTraitSpotlight(seed: string, board: SpotlightBoard): SpotlightState {
  const rates = traitRates();
  const present = board !== 'absent';
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 2,
    queue: QUEUE[board],
    valuePer: VALUE_PER,
    reason: 'review-backlog',
    trait: 'reviewDemon',
    skipped: false,
    members: [
      {
        id: 'steady',
        trait: null,
        present: true,
        output: BASE_OUTPUT,
        drain: BASE_DRAIN,
        stamina: STAMINA,
      },
      {
        id: 'demon',
        trait: 'reviewDemon',
        present,
        output: rates.output,
        drain: rates.drain,
        stamina: STAMINA,
      },
    ],
    value: 0,
    spent: 0,
    periods: [],
    inputs: [],
  };
}

/** 不在や余力不足のレビュー鬼は割り当てできない。速度は待ちの範囲までしか積まない。 */
export function applyTraitSpotlight(state: SpotlightState, input: SpotlightInput): SpotlightState {
  if (input.type === 'view') return state;
  if (input.type === 'note') {
    if (state.skipped) return state;
    const next = structuredClone(state);
    next.skipped = true;
    next.inputs.push({ type: 'note' });
    return next;
  }
  if (input.type !== 'assign' || state.tick >= state.horizon) return state;
  if (input.member !== 'steady' && input.member !== 'demon') return state;
  const chosen = member(state, input.member);
  if (!available(chosen)) return state;
  const next = structuredClone(state);
  const target = member(next, input.member);
  const cleared = Math.min(target.output, next.queue);
  target.stamina -= target.drain;
  next.value += cleared * next.valuePer;
  next.spent += target.drain;
  next.periods.push({
    tick: next.tick,
    member: input.member,
    cleared,
    drain: target.drain,
    value: next.value - next.spent,
  });
  next.tick += 1;
  next.inputs.push({ type: 'assign', member: input.member });
  return next;
}

export function viewTraitSpotlight(state: SpotlightState) {
  const demon = member(state, 'demon');
  return {
    tick: state.tick,
    horizon: state.horizon,
    queue: state.queue,
    valuePer: state.valuePer,
    trait: state.trait,
    reason: state.reason,
    helpsWhen: 'queue-exceeds-steady',
    hindersWhen: 'queue-below-output',
    choices: state.members.filter(available).map((item) => item.id),
    demon: {
      present: demon.present,
      active: available(demon),
      output: demon.output,
      drain: demon.drain,
      stamina: demon.stamina,
    },
  };
}

export function summarizeTraitSpotlight(state: SpotlightState) {
  return {
    value: state.value,
    spent: state.spent,
    score: state.value - state.spent,
    path: state.periods.map((period) => period.value),
    assigned: state.periods.map((period) => period.member),
    skipped: state.skipped,
    lost: false,
  };
}

export function chooseSpotlightAction(
  state: SpotlightState,
  strategy: SpotlightStrategy,
): SpotlightInput {
  const demon = member(state, 'demon');
  if (strategy === 'spotlight' && !available(demon) && !state.skipped) return { type: 'note' };
  if (strategy === 'spotlight' && available(demon)) return { type: 'assign', member: 'demon' };
  return { type: 'assign', member: 'steady' };
}

function runSpotlight(seed: string, board: SpotlightBoard, strategy: SpotlightStrategy) {
  const initial = createTraitSpotlight(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseSpotlightAction(state, strategy);
    const next = applyTraitSpotlight(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeTraitSpotlight(state) };
}

export function compareTraitSpotlights(seed = 'RI-241') {
  return (['calm', 'crisis', 'absent'] as const).flatMap((board) =>
    (['steady', 'spotlight'] as const).map((strategy) => ({
      board,
      strategy,
      ...runSpotlight(seed, board, strategy),
    })),
  );
}
