/** RI-181: レビュー速度の時限乗算。期限が切れても恒久加算は戻さない。再発動は費用と回数上限を持つ。 */
export type TimedInput = { type: 'activate' | 'tick' };
export type TimedStrategy = 'hold' | 'early' | 'peak' | 'rearm';
export type TimedSensitivityStrategy = 'hold' | 'early' | 'peak';
export type TimedSensitivityFactor = 'duration' | 'foreshadowing';
export interface TimedEffect {
  tick: number;
  lane: 'review';
  throughput: number;
}
export interface TimedState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  focus: number;
  focusSpent: number;
  baseThroughput: number;
  permanentAdd: number;
  multiplier: number;
  duration: number;
  activeRemaining: number;
  reviewQueue: number;
  codingQueue: number;
  earnedReview: number;
  earnedCoding: number;
  activations: number;
  affected: TimedEffect[];
  inputs: TimedInput[];
}
const DURATION = 3;
const MULTIPLIER = 2;
/** 山場流入が始まるtick。盤面の流入列は変えない。 */
export const TIMED_PEAK_START_TICK = 4;
/** 初回比較の予兆。このtick数だけ山場より早く見え、山場戦略は見えたtickで即発動する。 */
export const TIMED_BASELINE_FORESHADOWING = 1;
export const TIMED_ACTIVATION_COST = 1;
export const TIMED_REACTIVATION_COST = 1;
export const TIMED_ACTIVATION_CAP = 2;
export const TIMED_DURATION_SWEEP = [1, 2, 3, 4, 5, 6];
export const TIMED_FORESHADOWING_SWEEP = [0, 1, 2, 3, 4];

export function reviewInflowAt(tick: number): number {
  if (tick <= 3) return 1;
  if (tick <= 6) return 4;
  return 1;
}
function activationCostFor(state: TimedState): number {
  return state.activations === 0 ? TIMED_ACTIVATION_COST : TIMED_REACTIVATION_COST;
}
/** 予兆0は山場tickの処理後。予兆が山場開始以上ならスプリント開始tickへ寄せる。 */
export function peakSignalTick(foreshadowing: number): number {
  if (foreshadowing <= 0) return TIMED_PEAK_START_TICK;
  return Math.max(0, TIMED_PEAK_START_TICK - foreshadowing);
}
export function createTimedPrototype(
  seed: number,
  horizon: number,
  duration = DURATION,
): TimedState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    focus: 2,
    focusSpent: 0,
    baseThroughput: 1,
    permanentAdd: 1,
    multiplier: MULTIPLIER,
    duration,
    activeRemaining: 0,
    reviewQueue: 0,
    codingQueue: 0,
    earnedReview: 0,
    earnedCoding: 0,
    activations: 0,
    affected: [],
    inputs: [],
  };
}
export function viewTimed(state: TimedState) {
  const active = state.activeRemaining > 0;
  const nextActivationCost = activationCostFor(state);
  return {
    tick: state.tick,
    horizon: state.horizon,
    focus: state.focus,
    duration: state.duration,
    remaining: state.activeRemaining,
    active,
    permanentAdd: state.permanentAdd,
    reviewThroughput: (state.baseThroughput + state.permanentAdd) * (active ? state.multiplier : 1),
    codingThroughput: state.baseThroughput,
    activationCost: TIMED_ACTIVATION_COST,
    reactivationCost: TIMED_REACTIVATION_COST,
    activationCap: TIMED_ACTIVATION_CAP,
    nextActivationCost,
    activations: state.activations,
    canActivate:
      state.tick < state.horizon &&
      state.activeRemaining === 0 &&
      state.activations < TIMED_ACTIVATION_CAP &&
      state.focus >= nextActivationCost,
    affected: state.affected.map((item) => ({ ...item })),
  };
}
export function applyTimedInput(state: TimedState, input: TimedInput): TimedState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'activate') {
    if (state.activeRemaining > 0) return state;
    if (state.activations >= TIMED_ACTIVATION_CAP) return state;
    if (state.focus < activationCostFor(state)) return state;
  }
  const next = structuredClone(state);
  if (input.type === 'activate') {
    const cost = activationCostFor(next);
    next.focus -= cost;
    next.focusSpent += cost;
    next.activations += 1;
    next.activeRemaining = next.duration;
  } else {
    next.tick += 1;
    const boosted = next.activeRemaining > 0;
    const reviewThroughput =
      (next.baseThroughput + next.permanentAdd) * (boosted ? next.multiplier : 1);
    next.reviewQueue += reviewInflowAt(next.tick);
    next.codingQueue += 1;
    const clearedReview = Math.min(next.reviewQueue, reviewThroughput);
    const clearedCoding = Math.min(next.codingQueue, next.baseThroughput);
    next.reviewQueue -= clearedReview;
    next.codingQueue -= clearedCoding;
    next.earnedReview += clearedReview;
    next.earnedCoding += clearedCoding;
    if (boosted) {
      next.affected.push({ tick: next.tick, lane: 'review', throughput: reviewThroughput });
      next.activeRemaining -= 1;
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeTimed(state: TimedState) {
  return {
    earnedReview: state.earnedReview,
    earnedCoding: state.earnedCoding,
    reviewQueue: state.reviewQueue,
    focusSpent: state.focusSpent,
    activations: state.activations,
    remaining: state.activeRemaining,
    affectedTicks: state.affected.map((item) => item.tick),
    netValue: state.earnedReview + state.earnedCoding - state.focusSpent,
  };
}
export interface TimedRun {
  horizon: number;
  seed: number;
  strategy: TimedStrategy;
  duration: number;
  foreshadowing: number;
  reviewInflow: number[];
  codingInflowPerTick: number;
  initial: TimedState;
  inputs: TimedInput[];
  result: ReturnType<typeof summarizeTimed>;
}
export function runTimedStrategy(
  horizon: number,
  strategy: TimedStrategy,
  duration = DURATION,
  foreshadowing = TIMED_BASELINE_FORESHADOWING,
  seed = 1,
): TimedRun {
  const initial = createTimedPrototype(seed, horizon, duration);
  let state = structuredClone(initial);
  const signal = peakSignalTick(foreshadowing);
  while (state.tick < state.horizon) {
    const atStart = strategy === 'early' || strategy === 'rearm';
    const atPeak = strategy === 'peak' || strategy === 'rearm';
    if (state.activeRemaining === 0 && state.focus > 0) {
      if ((atStart && state.tick === 0) || (atPeak && state.tick === signal)) {
        state = applyTimedInput(state, { type: 'activate' });
      }
    }
    state = applyTimedInput(state, { type: 'tick' });
  }
  return {
    horizon,
    seed,
    strategy,
    duration,
    foreshadowing,
    reviewInflow: Array.from({ length: horizon }, (_, index) => reviewInflowAt(index + 1)),
    codingInflowPerTick: 1,
    initial,
    inputs: state.inputs,
    result: summarizeTimed(state),
  };
}
export function compareTimedStrategies() {
  const plans: { horizon: number; strategy: TimedStrategy }[] = [
    { horizon: 3, strategy: 'hold' },
    { horizon: 3, strategy: 'early' },
    { horizon: 8, strategy: 'hold' },
    { horizon: 8, strategy: 'early' },
    { horizon: 8, strategy: 'peak' },
    { horizon: 8, strategy: 'rearm' },
  ];
  return plans.map(({ horizon, strategy }) => {
    const run = runTimedStrategy(horizon, strategy);
    return {
      horizon: run.horizon,
      seed: run.seed,
      strategy: run.strategy,
      reviewInflow: run.reviewInflow,
      codingInflowPerTick: run.codingInflowPerTick,
      initial: run.initial,
      inputs: run.inputs,
      result: run.result,
    };
  });
}
/** 費用も上限も払わず毎tick効果を張り直した反実仮想。applyTimedInputでは到達できない。 */
export function projectUngatedAlwaysBoosted(seed = 1, horizon = 8): TimedState {
  let state = createTimedPrototype(seed, horizon);
  while (state.tick < state.horizon) {
    const forced = structuredClone(state);
    forced.activeRemaining = 1;
    state = applyTimedInput(forced, { type: 'tick' });
  }
  return state;
}
const SENSITIVITY_STRATEGIES: TimedSensitivityStrategy[] = ['hold', 'early', 'peak'];
const SENSITIVITY_HORIZONS = [3, 8];
const TIE_RANK: Record<TimedSensitivityStrategy, number> = { hold: 0, peak: 1, early: 2 };

export interface TimedSensitivityRow extends TimedRun {
  varied: TimedSensitivityFactor;
  variedValue: number;
  strategy: TimedSensitivityStrategy;
}
export interface TimedRanking {
  varied: TimedSensitivityFactor;
  horizon: number;
  value: number;
  duration: number;
  foreshadowing: number;
  peakSignalTick: number;
  nets: Record<TimedSensitivityStrategy, number>;
  activations: Record<TimedSensitivityStrategy, number>;
  order: string;
  reversed: boolean;
}
function formatOrder(nets: Record<TimedSensitivityStrategy, number>): string {
  const ranked = [...SENSITIVITY_STRATEGIES].sort(
    (left, right) => nets[right] - nets[left] || TIE_RANK[left] - TIE_RANK[right],
  );
  const groups: string[] = [];
  let current: TimedSensitivityStrategy[] = [ranked[0]];
  for (let index = 1; index < ranked.length; index += 1) {
    const strategy = ranked[index];
    if (nets[strategy] === nets[ranked[index - 1]]) current.push(strategy);
    else {
      groups.push(current.join(' = '));
      current = [strategy];
    }
  }
  groups.push(current.join(' = '));
  return groups.join(' > ');
}
function collectSweep(varied: TimedSensitivityFactor, values: number[]): TimedSensitivityRow[] {
  return values.flatMap((value) =>
    SENSITIVITY_HORIZONS.flatMap((horizon) =>
      SENSITIVITY_STRATEGIES.map((strategy) => {
        const duration = varied === 'duration' ? value : DURATION;
        const foreshadowing = varied === 'foreshadowing' ? value : TIMED_BASELINE_FORESHADOWING;
        const run = runTimedStrategy(horizon, strategy, duration, foreshadowing);
        return { ...run, varied, variedValue: value, strategy };
      }),
    ),
  );
}
function rankingsFor(
  varied: TimedSensitivityFactor,
  rows: TimedSensitivityRow[],
  values: number[],
  baselineOrders: Record<number, string>,
): TimedRanking[] {
  return SENSITIVITY_HORIZONS.flatMap((horizon) =>
    values.map((value) => {
      const selected = rows.filter((row) => row.horizon === horizon && row.variedValue === value);
      const nets = { hold: Number.NaN, early: Number.NaN, peak: Number.NaN };
      const activations = { hold: Number.NaN, early: Number.NaN, peak: Number.NaN };
      for (const row of selected) {
        nets[row.strategy] = row.result.netValue;
        activations[row.strategy] = row.result.activations;
      }
      if (SENSITIVITY_STRATEGIES.some((strategy) => Number.isNaN(nets[strategy]))) {
        throw new Error(`missing sensitivity row: ${varied} ${horizon} ${value}`);
      }
      const duration = varied === 'duration' ? value : DURATION;
      const foreshadowing = varied === 'foreshadowing' ? value : TIMED_BASELINE_FORESHADOWING;
      const order = formatOrder(nets);
      return {
        varied,
        horizon,
        value,
        duration,
        foreshadowing,
        peakSignalTick: peakSignalTick(foreshadowing),
        nets,
        activations,
        order,
        reversed: order !== baselineOrders[horizon],
      };
    }),
  );
}
function runCappedSpam() {
  const seed = 1;
  const horizon = 8;
  const duration = 1;
  const focus = 8;
  const initial = { ...createTimedPrototype(seed, horizon, duration), focus };
  let state = structuredClone(initial);
  let activateAttempts = 0;
  while (state.tick < state.horizon) {
    activateAttempts += 1;
    state = applyTimedInput(state, { type: 'activate' });
    state = applyTimedInput(state, { type: 'tick' });
  }
  return {
    legal: {
      seed,
      horizon,
      duration,
      focus,
      activateAttempts,
      activationCost: TIMED_ACTIVATION_COST,
      reactivationCost: TIMED_REACTIVATION_COST,
      activationCap: TIMED_ACTIVATION_CAP,
      initial,
      inputs: state.inputs,
      result: summarizeTimed(state),
    },
    ungatedAlwaysBoosted: {
      legal: false as const,
      seed,
      horizon,
      result: summarizeTimed(projectUngatedAlwaysBoosted(seed, horizon)),
    },
  };
}
export function compareTimedSensitivity() {
  const durationSweep = collectSweep('duration', TIMED_DURATION_SWEEP);
  const foreshadowingSweep = collectSweep('foreshadowing', TIMED_FORESHADOWING_SWEEP);
  const baselineOrders = Object.fromEntries(
    SENSITIVITY_HORIZONS.map((horizon) => {
      const rows = durationSweep.filter(
        (row) => row.horizon === horizon && row.variedValue === DURATION,
      );
      const nets = {
        hold: rows.find((row) => row.strategy === 'hold')!.result.netValue,
        early: rows.find((row) => row.strategy === 'early')!.result.netValue,
        peak: rows.find((row) => row.strategy === 'peak')!.result.netValue,
      };
      return [horizon, formatOrder(nets)];
    }),
  );
  const horizon8Inflow = Array.from({ length: 8 }, (_, index) => reviewInflowAt(index + 1));
  return {
    board: {
      seed: 1,
      horizons: SENSITIVITY_HORIZONS,
      peakStartTick: TIMED_PEAK_START_TICK,
      baselineDuration: DURATION,
      baselineForeshadowing: TIMED_BASELINE_FORESHADOWING,
      multiplier: MULTIPLIER,
      baseThroughput: 1,
      permanentAdd: 1,
      initialFocus: 2,
      activationCost: TIMED_ACTIVATION_COST,
      reactivationCost: TIMED_REACTIVATION_COST,
      activationCap: TIMED_ACTIVATION_CAP,
      codingInflowPerTick: 1,
      reviewInflowHorizon3: horizon8Inflow.slice(0, 3),
      reviewInflowHorizon8: horizon8Inflow,
      fixedStrategies: true,
      humanPlaytest: false,
      baselineOrders,
    },
    durationSweep,
    foreshadowingSweep,
    rankings: [
      ...rankingsFor('duration', durationSweep, TIMED_DURATION_SWEEP, baselineOrders),
      ...rankingsFor(
        'foreshadowing',
        foreshadowingSweep,
        TIMED_FORESHADOWING_SWEEP,
        baselineOrders,
      ),
    ],
    reactivation: runCappedSpam(),
  };
}
