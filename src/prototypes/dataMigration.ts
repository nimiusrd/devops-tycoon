/** RI-256: データ移行の早期切替と検証延長を比べる。通常ランには接続しない。 */

export type MigrationBoard = 'trusted' | 'sensitive';
export type MigrationStrategy = 'early' | 'prepare';
export type MigrationInput =
  | { type: 'view' }
  | { type: 'early' }
  | { type: 'prepare' }
  | { type: 'work' }
  | { type: 'repair' }
  | { type: 'assign'; migrate: number; verify: number };

export interface MigrationPeriod {
  tick: number;
  action: MigrationStrategy | 'work' | 'repair' | 'assign';
  migrated: number;
  verified: number;
  dualSpent: number;
  risk: number;
  postProcess: number;
  score: number;
}

export interface MigrationState {
  version: 1;
  seed: string;
  board: MigrationBoard;
  tick: number;
  horizon: number;
  total: number;
  slots: number;
  dualRate: number;
  riskRate: number;
  shipValue: number;
  strategy: MigrationStrategy | null;
  migrated: number;
  verified: number;
  switched: boolean;
  dualSpent: number;
  risk: number;
  ship: number;
  postProcess: number;
  appliedId: string | null;
  periods: MigrationPeriod[];
  inputs: MigrationInput[];
}

const TOTAL = 4;
const SLOTS = 2;
const SHIP_VALUE = 20;
const WORK_TICKS = 4;
const APPLIED_ID = 'migrated-batch';

const BOARDS: Record<MigrationBoard, { dualRate: number; riskRate: number }> = {
  trusted: { dualRate: 6, riskRate: 1 },
  sensitive: { dualRate: 2, riskRate: 8 },
};

function scoreOf(state: MigrationState): number {
  return state.ship - state.dualSpent - state.risk;
}

function isSlotCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function pushPeriod(state: MigrationState, action: MigrationPeriod['action']) {
  state.periods.push({
    tick: state.tick,
    action,
    migrated: state.migrated,
    verified: state.verified,
    dualSpent: state.dualSpent,
    risk: state.risk,
    postProcess: state.postProcess,
    score: scoreOf(state),
  });
  state.tick += 1;
}

function cutover(state: MigrationState) {
  if (state.switched) return;
  state.switched = true;
  state.risk = (state.migrated - state.verified) * state.riskRate;
  state.postProcess = 1;
  state.appliedId = APPLIED_ID;
  state.ship = state.shipValue;
}

export function createDataMigration(seed: string, board: MigrationBoard): MigrationState {
  const spec = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: WORK_TICKS + 1,
    total: TOTAL,
    slots: SLOTS,
    dualRate: spec.dualRate,
    riskRate: spec.riskRate,
    shipValue: SHIP_VALUE,
    strategy: null,
    migrated: 0,
    verified: 0,
    switched: false,
    dualSpent: 0,
    risk: 0,
    ship: 0,
    postProcess: 0,
    appliedId: null,
    periods: [],
    inputs: [],
  };
}

function advance(state: MigrationState, migrateSlots: number, verifySlots: number) {
  state.migrated = Math.min(state.total, state.migrated + migrateSlots);
  const room = state.migrated - state.verified;
  state.verified += Math.min(room, verifySlots);
}

function applyWork(state: MigrationState): MigrationState {
  const next = structuredClone(state);
  if (!next.switched) {
    const plan =
      next.strategy === 'early' ? { migrate: next.slots, verify: 0 } : { migrate: 1, verify: 1 };
    advance(next, plan.migrate, plan.verify);
    next.dualSpent += next.dualRate;
    const ready =
      next.strategy === 'early'
        ? next.migrated >= next.total
        : next.migrated >= next.total && next.verified >= next.total;
    if (ready) cutover(next);
  }
  pushPeriod(next, 'work');
  next.inputs.push({ type: 'work' });
  return next;
}

export function applyDataMigration(state: MigrationState, input: MigrationInput): MigrationState {
  if (input.type === 'view') return state;
  if (input.type === 'early' || input.type === 'prepare') {
    if (state.strategy !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.strategy = input.type;
    pushPeriod(next, input.type);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (input.type === 'repair') {
    if (!state.switched || state.verified >= state.migrated) return state;
    const next = structuredClone(state);
    next.verified += 1;
    pushPeriod(next, 'repair');
    next.inputs.push({ type: 'repair' });
    return next;
  }
  if (input.type === 'assign') {
    if (!isSlotCount(input.migrate) || !isSlotCount(input.verify)) return state;
    if (input.migrate + input.verify > state.slots) return state;
    const next = structuredClone(state);
    advance(next, input.migrate, input.verify);
    pushPeriod(next, 'assign');
    next.inputs.push({ type: 'assign', migrate: input.migrate, verify: input.verify });
    return next;
  }
  if (state.strategy === null || state.tick >= state.horizon || input.type !== 'work') return state;
  return applyWork(state);
}

export function summarizeDataMigration(state: MigrationState) {
  return {
    score: scoreOf(state),
    ship: state.ship,
    dualSpent: state.dualSpent,
    risk: state.risk,
    migrated: state.migrated,
    verified: state.verified,
    switched: state.switched,
    postProcess: state.postProcess,
    appliedId: state.appliedId,
    path: state.periods.map((period) => period.score),
    lost: false,
    rosterChanged: false,
    existingBossWeights: 'unchanged',
  };
}

export function chooseDataMigrationAction(
  state: MigrationState,
  strategy: MigrationStrategy,
): MigrationInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.strategy === null) return { type: strategy };
  return { type: 'work' };
}

function runMigration(seed: string, board: MigrationBoard, strategy: MigrationStrategy) {
  const initial = createDataMigration(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 8) throw new Error(`${board}:${strategy}`);
    const input = chooseDataMigrationAction(state, strategy);
    const next = applyDataMigration(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeDataMigration(state) };
}

export function compareDataMigration(seed = 'RI-256') {
  return (['trusted', 'sensitive'] as const).flatMap((board) =>
    (['early', 'prepare'] as const).map((strategy) => ({
      board,
      strategy,
      ...runMigration(seed, board, strategy),
    })),
  );
}

function preview(state: MigrationState, strategy: MigrationStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 8) break;
    const next = applyDataMigration(cursor, chooseDataMigrationAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeDataMigration(cursor);
  return {
    strategy,
    score: summary.score,
    dualSpent: summary.dualSpent,
    risk: summary.risk,
    postProcess: summary.postProcess,
  };
}

export function viewDataMigration(state: MigrationState) {
  return {
    tick: state.tick,
    board: state.board,
    total: state.total,
    slots: state.slots,
    dualRate: state.dualRate,
    riskRate: state.riskRate,
    shipValue: state.shipValue,
    strategy: state.strategy,
    switched: state.switched,
    migrated: state.migrated,
    verified: state.verified,
    choices: state.strategy === null ? (['early', 'prepare'] as const) : [],
    rosterChanged: false,
    existingBossWeights: 'unchanged',
    achievementCompat: 'unseen-until-new-ruleset',
    forecasts:
      state.strategy === null
        ? (['early', 'prepare'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}
