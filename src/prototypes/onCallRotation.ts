/** RI-221: 当番1枠を主力・新人・持ち回りで比較する。RI-170 の待機レーンとは未接続。 */

export type PersonId = 'ace' | 'jun';
export type OnCallBoard = 'quiet' | 'severe' | 'mixed';
export type OnCallStrategy = 'ace' | 'junior' | 'rotate';
export type OnCallInput = { type: 'assign'; id: PersonId } | { type: 'view' };

export interface OnCallPerson {
  id: PersonId;
  ship: number;
  recover: number;
  fatigueRate: number;
  fatigue: number;
  experience: number;
}

export interface OnCallState {
  version: 1;
  seed: string;
  board: OnCallBoard;
  tick: number;
  horizon: number;
  onCall: PersonId | null;
  incidentLeft: number;
  incidentTotal: number;
  penalty: number;
  penaltyApplied: boolean;
  shipped: number;
  people: OnCallPerson[];
  inputs: OnCallInput[];
}

const BOARDS: Record<OnCallBoard, { incident: number; penalty: number }> = {
  quiet: { incident: 0, penalty: 0 },
  severe: { incident: 5, penalty: 12 },
  mixed: { incident: 4, penalty: 8 },
};

function createPeople(): OnCallPerson[] {
  return [
    { id: 'ace', ship: 4, recover: 3, fatigueRate: 2, fatigue: 0, experience: 0 },
    { id: 'jun', ship: 2, recover: 1, fatigueRate: 1, fatigue: 0, experience: 0 },
  ];
}

export function createOnCallRotation(seed: string, board: OnCallBoard): OnCallState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 2,
    onCall: null,
    incidentLeft: preset.incident,
    incidentTotal: preset.incident,
    penalty: preset.penalty,
    penaltyApplied: preset.incident === 0,
    shipped: 0,
    people: createPeople(),
    inputs: [],
  };
}

function person(state: OnCallState, id: PersonId): OnCallPerson | undefined {
  return state.people.find((candidate) => candidate.id === id);
}

/** 1期間の当番は1人。消耗と経験はその人へ一度だけ足す。 */
export function assignOnCall(state: OnCallState, ids: readonly PersonId[]): OnCallState {
  if (state.tick >= state.horizon || ids.length !== 1) return state;
  const id = ids[0];
  if (!person(state, id)) return state;
  const next = structuredClone(state);
  const active = person(next, id);
  if (!active) return state;
  active.fatigue += active.fatigueRate;
  if (active.id === 'jun') active.experience += 1;
  next.incidentLeft = Math.max(0, next.incidentLeft - active.recover);
  next.onCall = id;
  next.shipped += next.people
    .filter((candidate) => candidate.id !== id)
    .reduce((sum, candidate) => sum + candidate.ship, 0);
  next.tick += 1;
  if (next.tick === next.horizon && next.incidentLeft > 0 && !next.penaltyApplied) {
    next.penaltyApplied = true;
  }
  next.inputs.push({ type: 'assign', id });
  return next;
}

export function applyOnCallRotation(state: OnCallState, input: OnCallInput): OnCallState {
  if (input.type === 'view') return state;
  if (input.type !== 'assign') return state;
  return assignOnCall(state, [input.id]);
}

export function viewOnCallRotation(state: OnCallState) {
  const active = state.onCall === null ? null : person(state, state.onCall);
  return {
    tick: state.tick,
    horizon: state.horizon,
    onCall: state.onCall,
    period: state.tick,
    ordinaryCapacity: state.people
      .filter((candidate) => candidate.id !== state.onCall)
      .reduce((sum, candidate) => sum + candidate.ship, 0),
    incidentLeft: state.incidentLeft,
    people: state.people.map((candidate) => ({
      id: candidate.id,
      fatigue: candidate.fatigue,
      experience: candidate.experience,
      onCall: candidate.id === state.onCall,
    })),
    activeFatigueRate: active?.fatigueRate ?? null,
  };
}

export function summarizeOnCallRotation(state: OnCallState) {
  const fatigue = state.people.reduce((sum, candidate) => sum + candidate.fatigue, 0);
  const unresolved = state.incidentLeft > 0 ? state.penalty : 0;
  return {
    shipped: state.shipped,
    fatigue,
    unresolved,
    score: state.shipped - fatigue - unresolved,
    incidentLeft: state.incidentLeft,
    experience: state.people.map((candidate) => ({
      id: candidate.id,
      experience: candidate.experience,
    })),
    lost: false,
  };
}

export function chooseOnCallAction(state: OnCallState, strategy: OnCallStrategy): OnCallInput {
  if (strategy === 'ace') return { type: 'assign', id: 'ace' };
  if (strategy === 'junior') return { type: 'assign', id: 'jun' };
  return { type: 'assign', id: state.tick % 2 === 0 ? 'jun' : 'ace' };
}

export function compareOnCallRotations(seed = 'RI-221') {
  return (['quiet', 'severe', 'mixed'] as const).flatMap((board) =>
    (['ace', 'junior', 'rotate'] as const).map((strategy) => {
      const initial = createOnCallRotation(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseOnCallAction(state, strategy);
        const next = applyOnCallRotation(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeOnCallRotation(state),
      };
    }),
  );
}
