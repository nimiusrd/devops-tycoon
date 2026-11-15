/** RI-160: 通常ランから隔離した2便・期待損失の比較。乱数事故は扱わない。 */

export interface WindowTask {
  id: string;
  reviewCompletedTick: number;
  status: 'awaitingRelease' | 'published';
  verificationLeft: number;
  riskLoss: number;
  deadlineTick: number;
  onTimeValue: number;
  lateValue: number;
  publishedTick: number | null;
  value: number;
  loss: number;
}

/** 無いときは初回と同じ。確認完了で損失0、レビュー完了と同じtickの便には乗せる。 */
export interface WindowRules {
  /** 確認工数を使い切った公開に残す期待損失。 */
  verifiedLoss: number;
  /** false のとき、レビュー完了と同じtickの便には乗らない。 */
  reviewBeforeDeparture: boolean;
}

export const baselineWindowRules: WindowRules = {
  verifiedLoss: 0,
  reviewBeforeDeparture: true,
};

export interface WindowState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  departures: number[];
  tasks: WindowTask[];
  verificationWork: number;
  inputs: WindowInput[];
  /** 無いときは baselineWindowRules。初回の比較JSONはこのフィールドを持たない。 */
  rules?: WindowRules;
}

export interface WindowInput {
  verifyId?: string;
  holdIds: string[];
}

function rulesOf(state: WindowState): WindowRules {
  return {
    verifiedLoss: state.rules?.verifiedLoss ?? baselineWindowRules.verifiedLoss,
    reviewBeforeDeparture:
      state.rules?.reviewBeforeDeparture ?? baselineWindowRules.reviewBeforeDeparture,
  };
}

export function createWindowPrototype(seed: string | number, impact: 'low' | 'high'): WindowState {
  return {
    version: 1,
    seed,
    tick: 1,
    horizon: 6,
    departures: [2, 5],
    verificationWork: 0,
    inputs: [],
    tasks: [
      {
        id: 'change',
        reviewCompletedTick: 1,
        status: 'awaitingRelease',
        verificationLeft: 2,
        riskLoss: impact === 'low' ? 2 : 8,
        deadlineTick: 2,
        onTimeValue: 10,
        lateValue: 6,
        publishedTick: null,
        value: 0,
        loss: 0,
      },
    ],
  };
}

function reviewReady(rules: WindowRules, task: WindowTask, tick: number): boolean {
  return rules.reviewBeforeDeparture
    ? task.reviewCompletedTick <= tick
    : task.reviewCompletedTick < tick;
}

/** 1枠の確認を行い、tick終端で搭載。確認を使い切ったときだけ verifiedLoss にする。 */
export function tickWindowPrototype(state: WindowState, input: WindowInput): WindowState {
  const rules = rulesOf(state);
  const verifyTarget =
    input.verifyId === undefined
      ? undefined
      : state.tasks.find((task) => task.id === input.verifyId);
  if (
    state.tick >= state.horizon ||
    new Set(input.holdIds).size !== input.holdIds.length ||
    input.holdIds.some(
      (id) => !state.tasks.some((task) => task.id === id && task.status === 'awaitingRelease'),
    ) ||
    (input.verifyId !== undefined &&
      (verifyTarget === undefined ||
        verifyTarget.status !== 'awaitingRelease' ||
        verifyTarget.verificationLeft <= 0 ||
        state.tick < verifyTarget.reviewCompletedTick))
  )
    return state;
  const next = structuredClone(state);
  next.tick++;
  if (input.verifyId !== undefined) {
    next.tasks.find((task) => task.id === input.verifyId)!.verificationLeft--;
    next.verificationWork++;
  }
  if (next.departures.includes(next.tick))
    for (const task of next.tasks) {
      if (
        task.status !== 'awaitingRelease' ||
        input.holdIds.includes(task.id) ||
        !reviewReady(rules, task, next.tick)
      )
        continue;
      task.status = 'published';
      task.publishedTick = next.tick;
      task.value = next.tick <= task.deadlineTick ? task.onTimeValue : task.lateValue;
      task.loss = task.verificationLeft === 0 ? rules.verifiedLoss : task.riskLoss;
    }
  next.inputs.push(structuredClone(input));
  return next;
}

export function summarizeWindows(state: WindowState) {
  const published = state.tasks.filter((task) => task.status === 'published');
  return {
    tick: state.tick,
    reviewed: state.tasks.length,
    published: published.length,
    carryover: state.tasks
      .filter((task) => task.status === 'awaitingRelease')
      .map((task) => task.id),
    value: published.reduce((sum, task) => sum + task.value, 0),
    loss: published.reduce((sum, task) => sum + task.loss, 0),
    netValue: published.reduce((sum, task) => sum + task.value - task.loss, 0),
    verificationWork: state.verificationWork,
  };
}

export function compareWindowStrategies(seed: string | number) {
  return (['low', 'high'] as const).flatMap((impact) =>
    (['early', 'verify'] as const).map((strategy) => {
      const initial = createWindowPrototype(seed, impact);
      let state = initial;
      while (state.tick < state.horizon)
        state = tickWindowPrototype(state, {
          holdIds: strategy === 'verify' && state.tick < 2 ? ['change'] : [],
          ...(strategy === 'verify' && state.tick >= 2 && state.tick < 4
            ? { verifyId: 'change' }
            : {}),
        });
      return {
        impact,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeWindows(state),
        tasks: state.tasks,
      };
    }),
  );
}

interface FactorMove {
  factor: string;
  parameter: string;
  impact: 'low' | 'high' | null;
  riskLoss?: number;
  deadlineTick?: number;
  departures?: number[];
  reviewCompletedTick?: number;
  startTick?: number;
  verifiedLoss?: number;
  reviewBeforeDeparture?: boolean;
  /** 初便までに確認が終わるときだけ、今出すが便の前の枠を使う。 */
  useLeadTime?: boolean;
}

function createFactorBoard(seed: string | number, move: FactorMove, rival = false): WindowState {
  const state = createWindowPrototype(seed, move.impact ?? 'low');
  const task = state.tasks[0]!;
  if (move.riskLoss !== undefined) task.riskLoss = move.riskLoss;
  if (move.deadlineTick !== undefined) task.deadlineTick = move.deadlineTick;
  if (move.reviewCompletedTick !== undefined) task.reviewCompletedTick = move.reviewCompletedTick;
  if (move.startTick !== undefined) state.tick = move.startTick;
  if (move.departures !== undefined) state.departures = [...move.departures];
  if ((move.verifiedLoss ?? 0) !== 0 || move.reviewBeforeDeparture === false)
    state.rules = {
      verifiedLoss: move.verifiedLoss ?? 0,
      reviewBeforeDeparture: move.reviewBeforeDeparture ?? true,
    };
  if (rival) {
    const other = structuredClone(task);
    other.id = 'other';
    state.tasks.push(other);
  }
  return state;
}

function step(state: WindowState, input: WindowInput): WindowState {
  const next = tickWindowPrototype(state, input);
  if (next === state) throw new Error(`rejected input at tick ${state.tick}`);
  return next;
}

/** 今出すは保留も確認もしない。次便は初便だけ保留し、その後の2tickで change を確認する。 */
function runSingle(
  initial: WindowState,
  strategy: 'early' | 'verify',
  useLeadTime: boolean,
): WindowState {
  let state = initial;
  const first = Math.min(...initial.departures);
  const work = initial.tasks.find((task) => task.id === 'change')!.verificationLeft;
  while (state.tick < state.horizon) {
    const change = state.tasks.find((task) => task.id === 'change')!;
    const landing = state.tick + 1;
    const hold = strategy === 'verify' && landing === first && change.status === 'awaitingRelease';
    const lead =
      useLeadTime &&
      strategy === 'early' &&
      change.status === 'awaitingRelease' &&
      change.verificationLeft > 0 &&
      state.tick >= change.reviewCompletedTick &&
      change.verificationLeft <= first - state.tick;
    const verify =
      strategy === 'verify' &&
      change.status === 'awaitingRelease' &&
      change.verificationLeft > 0 &&
      state.tick >= change.reviewCompletedTick &&
      state.tick >= first &&
      state.tick < first + work;
    const verifyId = lead || verify ? 'change' : undefined;
    state = step(state, { holdIds: hold ? ['change'] : [], ...(verifyId ? { verifyId } : {}) });
  }
  return state;
}

type ContentionStrategy = 'all-early' | 'verify-change' | 'verify-other' | 'all-verify' | 'split';

/** 初回の時刻のまま。枠1では確認2工数の仕事を1件しか次便までに終えられない。 */
function contentionInput(tick: number, strategy: ContentionStrategy): WindowInput {
  if (strategy === 'all-early') return { holdIds: [] };
  if (strategy === 'verify-change') {
    if (tick === 1) return { holdIds: ['change'] };
    if (tick === 2 || tick === 3) return { holdIds: [], verifyId: 'change' };
    return { holdIds: [] };
  }
  if (strategy === 'verify-other') {
    if (tick === 1) return { holdIds: ['other'] };
    if (tick === 2 || tick === 3) return { holdIds: [], verifyId: 'other' };
    return { holdIds: [] };
  }
  if (strategy === 'all-verify') {
    if (tick === 1) return { holdIds: ['change', 'other'] };
    if (tick === 2 || tick === 3) return { holdIds: [], verifyId: 'change' };
    return { holdIds: [] };
  }
  if (tick === 1) return { holdIds: ['change', 'other'] };
  if (tick === 2) return { holdIds: [], verifyId: 'change' };
  if (tick === 3) return { holdIds: [], verifyId: 'other' };
  return { holdIds: [] };
}

function runContention(initial: WindowState, strategy: ContentionStrategy): WindowState {
  let state = initial;
  while (state.tick < state.horizon) state = step(state, contentionInput(state.tick, strategy));
  return state;
}

function finish(
  factor: string,
  parameter: string,
  impact: 'low' | 'high' | null,
  strategy: string,
  initial: WindowState,
  state: WindowState,
) {
  return {
    factor,
    parameter,
    impact,
    strategy,
    initial,
    inputs: state.inputs,
    result: summarizeWindows(state),
    tasks: state.tasks,
  };
}

const impacts = ['low', 'high'] as const;

const factorMoves: FactorMove[] = [
  ...[1, 2, 4, 5].flatMap((deadline) =>
    impacts.map((impact) => ({
      factor: 'deadline',
      parameter: String(deadline),
      impact,
      deadlineTick: deadline,
    })),
  ),
  ...[2, 3, 4, 5, 8].map((loss) => ({
    factor: 'riskLoss',
    parameter: String(loss),
    impact: null,
    riskLoss: loss,
  })),
  ...(
    [
      [2, 3],
      [2, 4],
      [2, 6],
      [2, 7],
      [3, 5],
      [4, 5],
    ] as const
  ).flatMap((departures) =>
    impacts.map((impact) => ({
      factor: 'departure',
      parameter: departures.join(','),
      impact,
      departures: [...departures],
    })),
  ),
  ...[
    { impact: 'low' as const, residual: 0 },
    { impact: 'low' as const, residual: 2 },
    { impact: 'high' as const, residual: 0 },
    { impact: 'high' as const, residual: 3 },
    { impact: 'high' as const, residual: 4 },
    { impact: 'high' as const, residual: 5 },
    { impact: 'high' as const, residual: 8 },
  ].map(({ impact, residual }) => ({
    factor: 'verificationFailure',
    parameter: String(residual),
    impact,
    verifiedLoss: residual,
  })),
  ...impacts.flatMap((impact) => [
    {
      factor: 'sameDayOrder',
      parameter: 'review1-after',
      impact,
      reviewBeforeDeparture: false,
    },
    {
      factor: 'sameDayOrder',
      parameter: 'review2-before',
      impact,
      reviewCompletedTick: 2,
    },
    {
      factor: 'sameDayOrder',
      parameter: 'review2-after',
      impact,
      reviewCompletedTick: 2,
      reviewBeforeDeparture: false,
    },
  ]),
  ...[1, 0, -1].flatMap((start) =>
    impacts.map((impact) => ({
      factor: 'earlyReview',
      parameter: String(start),
      impact,
      startTick: start,
      reviewCompletedTick: start,
      useLeadTime: true,
    })),
  ),
];

const contentionStrategies = [
  'all-early',
  'verify-change',
  'verify-other',
  'all-verify',
  'split',
] as const;

/** 初回の低高対比は繰り返さない。各要因は対照の資源から一つだけ動かす。 */
export function compareReleaseFactorReversals(seed: string | number) {
  const single = factorMoves.flatMap((move) =>
    (['early', 'verify'] as const).map((strategy) => {
      const initial = createFactorBoard(seed, move);
      const state = runSingle(initial, strategy, move.useLeadTime === true);
      return finish(move.factor, move.parameter, move.impact, strategy, initial, state);
    }),
  );
  const contention = impacts.flatMap((impact) =>
    contentionStrategies.map((strategy) => {
      const initial = createFactorBoard(
        seed,
        { factor: 'contention', parameter: 'rival', impact },
        true,
      );
      const state = runContention(initial, strategy);
      return finish('contention', 'rival', impact, strategy, initial, state);
    }),
  );
  return [...single, ...contention];
}
