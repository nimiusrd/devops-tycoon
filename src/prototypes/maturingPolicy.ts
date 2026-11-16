/** RI-185: 新しいレビュー完了だけで成熟する。カードlevelとは別の段階。 */
export type MatureCard = 'none' | 'steady' | 'growing';
export type MatureStrategy = MatureCard;
export type MatureInput =
  { type: 'adopt'; card: 'steady' | 'growing' } | { type: 'rework' | 'tick' };
export interface MatureState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  focus: number;
  focusSpent: number;
  card: MatureCard;
  cardLevel: number;
  stage: 0 | 1;
  progress: number;
  nextId: number;
  completedIds: string[];
  earnedValue: number;
  reworks: number;
  inputs: MatureInput[];
  /** 無いときは必要件数3、段階1の速度3、即効の速度2。初回の比較JSONはこのフィールドを持たない。 */
  factors?: MatureFactors;
}
/** 初回比較の係数。感度ではこのうち一つだけを変える。 */
export const MATURE_BASELINE = {
  matureAt: 3,
  stage1Throughput: 3,
  steadyThroughput: 2,
} as const;
export type MatureFactors = {
  [Key in keyof typeof MATURE_BASELINE]: number;
};

function copyFactors(factors: MatureFactors): MatureFactors {
  return {
    matureAt: factors.matureAt,
    stage1Throughput: factors.stage1Throughput,
    steadyThroughput: factors.steadyThroughput,
  };
}
function factorsOf(state: MatureState): MatureFactors {
  return state.factors ?? MATURE_BASELINE;
}
export function throughputFor(state: MatureState): number {
  const factors = factorsOf(state);
  if (state.card === 'steady') return factors.steadyThroughput;
  if (state.card === 'growing' && state.stage === 1) return factors.stage1Throughput;
  return 1;
}
export function createMaturePrototype(
  seed: number,
  horizon: number,
  factors?: MatureFactors,
): MatureState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    focus: 1,
    focusSpent: 0,
    card: 'none',
    cardLevel: 0,
    stage: 0,
    progress: 0,
    nextId: 1,
    completedIds: [],
    earnedValue: 0,
    reworks: 0,
    inputs: [],
    ...(factors ? { factors: copyFactors(factors) } : {}),
  };
}
export function viewMature(state: MatureState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    focus: state.focus,
    card: state.card,
    cardLevel: state.cardLevel,
    stage: state.stage,
    progress: state.progress,
    nextAt: state.card === 'growing' && state.stage === 0 ? factorsOf(state).matureAt : null,
    throughput: throughputFor(state),
    completed: state.completedIds.length,
    reworks: state.reworks,
  };
}
export function applyMatureInput(state: MatureState, input: MatureInput): MatureState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'adopt' && (state.card !== 'none' || state.focus < 1)) return state;
  if (input.type === 'rework' && state.completedIds.length === 0) return state;
  const next = structuredClone(state);
  if (input.type === 'adopt') {
    next.focus -= 1;
    next.focusSpent += 1;
    next.card = input.card;
  } else if (input.type === 'rework') {
    next.tick += 1;
    next.reworks += 1;
  } else {
    next.tick += 1;
    const matureAt = factorsOf(next).matureAt;
    const amount = throughputFor(next);
    for (let i = 0; i < amount; i++) {
      const id = `r${next.nextId}`;
      next.nextId += 1;
      if (next.completedIds.includes(id)) continue;
      next.completedIds.push(id);
      next.earnedValue += 1;
      if (next.card === 'growing' && next.stage === 0 && next.progress < matureAt)
        next.progress += 1;
    }
    if (next.card === 'growing' && next.progress >= matureAt) next.stage = 1;
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeMature(state: MatureState) {
  return {
    card: state.card,
    cardLevel: state.cardLevel,
    stage: state.stage,
    progress: state.progress,
    completed: state.completedIds.length,
    reworks: state.reworks,
    earnedValue: state.earnedValue,
    focusSpent: state.focusSpent,
    netValue: state.earnedValue - state.focusSpent,
  };
}
export function compareMatureStrategies() {
  const plans: { horizon: number; strategy: MatureStrategy }[] = [
    { horizon: 4, strategy: 'none' },
    { horizon: 4, strategy: 'steady' },
    { horizon: 4, strategy: 'growing' },
    { horizon: 10, strategy: 'none' },
    { horizon: 10, strategy: 'steady' },
    { horizon: 10, strategy: 'growing' },
  ];
  return plans.map(({ horizon, strategy }) => {
    const initial = createMaturePrototype(1, horizon);
    let state = initial;
    if (strategy !== 'none') state = applyMatureInput(state, { type: 'adopt', card: strategy });
    while (state.tick < state.horizon) state = applyMatureInput(state, { type: 'tick' });
    return {
      horizon,
      seed: 1,
      strategy,
      initial,
      inputs: state.inputs,
      result: summarizeMature(state),
    };
  });
}

export type MatureFactorName = keyof MatureFactors;
export type MatureHorizon = 4 | 10;
export type MaturePreference = 'steady' | 'growing' | 'tie';
const MATURE_HORIZONS = [4, 10] as const;
const MATURE_FACTORS = ['matureAt', 'stage1Throughput', 'steadyThroughput'] as const;
const FACTOR_VALUES: Record<MatureFactorName, readonly number[]> = {
  matureAt: [1, 2, 3, 4, 5, 6, 7],
  stage1Throughput: [1, 2, 3, 4, 5, 6],
  steadyThroughput: [1, 2, 3],
};

export interface MatureFactorRun {
  inputs: MatureInput[];
  result: ReturnType<typeof summarizeMature>;
}
export interface MatureFactorPoint {
  axis: MatureFactorName;
  horizon: MatureHorizon;
  parameter: number;
  factors: MatureFactors;
  preference: MaturePreference;
  /** 育成の差引から即効の差引を引いた値。正なら育成が上。 */
  margin: number;
  runs: { steady: MatureFactorRun; growing: MatureFactorRun };
}
export interface MatureFactorReversal {
  axis: MatureFactorName;
  horizon: MatureHorizon;
  before: { parameter: number; preference: MaturePreference; steady: number; growing: number };
  after: { parameter: number; preference: MaturePreference; steady: number; growing: number };
}

function preferenceOf(steady: number, growing: number): MaturePreference {
  if (growing > steady) return 'growing';
  if (steady > growing) return 'steady';
  return 'tie';
}
function runFixed(
  horizon: MatureHorizon,
  strategy: 'steady' | 'growing',
  factors: MatureFactors,
): MatureFactorRun {
  let state = createMaturePrototype(1, horizon, factors);
  state = applyMatureInput(state, { type: 'adopt', card: strategy });
  while (state.tick < state.horizon) state = applyMatureInput(state, { type: 'tick' });
  return { inputs: state.inputs, result: summarizeMature(state) };
}
function factorPoint(
  axis: MatureFactorName,
  horizon: MatureHorizon,
  parameter: number,
): MatureFactorPoint {
  const factors = copyFactors({ ...MATURE_BASELINE, [axis]: parameter });
  const steady = runFixed(horizon, 'steady', factors);
  const growing = runFixed(horizon, 'growing', factors);
  return {
    axis,
    horizon,
    parameter,
    factors,
    preference: preferenceOf(steady.result.netValue, growing.result.netValue),
    margin: growing.result.netValue - steady.result.netValue,
    runs: { steady, growing },
  };
}
function reversalsOf(rows: MatureFactorPoint[]): MatureFactorReversal[] {
  const found: MatureFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      horizon: before.horizon,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        steady: before.runs.steady.result.netValue,
        growing: before.runs.growing.result.netValue,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        steady: after.runs.steady.result.netValue,
        growing: after.runs.growing.result.netValue,
      },
    });
  }
  return found;
}

/** 初回と同じ資源で、成熟件数・段階1の速度・即効の速度を一つずつ動かす。固定戦略。 */
export function compareMatureSensitivity() {
  const sweeps = {
    matureAt: { 4: [] as MatureFactorPoint[], 10: [] as MatureFactorPoint[] },
    stage1Throughput: { 4: [] as MatureFactorPoint[], 10: [] as MatureFactorPoint[] },
    steadyThroughput: { 4: [] as MatureFactorPoint[], 10: [] as MatureFactorPoint[] },
  };
  for (const axis of MATURE_FACTORS) {
    for (const horizon of MATURE_HORIZONS) {
      sweeps[axis][horizon] = FACTOR_VALUES[axis].map((parameter) =>
        factorPoint(axis, horizon, parameter),
      );
    }
  }
  return {
    conditions: {
      seed: 1,
      horizons: [...MATURE_HORIZONS],
      focus: 1,
      adoptCost: 1,
      adoptAdvancesTime: false,
      valuePerCompletion: 1,
      stage0Throughput: 1,
      noneThroughput: 1,
      plan: 'adopt-then-tick',
      score: 'netValue',
      baseline: copyFactors(MATURE_BASELINE),
      swept: {
        matureAt: [...FACTOR_VALUES.matureAt],
        stage1Throughput: [...FACTOR_VALUES.stage1Throughput],
        steadyThroughput: [...FACTOR_VALUES.steadyThroughput],
      },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
    },
    sweeps,
    reversals: MATURE_FACTORS.flatMap((axis) =>
      MATURE_HORIZONS.flatMap((horizon) => reversalsOf(sweeps[axis][horizon])),
    ),
  };
}
