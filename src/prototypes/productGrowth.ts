/** RI-228: タスク完了だけが機能完成になる。RI-153 の機能セット統合価値へは未接続。 */

export const PRODUCT_CAPACITY = 4;

export type ProductFeatureId = 'api' | 'screen' | 'billing';
export type ProductSpendKey = ProductFeatureId | 'ops';
export type ProductBoard = 'open' | 'blocked';
export type ProductStrategy = 'focus' | 'spread' | 'ops';
export type ProductSpend = Record<ProductSpendKey, number>;
export type ProductInput = { type: 'spend'; spend: ProductSpend } | { type: 'view' };

export interface ProductFeature {
  id: ProductFeatureId;
  need: number;
  done: number;
  complete: boolean;
}

export interface ProductPeriod {
  tick: number;
  completed: ProductFeatureId[];
  featureWork: number;
  ops: number;
  incident: number;
}

export interface ProductState {
  version: 1;
  seed: string;
  board: ProductBoard;
  tick: number;
  horizon: number;
  capacity: number;
  completeValue: number;
  incidentIfIdle: number;
  features: ProductFeature[];
  shippedWork: number;
  completedValue: number;
  incident: number;
  periods: ProductPeriod[];
  inputs: ProductInput[];
}

const FEATURES: readonly ProductFeatureId[] = ['api', 'screen', 'billing'];
const NEED = 5;
const COMPLETE_VALUE = 8;
const SPEND_KEYS: readonly ProductSpendKey[] = ['api', 'screen', 'billing', 'ops'];

const BOARDS: Record<ProductBoard, { incidentIfIdle: number }> = {
  open: { incidentIfIdle: 0 },
  blocked: { incidentIfIdle: 6 },
};

/** 初回比較の規則。感度ではこの三つを一つずつ動かす。 */
export interface ProductGrowthRules {
  need: number;
  completeValue: number;
  incidentIfIdle: number;
}

export function boardProductRules(board: ProductBoard): ProductGrowthRules {
  const incident = BOARDS[board];
  return {
    need: NEED,
    completeValue: COMPLETE_VALUE,
    incidentIfIdle: incident.incidentIfIdle,
  };
}

const PLANS: Record<ProductStrategy, readonly ProductSpend[]> = {
  focus: [
    { api: 4, screen: 0, billing: 0, ops: 0 },
    { api: 1, screen: 3, billing: 0, ops: 0 },
    { api: 0, screen: 2, billing: 2, ops: 0 },
  ],
  spread: [
    { api: 2, screen: 1, billing: 1, ops: 0 },
    { api: 2, screen: 1, billing: 1, ops: 0 },
    { api: 1, screen: 2, billing: 1, ops: 0 },
  ],
  ops: [
    { api: 3, screen: 0, billing: 0, ops: 1 },
    { api: 2, screen: 1, billing: 0, ops: 1 },
    { api: 0, screen: 3, billing: 0, ops: 1 },
  ],
};

/** 必要量を超えた分は捨て、完成は閾値を跨いだ一度だけ返す。 */
export function applyFeatureWork(done: number, need: number, amount: number) {
  if (amount <= 0 || done >= need) return { done, completed: false, accepted: 0 };
  const accepted = Math.min(amount, need - done);
  const next = done + accepted;
  return { done: next, completed: done < need && next >= need, accepted };
}

function isSpend(value: unknown): value is ProductSpend {
  if (typeof value !== 'object' || value === null) return false;
  const spend = value as Record<string, unknown>;
  if (Object.keys(spend).length !== SPEND_KEYS.length) return false;
  return SPEND_KEYS.every(
    (key) => Number.isInteger(spend[key]) && typeof spend[key] === 'number' && spend[key] >= 0,
  );
}

export function createProductGrowth(
  seed: string,
  board: ProductBoard,
  rules: ProductGrowthRules = boardProductRules(board),
): ProductState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    completeValue: rules.completeValue,
    incidentIfIdle: rules.incidentIfIdle,
    features: FEATURES.map((id) => ({ id, need: rules.need, done: 0, complete: false })),
    shippedWork: 0,
    completedValue: 0,
    incident: 0,
    periods: [],
    inputs: [],
  };
}

/** 未完了の進捗は機能を増やさない。余った投入は他機能へ移さない。 */
export function applyProductSpend(state: ProductState, spend: ProductSpend): ProductState {
  if (state.tick >= state.horizon || !isSpend(spend)) return state;
  const assigned = SPEND_KEYS.reduce((sum, key) => sum + spend[key], 0);
  if (assigned !== state.capacity) return state;
  const next = structuredClone(state);
  const completed: ProductFeatureId[] = [];
  let featureWork = 0;
  for (const feature of next.features) {
    const applied = applyFeatureWork(feature.done, feature.need, spend[feature.id]);
    feature.done = applied.done;
    featureWork += applied.accepted;
    if (applied.completed) {
      feature.complete = true;
      completed.push(feature.id);
      next.completedValue += next.completeValue;
    }
  }
  const incident = spend.ops < 1 ? next.incidentIfIdle : 0;
  next.shippedWork += featureWork;
  next.incident += incident;
  next.periods.push({ tick: next.tick, completed, featureWork, ops: spend.ops, incident });
  next.tick += 1;
  next.inputs.push({ type: 'spend', spend: { ...spend } });
  return next;
}

export function applyProductGrowth(state: ProductState, input: ProductInput): ProductState {
  if (input.type === 'view') return state;
  if (input.type !== 'spend') return state;
  return applyProductSpend(state, input.spend);
}

export function viewProductGrowth(state: ProductState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    capacity: state.capacity,
    incidentIfSkipOps: state.incidentIfIdle,
    features: state.features.map((feature) => ({
      id: feature.id,
      remaining: feature.need - feature.done,
      complete: feature.complete,
    })),
    ready: state.features.filter((feature) => feature.complete).map((feature) => feature.id),
  };
}

export function summarizeProductGrowth(state: ProductState) {
  return {
    shippedWork: state.shippedWork,
    completed: state.features.filter((feature) => feature.complete).map((feature) => feature.id),
    completedValue: state.completedValue,
    incident: state.incident,
    score: state.completedValue - state.incident,
    lost: false,
  };
}

export function productSpendPlan(strategy: ProductStrategy, tick: number): ProductSpend {
  return { ...(PLANS[strategy][tick] ?? { api: 0, screen: 0, billing: 0, ops: PRODUCT_CAPACITY }) };
}

export function chooseProductSpend(state: ProductState, strategy: ProductStrategy): ProductInput {
  return { type: 'spend', spend: productSpendPlan(strategy, state.tick) };
}

export function compareProductGrowth(seed = 'RI-228') {
  return (['open', 'blocked'] as const).flatMap((board) =>
    (['focus', 'spread', 'ops'] as const).map((strategy) => {
      const initial = createProductGrowth(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseProductSpend(state, strategy);
        const next = applyProductGrowth(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeProductGrowth(state),
      };
    }),
  );
}

const FACTOR_SEED = 'RI-228';
const FACTOR_STRATEGIES = ['focus', 'spread', 'ops'] as const;
const FACTOR_PAIRS = [
  ['focus', 'spread'],
  ['focus', 'ops'],
  ['spread', 'ops'],
] as const;
const FACTOR_BOARDS = ['open', 'blocked'] as const;

export type ProductFactorAxis = 'need' | 'completeValue' | 'incident';
export type ProductFactorLane = 'open' | 'blocked' | 'incident';
export type ProductPreference = ProductStrategy | 'tie';

export interface ProductFactorRun {
  strategy: ProductStrategy;
  inputs: ProductInput[];
  result: ReturnType<typeof summarizeProductGrowth>;
}

export interface ProductFactorPair {
  left: ProductStrategy;
  right: ProductStrategy;
  preference: ProductPreference;
  margin: number;
  leftScore: number;
  rightScore: number;
  leftCompleted: ProductFeatureId[];
  rightCompleted: ProductFeatureId[];
}

export interface ProductFactorScenario {
  lane: ProductFactorLane;
  board: ProductBoard;
  rules: ProductGrowthRules;
  runs: ProductFactorRun[];
  pairs: ProductFactorPair[];
  leaders: ProductStrategy[];
}

export interface ProductFactorPoint {
  axis: ProductFactorAxis;
  parameter: string;
  scenarios: ProductFactorScenario[];
}

export interface ProductFactorSide {
  parameter: string;
  preference: ProductPreference;
  leftScore: number;
  rightScore: number;
  leftCompleted: ProductFeatureId[];
  rightCompleted: ProductFeatureId[];
}

export interface ProductFactorReversal {
  axis: ProductFactorAxis;
  lane: ProductFactorLane;
  left: ProductStrategy;
  right: ProductStrategy;
  before: ProductFactorSide;
  after: ProductFactorSide;
}

function cloneRules(rules: ProductGrowthRules): ProductGrowthRules {
  return { ...rules };
}

function preferenceOf(
  leftScore: number,
  rightScore: number,
  left: ProductStrategy,
  right: ProductStrategy,
): ProductPreference {
  if (leftScore > rightScore) return left;
  if (rightScore > leftScore) return right;
  return 'tie';
}

function runProductStrategy(
  board: ProductBoard,
  strategy: ProductStrategy,
  rules: ProductGrowthRules,
): ProductFactorRun {
  let state = createProductGrowth(FACTOR_SEED, board, rules);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseProductSpend(state, strategy);
    const next = applyProductGrowth(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { strategy, inputs: state.inputs, result: summarizeProductGrowth(state) };
}

/** 初回と同じ投入列で、渡した規則の三戦略を比べる。 */
export function evaluateProductGrowthFactor(
  board: ProductBoard,
  rules: ProductGrowthRules,
  lane: ProductFactorLane,
): ProductFactorScenario {
  const runs = FACTOR_STRATEGIES.map((strategy) => runProductStrategy(board, strategy, rules));
  const runOf = (strategy: ProductStrategy) => {
    const run = runs.find((item) => item.strategy === strategy);
    if (!run) throw new Error(strategy);
    return run;
  };
  const pairs = FACTOR_PAIRS.map(([left, right]) => {
    const leftRun = runOf(left);
    const rightRun = runOf(right);
    return {
      left,
      right,
      preference: preferenceOf(leftRun.result.score, rightRun.result.score, left, right),
      margin: leftRun.result.score - rightRun.result.score,
      leftScore: leftRun.result.score,
      rightScore: rightRun.result.score,
      leftCompleted: leftRun.result.completed,
      rightCompleted: rightRun.result.completed,
    };
  });
  const best = Math.max(...runs.map((run) => run.result.score));
  return {
    lane,
    board,
    rules: cloneRules(rules),
    runs,
    pairs,
    leaders: runs.filter((run) => run.result.score === best).map((run) => run.strategy),
  };
}

function boardPoint(
  axis: 'need' | 'completeValue',
  parameter: number,
  patch: Partial<ProductGrowthRules>,
): ProductFactorPoint {
  return {
    axis,
    parameter: String(parameter),
    scenarios: FACTOR_BOARDS.map((board) =>
      evaluateProductGrowthFactor(board, { ...boardProductRules(board), ...patch }, board),
    ),
  };
}

function incidentPoint(incidentIfIdle: number): ProductFactorPoint {
  const board: ProductBoard = incidentIfIdle === 0 ? 'open' : 'blocked';
  return {
    axis: 'incident',
    parameter: String(incidentIfIdle),
    scenarios: [
      evaluateProductGrowthFactor(
        board,
        { ...boardProductRules('open'), incidentIfIdle },
        'incident',
      ),
    ],
  };
}

function sideOf(parameter: string, pair: ProductFactorPair): ProductFactorSide {
  return {
    parameter,
    preference: pair.preference,
    leftScore: pair.leftScore,
    rightScore: pair.rightScore,
    leftCompleted: pair.leftCompleted,
    rightCompleted: pair.rightCompleted,
  };
}

function reversalsOf(rows: ProductFactorPoint[]): ProductFactorReversal[] {
  const found: ProductFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const earlier of before.scenarios) {
      const later = after.scenarios.find((item) => item.lane === earlier.lane);
      if (!later) continue;
      for (const early of earlier.pairs) {
        const late = later.pairs.find(
          (item) => item.left === early.left && item.right === early.right,
        );
        if (!late || early.preference === late.preference) continue;
        found.push({
          axis: before.axis,
          lane: earlier.lane,
          left: early.left,
          right: early.right,
          before: sideOf(before.parameter, early),
          after: sideOf(after.parameter, late),
        });
      }
    }
  }
  return found;
}

/** 初回と同じ資源で、必要量・完成価値・運用を空けた事故を一つずつ動かす。固定戦略。 */
export function compareProductGrowthFactorReversals() {
  const sweeps = {
    need: [1, 2, 3, 4, 5, 6].map((need) => boardPoint('need', need, { need })),
    completeValue: [0, 1, 8, 17, 18, 19].map((completeValue) =>
      boardPoint('completeValue', completeValue, { completeValue }),
    ),
    incident: [0, 1, 2, 3, 6].map((incidentIfIdle) => incidentPoint(incidentIfIdle)),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      horizon: 3,
      capacity: PRODUCT_CAPACITY,
      features: [...FEATURES],
      plans: '初回と同じ集中・分散・運用枠の投入列。必要量が変わっても列は組み直さない',
      discard: '必要量を超えた投入は捨て、他の機能へ移さない',
      incident: '運用が1未満の期間だけ incidentIfIdle を足す。集中と分散は3期間、運用枠は0',
      score: 'completedValue - incident',
      boards: {
        open: boardProductRules('open'),
        blocked: boardProductRules('blocked'),
      },
      decision: {
        pairs: FACTOR_PAIRS.map(([left, right]) => `${left}-${right}`),
        preference: '差引が大きい構成。同じときは同点',
      },
      sampled: {
        need: [1, 2, 3, 4, 5, 6],
        completeValue: [0, 1, 8, 17, 18, 19],
        incidentIfIdle: [0, 1, 2, 3, 6],
      },
      held: {
        need: '三機能の必要量だけを同じ値で動かす。完成価値8。余力ありの事故は0、障害対応が要る事故は6',
        completeValue: '完成した機能1つの価値だけを動かす。必要量5。事故は盤面の0と6',
        incident:
          '運用を空けた1期間の事故だけを動かす。必要量5、完成価値8。0は余力あり、6は障害対応が要る盤面',
      },
      baseline: { need: NEED, completeValue: COMPLETE_VALUE, openIncident: 0, blockedIncident: 6 },
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: (['need', 'completeValue', 'incident'] as const).flatMap((axis) =>
      reversalsOf(sweeps[axis]),
    ),
  };
}
