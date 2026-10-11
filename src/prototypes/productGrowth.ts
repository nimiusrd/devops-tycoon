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

export function createProductGrowth(seed: string, board: ProductBoard): ProductState {
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 3,
    capacity: PRODUCT_CAPACITY,
    completeValue: COMPLETE_VALUE,
    incidentIfIdle: BOARDS[board].incidentIfIdle,
    features: FEATURES.map((id) => ({ id, need: NEED, done: 0, complete: false })),
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
