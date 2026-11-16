/** RI-223: 改善1件へ専任1枠を置き、継続と現場復帰を比べる。感度は必要進捗・再開費用・危機tickだけ。通常ランへは未接続。 */

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
  /** 再開費用が2期間以上のときだけ残数を持つ。初回の費用1は restartPending だけを使う。 */
  restartLeft?: number;
  periodsOnImprovement: number;
  completed: boolean;
  shipped: number;
  improvementValue: number;
  penalty: number;
  inputs: LeadInput[];
}

const SHIP_RATE = 4;
const NEED = 4;
const RESTART_COST = 1;
const CRISIS_TICK = 0;
const CRISIS_PENALTY = 16;

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
  near: { start: 3, need: NEED, value: 18, horizon: 2, crisisTick: null, penalty: 0 },
  urgent: {
    start: 2,
    need: NEED,
    value: 18,
    horizon: 4,
    crisisTick: CRISIS_TICK,
    penalty: CRISIS_PENALTY,
  },
  calm: { start: 0, need: NEED, value: 10, horizon: 4, crisisTick: null, penalty: 0 },
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

/** 専任中は通常出荷へ参加しない。再開費用の期間は進捗を進めず、担当変更では完成にしない。 */
export function assignLead(state: LeadState, mode: string, restartCost = RESTART_COST): LeadState {
  if (state.tick >= state.horizon || !isMode(mode)) return state;
  const next = structuredClone(state);
  if (mode === 'field') {
    next.shipped += next.shipRate;
    if (restartCost > 0 && next.progress > 0 && next.progress < next.need && !next.completed) {
      next.restartPending = true;
      if (restartCost > 1) next.restartLeft = restartCost;
    }
  } else if (restartCost > 1) {
    next.periodsOnImprovement += 1;
    const owed = next.restartLeft ?? 0;
    if (owed > 0) {
      const remain = owed - 1;
      next.restartLeft = remain;
      next.restartPending = remain > 0;
    } else if (!next.completed) {
      next.progress += 1;
      if (next.progress >= next.need) {
        next.completed = true;
        next.improvementValue += next.value;
      }
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

/** 感度で一つだけ動かす規則。初期進捗・価値・期間・出荷・罰は含めない。 */
export interface LeadFactorRules {
  need: number;
  restartCost: number;
  urgentCrisisTick: number | null;
}

/** 初回比較の規則。感度ではこのうち一つだけを変える。 */
export const baselineLeadRules: LeadFactorRules = {
  need: NEED,
  restartCost: RESTART_COST,
  urgentCrisisTick: CRISIS_TICK,
};

export function applyImprovementLead(
  state: LeadState,
  input: LeadInput,
  rules: LeadFactorRules = baselineLeadRules,
): LeadState {
  if (input.type === 'view' || input.type === 'swap') return state;
  if (input.type !== 'assign') return state;
  return assignLead(state, input.mode, rules.restartCost);
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

const FACTOR_SEED = 'RI-223';
const FACTOR_BOARDS = ['near', 'urgent', 'calm'] as const;
const FACTOR_STRATEGIES = ['finish', 'pause', 'field'] as const;
const NEED_STEPS = [2, 3, 4, 5, 6] as const;
const RESTART_STEPS = [0, 1, 2, 3] as const;
const CRISIS_STEPS = [null, 0, 1, 2, 3] as const;
type LeadFactorAxis = 'need' | 'restartCost' | 'crisisTick';
type LeadFactorRun = {
  inputs: LeadInput[];
  result: ReturnType<typeof summarizeImprovementLead>;
};
type LeadFactorBoard = {
  board: LeadBoard;
  scores: Record<LeadStrategy, number>;
  order: string;
  leaders: LeadStrategy[];
  finish: LeadFactorRun;
  pause: LeadFactorRun;
  field: LeadFactorRun;
};
type LeadFactorPoint = {
  axis: LeadFactorAxis;
  parameter: string;
  rules: LeadFactorRules;
  sameAsFirstComparison: boolean;
  boards: LeadFactorBoard[];
};
type LeadFactorReversal = {
  axis: LeadFactorAxis;
  board: LeadBoard;
  before: {
    parameter: string;
    order: string;
    finish: number;
    pause: number;
    field: number;
  };
  after: {
    parameter: string;
    order: string;
    finish: number;
    pause: number;
    field: number;
  };
};

/** 感度用の初期状態。必要進捗は全盤面、危機tickは現場の危機だけを規則で上書きする。 */
export function createLeadFactorState(board: LeadBoard, rules: LeadFactorRules): LeadState {
  const state = createImprovementLead(FACTOR_SEED, board);
  return {
    ...state,
    need: rules.need,
    crisisTick: board === 'urgent' ? rules.urgentCrisisTick : state.crisisTick,
  };
}

function rulesMatchBaseline(rules: LeadFactorRules) {
  return (
    rules.need === baselineLeadRules.need &&
    rules.restartCost === baselineLeadRules.restartCost &&
    rules.urgentCrisisTick === baselineLeadRules.urgentCrisisTick
  );
}

function rankLead(scores: Record<LeadStrategy, number>) {
  const ranked = [...FACTOR_STRATEGIES].sort((left, right) => {
    const diff = scores[right] - scores[left];
    if (diff !== 0) return diff;
    return FACTOR_STRATEGIES.indexOf(left) - FACTOR_STRATEGIES.indexOf(right);
  });
  const groups: LeadStrategy[][] = [];
  for (const strategy of ranked) {
    const last = groups[groups.length - 1];
    const head = last?.[0];
    if (last && head !== undefined && scores[head] === scores[strategy]) last.push(strategy);
    else groups.push([strategy]);
  }
  const leaders = groups[0];
  if (!leaders) throw new Error('rank');
  return { order: groups.map((group) => group.join('=')).join('>'), leaders };
}

function runLeadFactor(
  board: LeadBoard,
  strategy: LeadStrategy,
  rules: LeadFactorRules,
): LeadFactorRun {
  let state = createLeadFactorState(board, rules);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseLeadAction(state, strategy);
    const next = applyImprovementLead(state, input, rules);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeImprovementLead(state) };
}

function factorBoard(board: LeadBoard, rules: LeadFactorRules): LeadFactorBoard {
  const finish = runLeadFactor(board, 'finish', rules);
  const pause = runLeadFactor(board, 'pause', rules);
  const field = runLeadFactor(board, 'field', rules);
  const scores = {
    finish: finish.result.score,
    pause: pause.result.score,
    field: field.result.score,
  };
  const ranked = rankLead(scores);
  return { board, scores, order: ranked.order, leaders: ranked.leaders, finish, pause, field };
}

function factorPoint(
  axis: LeadFactorAxis,
  parameter: string,
  rules: LeadFactorRules,
): LeadFactorPoint {
  return {
    axis,
    parameter,
    rules: { ...rules },
    sameAsFirstComparison: rulesMatchBaseline(rules),
    boards: FACTOR_BOARDS.map((board) => factorBoard(board, rules)),
  };
}

function boardAt(point: LeadFactorPoint, board: LeadBoard): LeadFactorBoard {
  const found = point.boards.find((item) => item.board === board);
  if (!found) throw new Error(board);
  return found;
}

function reversalScores(board: LeadFactorBoard) {
  return {
    order: board.order,
    finish: board.scores.finish,
    pause: board.scores.pause,
    field: board.scores.field,
  };
}

function reversalsOf(rows: LeadFactorPoint[]): LeadFactorReversal[] {
  const found: LeadFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      const earlier = boardAt(before, board);
      const later = boardAt(after, board);
      if (earlier.order === later.order) continue;
      found.push({
        axis: before.axis,
        board,
        before: { parameter: before.parameter, ...reversalScores(earlier) },
        after: { parameter: after.parameter, ...reversalScores(later) },
      });
    }
  }
  return found;
}

function crisisParameter(tick: number | null) {
  return tick === null ? 'none' : String(tick);
}

function factorResources(board: LeadBoard) {
  const state = createImprovementLead(FACTOR_SEED, board);
  return {
    start: state.progress,
    value: state.value,
    horizon: state.horizon,
    crisisTick: state.crisisTick,
    crisisPenalty: state.crisisPenalty,
    shipRate: state.shipRate,
  };
}

/** 初回と同じ資源で、必要進捗・再開費用・現場の危機のtickを一つずつ動かす。固定戦略。 */
export function compareImprovementLeadFactors() {
  const sweeps = {
    need: NEED_STEPS.map((need) =>
      factorPoint('need', String(need), { ...baselineLeadRules, need }),
    ),
    restartCost: RESTART_STEPS.map((restartCost) =>
      factorPoint('restartCost', String(restartCost), { ...baselineLeadRules, restartCost }),
    ),
    crisisTick: CRISIS_STEPS.map((urgentCrisisTick) =>
      factorPoint('crisisTick', crisisParameter(urgentCrisisTick), {
        ...baselineLeadRules,
        urgentCrisisTick,
      }),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      assignee: 'lead' as const,
      shipRate: SHIP_RATE,
      boards: {
        near: factorResources('near'),
        urgent: factorResources('urgent'),
        calm: factorResources('calm'),
      },
      strategies: {
        finish: '完成まで専任してから現場へ戻る',
        pause: '初期間だけ現場へ戻り、その後完成を目指す',
        field: '毎期現場にいる',
      },
      score: 'shipped + improvement - penalty',
      baseline: { ...baselineLeadRules },
      held: {
        need: '必要進捗だけを動かす。再開費用1、現場の危機はtick 0。初期進捗・価値・期間・出荷4・罰16は固定',
        restartCost:
          '再開費用だけを動かす。必要進捗4、現場の危機はtick 0。進捗0の現場復帰は再開待ちにしない',
        crisisTick:
          '現場の危機のtickだけを動かす。必要進捗4、再開費用1、罰16。完成間近と静穏は危機なしのまま',
      },
      needDefinition:
        '進捗の目標。初期進捗は盤面のまま。目標が初期進捗以下のときは専任せず、改善価値は入らない',
      restartCostDefinition:
        '進捗が残る現場復帰のあと、進捗を進めない改善期間の数。0は再開待ちにしない。差引から別の額は引かない',
      crisisTickDefinition:
        '現場の危機で専任すると罰16を一度足すtick。noneは危機なし。現場にいる期間は罰なし',
      steps: {
        need: [...NEED_STEPS],
        restartCost: [...RESTART_STEPS],
        crisisTick: CRISIS_STEPS.map((tick) => crisisParameter(tick)),
      },
      omitted: '初回の3盤面×3戦略の表は再出力しない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.need),
      ...reversalsOf(sweeps.restartCost),
      ...reversalsOf(sweeps.crisisTick),
    ],
  };
}
