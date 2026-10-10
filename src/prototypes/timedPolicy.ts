/** RI-181: レビュー速度の時限乗算。期限が切れても恒久加算は戻さない。 */
export type TimedInput = { type: 'activate' | 'tick' };
export type TimedStrategy = 'hold' | 'early' | 'peak' | 'rearm';
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

function reviewInflow(tick: number): number {
  if (tick <= 3) return 1;
  if (tick <= 6) return 4;
  return 1;
}
export function createTimedPrototype(seed: number, horizon: number): TimedState {
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
    duration: DURATION,
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
    affected: state.affected,
  };
}
export function applyTimedInput(state: TimedState, input: TimedInput): TimedState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'activate' && (state.activeRemaining > 0 || state.focus < 1)) return state;
  const next = structuredClone(state);
  if (input.type === 'activate') {
    next.focus -= 1;
    next.focusSpent += 1;
    next.activations += 1;
    next.activeRemaining = next.duration;
  } else {
    next.tick += 1;
    const boosted = next.activeRemaining > 0;
    const reviewThroughput =
      (next.baseThroughput + next.permanentAdd) * (boosted ? next.multiplier : 1);
    next.reviewQueue += reviewInflow(next.tick);
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
    const initial = createTimedPrototype(1, horizon);
    let state = initial;
    while (state.tick < state.horizon) {
      const atStart = strategy === 'early' || strategy === 'rearm';
      const atPeak = strategy === 'peak' || strategy === 'rearm';
      if (state.activeRemaining === 0 && state.focus > 0) {
        if ((atStart && state.tick === 0) || (atPeak && state.tick === 3))
          state = applyTimedInput(state, { type: 'activate' });
      }
      state = applyTimedInput(state, { type: 'tick' });
    }
    return {
      horizon,
      seed: 1,
      strategy,
      initial,
      inputs: state.inputs,
      result: summarizeTimed(state),
    };
  });
}
