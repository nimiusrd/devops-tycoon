/** RI-227: 2チームの手順を揃えるか、現場の手順を残すか。既存の standardize レバーへは未接続。 */

export type StandardTeamId = 'alpha' | 'beta';
export type StandardWork = 'batch' | 'custom';
export type StandardProcedureName = 'kit' | 'local';
export type StandardBoard = 'same' | 'different';
export type StandardStrategy = 'standardize' | 'experiment' | 'hold';
export type StandardAction = 'migrate' | 'support' | 'hold';
export type StandardInput = { type: 'act'; action: StandardAction } | { type: 'view' };

export interface StandardTeam {
  id: StandardTeamId;
  procedure: StandardProcedureName;
  work: StandardWork;
}

export interface StandardState {
  version: 1;
  seed: string;
  board: StandardBoard;
  tick: number;
  horizon: number;
  migrationFee: number;
  blocker: number;
  supportSame: number;
  supportDiff: number;
  fitShip: number;
  missShip: number;
  teams: StandardTeam[];
  shipped: number;
  alphaShip: number;
  betaShip: number;
  supportPaid: number;
  migrationPaid: number;
  penalty: number;
  inputs: StandardInput[];
}

const FIT_SHIP = 6;
const MISS_SHIP = 3;
const MIGRATION_FEE = 5;
const BLOCKER = 5;
const SUPPORT_SAME = 1;
const SUPPORT_DIFF = 4;

/** 初回比較の係数。感度ではこのうち一つだけを変える。適合差は適合出荷−不適合出荷。 */
export interface StandardFactorRules {
  supportDiff: number;
  migrationFee: number;
  fitGap: number;
}

export const baselineStandardRules: StandardFactorRules = {
  supportDiff: SUPPORT_DIFF,
  migrationFee: MIGRATION_FEE,
  fitGap: FIT_SHIP - MISS_SHIP,
};

const WORK: Record<StandardBoard, Record<StandardTeamId, StandardWork>> = {
  same: { alpha: 'batch', beta: 'batch' },
  different: { alpha: 'batch', beta: 'custom' },
};

const PLANS: Record<StandardStrategy, readonly StandardAction[]> = {
  standardize: ['migrate', 'support', 'support'],
  experiment: ['support', 'support', 'support'],
  hold: ['hold', 'hold', 'hold'],
};

function fits(procedure: StandardProcedureName, work: StandardWork): boolean {
  return (procedure === 'kit' && work === 'batch') || (procedure === 'local' && work === 'custom');
}

function shipOf(
  state: StandardState,
  procedure: StandardProcedureName,
  work: StandardWork,
): number {
  return fits(procedure, work) ? state.fitShip : state.missShip;
}

function isAction(value: string): value is StandardAction {
  return value === 'migrate' || value === 'support' || value === 'hold';
}

function team(state: StandardState, id: StandardTeamId): StandardTeam {
  const found = state.teams.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

export function createStandardProcedure(
  seed: string,
  board: StandardBoard,
  rules: StandardFactorRules = baselineStandardRules,
): StandardState {
  const work = WORK[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    migrationFee: rules.migrationFee,
    blocker: BLOCKER,
    supportSame: SUPPORT_SAME,
    supportDiff: rules.supportDiff,
    fitShip: MISS_SHIP + rules.fitGap,
    missShip: MISS_SHIP,
    teams: [
      { id: 'alpha', procedure: 'kit', work: work.alpha },
      { id: 'beta', procedure: 'local', work: work.beta },
    ],
    shipped: 0,
    alphaShip: 0,
    betaShip: 0,
    supportPaid: 0,
    migrationPaid: 0,
    penalty: 0,
    inputs: [],
  };
}

/** 手順が同じ支援は state.supportSame、違う手順は state.supportDiff。初期値は1と4。 */
export function supportCostOf(state: StandardState): number {
  const alpha = team(state, 'alpha');
  const beta = team(state, 'beta');
  return alpha.procedure === beta.procedure ? state.supportSame : state.supportDiff;
}

/** 移行費用は beta が kit へ移る一度だけ。二度目と未知の操作は状態を変えない。 */
export function applyStandardAction(state: StandardState, action: string): StandardState {
  if (state.tick >= state.horizon || !isAction(action)) return state;
  if (action === 'migrate' && team(state, 'beta').procedure === 'kit') return state;
  const next = structuredClone(state);
  if (action === 'migrate') {
    team(next, 'beta').procedure = 'kit';
    next.migrationPaid += next.migrationFee;
  }
  const alphaShip = shipOf(next, team(next, 'alpha').procedure, team(next, 'alpha').work);
  const betaShip = shipOf(next, team(next, 'beta').procedure, team(next, 'beta').work);
  next.alphaShip += alphaShip;
  next.betaShip += betaShip;
  next.shipped += alphaShip + betaShip;
  if (action === 'support') next.supportPaid += supportCostOf(next);
  else next.penalty += next.blocker;
  next.tick += 1;
  next.inputs.push({ type: 'act', action });
  return next;
}

export function applyStandardProcedure(state: StandardState, input: StandardInput): StandardState {
  if (input.type === 'view') return state;
  if (input.type !== 'act') return state;
  return applyStandardAction(state, input.action);
}

export function viewStandardProcedure(state: StandardState) {
  const beta = team(state, 'beta');
  return {
    tick: state.tick,
    horizon: state.horizon,
    teams: state.teams.map((item) => ({
      id: item.id,
      procedure: item.procedure,
      work: item.work,
      fit: fits(item.procedure, item.work),
      periodShip: shipOf(state, item.procedure, item.work),
    })),
    migrationFee: beta.procedure === 'kit' ? 0 : state.migrationFee,
    supportCost: supportCostOf(state),
    blockerIfIdle: state.blocker,
  };
}

export function summarizeStandardProcedure(state: StandardState) {
  return {
    shipped: state.shipped,
    support: state.supportPaid,
    migration: state.migrationPaid,
    penalty: state.penalty,
    alphaShip: state.alphaShip,
    betaShip: state.betaShip,
    score: state.shipped - state.supportPaid - state.migrationPaid - state.penalty,
    lost: false,
  };
}

export function chooseStandardAction(
  state: StandardState,
  strategy: StandardStrategy,
): StandardInput {
  return { type: 'act', action: PLANS[strategy][state.tick] ?? 'hold' };
}

export function compareStandardProcedures(seed = 'RI-227') {
  return (['same', 'different'] as const).flatMap((board) =>
    (['standardize', 'experiment', 'hold'] as const).map((strategy) => {
      const initial = createStandardProcedure(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseStandardAction(state, strategy);
        const next = applyStandardProcedure(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeStandardProcedure(state),
      };
    }),
  );
}

const FACTOR_SEED = 'RI-227';
const FACTOR_BOARDS = ['same', 'different'] as const;
const SUPPORT_DIFF_STEPS = [0, 1, 2, 4, 6, 7, 8] as const;
const MIGRATION_FEE_STEPS = [0, 5, 13, 14, 15] as const;
const FIT_GAP_STEPS = [-1, 0, 1, 3, 6] as const;
type StandardFactorAxis = 'supportDiff' | 'migrationFee' | 'fitGap';
type StandardFactorPreference = 'standardize' | 'experiment' | 'tie';
type StandardFactorStrategy = 'standardize' | 'experiment';

interface StandardFactorRun {
  inputs: StandardInput[];
  result: ReturnType<typeof summarizeStandardProcedure>;
}

interface StandardFactorBoard {
  board: StandardBoard;
  preference: StandardFactorPreference;
  margin: number;
  standardize: StandardFactorRun;
  experiment: StandardFactorRun;
}

interface StandardFactorPoint {
  axis: StandardFactorAxis;
  parameter: string;
  rules: StandardFactorRules;
  sameAsFirstComparison: boolean;
  boards: StandardFactorBoard[];
}

interface StandardFactorReversal {
  axis: StandardFactorAxis;
  board: StandardBoard;
  before: {
    parameter: string;
    preference: StandardFactorPreference;
    standardize: number;
    experiment: number;
  };
  after: {
    parameter: string;
    preference: StandardFactorPreference;
    standardize: number;
    experiment: number;
  };
}

function withRules(patch: Partial<StandardFactorRules>): StandardFactorRules {
  return { ...baselineStandardRules, ...patch };
}

function rulesMatchBaseline(rules: StandardFactorRules): boolean {
  return (
    rules.supportDiff === baselineStandardRules.supportDiff &&
    rules.migrationFee === baselineStandardRules.migrationFee &&
    rules.fitGap === baselineStandardRules.fitGap
  );
}

function preferenceOf(standardize: number, experiment: number): StandardFactorPreference {
  if (standardize > experiment) return 'standardize';
  if (experiment > standardize) return 'experiment';
  return 'tie';
}

function runStandardFactor(
  board: StandardBoard,
  strategy: StandardFactorStrategy,
  rules: StandardFactorRules,
): StandardFactorRun {
  let state = createStandardProcedure(FACTOR_SEED, board, rules);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseStandardAction(state, strategy);
    const next = applyStandardProcedure(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeStandardProcedure(state) };
}

function factorBoard(board: StandardBoard, rules: StandardFactorRules): StandardFactorBoard {
  const standardize = runStandardFactor(board, 'standardize', rules);
  const experiment = runStandardFactor(board, 'experiment', rules);
  return {
    board,
    preference: preferenceOf(standardize.result.score, experiment.result.score),
    margin: standardize.result.score - experiment.result.score,
    standardize,
    experiment,
  };
}

function factorPoint(
  axis: StandardFactorAxis,
  parameter: string,
  rules: StandardFactorRules,
): StandardFactorPoint {
  const frozen = { ...rules };
  return {
    axis,
    parameter,
    rules: frozen,
    sameAsFirstComparison: rulesMatchBaseline(frozen),
    boards: FACTOR_BOARDS.map((board) => factorBoard(board, frozen)),
  };
}

function boardAt(point: StandardFactorPoint, board: StandardBoard): StandardFactorBoard {
  const found = point.boards.find((item) => item.board === board);
  if (!found) throw new Error(board);
  return found;
}

function reversalsOf(rows: StandardFactorPoint[]): StandardFactorReversal[] {
  const found: StandardFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      const earlier = boardAt(before, board);
      const later = boardAt(after, board);
      if (earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        board,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          standardize: earlier.standardize.result.score,
          experiment: earlier.experiment.result.score,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          standardize: later.standardize.result.score,
          experiment: later.experiment.result.score,
        },
      });
    }
  }
  return found;
}

function boardTeams(board: StandardBoard) {
  return createStandardProcedure(FACTOR_SEED, board).teams.map((item) => ({
    id: item.id,
    procedure: item.procedure,
    work: item.work,
  }));
}

/** 初回と同じ資源で、違う手順の支援費用・移行費用・適合差を一つずつ動かす。固定戦略。 */
export function compareStandardFactorReversals() {
  const baseline = createStandardProcedure(FACTOR_SEED, 'same');
  const sweeps = {
    supportDiff: SUPPORT_DIFF_STEPS.map((supportDiff) =>
      factorPoint('supportDiff', String(supportDiff), withRules({ supportDiff })),
    ),
    migrationFee: MIGRATION_FEE_STEPS.map((migrationFee) =>
      factorPoint('migrationFee', String(migrationFee), withRules({ migrationFee })),
    ),
    fitGap: FIT_GAP_STEPS.map((fitGap) =>
      factorPoint('fitGap', String(fitGap), withRules({ fitGap })),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizon: baseline.horizon,
      blocker: baseline.blocker,
      supportSame: baseline.supportSame,
      missShip: baseline.missShip,
      boards: {
        same: boardTeams('same'),
        different: boardTeams('different'),
      },
      plans: {
        standardize: [...PLANS.standardize],
        experiment: [...PLANS.experiment],
      },
      decision: {
        standardize: '最初に移行し、その後2期間支援する固定方針',
        experiment: '現場手順のまま3期間支援する固定方針',
        score: 'shipped - supportPaid - migrationPaid - penalty',
        preference: '標準化の差引が大きいとき標準化、現場手順が大きいとき現場手順、同じとき同点',
      },
      baseline: { ...baselineStandardRules },
      held: {
        supportDiff:
          '違う手順の支援費用だけを動かす。移行費用5、適合差3、同じ手順の支援費用1、罰5、不適合出荷3',
        migrationFee:
          '移行費用だけを動かす。違う手順の支援費用4、適合差3、同じ手順の支援費用1、罰5、不適合出荷3',
        fitGap:
          '適合差だけを動かす。不適合出荷3に差を足して適合出荷にする。違う手順の支援費用4、同じ手順の支援費用1、移行費用5、罰5',
      },
      supportDiffDefinition: '手順が違う期間に支援する費用。同じ手順の支援費用は1のまま',
      migrationFeeDefinition: 'betaをkitへ移す一度だけの費用。移行した期間は支援せず罰5',
      fitGapDefinition: '適合出荷から不適合出荷3を引いた差。適合出荷は3+適合差',
      steps: {
        supportDiff: [...SUPPORT_DIFF_STEPS],
        migrationFee: [...MIGRATION_FEE_STEPS],
        fitGap: [...FIT_GAP_STEPS],
      },
      omitted: '様子見は初回JSONのまま再出力しない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.supportDiff),
      ...reversalsOf(sweeps.migrationFee),
      ...reversalsOf(sweeps.fitGap),
    ],
  };
}
