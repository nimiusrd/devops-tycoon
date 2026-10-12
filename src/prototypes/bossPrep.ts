/** RI-242: 大型リリースの直前に、温存か前倒し整備かを一度だけ選ぶ。 */

import { getBoss } from '../data/bosses';

export type BossPrepBoard = 'small' | 'large' | 'absent';
export type BossPrepStrategy = 'conserve' | 'advance';
export type BossPrepChoice = 'conserve' | 'advance' | 'cover';
export type BossPrepInput =
  | { type: 'view' }
  | { type: 'meet' }
  | { type: 'note' }
  | { type: 'choose'; prep: BossPrepChoice }
  | { type: 'resolve' };

export interface BossPrepMember {
  id: 'steady' | 'ace';
  present: boolean;
  output: number;
  drain: number;
  stamina: number;
}

export interface BossPrepPeriod {
  tick: number;
  phase: 'prep' | 'boss';
  member: 'steady' | 'ace';
  cleared: number;
  remaining: number;
  drain: number;
  value: number;
}

export interface BossPrepForecast {
  prep: BossPrepChoice;
  prepMember: 'steady' | 'ace';
  prepClear: number;
  bossMember: 'steady' | 'ace' | null;
  bossClear: number;
  budget: number;
  spent: number;
  value: number;
  score: number;
  once: true;
}

export interface BossPrepState {
  version: 1;
  seed: string;
  board: BossPrepBoard;
  tick: number;
  horizon: number;
  bossId: 'big-release';
  bossName: string;
  prepQueue: number;
  bossQueue: number;
  prepValuePer: number;
  bossValuePer: number;
  opened: boolean;
  skipped: boolean;
  prep: BossPrepChoice | null;
  consumed: boolean;
  budget: number;
  members: BossPrepMember[];
  value: number;
  spent: number;
  periods: BossPrepPeriod[];
  inputs: BossPrepInput[];
}

const PREP_QUEUE = 20;
const PREP_VALUE = 2;
const BOSS_VALUE = 5;
const BOSS_QUEUE: Record<BossPrepBoard, number> = { small: 8, large: 16, absent: 16 };
const PREP_BUDGET: Record<BossPrepChoice, number> = { conserve: 0, advance: 6, cover: 0 };

function bossName(): string {
  const boss = getBoss('big-release');
  if (!boss) throw new Error('big-release');
  return boss.name;
}

function member(state: BossPrepState, id: BossPrepMember['id']): BossPrepMember {
  const found = state.members.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

function aceReady(state: BossPrepState): boolean {
  const ace = member(state, 'ace');
  return ace.present && ace.stamina >= ace.drain;
}

function legal(state: BossPrepState, prep: BossPrepChoice): boolean {
  if (prep === 'cover') return !member(state, 'ace').present;
  return aceReady(state);
}

function workerFor(prep: BossPrepChoice, phase: 'prep' | 'boss'): BossPrepMember['id'] {
  if (prep === 'advance' && phase === 'prep') return 'ace';
  if (prep === 'conserve' && phase === 'boss') return 'ace';
  return 'steady';
}

function scoreOf(state: BossPrepState): number {
  return state.value - state.spent - state.budget;
}

export function createBossPrep(seed: string, board: BossPrepBoard): BossPrepState {
  const present = board !== 'absent';
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 2,
    bossId: 'big-release',
    bossName: bossName(),
    prepQueue: PREP_QUEUE,
    bossQueue: BOSS_QUEUE[board],
    prepValuePer: PREP_VALUE,
    bossValuePer: BOSS_VALUE,
    opened: false,
    skipped: false,
    prep: null,
    consumed: false,
    budget: 0,
    members: [
      { id: 'steady', present: true, output: 8, drain: 12, stamina: 40 },
      { id: 'ace', present, output: 16, drain: 24, stamina: 30 },
    ],
    value: 0,
    spent: 0,
    periods: [],
    inputs: [],
  };
}

/** 会議前の見通し。準備の効果は次のボススプリントで一度だけ消える。 */
export function projectBossPrep(state: BossPrepState, prep: BossPrepChoice): BossPrepForecast {
  const prepWho = member(state, workerFor(prep, 'prep'));
  const bossWho = member(state, workerFor(prep, 'boss'));
  const prepClear = Math.min(prepWho.output, state.prepQueue);
  const bossStamina = bossWho.id === prepWho.id ? bossWho.stamina - prepWho.drain : bossWho.stamina;
  const bossActive = bossWho.present && bossStamina >= bossWho.drain;
  const bossClear = bossActive ? Math.min(bossWho.output, state.bossQueue) : 0;
  const budget = PREP_BUDGET[prep];
  const spent = prepWho.drain + (bossActive ? bossWho.drain : 0);
  const value = prepClear * state.prepValuePer + bossClear * state.bossValuePer;
  return {
    prep,
    prepMember: prepWho.id,
    prepClear,
    bossMember: bossActive ? bossWho.id : null,
    bossClear,
    budget,
    spent,
    value,
    score: value - spent - budget,
    once: true,
  };
}

function pushPeriod(
  state: BossPrepState,
  phase: 'prep' | 'boss',
  id: BossPrepMember['id'],
  cleared: number,
  remaining: number,
  drain: number,
) {
  state.periods.push({
    tick: state.tick,
    phase,
    member: id,
    cleared,
    remaining,
    drain,
    value: scoreOf(state),
  });
  state.tick += 1;
}

export function applyBossPrep(state: BossPrepState, input: BossPrepInput): BossPrepState {
  if (input.type === 'view') return state;
  if (input.type === 'meet') {
    if (state.opened) return state;
    const next = structuredClone(state);
    next.opened = true;
    next.inputs.push({ type: 'meet' });
    return next;
  }
  if (input.type === 'note') {
    if (!state.opened || state.skipped || member(state, 'ace').present) return state;
    const next = structuredClone(state);
    next.skipped = true;
    next.inputs.push({ type: 'note' });
    return next;
  }
  if (input.type === 'choose') {
    if (!state.opened || state.tick !== 0 || state.prep) return state;
    if (input.prep !== 'conserve' && input.prep !== 'advance' && input.prep !== 'cover') {
      return state;
    }
    if (!legal(state, input.prep)) return state;
    const next = structuredClone(state);
    const id = workerFor(input.prep, 'prep');
    const who = member(next, id);
    const cleared = Math.min(who.output, next.prepQueue);
    next.prepQueue -= cleared;
    who.stamina -= who.drain;
    next.value += cleared * next.prepValuePer;
    next.spent += who.drain;
    next.budget += PREP_BUDGET[input.prep];
    next.prep = input.prep;
    pushPeriod(next, 'prep', id, cleared, next.prepQueue, who.drain);
    if (input.prep === 'cover' && !next.skipped) {
      next.skipped = true;
      next.inputs.push({ type: 'note' });
    }
    next.inputs.push({ type: 'choose', prep: input.prep });
    return next;
  }
  if (state.tick !== 1 || !state.prep || state.consumed) return state;
  const next = structuredClone(state);
  const id = workerFor(state.prep, 'boss');
  const who = member(next, id);
  if (!who.present || who.stamina < who.drain) return state;
  const cleared = Math.min(who.output, next.bossQueue);
  next.bossQueue -= cleared;
  who.stamina -= who.drain;
  next.value += cleared * next.bossValuePer;
  next.spent += who.drain;
  next.consumed = true;
  pushPeriod(next, 'boss', id, cleared, next.bossQueue, who.drain);
  next.inputs.push({ type: 'resolve' });
  return next;
}

export function viewBossPrep(state: BossPrepState) {
  const ace = member(state, 'ace');
  const forecasts =
    state.tick === 0 && state.prep === null
      ? (['conserve', 'advance', 'cover'] as const)
          .filter((prep) => legal(state, prep))
          .map((prep) => projectBossPrep(state, prep))
      : [];
  return {
    tick: state.tick,
    opened: state.opened,
    consumed: state.consumed,
    prep: state.prep,
    bossId: state.bossId,
    bossName: state.bossName,
    bossQueue: state.bossQueue,
    prepQueue: state.prepQueue,
    reason: 'before-big-release',
    helpsWhen: 'boss-queue-at-least-16',
    hindersWhen: 'boss-queue-at-most-8',
    choices: forecasts.map((item) => item.prep),
    ace: {
      present: ace.present,
      active: aceReady(state),
      output: ace.output,
      drain: ace.drain,
      stamina: ace.stamina,
    },
    forecasts,
  };
}

export function summarizeBossPrep(state: BossPrepState) {
  return {
    value: state.value,
    spent: state.spent,
    budget: state.budget,
    score: scoreOf(state),
    path: state.periods.map((period) => period.value),
    assigned: state.periods.map((period) => period.member),
    prep: state.prep,
    skipped: state.skipped,
    consumed: state.consumed,
    lost: false,
  };
}

export function chooseBossPrepAction(
  state: BossPrepState,
  strategy: BossPrepStrategy,
): BossPrepInput {
  if (!state.opened) return { type: 'meet' };
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.tick === 0 && state.prep === null) {
    if (!member(state, 'ace').present) {
      if (!state.skipped) return { type: 'note' };
      return { type: 'choose', prep: 'cover' };
    }
    return { type: 'choose', prep: strategy };
  }
  if (state.tick === 1 && !state.consumed) return { type: 'resolve' };
  return { type: 'view' };
}

function runBossPrep(seed: string, board: BossPrepBoard, strategy: BossPrepStrategy) {
  const initial = createBossPrep(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon || !state.consumed) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseBossPrepAction(state, strategy);
    const next = applyBossPrep(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
    if (state.consumed && state.tick >= state.horizon) break;
  }
  return { initial, inputs: state.inputs, result: summarizeBossPrep(state) };
}

export function compareBossPreps(seed = 'RI-242') {
  return (['small', 'large', 'absent'] as const).flatMap((board) =>
    (['conserve', 'advance'] as const).map((strategy) => ({
      board,
      strategy,
      ...runBossPrep(seed, board, strategy),
    })),
  );
}
