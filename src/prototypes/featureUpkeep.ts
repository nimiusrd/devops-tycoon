/** RI-234: 完成した機能は次の期間から保守を生む。同じ機能の二度目は増やさない。RI-228 の完成判定を使う。感度は軽い観測を起点に、単価・必要作業・罰則の一つだけを状態へ置く。 */

import { applyFeatureWork, PRODUCT_CAPACITY, type ProductFeatureId } from './productGrowth';

export type UpkeepFeature = ProductFeatureId;
export type UpkeepBoard = 'light' | 'heavy';
export type UpkeepStrategy = 'rush' | 'staff';
export type UpkeepInput =
  { type: 'assign'; feature: UpkeepFeature; maintain: number } | { type: 'view' };

/** 感度で一つだけ動かす係数。余力・期間・完成価値は含めない。 */
export interface UpkeepFactorRules {
  upkeepRate: number;
  need: number;
  shortfallPenalty: number;
}

export type UpkeepFactorAxis = 'upkeepRate' | 'need' | 'penalty';
export type UpkeepPreference = UpkeepStrategy | 'tie';

export interface UpkeepFeatureState {
  id: UpkeepFeature;
  need: number;
  done: number;
  complete: boolean;
  online: boolean;
}

export interface UpkeepPeriod {
  tick: number;
  feature: UpkeepFeature;
  maintain: number;
  built: number;
  completed: boolean;
  shortfall: number;
}

export interface UpkeepState {
  version: 1;
  seed: string;
  board: UpkeepBoard;
  tick: number;
  horizon: number;
  capacity: number;
  upkeepRate: number;
  shortfallPenalty: number;
  featureValue: number;
  features: UpkeepFeatureState[];
  completedValue: number;
  shortfall: number;
  periods: UpkeepPeriod[];
  inputs: UpkeepInput[];
}

const FEATURES: readonly UpkeepFeature[] = ['api', 'screen', 'billing'];
const NEED = 4;
const FEATURE_VALUE = 6;

const BOARDS: Record<UpkeepBoard, { upkeepRate: number; shortfallPenalty: number }> = {
  light: { upkeepRate: 1, shortfallPenalty: 1 },
  heavy: { upkeepRate: 2, shortfallPenalty: 4 },
};

/** 初回の軽い観測。感度ではこのうち一つだけを変える。 */
export const baselineUpkeepRules: UpkeepFactorRules = {
  upkeepRate: BOARDS.light.upkeepRate,
  need: NEED,
  shortfallPenalty: BOARDS.light.shortfallPenalty,
};

function isFeature(value: string): value is UpkeepFeature {
  return value === 'api' || value === 'screen' || value === 'billing';
}

export function createFeatureUpkeep(
  seed: string,
  board: UpkeepBoard,
  rules?: Partial<UpkeepFactorRules>,
): UpkeepState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    upkeepRate: rules?.upkeepRate ?? preset.upkeepRate,
    shortfallPenalty: rules?.shortfallPenalty ?? preset.shortfallPenalty,
    featureValue: FEATURE_VALUE,
    features: FEATURES.map((id) => ({
      id,
      need: rules?.need ?? NEED,
      done: 0,
      complete: false,
      online: false,
    })),
    completedValue: 0,
    shortfall: 0,
    periods: [],
    inputs: [],
  };
}

function dueNow(state: UpkeepState): number {
  return state.upkeepRate * state.features.filter((feature) => feature.online).length;
}

function maintenanceOf(state: UpkeepState, feature: UpkeepFeatureState): number {
  return feature.online ? state.upkeepRate : 0;
}

/** 今期の保守は、前期までに完成した機能だけが生む。 */
export function applyFeatureUpkeep(state: UpkeepState, input: UpkeepInput): UpkeepState {
  if (input.type === 'view' || state.tick >= state.horizon) return state;
  if (input.type !== 'assign' || !isFeature(input.feature)) return state;
  if (!Number.isInteger(input.maintain) || input.maintain < 0 || input.maintain > state.capacity) {
    return state;
  }
  const next = structuredClone(state);
  const feature = next.features.find((item) => item.id === input.feature);
  if (!feature) return state;
  const due = dueNow(next);
  const applied = applyFeatureWork(feature.done, feature.need, next.capacity - input.maintain);
  feature.done = applied.done;
  if (applied.completed) {
    feature.complete = true;
    next.completedValue += next.featureValue;
  }
  const shortfall = Math.max(0, due - input.maintain);
  next.shortfall += shortfall;
  next.periods.push({
    tick: next.tick,
    feature: input.feature,
    maintain: input.maintain,
    built: applied.accepted,
    completed: applied.completed,
    shortfall,
  });
  for (const item of next.features) {
    if (item.complete) item.online = true;
  }
  next.tick += 1;
  next.inputs.push({ type: 'assign', feature: input.feature, maintain: input.maintain });
  return next;
}

export function viewFeatureUpkeep(state: UpkeepState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    board: state.board,
    upkeepRate: state.upkeepRate,
    shortfallPenalty: state.shortfallPenalty,
    featureValue: state.featureValue,
    obligation: dueNow(state),
    features: state.features.map((feature) => ({
      id: feature.id,
      remaining: feature.need - feature.done,
      complete: feature.complete,
      maintenance: maintenanceOf(state, feature),
    })),
  };
}

export function summarizeFeatureUpkeep(state: UpkeepState) {
  const maintenance = dueNow(state);
  return {
    completedValue: state.completedValue,
    completed: state.features.filter((feature) => feature.complete).map((feature) => feature.id),
    maintenance,
    shortfall: state.shortfall,
    nextSlack: state.capacity - maintenance,
    score: state.completedValue - state.shortfall * state.shortfallPenalty,
    lost: false,
  };
}

function nextFeature(state: UpkeepState): UpkeepFeature {
  return state.features.find((feature) => !feature.complete)?.id ?? 'api';
}

export function chooseUpkeepAction(state: UpkeepState, strategy: UpkeepStrategy): UpkeepInput {
  const maintain = strategy === 'staff' ? Math.min(dueNow(state), state.capacity) : 0;
  return { type: 'assign', feature: nextFeature(state), maintain };
}

function runUpkeep(seed: string, board: UpkeepBoard, strategy: UpkeepStrategy) {
  const initial = createFeatureUpkeep(seed, board);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseUpkeepAction(state, strategy);
    const next = applyFeatureUpkeep(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeFeatureUpkeep(state) };
}

export function compareFeatureUpkeep(seed = 'RI-234') {
  return (['light', 'heavy'] as const).flatMap((board) =>
    (['rush', 'staff'] as const).map((strategy) => ({
      board,
      strategy,
      ...runUpkeep(seed, board, strategy),
    })),
  );
}

const FACTOR_SEED = 'RI-234';
const FACTOR_AXES = ['upkeepRate', 'need', 'penalty'] as const;
const FACTOR_STRATEGIES = ['rush', 'staff'] as const;
const RATE_STEPS = [0, 1, 2, 3, 4, 5, 6] as const;
const NEED_STEPS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const PENALTY_STEPS = [0, 1, 2, 3, 4, 5, 6] as const;

interface UpkeepFactorHeld {
  upkeepRate?: number;
  need?: number;
  shortfallPenalty?: number;
}

interface UpkeepFactorRun {
  inputs: UpkeepInput[];
  result: ReturnType<typeof summarizeFeatureUpkeep>;
}

interface UpkeepFactorRow {
  axis: UpkeepFactorAxis;
  parameter: string;
  board: 'light';
  rules: UpkeepFactorRules;
  preference: UpkeepPreference;
  margin: number;
  leaders: UpkeepStrategy[];
  scores: Record<UpkeepStrategy, number>;
  runs: Record<UpkeepStrategy, UpkeepFactorRun>;
  initial: UpkeepState;
}

interface UpkeepFactorReversal {
  axis: UpkeepFactorAxis;
  held: UpkeepFactorHeld;
  before: { parameter: string; preference: UpkeepPreference; rush: number; staff: number };
  after: { parameter: string; preference: UpkeepPreference; rush: number; staff: number };
}

interface UpkeepFactorSeries {
  axis: UpkeepFactorAxis;
  anchor: 'light';
  held: UpkeepFactorHeld;
  rows: UpkeepFactorRow[];
  reversals: UpkeepFactorReversal[];
}

function axisField(axis: UpkeepFactorAxis): keyof UpkeepFactorRules {
  if (axis === 'penalty') return 'shortfallPenalty';
  return axis;
}

function rulesOnAxis(axis: UpkeepFactorAxis, value: number): UpkeepFactorRules {
  return { ...baselineUpkeepRules, [axisField(axis)]: value };
}

function heldFor(axis: UpkeepFactorAxis): UpkeepFactorHeld {
  if (axis === 'upkeepRate') {
    return {
      need: baselineUpkeepRules.need,
      shortfallPenalty: baselineUpkeepRules.shortfallPenalty,
    };
  }
  if (axis === 'need') {
    return {
      upkeepRate: baselineUpkeepRules.upkeepRate,
      shortfallPenalty: baselineUpkeepRules.shortfallPenalty,
    };
  }
  return { upkeepRate: baselineUpkeepRules.upkeepRate, need: baselineUpkeepRules.need };
}

function preferenceOf(rush: number, staff: number): UpkeepPreference {
  if (staff > rush) return 'staff';
  if (rush > staff) return 'rush';
  return 'tie';
}

function leadersOf(scores: Record<UpkeepStrategy, number>): UpkeepStrategy[] {
  const top = Math.max(scores.rush, scores.staff);
  return FACTOR_STRATEGIES.filter((strategy) => scores[strategy] === top);
}

function sameState(left: UpkeepState, right: UpkeepState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function playUpkeep(rules: UpkeepFactorRules, strategy: UpkeepStrategy) {
  const initial = createFeatureUpkeep(FACTOR_SEED, 'light', rules);
  let state = initial;
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${strategy}`);
    const input = chooseUpkeepAction(state, strategy);
    const next = applyFeatureUpkeep(state, input);
    if (next === state) throw new Error(`${strategy}@${state.tick}`);
    state = next;
  }
  return { initial, inputs: state.inputs, result: summarizeFeatureUpkeep(state) };
}

function factorRow(axis: UpkeepFactorAxis, value: number): UpkeepFactorRow {
  const rules = rulesOnAxis(axis, value);
  const rush = playUpkeep(rules, 'rush');
  const staff = playUpkeep(rules, 'staff');
  if (!sameState(rush.initial, staff.initial)) throw new Error(`${axis}:${value}`);
  const scores = { rush: rush.result.score, staff: staff.result.score };
  return {
    axis,
    parameter: String(value),
    board: 'light',
    rules,
    preference: preferenceOf(scores.rush, scores.staff),
    margin: scores.staff - scores.rush,
    leaders: leadersOf(scores),
    scores,
    runs: {
      rush: { inputs: rush.inputs, result: rush.result },
      staff: { inputs: staff.inputs, result: staff.result },
    },
    initial: rush.initial,
  };
}

function reversalsOf(rows: UpkeepFactorRow[], held: UpkeepFactorHeld): UpkeepFactorReversal[] {
  const found: UpkeepFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after || before.preference === after.preference) continue;
    found.push({
      axis: before.axis,
      held,
      before: {
        parameter: before.parameter,
        preference: before.preference,
        rush: before.scores.rush,
        staff: before.scores.staff,
      },
      after: {
        parameter: after.parameter,
        preference: after.preference,
        rush: after.scores.rush,
        staff: after.scores.staff,
      },
    });
  }
  return found;
}

function buildSeries(axis: UpkeepFactorAxis, values: readonly number[]): UpkeepFactorSeries {
  const held = heldFor(axis);
  const rows = values.map((value) => factorRow(axis, value));
  return { axis, anchor: 'light', held, rows, reversals: reversalsOf(rows, held) };
}

/** 初回と同じ資源で、保守単価・完成に必要な作業・罰則を一つずつ動かす。固定戦略。 */
export function compareFeatureUpkeepFactorReversals() {
  const sample = createFeatureUpkeep(FACTOR_SEED, 'light');
  const sweeps = {
    upkeepRate: buildSeries('upkeepRate', RATE_STEPS),
    need: buildSeries('need', NEED_STEPS),
    penalty: buildSeries('penalty', PENALTY_STEPS),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      anchor: 'light' as const,
      features: [...FEATURES],
      capacity: sample.capacity,
      horizon: sample.horizon,
      featureValue: sample.featureValue,
      score: 'completedValue - shortfall * shortfallPenalty' as const,
      strategies: [...FACTOR_STRATEGIES],
      decision: {
        preference: '体制の得点が大きいとき staff、急ぐが大きいとき rush、同じとき tie',
        margin: 'staff の得点 - rush の得点',
        leaders: '得点が最大の戦略。同点は rush、staff の順で複数',
        ignored: '次期余力は結果に残すが、順序には使わない',
      },
      baseline: { ...baselineUpkeepRules },
      held: {
        upkeepRate: '保守単価だけを動かす。完成に必要な作業4、罰則1',
        need: '完成に必要な作業だけを動かす。保守単価1、罰則1',
        penalty: '罰則だけを動かす。保守単価1、完成に必要な作業4。入力列は軽い観測のまま',
      },
      steps: {
        upkeepRate: [...RATE_STEPS],
        need: [...NEED_STEPS],
        penalty: [...PENALTY_STEPS],
      },
      omitted:
        '初回の2観測表は再出力しない。基準行だけ軽い観測の急ぐ・体制と照合する。重い観測は単価2と罰則4の同時変更なので、この掃引の行にしない',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: FACTOR_AXES.flatMap((axis) => sweeps[axis].reversals),
  };
}
