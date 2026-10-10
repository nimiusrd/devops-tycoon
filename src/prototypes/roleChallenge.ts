/** RI-202: 挑戦はレビューへ配置した期だけ経験になり、次期の見通しは事前に見える。 */

export type ChallengeBoard = 'pressed' | 'slack';
export type ChallengeStrategy = 'accept' | 'decline';
export type Assignment = 'review' | 'coding';
export interface ChallengeMember {
  id: string;
  review: number;
  assignment: Assignment | null;
}
export type ChallengeInput = { type: 'place'; assignment: string } | { type: 'period' };
export interface PeriodResult {
  period: number;
  review: number;
  target: number;
  met: boolean;
}
export interface ChallengeState {
  version: 1;
  seed: string;
  board: ChallengeBoard;
  period: number;
  horizon: number;
  seats: number;
  targets: number[];
  penalty: number;
  placed: boolean;
  reviewValue: number;
  growth: number;
  growthEvents: number;
  penalties: number;
  history: PeriodResult[];
  members: ChallengeMember[];
  inputs: ChallengeInput[];
}

const OUTLOOK = 5;
const BOARDS: Record<ChallengeBoard, { seats: number; targets: number[]; penalty: number }> = {
  pressed: { seats: 1, targets: [8, 4], penalty: 6 },
  slack: { seats: 2, targets: [6, 12], penalty: 6 },
};

export function createRoleChallengePrototype(seed: string, board: ChallengeBoard): ChallengeState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    period: 0,
    horizon: preset.targets.length,
    seats: preset.seats,
    targets: [...preset.targets],
    penalty: preset.penalty,
    placed: false,
    reviewValue: 0,
    growth: 0,
    growthEvents: 0,
    penalties: 0,
    history: [],
    members: [
      { id: 'sato', review: 8, assignment: 'review' },
      { id: 'mei', review: 2, assignment: null },
    ],
    inputs: [],
  };
}

function member(state: ChallengeState, id: string): ChallengeMember | undefined {
  return state.members.find((item) => item.id === id);
}

export function viewRoleChallenge(state: ChallengeState) {
  const mei = member(state, 'mei');
  const sato = member(state, 'sato');
  return {
    period: state.period,
    horizon: state.horizon,
    board: state.board,
    seats: state.seats,
    targets: [...state.targets],
    penalty: state.penalty,
    wish: {
      id: 'mei',
      role: 'review' as const,
      review: mei?.review ?? null,
      outlook: OUTLOOK,
      assignment: mei?.assignment ?? null,
    },
    senior: { id: 'sato', review: sato?.review ?? null, assignment: sato?.assignment ?? null },
  };
}

export function applyRoleChallengeInput(
  state: ChallengeState,
  input: ChallengeInput,
): ChallengeState {
  if (state.period >= state.horizon) return state;
  if (input.type === 'place') return place(state, input.assignment);
  return advance(state);
}

function place(state: ChallengeState, assignment: string): ChallengeState {
  if (state.placed || state.period !== 0) return state;
  if (assignment !== 'review' && assignment !== 'coding') return state;
  const next = structuredClone(state);
  const mei = member(next, 'mei');
  const sato = member(next, 'sato');
  if (!mei || !sato) return state;
  mei.assignment = assignment;
  sato.assignment = next.seats === 1 && assignment === 'review' ? 'coding' : 'review';
  next.placed = true;
  next.inputs.push({ type: 'place', assignment });
  return next;
}

function advance(state: ChallengeState): ChallengeState {
  if (!state.placed) return state;
  const next = structuredClone(state);
  const produced = next.members.reduce(
    (sum, item) => sum + (item.assignment === 'review' ? item.review : 0),
    0,
  );
  const target = next.targets[next.period] ?? 0;
  const met = produced >= target;
  next.reviewValue += produced;
  if (!met) next.penalties += next.penalty;
  next.history.push({ period: next.period + 1, review: produced, target, met });
  next.period += 1;
  if (next.period === 1) grow(next);
  next.inputs.push({ type: 'period' });
  return next;
}

function grow(state: ChallengeState): void {
  const mei = member(state, 'mei');
  if (!mei || mei.assignment !== 'review' || mei.review >= OUTLOOK) return;
  state.growth += OUTLOOK - mei.review;
  state.growthEvents += 1;
  mei.review = OUTLOOK;
}

export function summarizeRoleChallenge(state: ChallengeState) {
  const mei = member(state, 'mei');
  const sato = member(state, 'sato');
  return {
    assignment: mei?.assignment ?? null,
    seniorAssignment: sato?.assignment ?? null,
    meiReview: mei?.review ?? null,
    reviewValue: state.reviewValue,
    growth: state.growth,
    growthEvents: state.growthEvents,
    penalties: state.penalties,
    score: state.reviewValue - state.penalties,
    history: state.history,
  };
}

export function chooseRoleChallengeAction(
  state: ChallengeState,
  strategy: ChallengeStrategy,
): ChallengeInput {
  if (!state.placed) {
    return { type: 'place', assignment: strategy === 'accept' ? 'review' : 'coding' };
  }
  return { type: 'period' };
}

export function compareRoleChallenges(seed = 'RI-202') {
  return (['pressed', 'slack'] as const).flatMap((board) =>
    (['accept', 'decline'] as const).map((strategy) => {
      const initial = createRoleChallengePrototype(seed, board);
      let state = initial;
      let guard = 0;
      while (state.period < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const next = applyRoleChallengeInput(state, chooseRoleChallengeAction(state, strategy));
        if (next === state) throw new Error(`${board}:${strategy}@${state.period}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeRoleChallenge(state),
      };
    }),
  );
}
