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

const BASELINE_OUTLOOK = 5;
/** 省略した席と罰は盤面の基準。見通しは状態へ入れず、再生時に渡す。 */
export interface ChallengeFactorRules {
  outlook: number;
  seats: number | null;
  penalty: number | null;
}
export interface ChallengeOutlook {
  outlook: number;
}
export const baselineChallengeFactorRules: ChallengeFactorRules = {
  outlook: BASELINE_OUTLOOK,
  seats: null,
  penalty: null,
};
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

export function viewRoleChallenge(
  state: ChallengeState,
  rules: ChallengeOutlook = baselineChallengeFactorRules,
) {
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
      outlook: rules.outlook,
      assignment: mei?.assignment ?? null,
    },
    senior: { id: 'sato', review: sato?.review ?? null, assignment: sato?.assignment ?? null },
  };
}

export function applyRoleChallengeInput(
  state: ChallengeState,
  input: ChallengeInput,
  rules: ChallengeOutlook = baselineChallengeFactorRules,
): ChallengeState {
  if (state.period >= state.horizon) return state;
  if (input.type === 'place') return place(state, input.assignment);
  return advance(state, rules.outlook);
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

function advance(state: ChallengeState, outlook: number): ChallengeState {
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
  if (next.period === 1) grow(next, outlook);
  next.inputs.push({ type: 'period' });
  return next;
}

function grow(state: ChallengeState, outlook: number): void {
  const mei = member(state, 'mei');
  if (!mei || mei.assignment !== 'review' || mei.review >= outlook) return;
  state.growth += outlook - mei.review;
  state.growthEvents += 1;
  mei.review = outlook;
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

const FACTOR_SEED = 'RI-202';
const FACTOR_BOARDS = ['pressed', 'slack'] as const;
/** 席1・罰6では見通し4以上の受諾差引が見通し−4。見送り16と並ぶ20の前後を境目にする。 */
const OUTLOOKS = [2, 4, 5, 19, 20, 21] as const;
const SEAT_COUNTS = [1, 2, 3, 4] as const;
const PENALTIES = [0, 6, 12] as const;
export type ChallengePreference = 'accept' | 'decline' | 'tie';
export interface ChallengeFactorRun {
  inputs: ChallengeInput[];
  result: ReturnType<typeof summarizeRoleChallenge>;
}
export interface ChallengeFactorBoard {
  board: ChallengeBoard;
  outlook: number;
  seats: number;
  targets: number[];
  penalty: number;
  preference: ChallengePreference;
  margin: number;
  initial: ChallengeState;
  accept: ChallengeFactorRun;
  decline: ChallengeFactorRun;
}
export interface ChallengeFactorPoint {
  axis: string;
  parameter: string;
  rules: ChallengeFactorRules;
  boards: ChallengeFactorBoard[];
}
export interface ChallengeFactorReversal {
  axis: string;
  board: ChallengeBoard;
  before: {
    parameter: string;
    preference: ChallengePreference;
    accept: number;
    decline: number;
  };
  after: {
    parameter: string;
    preference: ChallengePreference;
    accept: number;
    decline: number;
  };
}
function cloneRules(rules: ChallengeFactorRules): ChallengeFactorRules {
  return { ...rules };
}
function withRules(patch: Partial<ChallengeFactorRules>): ChallengeFactorRules {
  return { ...baselineChallengeFactorRules, ...patch };
}
function preferenceOf(accept: number, decline: number): ChallengePreference {
  if (accept > decline) return 'accept';
  if (decline > accept) return 'decline';
  return 'tie';
}
function opening(board: ChallengeBoard, rules: ChallengeFactorRules): ChallengeState {
  const created = createRoleChallengePrototype(FACTOR_SEED, board);
  if (rules.seats === null && rules.penalty === null) return created;
  const preset = BOARDS[board];
  return {
    ...created,
    seats: rules.seats ?? preset.seats,
    penalty: rules.penalty ?? preset.penalty,
  };
}
function play(
  initial: ChallengeState,
  strategy: ChallengeStrategy,
  outlook: number,
): ChallengeFactorRun {
  let state = structuredClone(initial);
  let guard = 0;
  while (state.period < state.horizon) {
    if (++guard > 10) throw new Error(`${initial.board}:${strategy}`);
    const next = applyRoleChallengeInput(state, chooseRoleChallengeAction(state, strategy), {
      outlook,
    });
    if (next === state) throw new Error(`${initial.board}:${strategy}@${state.period}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeRoleChallenge(state) };
}
function factorPoint(
  axis: string,
  parameter: string,
  rules: ChallengeFactorRules,
): ChallengeFactorPoint {
  const boards = FACTOR_BOARDS.map((board) => {
    const initial = opening(board, rules);
    const accept = play(initial, 'accept', rules.outlook);
    const decline = play(initial, 'decline', rules.outlook);
    const acceptScore = accept.result.score;
    const declineScore = decline.result.score;
    return {
      board,
      outlook: rules.outlook,
      seats: initial.seats,
      targets: [...initial.targets],
      penalty: initial.penalty,
      preference: preferenceOf(acceptScore, declineScore),
      margin: acceptScore - declineScore,
      initial,
      accept,
      decline,
    };
  });
  return { axis, parameter, rules: cloneRules(rules), boards };
}
function reversalsOf(rows: ChallengeFactorPoint[]): ChallengeFactorReversal[] {
  const found: ChallengeFactorReversal[] = [];
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
          accept: earlier.accept.result.score,
          decline: earlier.decline.result.score,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          accept: later.accept.result.score,
          decline: later.decline.result.score,
        },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、見通し・席数・罰を一つずつ動かす。固定戦略。 */
export function compareRoleChallengeFactorReversals() {
  const sweeps = {
    outlook: OUTLOOKS.map((outlook) =>
      factorPoint('outlook', String(outlook), withRules({ outlook })),
    ),
    seats: SEAT_COUNTS.map((seats) => factorPoint('seats', String(seats), withRules({ seats }))),
    penalty: PENALTIES.map((penalty) =>
      factorPoint('penalty', String(penalty), withRules({ penalty })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      boards: [...FACTOR_BOARDS],
      horizon: 2,
      satoReview: 8,
      meiReview: 2,
      targets: { pressed: [...BOARDS.pressed.targets], slack: [...BOARDS.slack.targets] },
      baselineSeats: { pressed: BOARDS.pressed.seats, slack: BOARDS.slack.seats },
      baselinePenalty: { pressed: BOARDS.pressed.penalty, slack: BOARDS.slack.penalty },
      decision: {
        accept: 'meiをレビューへ置く',
        decline: 'meiをコーディングへ置く',
        score: 'reviewValue - penalties',
        preference: '受諾の差引が大きいとき受諾、見送りが大きいとき見送り、同じとき同点',
      },
      baseline: cloneRules(baselineChallengeFactorRules),
      held: {
        outlook:
          '次期のレビュー見通しだけを動かす。席・罰・目標は盤面の基準。現在はmeiが2、satoが8。幅は見通しと2との差',
        seats:
          '席数だけを動かす。見通しは5、罰は6、目標は盤面の基準。席が1のときだけ受諾でsatoがコーディングへ下がる',
        penalty: '未達1期の罰だけを動かす。見通しは5、席と目標は盤面の基準',
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
