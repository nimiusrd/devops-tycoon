/** RI-169: 公開済み成果を持つ障害1件。通常firefightとは接続しない。 */
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
  | { type: 'recover'; id: string; method: RecoveryMethod }
  | { type: 'tick' };
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
    next.incident.workLeft = quote.work;
    next.focus -= quote.focus;
    next.focusSpent += quote.focus;
    next.inputs.push(structuredClone(input));
    return next;
  }
  const next = structuredClone(state);
  next.tick++;
  if (next.incident.status === 'resolved') next.otherValue += 2;
  else {
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
  return {
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
      outstandingImpact,
  };
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
