/** RI-224: 基準は3チームから救援1期間を貸し出す。感度比較だけ期間と余力と未解決罰を変える。 */

export type TeamId = 'alpha' | 'bravo' | 'spare';
export type RescueBoard = 'local' | 'wide' | 'deadline';
export type RescueStrategy = 'none' | 'focus' | 'spread';
export type RescuePreference = 'focus' | 'spread' | 'tie';
export type RescueLoans = Record<TeamId, number>;
export type RescueInput =
  | { type: 'dispatch'; loans: RescueLoans }
  | { type: 'resolve' }
  | { type: 'continue' }
  | { type: 'return' }
  | { type: 'view' };

export interface RescueTeamMember {
  id: TeamId;
  capacity: number;
  output: number;
  loaned: number;
}

export interface RescueState {
  version: 1;
  seed: string;
  board: RescueBoard;
  tick: number;
  horizon: number;
  duration: number;
  phase: 'plan' | 'out' | 'back';
  incident: number;
  incidentLeft: number;
  penaltyEach: number;
  penalty: number;
  penaltyApplied: boolean;
  recovered: number;
  resolved: boolean;
  returned: boolean;
  shipped: number;
  teams: RescueTeamMember[];
  inputs: RescueInput[];
}

const TEAM_IDS: readonly TeamId[] = ['alpha', 'bravo', 'spare'];
const BASE_DURATION = 1;
const BASE_CAPACITY = 4;

/** 初回と同じ資源。未解決罰 null は盤面の既定を使う。感度では一つの欄だけを変える。 */
export interface RescueFactorRules {
  duration: number;
  capacity: number;
  penaltyEach: number | null;
}

export const baselineRescueRules: RescueFactorRules = {
  duration: BASE_DURATION,
  capacity: BASE_CAPACITY,
  penaltyEach: null,
};

const BOARDS: Record<RescueBoard, { incident: number; penaltyEach: number; output: RescueLoans }> =
  {
    local: { incident: 4, penaltyEach: 5, output: { alpha: 2, bravo: 2, spare: 2 } },
    wide: { incident: 6, penaltyEach: 6, output: { alpha: 2, bravo: 2, spare: 2 } },
    deadline: { incident: 4, penaltyEach: 3, output: { alpha: 6, bravo: 2, spare: 2 } },
  };

function createTeams(output: RescueLoans, capacity: number): RescueTeamMember[] {
  return TEAM_IDS.map((id) => ({ id, capacity, output: output[id], loaned: 0 }));
}

export function createRescueTeam(
  seed: string,
  board: RescueBoard,
  rules: RescueFactorRules = baselineRescueRules,
): RescueState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: rules.duration + 2,
    duration: rules.duration,
    phase: 'plan',
    incident: preset.incident,
    incidentLeft: preset.incident,
    penaltyEach: rules.penaltyEach ?? preset.penaltyEach,
    penalty: 0,
    penaltyApplied: false,
    recovered: 0,
    resolved: false,
    returned: false,
    shipped: 0,
    teams: createTeams(preset.output, rules.capacity),
    inputs: [],
  };
}

export function availableCapacity(team: RescueTeamMember): number {
  return team.capacity - team.loaned;
}

function loanTotal(teams: readonly RescueTeamMember[]): number {
  return teams.reduce((sum, team) => sum + team.loaned, 0);
}

function isLoans(state: RescueState, value: unknown): value is RescueLoans {
  if (value === null || typeof value !== 'object') return false;
  const loans = value as Record<string, unknown>;
  return TEAM_IDS.every((id) => {
    const amount = loans[id];
    const capacity = state.teams.find((team) => team.id === id)?.capacity ?? 0;
    return (
      typeof amount === 'number' && Number.isInteger(amount) && amount >= 0 && amount <= capacity
    );
  });
}

function loanedPeriods(state: RescueState): number {
  return state.inputs.filter((input) => input.type === 'resolve' || input.type === 'continue')
    .length;
}

function shipAvailable(teams: readonly RescueTeamMember[]): number {
  return teams.reduce((sum, team) => sum + availableCapacity(team) * team.output, 0);
}

export function planRescueLoans(state: RescueState, strategy: RescueStrategy): RescueLoans {
  const loans = { alpha: 0, bravo: 0, spare: 0 };
  if (strategy === 'none') return loans;
  if (strategy === 'spread') {
    const each = Math.ceil(state.incident / state.teams.length);
    for (const team of state.teams) loans[team.id] = Math.min(team.capacity, each);
    return loans;
  }
  let pick = state.teams[0]!;
  for (const team of state.teams) {
    if (team.output <= pick.output) pick = team;
  }
  loans[pick.id] = Math.min(pick.capacity, state.incident);
  return loans;
}

export function dispatchRescue(state: RescueState, loans: unknown): RescueState {
  if (state.phase !== 'plan' || !isLoans(state, loans)) return state;
  const next = structuredClone(state);
  for (const team of next.teams) team.loaned = loans[team.id];
  next.phase = 'out';
  next.tick += 1;
  next.inputs.push({
    type: 'dispatch',
    loans: { alpha: loans.alpha, bravo: loans.bravo, spare: loans.spare },
  });
  return next;
}

/** 貸し出し中の余力は元チームの出荷に使わない。復旧は救援プールだけで一度行う。 */
export function resolveRescue(state: RescueState): RescueState {
  if (state.phase !== 'out' || state.resolved || state.returned) return state;
  const next = structuredClone(state);
  next.recovered = Math.min(next.incidentLeft, loanTotal(next.teams));
  next.incidentLeft -= next.recovered;
  next.shipped += shipAvailable(next.teams);
  if (next.incidentLeft > 0 && !next.penaltyApplied) {
    next.penalty += next.incidentLeft * next.penaltyEach;
    next.penaltyApplied = true;
  }
  next.resolved = true;
  next.tick += 1;
  next.inputs.push({ type: 'resolve' });
  return next;
}

/** 復旧のあとの残りの救援期間は、同じ貸し出しのまま出荷だけを続ける。復旧と罰は足さない。 */
export function continueRescue(state: RescueState): RescueState {
  if (state.phase !== 'out' || !state.resolved || state.returned) return state;
  if (loanedPeriods(state) >= state.duration) return state;
  const next = structuredClone(state);
  next.shipped += shipAvailable(next.teams);
  next.tick += 1;
  next.inputs.push({ type: 'continue' });
  return next;
}

/** 終了と中断のどちらも、貸し出しを一度だけ返す。中断は未復旧のまま罰を確定する。 */
export function returnRescue(state: RescueState): RescueState {
  if (state.phase !== 'out' || state.returned) return state;
  const next = structuredClone(state);
  if (!next.resolved && next.incidentLeft > 0 && !next.penaltyApplied) {
    next.penalty += next.incidentLeft * next.penaltyEach;
    next.penaltyApplied = true;
  }
  for (const team of next.teams) team.loaned = 0;
  next.returned = true;
  next.phase = 'back';
  next.shipped += next.teams.reduce((sum, team) => sum + team.capacity * team.output, 0);
  next.tick += 1;
  next.inputs.push({ type: 'return' });
  return next;
}

export function applyRescueTeam(state: RescueState, input: RescueInput): RescueState {
  if (input.type === 'view') return state;
  if (input.type === 'dispatch') return dispatchRescue(state, input.loans);
  if (input.type === 'resolve') return resolveRescue(state);
  if (input.type === 'continue') return continueRescue(state);
  if (input.type === 'return') return returnRescue(state);
  return state;
}

export function viewRescueTeam(state: RescueState) {
  return {
    tick: state.tick,
    phase: state.phase,
    duration: state.duration,
    incidentLeft: state.incidentLeft,
    teams: state.teams.map((team) => ({
      id: team.id,
      capacity: team.capacity,
      output: team.output,
      loaned: team.loaned,
      available: availableCapacity(team),
    })),
    plans: (['none', 'focus', 'spread'] as const).map((strategy) => {
      const loans = planRescueLoans(state, strategy);
      const recovery = Math.min(
        state.incident,
        TEAM_IDS.reduce((sum, id) => sum + loans[id], 0),
      );
      const sourceShip = state.teams.reduce(
        (sum, team) => sum + (team.capacity - loans[team.id]) * team.output,
        0,
      );
      return { strategy, loans, recovery, sourceShip, duration: state.duration };
    }),
  };
}

export function summarizeRescueTeam(state: RescueState) {
  return {
    shipped: state.shipped,
    recovered: state.recovered,
    incidentLeft: state.incidentLeft,
    penalty: state.penalty,
    returned: state.returned,
    loaned: state.teams.map((team) => ({ id: team.id, loaned: team.loaned })),
    score: state.shipped - state.penalty,
    lost: false,
  };
}

export function chooseRescueAction(state: RescueState, strategy: RescueStrategy): RescueInput {
  if (state.phase === 'plan') return { type: 'dispatch', loans: planRescueLoans(state, strategy) };
  if (loanedPeriods(state) < state.duration) {
    if (!state.resolved) return { type: 'resolve' };
    return { type: 'continue' };
  }
  return { type: 'return' };
}

export function compareRescueTeams(seed = 'RI-224') {
  return (['local', 'wide', 'deadline'] as const).flatMap((board) =>
    (['none', 'focus', 'spread'] as const).map((strategy) => {
      const initial = createRescueTeam(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseRescueAction(state, strategy);
        const next = applyRescueTeam(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return { board, strategy, initial, inputs: state.inputs, result: summarizeRescueTeam(state) };
    }),
  );
}

export interface RescueFactorRun {
  initial: RescueState;
  inputs: RescueInput[];
  result: ReturnType<typeof summarizeRescueTeam>;
}
export interface RescueFactorBoard {
  board: RescueBoard;
  duration: number;
  capacity: number;
  penaltyEach: number;
  incident: number;
  focus: RescueFactorRun;
  spread: RescueFactorRun;
  preference: RescuePreference;
  margin: number;
}
export interface RescueFactorPoint {
  axis: keyof RescueFactorRules;
  parameter: string;
  rules: RescueFactorRules;
  boards: RescueFactorBoard[];
}
export interface RescueFactorReversal {
  axis: keyof RescueFactorRules;
  board: RescueBoard;
  before: { parameter: string; preference: RescuePreference; focus: number; spread: number };
  after: { parameter: string; preference: RescuePreference; focus: number; spread: number };
}

const FACTOR_BOARDS = ['local', 'wide', 'deadline'] as const;

function cloneRules(rules: RescueFactorRules): RescueFactorRules {
  return { ...rules };
}
function withRules(patch: Partial<RescueFactorRules>): RescueFactorRules {
  return { ...baselineRescueRules, ...patch };
}
function preferenceOf(focus: number, spread: number): RescuePreference {
  if (focus > spread) return 'focus';
  if (spread > focus) return 'spread';
  return 'tie';
}
function runRescue(
  board: RescueBoard,
  strategy: RescueStrategy,
  rules: RescueFactorRules,
): RescueFactorRun {
  const initial = createRescueTeam('RI-224', board, rules);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 24) throw new Error(`${board}:${strategy}:${rules.duration}`);
    const next = applyRescueTeam(state, chooseRescueAction(state, strategy));
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeRescueTeam(state) };
}
function factorPoint(
  axis: keyof RescueFactorRules,
  parameter: string,
  rules: RescueFactorRules,
): RescueFactorPoint {
  const boards = FACTOR_BOARDS.map((board) => {
    const focus = runRescue(board, 'focus', rules);
    const spread = runRescue(board, 'spread', rules);
    return {
      board,
      duration: focus.initial.duration,
      capacity: focus.initial.teams[0]?.capacity ?? 0,
      penaltyEach: focus.initial.penaltyEach,
      incident: focus.initial.incident,
      focus,
      spread,
      preference: preferenceOf(focus.result.score, spread.result.score),
      margin: focus.result.score - spread.result.score,
    };
  });
  return { axis, parameter, rules: cloneRules(rules), boards };
}
function reversalsOf(rows: RescueFactorPoint[]): RescueFactorReversal[] {
  const found: RescueFactorReversal[] = [];
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
          focus: earlier.focus.result.score,
          spread: earlier.spread.result.score,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          focus: later.focus.result.score,
          spread: later.spread.result.score,
        },
      });
    }
  }
  return found;
}

/** 初回と同じ資源で、救援期間・余力・未解決罰を一つずつ動かす。固定戦略。 */
export function compareRescueFactorReversals() {
  const sweeps = {
    duration: [1, 2, 3, 4, 5].map((duration) =>
      factorPoint('duration', String(duration), withRules({ duration })),
    ),
    capacity: [1, 2, 3, 4, 5, 6, 7, 8].map((capacity) =>
      factorPoint('capacity', String(capacity), withRules({ capacity })),
    ),
    penaltyEach: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((penaltyEach) =>
      factorPoint('penaltyEach', String(penaltyEach), withRules({ penaltyEach })),
    ),
  };
  return {
    conditions: {
      seed: 'RI-224',
      teams: TEAM_IDS,
      boards: FACTOR_BOARDS.map((board) => ({
        board,
        incident: BOARDS[board].incident,
        penaltyEach: BOARDS[board].penaltyEach,
        output: { ...BOARDS[board].output },
      })),
      decision: {
        focus: '出荷単価が最も低いチームから、障害量か余力の小さい方を出す。同単価は spare',
        spread: '各チームが障害量÷3の切り上げを出し、余力を超えない',
        score: 'shipped - penalty',
        preference: '集中の差引が大きいとき集中、分散が大きいとき分散、同じとき同点',
      },
      model: {
        loanPeriods: '救援期間のあいだ、貸し出した余力は元チームの出荷に使わない',
        recovery: '復旧は最初の1期間だけで、残期間は同じ貸し出しのまま出荷する',
        penalty: '未解決の罰は最初の復旧時に一度だけ',
        afterReturn: '返却後の出荷は1期間、全員が元の余力',
        dispatch: '派遣の入力自体は出荷しない',
      },
      baseline: cloneRules(baselineRescueRules),
      held: {
        duration:
          '救援期間だけを1から5まで動かす。余力は4、未解決罰は盤面のまま。期間は貸し出し中に出荷が落ちる回数。復旧と罰と返却は一度。0は貸し出さないので含めない。',
        capacity:
          '余力だけを1から8まで、3チームへ同じ値で置く。救援期間は1、未解決罰は盤面のまま。障害量と単価は初回のまま。',
        penaltyEach:
          '未解決1あたりの罰だけを0から8まで、3盤面へ同じ整数で置く。救援期間は1、余力は4。障害量と単価は初回のまま。',
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
