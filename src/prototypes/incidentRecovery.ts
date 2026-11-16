/** RI-169: 公開済み成果を持つ障害1件。通常firefightとは接続しない。要因掃引も通常ランへは出さない。 */
export type RecoveryMethod = 'fix' | 'rollback' | 'disable';
export interface RecoveryIncident {
  id: string;
  fixWork: number;
  lossPerTick: number;
  rollbackValue: number;
  featureValue: number;
  status: 'active' | 'recovering' | 'resolved';
  method: RecoveryMethod | null;
  workLeft: number;
  resolvedTick: number | null;
}
export interface RecoveryQuote {
  work: number;
  focus: number;
  lostValue: number;
  trustCost: number;
}
export function quoteRecovery(incident: RecoveryIncident, method: RecoveryMethod): RecoveryQuote {
  switch (method) {
    case 'fix':
      return { work: incident.fixWork, focus: 1, lostValue: 0, trustCost: 0 };
    case 'rollback':
      return { work: 2, focus: 2, lostValue: incident.rollbackValue, trustCost: 1 };
    case 'disable':
      return { work: 1, focus: 1, lostValue: incident.featureValue, trustCost: 2 };
  }
}
export type RecoveryInput =
  { type: 'recover'; id: string; method: RecoveryMethod } | { type: 'tick' };
export interface RecoveryState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  focus: number;
  focusSpent: number;
  shippedValue: number;
  lostValue: number;
  otherValue: number;
  customerLoss: number;
  trustCost: number;
  recoveryWork: number;
  incident: RecoveryIncident;
  inputs: RecoveryInput[];
  /** 機能停止の完了後、残りのtickごとに払う保守。無いときは0。 */
  disableUpkeep?: number;
  /** 実工数 − 見積工数。無いときは0。選択前の見積は変えない。 */
  workError?: number;
  /** 機能停止の完了後に払った保守の合計。 */
  maintenancePaid?: number;
}
export function createRecoveryPrototype(seed: string, severe = false): RecoveryState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: severe ? 3 : 8,
    focus: 4,
    focusSpent: 0,
    shippedValue: 20,
    lostValue: 0,
    otherValue: 0,
    customerLoss: 0,
    trustCost: 0,
    recoveryWork: 0,
    incident: {
      id: 'incident-1',
      fixWork: severe ? 6 : 2,
      lossPerTick: severe ? 4 : 1,
      rollbackValue: 4,
      featureValue: 8,
      status: 'active',
      method: null,
      workLeft: 0,
      resolvedTick: null,
    },
    inputs: [],
  };
}
export function applyRecoveryInput(state: RecoveryState, input: RecoveryInput): RecoveryState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'recover') {
    if (input.id !== state.incident.id || state.incident.status !== 'active') return state;
    const quote = quoteRecovery(state.incident, input.method);
    if (state.focus < quote.focus) return state;
    const next = structuredClone(state);
    next.incident.status = 'recovering';
    next.incident.method = input.method;
    // 見積誤差は実工数にだけ足す。quoteRecovery は選択前のまま。実工数は1未満にしない。
    next.incident.workLeft = recoveryActualWork(quote.work, state.workError ?? 0);
    next.focus -= quote.focus;
    next.focusSpent += quote.focus;
    next.inputs.push(structuredClone(input));
    return next;
  }
  const next = structuredClone(state);
  next.tick++;
  if (next.incident.status === 'resolved') {
    next.otherValue += 2;
    // 保守は完了tickでは払わない。別仕事が再開するtickから、停止したときだけ払う。
    const upkeep = next.disableUpkeep ?? 0;
    if (upkeep > 0 && next.incident.method === 'disable') {
      next.maintenancePaid = (next.maintenancePaid ?? 0) + upkeep;
    }
  } else {
    // 復旧完了tickまでは顧客影響が続く。操作だけで即時鎮火しない。
    next.customerLoss += next.incident.lossPerTick;
    if (next.incident.status === 'recovering') {
      next.incident.workLeft--;
      next.recoveryWork++;
      if (next.incident.workLeft === 0) {
        const quote = quoteRecovery(next.incident, next.incident.method!);
        next.incident.status = 'resolved';
        next.incident.resolvedTick = next.tick;
        next.shippedValue -= quote.lostValue;
        next.lostValue += quote.lostValue;
        next.trustCost += quote.trustCost;
      }
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeRecovery(state: RecoveryState) {
  // 未復旧を期末で消さない。残り修正期間の影響見積は実損失と分ける。
  const remainingWork =
    state.incident.status === 'active' ? state.incident.fixWork : state.incident.workLeft;
  const outstandingImpact = remainingWork * state.incident.lossPerTick;
  const maintenancePaid = state.maintenancePaid ?? 0;
  const summary = {
    shippedValue: state.shippedValue,
    lostValue: state.lostValue,
    otherValue: state.otherValue,
    focusSpent: state.focusSpent,
    customerLoss: state.customerLoss,
    trustCost: state.trustCost,
    recoveryWork: state.recoveryWork,
    resolvedTick: state.incident.resolvedTick,
    remainingWork,
    outstandingImpact,
    netValue:
      state.shippedValue +
      state.otherValue -
      state.focusSpent -
      state.customerLoss -
      state.trustCost -
      outstandingImpact -
      maintenancePaid,
  };
  if (maintenancePaid === 0) return summary;
  return { ...summary, maintenancePaid };
}
export function compareRecoveryStrategies(seed: string) {
  return [false, true].flatMap((severe) =>
    (['fix', 'rollback', 'disable', 'none'] as const).map((method) => {
      const initial = createRecoveryPrototype(seed, severe);
      let state =
        method === 'none'
          ? initial
          : applyRecoveryInput(initial, {
              type: 'recover',
              id: initial.incident.id,
              method,
            });
      while (state.tick < state.horizon) state = applyRecoveryInput(state, { type: 'tick' });
      return { severe, method, initial, inputs: state.inputs, result: summarizeRecovery(state) };
    }),
  );
}

/** 見積工数に誤差を足した実工数。誤差0は見積のまま。実工数は1未満にしない。 */
function recoveryActualWork(quotedWork: number, workError: number): number {
  if (workError === 0) return quotedWork;
  return Math.max(1, quotedWork + workError);
}

export interface RecoveryFactors {
  horizon: number;
  lossPerTick: number;
  rollbackValue: number;
  disableUpkeep: number;
  workError: number;
}

/** 初回の重大・期末3。軽い障害の組はここから再比較しない。 */
export const severeRecoveryFactors = {
  horizon: 3,
  lossPerTick: 4,
  rollbackValue: 4,
  disableUpkeep: 0,
  workError: 0,
} as const satisfies RecoveryFactors;

export type RecoverySweepAxis = keyof RecoveryFactors;

const RECOVERY_METHODS = ['fix', 'rollback', 'disable'] as const;

const SWEEP_VALUES = {
  horizon: [2, 3, 4, 5, 6, 8],
  lossPerTick: [0, 1, 2, 3, 4],
  rollbackValue: [0, 1, 2, 3, 4],
  disableUpkeep: [0, 1, 2, 3],
  workError: [-1, 0, 1, 2],
} as const satisfies Record<RecoverySweepAxis, readonly number[]>;

export interface RecoveryOutcome {
  quotedWork: number;
  actualWork: number;
  resolvedTick: number | null;
  shippedValue: number;
  lostValue: number;
  otherValue: number;
  focusSpent: number;
  customerLoss: number;
  trustCost: number;
  maintenancePaid: number;
  remainingWork: number;
  outstandingImpact: number;
  netValue: number;
}

export interface RecoveryFactorPoint {
  axis: RecoverySweepAxis;
  value: number;
  factors: RecoveryFactors;
  inputs: Record<RecoveryMethod, RecoveryInput[]>;
  results: Record<RecoveryMethod, RecoveryOutcome>;
  leaders: RecoveryMethod[];
  leadersAmongResolved: RecoveryMethod[];
}

export interface RecoveryFactorBoundary {
  axis: RecoverySweepAxis;
  /** 差引が単独最大で、巻き戻しは期末までに完了している。 */
  completedRollbackLeads: number[];
  /** 差引の首位に巻き戻しが他方法と同点で入る。 */
  rollbackTies: number[];
  /** 差引は単独最大だが、巻き戻しは期末までに終わっていない。 */
  unfinishedRollbackLeads: number[];
  edges: {
    before: number;
    after: number;
    beforeLeaders: RecoveryMethod[];
    afterLeaders: RecoveryMethod[];
    beforeResolved: RecoveryMethod[];
    afterResolved: RecoveryMethod[];
  }[];
}

export function createRecoveryFactorState(seed: string, factors: RecoveryFactors): RecoveryState {
  const base = createRecoveryPrototype(seed, true);
  const state: RecoveryState = {
    ...base,
    horizon: factors.horizon,
    incident: {
      ...base.incident,
      lossPerTick: factors.lossPerTick,
      rollbackValue: factors.rollbackValue,
    },
  };
  if (factors.disableUpkeep !== 0) state.disableUpkeep = factors.disableUpkeep;
  if (factors.workError !== 0) state.workError = factors.workError;
  return state;
}

function factorsFor(axis: RecoverySweepAxis, value: number): RecoveryFactors {
  return { ...severeRecoveryFactors, [axis]: value };
}

function leadersOf(
  results: Record<RecoveryMethod, RecoveryOutcome>,
  methods: readonly RecoveryMethod[],
): RecoveryMethod[] {
  if (methods.length === 0) return [];
  const best = Math.max(...methods.map((method) => results[method].netValue));
  return methods.filter((method) => results[method].netValue === best);
}

function toOutcome(
  state: RecoveryState,
  quotedWork: number,
  factors: RecoveryFactors,
): RecoveryOutcome {
  const summary = summarizeRecovery(state);
  return {
    quotedWork,
    actualWork: recoveryActualWork(quotedWork, factors.workError),
    resolvedTick: summary.resolvedTick,
    shippedValue: summary.shippedValue,
    lostValue: summary.lostValue,
    otherValue: summary.otherValue,
    focusSpent: summary.focusSpent,
    customerLoss: summary.customerLoss,
    trustCost: summary.trustCost,
    maintenancePaid: state.maintenancePaid ?? 0,
    remainingWork: summary.remainingWork,
    outstandingImpact: summary.outstandingImpact,
    netValue: summary.netValue,
  };
}

function playMethod(seed: string, factors: RecoveryFactors, method: RecoveryMethod) {
  const initial = createRecoveryFactorState(seed, factors);
  const quotedWork = quoteRecovery(initial.incident, method).work;
  const recover = { type: 'recover', id: initial.incident.id, method } as const;
  const inputs: RecoveryInput[] = [recover];
  let state = applyRecoveryInput(initial, recover);
  if (state.incident.status !== 'recovering') throw new Error(`recovery rejected: ${method}`);
  while (state.tick < state.horizon) {
    const tick = { type: 'tick' } as const;
    inputs.push(tick);
    state = applyRecoveryInput(state, tick);
  }
  return { inputs, outcome: toOutcome(state, quotedWork, factors) };
}

function sweepPoint(seed: string, axis: RecoverySweepAxis, value: number): RecoveryFactorPoint {
  const factors = factorsFor(axis, value);
  const inputs = {} as Record<RecoveryMethod, RecoveryInput[]>;
  const results = {} as Record<RecoveryMethod, RecoveryOutcome>;
  for (const method of RECOVERY_METHODS) {
    const played = playMethod(seed, factors, method);
    inputs[method] = played.inputs;
    results[method] = played.outcome;
  }
  const resolved = RECOVERY_METHODS.filter((method) => results[method].resolvedTick !== null);
  return {
    axis,
    value,
    factors,
    inputs,
    results,
    leaders: leadersOf(results, RECOVERY_METHODS),
    leadersAmongResolved: leadersOf(results, resolved),
  };
}

function sameMethods(left: readonly RecoveryMethod[], right: readonly RecoveryMethod[]): boolean {
  return left.join('|') === right.join('|');
}

function boundary(
  axis: RecoverySweepAxis,
  points: readonly RecoveryFactorPoint[],
): RecoveryFactorBoundary {
  const edges: RecoveryFactorBoundary['edges'] = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (!before || !after) continue;
    if (
      sameMethods(before.leaders, after.leaders) &&
      sameMethods(before.leadersAmongResolved, after.leadersAmongResolved)
    ) {
      continue;
    }
    edges.push({
      before: before.value,
      after: after.value,
      beforeLeaders: before.leaders,
      afterLeaders: after.leaders,
      beforeResolved: before.leadersAmongResolved,
      afterResolved: after.leadersAmongResolved,
    });
  }
  return {
    axis,
    completedRollbackLeads: points
      .filter(
        (point) =>
          point.leaders.length === 1 &&
          point.leaders[0] === 'rollback' &&
          point.results.rollback.resolvedTick !== null,
      )
      .map((point) => point.value),
    rollbackTies: points
      .filter((point) => point.leaders.includes('rollback') && point.leaders.length > 1)
      .map((point) => point.value),
    unfinishedRollbackLeads: points
      .filter(
        (point) =>
          point.leaders.length === 1 &&
          point.leaders[0] === 'rollback' &&
          point.results.rollback.resolvedTick === null,
      )
      .map((point) => point.value),
    edges,
  };
}

/** 重大障害の資源を固定し、要因を一つずつ動かす。固定戦略の計算で、軽い障害は再走しない。 */
export function compareRecoveryFactorSweep(seed: string) {
  const axes = Object.keys(SWEEP_VALUES) as RecoverySweepAxis[];
  const points = axes.flatMap((axis) =>
    SWEEP_VALUES[axis].map((value) => sweepPoint(seed, axis, value)),
  );
  return {
    conditions: {
      seed,
      base: 'severe',
      repeatedLightComparison: false,
      strategies: [...RECOVERY_METHODS],
      excludedStrategies: ['none'],
      shippedValue: 20,
      featureValue: 8,
      focus: 4,
      otherPerTick: 2,
      fixWork: 6,
      held: severeRecoveryFactors,
      values: SWEEP_VALUES,
      workFloor: 1,
      upkeepAfterResolvedTicks: true,
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegration: false,
    },
    points,
    boundaries: axes.map((axis) =>
      boundary(
        axis,
        points.filter((point) => point.axis === axis),
      ),
    ),
  };
}
