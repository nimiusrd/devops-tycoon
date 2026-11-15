import {
  createParallelPrototype,
  summarizeParallel,
  tickParallelPrototype,
  type ParallelState,
  type ParallelTask,
} from './parallelConflicts';

export interface CancellationState {
  version: 1;
  board: ParallelState;
  activeId: string | null;
  focus: number;
  trust: number;
  burningIds: string[];
  contractIds: string[];
  cancelled: {
    status: 'cancelled';
    task: ParallelTask;
    tick: number;
    reason: string;
    spentWork: number;
    trustCost: number;
  }[];
  inputs: CancellationInput[];
}
export type CancellationInput =
  { kind: 'work'; ids: string[] } | { kind: 'cancel'; id: string; reason: string };

export function createCancellationPrototype(
  seed: string | number,
  investment: 'shallow' | 'near-complete',
  contract = false,
): CancellationState {
  let board = createParallelPrototype(seed);
  board.slots = 1;
  board.horizon = 5;
  board.tasks = [
    {
      id: 'obsolete',
      domain: 'product',
      codingLeft: 4,
      integrationLeft: 0,
      completedTick: null,
      value: 2,
    },
    {
      id: 'needed',
      domain: 'platform',
      codingLeft: 3,
      integrationLeft: 0,
      completedTick: null,
      value: 8,
    },
  ];
  for (let i = 0; i < (investment === 'shallow' ? 1 : 3); i++)
    board = tickParallelPrototype(board, ['obsolete']);
  return {
    version: 1,
    board,
    activeId: 'obsolete',
    focus: 1,
    trust: 5,
    burningIds: [],
    contractIds: contract ? ['obsolete'] : [],
    cancelled: [],
    inputs: [],
  };
}

export interface CancellationRules {
  cancelFocusCost: number;
  cancelTickCost: number;
  /** null は契約固定2。数値は現在の信頼に対する分子/分母。 */
  contractRatio: { numerator: number; denominator: number } | null;
  /** null は最初から中止できる。指定tick未満は拒否する。 */
  announceTick: number | null;
}

export const BASE_CANCELLATION_RULES: CancellationRules = {
  cancelFocusCost: 1,
  cancelTickCost: 0,
  contractRatio: null,
  announceTick: null,
};

function resolveRules(rules?: Partial<CancellationRules>): CancellationRules {
  return { ...BASE_CANCELLATION_RULES, ...rules };
}

function trustCostOf(state: CancellationState, id: string, rules: CancellationRules): number {
  if (!state.contractIds.includes(id)) return 0;
  if (!rules.contractRatio) return 2;
  return Math.round(
    (state.trust * rules.contractRatio.numerator) / rules.contractRatio.denominator,
  );
}

/** 通常タスクのCoding中のみ中止可能。統合・Done・炎上・期末は拒否する。 */
export function applyCancellationPrototype(
  state: CancellationState,
  input: CancellationInput,
  rules?: Partial<CancellationRules>,
): CancellationState {
  const resolved = resolveRules(rules);
  if (state.board.tick >= state.board.horizon) return state;
  if (input.kind === 'work') {
    // 占有中の仕事を外す入力は拒否する。空いている枠へ別の仕事を足すこととは分ける。
    if (state.activeId !== null && input.ids.length > 0 && !input.ids.includes(state.activeId))
      return state;
    const board = tickParallelPrototype(state.board, input.ids);
    if (board === state.board) return state;
    const headId = input.ids[0];
    const head = headId === undefined ? undefined : board.tasks.find((task) => task.id === headId);
    return {
      ...state,
      board,
      activeId:
        input.ids.length === 0
          ? state.activeId
          : head !== undefined && head.completedTick === null
            ? head.id
            : null,
      inputs: [...state.inputs, { ...input, ids: [...input.ids] }],
    };
  }
  const task = state.board.tasks.find((candidate) => candidate.id === input.id);
  if (
    !task ||
    task.completedTick !== null ||
    task.codingLeft <= 0 ||
    state.burningIds.includes(input.id) ||
    input.reason.trim().length === 0 ||
    (resolved.announceTick !== null && state.board.tick < resolved.announceTick)
  )
    return state;
  const trustCost = trustCostOf(state, input.id, resolved);
  if (state.focus < resolved.cancelFocusCost || state.trust < trustCost) return state;
  // Focus・期間・信頼のどれも払わない中止は、無償の切替なので拒否する。
  if (resolved.cancelFocusCost <= 0 && resolved.cancelTickCost <= 0 && trustCost <= 0) return state;
  if (state.board.tick + resolved.cancelTickCost > state.board.horizon) return state;
  let board: ParallelState = {
    ...state.board,
    tasks: state.board.tasks.filter((candidate) => candidate.id !== input.id),
  };
  for (let i = 0; i < resolved.cancelTickCost; i++) board = tickParallelPrototype(board, []);
  return {
    ...state,
    board,
    activeId: state.activeId === input.id ? null : state.activeId,
    focus: state.focus - resolved.cancelFocusCost,
    trust: state.trust - trustCost,
    cancelled: [
      ...state.cancelled,
      {
        status: 'cancelled',
        task: { ...task },
        tick: state.board.tick,
        reason: input.reason.trim(),
        spentWork: state.board.history.filter((entry) => entry.ids.includes(input.id)).length,
        trustCost,
      },
    ],
    inputs: [...state.inputs, { ...input }],
  };
}

export function summarizeCancellation(state: CancellationState) {
  return {
    ...summarizeParallel(state.board),
    focus: state.focus,
    trust: state.trust,
    doneCount: state.board.tasks.filter((task) => task.completedTick !== null).length,
    cancelled: state.cancelled,
  };
}

export function compareCancellationStrategies(seed: string | number) {
  return (['shallow', 'near-complete'] as const).flatMap((investment) =>
    (['continue', 'cancel'] as const).map((strategy) => {
      let state = createCancellationPrototype(seed, investment);
      const initial = structuredClone(state);
      if (strategy === 'cancel')
        state = applyCancellationPrototype(state, {
          kind: 'cancel',
          id: 'obsolete',
          reason: '需要低下。残り枠を必要な仕事に振り向ける',
        });
      while (state.board.tick < state.board.horizon) {
        const task = state.board.tasks.find((task) => task.completedTick === null);
        state = applyCancellationPrototype(state, { kind: 'work', ids: task ? [task.id] : [] });
      }
      return {
        investment,
        strategy,
        initial,
        ...summarizeCancellation(state),
        inputs: state.inputs,
      };
    }),
  );
}

export type CancellationFactor =
  'focus' | 'cancel-cost' | 'contract-ratio' | 'no-alternative' | 'announce';
export type CancellationJudgment = 'continue' | 'cancel' | 'tie' | 'cancel-unavailable';

interface FactorJudgment {
  factor: CancellationFactor;
  level: number;
  judgment: CancellationJudgment;
  continueValue: number;
  cancelValue: number;
  continueDone: number;
  cancelDone: number;
  continueFocus: number;
  cancelFocus: number;
  continueTrust: number;
  cancelTrust: number;
  valueGap: number;
  trustSpent: number;
}

const FACTOR_ORDER: CancellationFactor[] = [
  'focus',
  'cancel-cost',
  'contract-ratio',
  'no-alternative',
  'announce',
];
const FACTOR_LEVELS: Record<CancellationFactor, readonly number[]> = {
  focus: [1, 2, 3],
  'cancel-cost': [0, 1, 2],
  'contract-ratio': [0, 2, 4, 5, 6],
  'no-alternative': [-1, 0, 1, 2],
  announce: [1, 2, 3, 4, 5],
};
const SENSITIVITY_DEFINITIONS = {
  focus:
    'Focusの数を同時に進められる作業枠の数にする。中止のFocus費用は1のまま。占有中の仕事を外す入力は拒否する。',
  'cancel-cost': '中止の解決が消費するtick。Focusは1払う。期間が0でも無償の切替にはしない。',
  'contract-ratio':
    '契約中止の信頼費用を round(現在の信頼×分子/5) にする。在庫を超える費用は資源を消費せず拒否する。',
  'no-alternative': '代案の仕事を置かず、残った仕事の出荷価値だけを変える。',
  announce:
    '指定tickになるまで中止を拒否する。それまでは占有中の仕事を進め、中止後は空いた枠で残りの仕事を進める。',
} as const;
const CANCEL_REASON = '需要が失われたため中止する';

function openTasks(state: CancellationState): ParallelTask[] {
  return state.board.tasks.filter(
    (task) => task.completedTick === null && (task.codingLeft > 0 || task.integrationLeft > 0),
  );
}

/** 占有中の仕事を残し、空いている枠だけ他の未完了を足す。 */
function workIds(state: CancellationState): string[] {
  const open = openTasks(state);
  const ids: string[] = [];
  if (state.activeId !== null && open.some((task) => task.id === state.activeId)) {
    ids.push(state.activeId);
  }
  for (const task of open) {
    if (ids.length >= state.board.slots) break;
    if (!ids.includes(task.id)) ids.push(task.id);
  }
  return ids;
}

function prepareSensitivity(
  seed: string | number,
  factor: CancellationFactor,
  level: number,
): { state: CancellationState; rules: CancellationRules } {
  const state = createCancellationPrototype(seed, 'shallow');
  const rules: CancellationRules = { ...BASE_CANCELLATION_RULES };
  if (factor === 'focus') {
    state.focus = level;
    state.board = { ...state.board, slots: level };
  } else if (factor === 'cancel-cost') {
    rules.cancelTickCost = level;
  } else if (factor === 'contract-ratio') {
    state.contractIds = ['obsolete'];
    rules.contractRatio = { numerator: level, denominator: 5 };
  } else if (factor === 'no-alternative') {
    state.board = {
      ...state.board,
      tasks: state.board.tasks
        .filter((task) => task.id === 'obsolete')
        .map((task) => ({ ...task, value: level })),
    };
  } else {
    rules.announceTick = level;
  }
  return { state, rules };
}

function runSensitivityStrategy(
  state: CancellationState,
  rules: CancellationRules,
  strategy: 'continue' | 'cancel',
): { state: CancellationState; cancelApplied: boolean; cancelRejected: boolean } {
  let cancelApplied = false;
  let cancelRejected = false;
  if (strategy === 'cancel') {
    while (state.board.tick < state.board.horizon && !cancelApplied && !cancelRejected) {
      const tried = applyCancellationPrototype(
        state,
        { kind: 'cancel', id: 'obsolete', reason: CANCEL_REASON },
        rules,
      );
      if (tried !== state) {
        state = tried;
        cancelApplied = true;
        break;
      }
      if (rules.announceTick !== null && state.board.tick < rules.announceTick) {
        const worked = applyCancellationPrototype(
          state,
          { kind: 'work', ids: workIds(state) },
          rules,
        );
        if (worked === state) break;
        state = worked;
        continue;
      }
      const obsolete = state.board.tasks.find((task) => task.id === 'obsolete');
      const stillOpen =
        obsolete !== undefined && obsolete.completedTick === null && obsolete.codingLeft > 0;
      if (!stillOpen) break;
      cancelRejected = true;
      while (state.board.tick < state.board.horizon) {
        const waited = applyCancellationPrototype(state, { kind: 'work', ids: [] }, rules);
        if (waited === state) break;
        state = waited;
      }
    }
  }
  while (state.board.tick < state.board.horizon) {
    const next = applyCancellationPrototype(state, { kind: 'work', ids: workIds(state) }, rules);
    if (next === state) break;
    state = next;
  }
  return { state, cancelApplied, cancelRejected };
}

/** 浅い投入の同じ盤面で要因を一つずつ動かし、固定戦略の出荷価値を比べる。 */
export function compareCancellationFactors(seed: string | number) {
  const results = FACTOR_ORDER.flatMap((factor) =>
    FACTOR_LEVELS[factor].flatMap((level) => {
      const prepared = prepareSensitivity(seed, factor, level);
      return (['continue', 'cancel'] as const).map((strategy) => {
        const initial = structuredClone(prepared.state);
        const outcome = runSensitivityStrategy(
          structuredClone(prepared.state),
          prepared.rules,
          strategy,
        );
        return {
          factor,
          level,
          strategy,
          rules: prepared.rules,
          cancelApplied: outcome.cancelApplied,
          cancelRejected: outcome.cancelRejected,
          initial,
          ...summarizeCancellation(outcome.state),
          inputs: outcome.state.inputs,
        };
      });
    }),
  );
  const judgments: FactorJudgment[] = [];
  for (let i = 0; i < results.length; i += 2) {
    const kept = results[i];
    const dropped = results[i + 1];
    if (
      !kept ||
      !dropped ||
      kept.strategy !== 'continue' ||
      dropped.strategy !== 'cancel' ||
      kept.factor !== dropped.factor ||
      kept.level !== dropped.level
    ) {
      throw new Error('比較は同じ要因の継続、中止の順で並べる');
    }
    const judgment: CancellationJudgment = dropped.cancelRejected
      ? 'cancel-unavailable'
      : kept.value === dropped.value
        ? 'tie'
        : dropped.value > kept.value
          ? 'cancel'
          : 'continue';
    judgments.push({
      factor: kept.factor,
      level: kept.level,
      judgment,
      continueValue: kept.value,
      cancelValue: dropped.value,
      continueDone: kept.doneCount,
      cancelDone: dropped.doneCount,
      continueFocus: kept.focus,
      cancelFocus: dropped.focus,
      continueTrust: kept.trust,
      cancelTrust: dropped.trust,
      valueGap: dropped.value - kept.value,
      trustSpent: kept.trust - dropped.trust,
    });
  }
  return {
    seed,
    investment: 'shallow' as const,
    metric: 'shipped-value' as const,
    humanPlay: false,
    adaptive: false,
    note: '固定戦略の出荷価値比較。中止は出荷・Done・価値に入れない。Focusと信頼の残量は同点を分けない。人間のプレイ評価ではない。',
    definitions: SENSITIVITY_DEFINITIONS,
    boundaries: FACTOR_ORDER.map((factor) => ({
      factor,
      cancel: judgments
        .filter((row) => row.factor === factor && row.judgment === 'cancel')
        .map((row) => row.level),
      continue: judgments
        .filter((row) => row.factor === factor && row.judgment === 'continue')
        .map((row) => row.level),
      tie: judgments
        .filter((row) => row.factor === factor && row.judgment === 'tie')
        .map((row) => row.level),
      unavailable: judgments
        .filter((row) => row.factor === factor && row.judgment === 'cancel-unavailable')
        .map((row) => row.level),
    })),
    judgments,
    results,
  };
}
