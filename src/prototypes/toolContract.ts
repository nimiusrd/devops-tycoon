/** RI-249: 架空ツール1種の更新。実在サービスの価格や通信は扱わない。 */

export type ContractBoard = 'steady' | 'heavy' | 'light';
export type ContractStrategy = 'continue' | 'migrate' | 'shrink';
export type ContractTool = 'none' | 'old' | 'migrating' | 'continued' | 'transferred' | 'shrunk';
export type ContractInput =
  | { type: 'view' }
  | { type: 'continue' }
  | { type: 'migrate' }
  | { type: 'shrink' }
  | { type: 'work' };

export interface ContractPeriod {
  tick: number;
  action: ContractStrategy | 'work';
  tool: ContractTool;
  automation: number;
  fee: number;
  score: number;
}

export interface ContractState {
  version: 1;
  seed: string;
  board: ContractBoard;
  tick: number;
  horizon: number;
  asset: number;
  budget: number;
  slack: boolean;
  strategy: ContractStrategy | null;
  worked: number;
  migrationLeft: number;
  migrationWork: number;
  net: number;
  continueAutomation: number;
  continueFee: number;
  transferAutomation: number;
  transferFee: number;
  periods: ContractPeriod[];
  inputs: ContractInput[];
}

const PRE_TICKS = 2;
const POST_TICKS = 3;
const PRE_AUTOMATION = 5;
const PRE_FEE = 1;
const MIGRATION_WORK = 1;
const SHRINK_AUTOMATION = 3;
const SHRINK_FEE = 1;

const BOARDS: Record<
  ContractBoard,
  {
    asset: number;
    budget: number;
    slack: boolean;
    continueAutomation: number;
    continueFee: number;
    transferAutomation: number;
    transferFee: number;
  }
> = {
  steady: {
    asset: 9,
    budget: 12,
    slack: true,
    continueAutomation: 9,
    continueFee: 2,
    transferAutomation: 4,
    transferFee: 2,
  },
  heavy: {
    asset: 9,
    budget: 12,
    slack: true,
    continueAutomation: 9,
    continueFee: 6,
    transferAutomation: 8,
    transferFee: 2,
  },
  light: {
    asset: 4,
    budget: 4,
    slack: false,
    continueAutomation: 4,
    continueFee: 6,
    transferAutomation: 2,
    transferFee: 2,
  },
};

function quote(state: ContractState): { tool: ContractTool; automation: number; fee: number } {
  if (state.worked < PRE_TICKS) {
    return { tool: 'old', automation: PRE_AUTOMATION, fee: PRE_FEE };
  }
  if (state.strategy === 'continue') {
    return { tool: 'continued', automation: state.continueAutomation, fee: state.continueFee };
  }
  if (state.strategy === 'shrink') {
    return { tool: 'shrunk', automation: SHRINK_AUTOMATION, fee: SHRINK_FEE };
  }
  if (state.migrationLeft > 0) return { tool: 'migrating', automation: 0, fee: 0 };
  return { tool: 'transferred', automation: state.transferAutomation, fee: state.transferFee };
}

function pushPeriod(
  state: ContractState,
  action: ContractPeriod['action'],
  tool: ContractTool,
  automation: number,
  fee: number,
) {
  state.periods.push({
    tick: state.tick,
    action,
    tool,
    automation,
    fee,
    score: state.net,
  });
  state.tick += 1;
}

export function createToolContract(seed: string, board: ContractBoard): ContractState {
  const spec = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: PRE_TICKS + POST_TICKS + 1,
    asset: spec.asset,
    budget: spec.budget,
    slack: spec.slack,
    strategy: null,
    worked: 0,
    migrationLeft: 0,
    migrationWork: MIGRATION_WORK,
    net: 0,
    continueAutomation: spec.continueAutomation,
    continueFee: spec.continueFee,
    transferAutomation: spec.transferAutomation,
    transferFee: spec.transferFee,
    periods: [],
    inputs: [],
  };
}

export function applyToolContract(state: ContractState, input: ContractInput): ContractState {
  if (input.type === 'view') return state;
  if (input.type === 'continue' || input.type === 'migrate' || input.type === 'shrink') {
    if (state.strategy !== null || state.tick !== 0) return state;
    const next = structuredClone(state);
    next.strategy = input.type;
    if (input.type === 'migrate') next.migrationLeft = next.migrationWork;
    pushPeriod(next, input.type, 'none', 0, 0);
    next.inputs.push({ type: input.type });
    return next;
  }
  if (state.strategy === null || state.tick >= state.horizon) return state;
  const next = structuredClone(state);
  const billed = quote(next);
  next.net += billed.automation - billed.fee;
  if (billed.tool === 'migrating') next.migrationLeft -= 1;
  next.worked += 1;
  pushPeriod(next, 'work', billed.tool, billed.automation, billed.fee);
  next.inputs.push({ type: 'work' });
  return next;
}

export function summarizeToolContract(state: ContractState) {
  return {
    score: state.net,
    asset: state.asset,
    budget: state.budget,
    slack: state.slack,
    migrationLeft: state.migrationLeft,
    path: state.periods.map((period) => period.score),
    billing: state.periods.map((period) => ({
      tool: period.tool,
      automation: period.automation,
      fee: period.fee,
    })),
    lost: false,
  };
}

export function chooseToolContractAction(
  state: ContractState,
  strategy: ContractStrategy,
): ContractInput {
  if (state.tick >= state.horizon) return { type: 'view' };
  if (state.strategy === null) return { type: strategy };
  return { type: 'work' };
}

function runContract(seed: string, board: ContractBoard, strategy: ContractStrategy) {
  const initial = createToolContract(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseToolContractAction(state, strategy);
    const next = applyToolContract(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeToolContract(state) };
}

export function compareToolContracts(seed = 'RI-249') {
  return (['steady', 'heavy', 'light'] as const).flatMap((board) =>
    (['continue', 'migrate', 'shrink'] as const).map((strategy) => ({
      board,
      strategy,
      ...runContract(seed, board, strategy),
    })),
  );
}

function preview(state: ContractState, strategy: ContractStrategy) {
  let cursor = structuredClone(state);
  let guard = 0;
  while (cursor.tick < cursor.horizon) {
    if (++guard > 10) break;
    const next = applyToolContract(cursor, chooseToolContractAction(cursor, strategy));
    if (next === cursor) break;
    cursor = next;
  }
  const summary = summarizeToolContract(cursor);
  return { strategy, score: summary.score, billing: summary.billing };
}

export function viewToolContract(state: ContractState) {
  return {
    tick: state.tick,
    board: state.board,
    reason: 'tool-contract',
    notice: 'renewal-announced',
    renewalAfterTicks: PRE_TICKS,
    postTicks: POST_TICKS,
    asset: state.asset,
    budget: state.budget,
    slack: state.slack,
    old: { automation: PRE_AUTOMATION, fee: PRE_FEE },
    continued: { automation: state.continueAutomation, fee: state.continueFee },
    transferred: { automation: state.transferAutomation, fee: state.transferFee },
    shrink: { automation: SHRINK_AUTOMATION, fee: SHRINK_FEE },
    migrationWork: state.migrationWork,
    migrationEffect: 'neither' as const,
    continueHelpsWhen: 'mild-fee',
    migrateHelpsWhen: 'heavy-asset-and-high-fee',
    shrinkHelpsWhen: 'thin-asset',
    strategy: state.strategy,
    choices: state.strategy === null ? (['continue', 'migrate', 'shrink'] as const) : [],
    forecasts:
      state.strategy === null
        ? (['continue', 'migrate', 'shrink'] as const).map((strategy) => preview(state, strategy))
        : [],
  };
}
