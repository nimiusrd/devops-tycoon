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

function shipOf(procedure: StandardProcedureName, work: StandardWork): number {
  return fits(procedure, work) ? FIT_SHIP : MISS_SHIP;
}

function isAction(value: string): value is StandardAction {
  return value === 'migrate' || value === 'support' || value === 'hold';
}

function team(state: StandardState, id: StandardTeamId): StandardTeam {
  const found = state.teams.find((item) => item.id === id);
  if (!found) throw new Error(id);
  return found;
}

export function createStandardProcedure(seed: string, board: StandardBoard): StandardState {
  const work = WORK[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    migrationFee: MIGRATION_FEE,
    blocker: BLOCKER,
    supportSame: SUPPORT_SAME,
    supportDiff: SUPPORT_DIFF,
    fitShip: FIT_SHIP,
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

/** 手順が同じ支援は1、違う手順の支援は4。移行済みかどうかは今の手順で決まる。 */
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
  const alphaShip = shipOf(team(next, 'alpha').procedure, team(next, 'alpha').work);
  const betaShip = shipOf(team(next, 'beta').procedure, team(next, 'beta').work);
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
      periodShip: shipOf(item.procedure, item.work),
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
