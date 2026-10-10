import { createRng } from '../sim/rng';

/** RI-174: 20%→100%の二段階。公開開始前に固定したイベントをtickで観測する。 */
export type RolloutSignal = 'pending' | 'healthy' | 'anomaly';
export type RolloutInput = { type: 'check' | 'expand' | 'stop' | 'tick' };
export interface RolloutState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  impact: number;
  defect: boolean;
  signalAtTick: number;
  signal: RolloutSignal;
  checkedSignal: RolloutSignal;
  checkedTick: number | null;
  stage: 'pilot' | 'full' | 'stopped';
  focus: number;
  focusSpent: number;
  earnedValue: number;
  customerLoss: number;
  inputs: RolloutInput[];
}
export function createRolloutPrototype(seed: number, horizon = 6, impact = 4): RolloutState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    impact,
    defect: createRng(seed)() < 0.5,
    signalAtTick: 2,
    signal: 'pending',
    checkedSignal: 'pending',
    checkedTick: null,
    stage: 'pilot',
    focus: 2,
    focusSpent: 0,
    earnedValue: 0,
    customerLoss: 0,
    inputs: [],
  };
}
export function viewRollout(state: RolloutState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    stage: state.stage,
    checkedSignal: state.checkedSignal,
    checkedTick: state.checkedTick,
    focus: state.focus,
    stages: [
      {
        stage: 'pilot',
        reachPercent: 20,
        valuePerHealthyTick: 1,
        maxCustomerLoss: 4 * state.impact,
      },
      {
        stage: 'full',
        reachPercent: 100,
        valuePerHealthyTick: 5,
        maxCustomerLoss: 20 * state.impact,
      },
    ],
  };
}
export function applyRolloutInput(state: RolloutState, input: RolloutInput): RolloutState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'expand' && (state.stage !== 'pilot' || state.focus < 1)) return state;
  if (input.type === 'stop' && (state.stage === 'stopped' || state.focus < 1)) return state;
  if (input.type === 'check' && (state.stage === 'stopped' || state.checkedTick === state.tick))
    return state;
  const next = structuredClone(state);
  if (input.type === 'check') {
    next.checkedSignal = next.signal;
    next.checkedTick = next.tick;
  } else if (input.type === 'expand' || input.type === 'stop') {
    next.stage = input.type === 'expand' ? 'full' : 'stopped';
    next.focus--;
    next.focusSpent++;
  } else {
    next.tick++;
    if (next.stage !== 'stopped') {
      if (next.tick >= next.signalAtTick) next.signal = next.defect ? 'anomaly' : 'healthy';
      const scale = next.stage === 'pilot' ? 1 : 5;
      if (next.signal === 'anomaly') {
        const cap = (next.stage === 'pilot' ? 4 : 20) * next.impact;
        next.customerLoss = Math.min(cap, next.customerLoss + scale * next.impact);
      } else next.earnedValue += scale;
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeRollout(state: RolloutState) {
  return {
    stage: state.stage,
    reachPercent: state.stage === 'pilot' ? 20 : state.stage === 'full' ? 100 : 0,
    checkedSignal: state.checkedSignal,
    checkedTick: state.checkedTick,
    earnedValue: state.earnedValue,
    customerLoss: state.customerLoss,
    focusSpent: state.focusSpent,
    netValue: state.earnedValue - state.customerLoss - state.focusSpent,
  };
}
export function compareRolloutStrategies() {
  return [
    { horizon: 2, impact: 1 },
    { horizon: 6, impact: 4 },
  ].flatMap(({ horizon, impact }) =>
    [0, 1].flatMap((seed) =>
      (['immediate', 'observe-decide', 'observe-forever', 'stop-now'] as const).map((strategy) => {
        const initial = createRolloutPrototype(seed, horizon, impact);
        let state =
          strategy === 'immediate'
            ? applyRolloutInput(initial, { type: 'expand' })
            : strategy === 'stop-now'
              ? applyRolloutInput(initial, { type: 'stop' })
              : initial;
        while (state.tick < state.horizon) {
          if (strategy === 'observe-decide' && state.stage === 'pilot' && state.tick === 2) {
            state = applyRolloutInput(state, { type: 'check' });
            state = applyRolloutInput(state, {
              type: state.checkedSignal === 'anomaly' ? 'stop' : 'expand',
            });
          }
          state = applyRolloutInput(state, { type: 'tick' });
        }
        return {
          horizon,
          impact,
          seed,
          strategy,
          initial,
          inputs: state.inputs,
          result: summarizeRollout(state),
        };
      }),
    ),
  );
}
