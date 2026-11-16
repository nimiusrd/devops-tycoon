import { createRng } from '../sim/rng';

/** RI-174: 20%→100%の二段階。公開開始前に固定したイベントをtickで観測する。 */
export type RolloutSignal = 'pending' | 'healthy' | 'anomaly';
export type RolloutInput = { type: 'check' | 'expand' | 'stop' | 'tick' };
export type RolloutStrategy = 'immediate' | 'observe-decide' | 'observe-forever' | 'stop-now';
/** 初期状態の形は変えない。未指定時は不具合率0.5、兆候tick 2。 */
export interface RolloutFactors {
  defectRate?: number;
  signalAtTick?: number;
}
export type RolloutSensitivityFactor =
  'baseline' | 'defectRate' | 'signalAtTick' | 'impactPerValue';
/** 段階のtick係数。健全時の成果であり、異常時の損失は係数×影響倍率。 */
export const ROLLOUT_PILOT_SCALE = 1;
export const ROLLOUT_FULL_SCALE = 5;
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
export function createRolloutPrototype(
  seed: number,
  horizon = 6,
  impact = 4,
  factors: RolloutFactors = {},
): RolloutState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    impact,
    defect: createRng(seed)() < (factors.defectRate ?? 0.5),
    signalAtTick: factors.signalAtTick ?? 2,
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
        valuePerHealthyTick: ROLLOUT_PILOT_SCALE,
        maxCustomerLoss: 4 * state.impact,
      },
      {
        stage: 'full',
        reachPercent: 100,
        valuePerHealthyTick: ROLLOUT_FULL_SCALE,
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
      const scale = next.stage === 'pilot' ? ROLLOUT_PILOT_SCALE : ROLLOUT_FULL_SCALE;
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
/** 観察判断は兆候tickに到達したあと、次のtickの前に checkedSignal だけを見る。 */
export function runRolloutStrategy(initial: RolloutState, strategy: RolloutStrategy): RolloutState {
  let state =
    strategy === 'immediate'
      ? applyRolloutInput(initial, { type: 'expand' })
      : strategy === 'stop-now'
        ? applyRolloutInput(initial, { type: 'stop' })
        : initial;
  while (state.tick < state.horizon) {
    if (
      strategy === 'observe-decide' &&
      state.stage === 'pilot' &&
      state.tick === state.signalAtTick
    ) {
      state = applyRolloutInput(state, { type: 'check' });
      state = applyRolloutInput(state, {
        type: state.checkedSignal === 'anomaly' ? 'stop' : 'expand',
      });
    }
    state = applyRolloutInput(state, { type: 'tick' });
  }
  return state;
}
export function compareRolloutStrategies() {
  return [
    { horizon: 2, impact: 1 },
    { horizon: 6, impact: 4 },
  ].flatMap(({ horizon, impact }) =>
    [0, 1].flatMap((seed) =>
      (['immediate', 'observe-decide', 'observe-forever', 'stop-now'] as const).map((strategy) => {
        const initial = createRolloutPrototype(seed, horizon, impact);
        const state = runRolloutStrategy(initial, strategy);
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

/** 期末6・seed 0/1。初回の期末2×影響4の組は含めない。 */
export const ROLLOUT_FACTOR_BASELINE = {
  horizon: 6,
  impact: 1,
  defectRate: 0.5,
  signalAtTick: 2,
} as const;

export const ROLLOUT_FACTOR_SCENARIOS: readonly {
  factor: RolloutSensitivityFactor;
  horizon: number;
  impact: number;
  defectRate: number;
  signalAtTick: number;
}[] = [
  { factor: 'baseline', ...ROLLOUT_FACTOR_BASELINE },
  { factor: 'defectRate', ...ROLLOUT_FACTOR_BASELINE, defectRate: 0.2 },
  { factor: 'defectRate', ...ROLLOUT_FACTOR_BASELINE, defectRate: 1 },
  { factor: 'signalAtTick', ...ROLLOUT_FACTOR_BASELINE, signalAtTick: 1 },
  { factor: 'signalAtTick', ...ROLLOUT_FACTOR_BASELINE, signalAtTick: 3 },
  { factor: 'impactPerValue', ...ROLLOUT_FACTOR_BASELINE, impact: 0.5 },
  { factor: 'impactPerValue', ...ROLLOUT_FACTOR_BASELINE, impact: 2 },
];

export function compareRolloutFactorSensitivity() {
  return ROLLOUT_FACTOR_SCENARIOS.flatMap((scenario) =>
    [0, 1].flatMap((seed) =>
      (['immediate', 'observe-decide'] as const).map((strategy) => {
        const initial = createRolloutPrototype(seed, scenario.horizon, scenario.impact, {
          defectRate: scenario.defectRate,
          signalAtTick: scenario.signalAtTick,
        });
        const state = runRolloutStrategy(initial, strategy);
        return {
          factor: scenario.factor,
          horizon: scenario.horizon,
          impact: scenario.impact,
          defectRate: scenario.defectRate,
          signalAtTick: scenario.signalAtTick,
          valuePerHealthyPilotTick: ROLLOUT_PILOT_SCALE,
          valuePerHealthyFullTick: ROLLOUT_FULL_SCALE,
          impactPerValue: scenario.impact / ROLLOUT_PILOT_SCALE,
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
