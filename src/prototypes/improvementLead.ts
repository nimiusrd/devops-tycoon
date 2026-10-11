/** RI-223: 改善1件へ専任1枠を置き、継続と現場復帰を比べる。RI-217 の基盤仕事へは未接続。 */

export type LeadBoard = 'near' | 'urgent' | 'calm';
export type LeadStrategy = 'finish' | 'pause' | 'field';
export type LeadMode = 'improve' | 'field';
export type LeadInput = { type: 'assign'; mode: LeadMode } | { type: 'swap' } | { type: 'view' };

export interface LeadState {
  version: 1;
  seed: string;
  board: LeadBoard;
  tick: number;
  horizon: number;
  assignee: 'lead';
  progress: number;
  need: number;
  value: number;
  crisisTick: number | null;
  crisisPenalty: number;
  shipRate: number;
  restartPending: boolean;
  periodsOnImprovement: number;
  completed: boolean;
  shipped: number;
  improvementValue: number;
  penalty: number;
  inputs: LeadInput[];
}

const SHIP_RATE = 4;

const BOARDS: Record<
  LeadBoard,
  {
    start: number;
    need: number;
    value: number;
    horizon: number;
    crisisTick: number | null;
    penalty: number;
  }
> = {
  near: { start: 3, need: 4, value: 18, horizon: 2, crisisTick: null, penalty: 0 },
  urgent: { start: 2, need: 4, value: 18, horizon: 4, crisisTick: 0, penalty: 16 },
  calm: { start: 0, need: 4, value: 10, horizon: 4, crisisTick: null, penalty: 0 },
};

export function createImprovementLead(seed: string, board: LeadBoard): LeadState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: preset.horizon,
    assignee: 'lead',
    progress: preset.start,
    need: preset.need,
    value: preset.value,
    crisisTick: preset.crisisTick,
    crisisPenalty: preset.penalty,
    shipRate: SHIP_RATE,
    restartPending: false,
    periodsOnImprovement: 0,
    completed: false,
    shipped: 0,
    improvementValue: 0,
    penalty: 0,
    inputs: [],
  };
}

function isMode(value: string): value is LeadMode {
  return value === 'improve' || value === 'field';
}

/** 専任中は通常出荷へ参加しない。中断後の最初の改善期間は進捗を進めず、担当変更では完成にしない。 */
export function assignLead(state: LeadState, mode: string): LeadState {
  if (state.tick >= state.horizon || !isMode(mode)) return state;
  const next = structuredClone(state);
  if (mode === 'field') {
    next.shipped += next.shipRate;
    if (next.progress > 0 && next.progress < next.need && !next.completed) {
      next.restartPending = true;
    }
  } else {
    next.periodsOnImprovement += 1;
    if (next.restartPending) {
      next.restartPending = false;
    } else if (!next.completed) {
      next.progress += 1;
      if (next.progress >= next.need) {
        next.completed = true;
        next.improvementValue += next.value;
      }
    }
  }
  if (next.crisisTick === next.tick && mode !== 'field') next.penalty += next.crisisPenalty;
  next.tick += 1;
  next.inputs.push({ type: 'assign', mode });
  return next;
}

export function applyImprovementLead(state: LeadState, input: LeadInput): LeadState {
  if (input.type === 'view' || input.type === 'swap') return state;
  if (input.type !== 'assign') return state;
  return assignLead(state, input.mode);
}

export function viewImprovementLead(state: LeadState) {
  const crisis = state.crisisTick === state.tick;
  const advance = state.restartPending || state.completed ? 0 : 1;
  return {
    tick: state.tick,
    horizon: state.horizon,
    assignee: state.assignee,
    progress: state.progress,
    need: state.need,
    remaining: Math.max(0, state.need - state.progress),
    restartPending: state.restartPending,
    periodsOnImprovement: state.periodsOnImprovement,
    crisis,
    shipIfField: state.tick >= state.horizon ? 0 : state.shipRate,
    advanceIfImprove: state.tick >= state.horizon ? 0 : advance,
    penaltyIfImprove: crisis ? state.crisisPenalty : 0,
  };
}

export function summarizeImprovementLead(state: LeadState) {
  return {
    shipped: state.shipped,
    improvement: state.improvementValue,
    penalty: state.penalty,
    periods: state.periodsOnImprovement,
    progress: state.progress,
    completed: state.completed,
    restartPending: state.restartPending,
    score: state.shipped + state.improvementValue - state.penalty,
    lost: false,
  };
}

export function chooseLeadAction(state: LeadState, strategy: LeadStrategy): LeadInput {
  if (strategy === 'field') return { type: 'assign', mode: 'field' };
  if (strategy === 'pause' && state.tick === 0) return { type: 'assign', mode: 'field' };
  if (!state.completed && state.progress < state.need) return { type: 'assign', mode: 'improve' };
  return { type: 'assign', mode: 'field' };
}

export function compareImprovementLeads(seed = 'RI-223') {
  return (['near', 'urgent', 'calm'] as const).flatMap((board) =>
    (['finish', 'pause', 'field'] as const).map((strategy) => {
      const initial = createImprovementLead(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseLeadAction(state, strategy);
        const next = applyImprovementLead(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeImprovementLead(state),
      };
    }),
  );
}
