/** RI-226: 施策1種を試験1チームか即全社で入れる。RI-217 の基盤仕事へは未接続。 */

export type PilotTeamId = 'pilot' | 'north' | 'south';
export type PilotBoard = 'good' | 'harm' | 'spike';
export type PilotStrategy = 'now' | 'expand' | 'stop';
export type PilotScope = 'pilot' | 'all' | 'stop';
export type PilotInput = { type: 'scope'; scope: PilotScope } | { type: 'view' };

export interface PilotObservation {
  tick: number;
  pilotShip: number;
  otherShip: number;
  delta: number;
  kind: 'observed';
}

export interface PilotState {
  version: 1;
  seed: string;
  board: PilotBoard;
  tick: number;
  horizon: number;
  base: number;
  effect: number;
  incidentIfAll: number;
  expandFee: number;
  adopted: PilotTeamId[];
  sawPilot: boolean;
  incidentPaid: boolean;
  feePaid: number;
  incident: number;
  shipped: number;
  periodShip: Record<PilotTeamId, number>;
  observations: PilotObservation[];
  inputs: PilotInput[];
}

const TEAMS: readonly PilotTeamId[] = ['pilot', 'north', 'south'];
const BASE = 5;
const EXPAND_FEE = 2;

const BOARDS: Record<PilotBoard, { effect: number; incidentIfAll: number }> = {
  good: { effect: 4, incidentIfAll: 0 },
  harm: { effect: -3, incidentIfAll: 0 },
  spike: { effect: 4, incidentIfAll: 20 },
};

const PLANS: Record<PilotStrategy, readonly PilotScope[]> = {
  now: ['all', 'all', 'all'],
  expand: ['pilot', 'all', 'all'],
  stop: ['pilot', 'stop', 'stop'],
};

export interface PilotRules {
  effect: number;
  incidentIfAll: number;
  expandFee: number;
}

/** rules を渡した欄だけ盤面プリセットを上書きする。未指定の欄は初回の値。 */
export function createPilotRollout(
  seed: string,
  board: PilotBoard,
  rules?: Partial<PilotRules>,
): PilotState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    base: BASE,
    effect: rules?.effect ?? preset.effect,
    incidentIfAll: rules?.incidentIfAll ?? preset.incidentIfAll,
    expandFee: rules?.expandFee ?? EXPAND_FEE,
    adopted: [],
    sawPilot: false,
    incidentPaid: false,
    feePaid: 0,
    incident: 0,
    shipped: 0,
    periodShip: { pilot: 0, north: 0, south: 0 },
    observations: [],
    inputs: [],
  };
}

function isScope(value: string): value is PilotScope {
  return value === 'pilot' || value === 'all' || value === 'stop';
}

function adoptedFor(scope: PilotScope): PilotTeamId[] {
  if (scope === 'all') return [...TEAMS];
  if (scope === 'pilot') return ['pilot'];
  return [];
}

/** 試験中の効果は pilot だけに足す。全社化しても pilot へは一度だけ足し、観測差は因果効果にしない。 */
export function applyPilotScope(state: PilotState, scope: string): PilotState {
  if (state.tick >= state.horizon || !isScope(scope)) return state;
  const next = structuredClone(state);
  const adopted = adoptedFor(scope);
  let incident = 0;
  if (scope === 'all' && !next.sawPilot && !next.incidentPaid && next.incidentIfAll > 0) {
    incident = next.incidentIfAll;
    next.incidentPaid = true;
  }
  if (scope === 'all' && next.sawPilot && next.feePaid === 0) next.feePaid = next.expandFee;
  const periodShip = { pilot: 0, north: 0, south: 0 };
  for (const team of TEAMS) {
    periodShip[team] = next.base + (adopted.includes(team) ? next.effect : 0);
    next.shipped += periodShip[team];
  }
  next.shipped -= incident;
  next.incident += incident;
  next.periodShip = periodShip;
  if (scope === 'pilot') {
    next.sawPilot = true;
    next.observations.push({
      tick: next.tick,
      pilotShip: periodShip.pilot,
      otherShip: periodShip.north + periodShip.south,
      delta: periodShip.pilot - next.base,
      kind: 'observed',
    });
  }
  next.adopted = adopted;
  next.tick += 1;
  next.inputs.push({ type: 'scope', scope });
  return next;
}

export function applyPilotRollout(state: PilotState, input: PilotInput): PilotState {
  if (input.type === 'view') return state;
  if (input.type !== 'scope') return state;
  return applyPilotScope(state, input.scope);
}

export function viewPilotRollout(state: PilotState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    effect: state.effect,
    adopted: [...state.adopted],
    waiting: TEAMS.filter((team) => !state.adopted.includes(team)),
    incidentIfSkipTrial: state.sawPilot || state.incidentPaid ? 0 : state.incidentIfAll,
    feeIfExpand: state.sawPilot && state.feePaid === 0 ? state.expandFee : 0,
    observations: state.observations.map((item) => ({ ...item })),
  };
}

export function summarizePilotRollout(state: PilotState) {
  return {
    shipped: state.shipped,
    fee: state.feePaid,
    incident: state.incident,
    observed: state.observations.reduce((sum, item) => sum + item.delta, 0),
    score: state.shipped - state.feePaid,
    lost: false,
  };
}

export function choosePilotAction(state: PilotState, strategy: PilotStrategy): PilotInput {
  return { type: 'scope', scope: PLANS[strategy][state.tick] ?? 'stop' };
}

function playPilot(
  seed: string,
  board: PilotBoard,
  strategy: PilotStrategy,
  rules?: Partial<PilotRules>,
) {
  const initial = createPilotRollout(seed, board, rules);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = choosePilotAction(state, strategy);
    const next = applyPilotRollout(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizePilotRollout(state) };
}

export function comparePilotRollouts(seed = 'RI-226') {
  return (['good', 'harm', 'spike'] as const).flatMap((board) =>
    (['now', 'expand', 'stop'] as const).map((strategy) => {
      const played = playPilot(seed, board, strategy);
      return {
        board,
        strategy,
        initial: played.initial,
        inputs: played.inputs,
        result: played.result,
      };
    }),
  );
}

export type PilotFactorAxis = 'effect' | 'expandFee' | 'incident';
export type PilotPreference = 'now' | 'expand' | 'tie';
export type PilotFactorHeld =
  | { incidentIfAll: number; expandFee: number }
  | { effect: number; incidentIfAll: number }
  | { effect: number; expandFee: number };

export interface PilotFactorRun {
  inputs: PilotInput[];
  result: ReturnType<typeof summarizePilotRollout>;
}

export interface PilotFactorRow {
  axis: PilotFactorAxis;
  parameter: string;
  board: PilotBoard;
  rules: PilotRules;
  preference: PilotPreference;
  margin: number;
  leaders: PilotStrategy[];
  scores: Record<PilotStrategy, number>;
  runs: Record<PilotStrategy, PilotFactorRun>;
  initial: PilotState;
}

export interface PilotFactorReversal {
  axis: PilotFactorAxis;
  held: PilotFactorHeld;
  before: {
    parameter: string;
    preference: PilotPreference;
    now: number;
    expand: number;
    stop: number;
  };
  after: {
    parameter: string;
    preference: PilotPreference;
    now: number;
    expand: number;
    stop: number;
  };
}

export interface PilotFactorSeries {
  axis: PilotFactorAxis;
  anchor: PilotBoard;
  held: PilotFactorHeld;
  rows: PilotFactorRow[];
  reversals: PilotFactorReversal[];
}

const FACTOR_SEED = 'RI-226';
const FACTOR_AXES = ['effect', 'expandFee', 'incident'] as const;

function baselineRules(board: PilotBoard): PilotRules {
  const preset = BOARDS[board];
  return { effect: preset.effect, incidentIfAll: preset.incidentIfAll, expandFee: EXPAND_FEE };
}

function rulesOnAxis(anchor: PilotBoard, axis: PilotFactorAxis, value: number): PilotRules {
  const rules = baselineRules(anchor);
  if (axis === 'effect') return { ...rules, effect: value };
  if (axis === 'expandFee') return { ...rules, expandFee: value };
  return { ...rules, incidentIfAll: value };
}

function heldFor(anchor: PilotBoard, axis: PilotFactorAxis): PilotFactorHeld {
  const rules = baselineRules(anchor);
  if (axis === 'effect') return { incidentIfAll: rules.incidentIfAll, expandFee: rules.expandFee };
  if (axis === 'expandFee') return { effect: rules.effect, incidentIfAll: rules.incidentIfAll };
  return { effect: rules.effect, expandFee: rules.expandFee };
}

function boardFor(anchor: PilotBoard, rules: PilotRules): PilotBoard {
  const preset = (['good', 'harm', 'spike'] as const).find(
    (board) =>
      BOARDS[board].effect === rules.effect && BOARDS[board].incidentIfAll === rules.incidentIfAll,
  );
  return preset ?? anchor;
}

function preferenceOf(now: number, expand: number): PilotPreference {
  if (expand > now) return 'expand';
  if (now > expand) return 'now';
  return 'tie';
}

function leadersOf(scores: Record<PilotStrategy, number>): PilotStrategy[] {
  const top = Math.max(scores.now, scores.expand, scores.stop);
  return (['now', 'expand', 'stop'] as const).filter((strategy) => scores[strategy] === top);
}

function sameState(left: PilotState, right: PilotState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function factorRow(axis: PilotFactorAxis, anchor: PilotBoard, value: number): PilotFactorRow {
  const rules = rulesOnAxis(anchor, axis, value);
  const board = boardFor(anchor, rules);
  const now = playPilot(FACTOR_SEED, board, 'now', rules);
  const expand = playPilot(FACTOR_SEED, board, 'expand', rules);
  const stop = playPilot(FACTOR_SEED, board, 'stop', rules);
  if (!sameState(now.initial, expand.initial) || !sameState(now.initial, stop.initial)) {
    throw new Error(`${axis}:${value}`);
  }
  const scores = {
    now: now.result.score,
    expand: expand.result.score,
    stop: stop.result.score,
  };
  return {
    axis,
    parameter: String(value),
    board,
    rules,
    preference: preferenceOf(scores.now, scores.expand),
    margin: scores.expand - scores.now,
    leaders: leadersOf(scores),
    scores,
    runs: {
      now: { inputs: now.inputs, result: now.result },
      expand: { inputs: expand.inputs, result: expand.result },
      stop: { inputs: stop.inputs, result: stop.result },
    },
    initial: now.initial,
  };
}

function reversalsOf(rows: PilotFactorRow[], held: PilotFactorHeld): PilotFactorReversal[] {
  const found: PilotFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      held,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        now: before.scores.now,
        expand: before.scores.expand,
        stop: before.scores.stop,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        now: after.scores.now,
        expand: after.scores.expand,
        stop: after.scores.stop,
      },
    });
  }
  return found;
}

function buildSeries(
  axis: PilotFactorAxis,
  anchor: PilotBoard,
  values: readonly number[],
): PilotFactorSeries {
  const held = heldFor(anchor, axis);
  const rows = values.map((value) => factorRow(axis, anchor, value));
  return { axis, anchor, held, rows, reversals: reversalsOf(rows, held) };
}

/** 初回と同じ資源で、効果・展開費用・事故を一つずつ動かす。固定戦略。 */
export function comparePilotFactorReversals() {
  const sample = createPilotRollout(FACTOR_SEED, 'good');
  const sweeps = {
    effect: [
      buildSeries('effect', 'good', [-4, -3, -2, -1, 0, 1, 4]),
      buildSeries('effect', 'spike', [4, 8, 9, 10]),
    ],
    expandFee: [
      buildSeries('expandFee', 'good', [0, 2, 8, 12]),
      buildSeries('expandFee', 'harm', [0, 2, 5, 6, 7]),
      buildSeries('expandFee', 'spike', [0, 2, 11, 12, 13]),
    ],
    incident: [
      buildSeries('incident', 'good', [0, 9, 10, 11, 20]),
      buildSeries('incident', 'harm', [0, 10, 20]),
    ],
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      teams: [...TEAMS],
      base: sample.base,
      horizon: sample.horizon,
      score: 'shipped - fee',
      strategies: {
        now: [...PLANS.now],
        expand: [...PLANS.expand],
        stop: [...PLANS.stop],
      },
      decision: {
        compared: ['expand', 'now'] as const,
        preference: '展開の差引が大きいとき展開、即全社が大きいとき即全社、同じとき同点',
        margin: '展開の差引 - 即全社の差引',
        leaders: '三つの差引が最大の戦略。同点は複数',
      },
      baselines: {
        good: baselineRules('good'),
        harm: baselineRules('harm'),
        spike: baselineRules('spike'),
      },
      held: {
        effect:
          '効果だけを動かす。展開費用2。事故0の列は良い効果と悪い効果の資源、事故20の列は一斉事故の資源',
        expandFee:
          '展開費用だけを動かす。良い効果は効果4・事故0、悪い効果は効果-3・事故0、一斉事故は効果4・事故20',
        incident:
          '事故だけを動かす。効果4・展開費用2の列と、効果-3・展開費用2の列。事故は0未満にしない',
      },
      relation:
        '固定手順では展開の差引 - 即全社の差引 = 事故 - 展開費用 - 2×効果。2×効果は試験1期間に north と south へ効果が乗らない分',
      observation: '試験の観測差は効果。事故は試験を飛ばした即全社だけが払い、観測には出ない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: FACTOR_AXES.flatMap((axis) => sweeps[axis].flatMap((series) => series.reversals)),
  };
}
