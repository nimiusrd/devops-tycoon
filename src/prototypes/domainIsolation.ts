import { quoteRecovery, type RecoveryIncident } from './incidentRecovery';

/** RI-171: 2領域の固定盤面。復旧と影響範囲の制限は別操作。 */
export type IsolationDomain = 'product' | 'platform';
export interface IsolationTask {
  id: string;
  domain: IsolationDomain;
  stage: 'coding' | 'review' | 'done';
  workLeft: number;
  value: number;
  admitted: boolean;
}
export type IsolationInput =
  | { type: 'isolate' | 'release'; domain: IsolationDomain }
  | { type: 'admit'; id: string }
  | { type: 'repair' }
  | { type: 'tick' };
export interface IsolationState {
  version: 1;
  seed: string;
  tick: number;
  horizon: number;
  focus: number;
  focusSpent: number;
  isolated: IsolationDomain | null;
  incident: RecoveryIncident;
  customerLoss: number;
  spreadTicks: number;
  blockedCapacity: Record<IsolationDomain, number>;
  recoveryWork: number;
  tasks: IsolationTask[];
  inputs: IsolationInput[];
}
export function createIsolationPrototype(seed: string, severe = false): IsolationState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 8,
    focus: 6,
    focusSpent: 0,
    isolated: null,
    customerLoss: 0,
    spreadTicks: 0,
    blockedCapacity: { product: 0, platform: 0 },
    recoveryWork: 0,
    incident: {
      id: 'product-incident',
      fixWork: severe ? 6 : 2,
      lossPerTick: severe ? 4 : 1,
      rollbackValue: 4,
      featureValue: 8,
      status: 'active',
      method: null,
      workLeft: 0,
      resolvedTick: null,
    },
    tasks: (['product', 'platform'] as const).flatMap((domain) => [
      { id: `${domain}-job`, domain, stage: 'coding', workLeft: 2, value: 8, admitted: true },
      { id: `${domain}-reserve`, domain, stage: 'coding', workLeft: 2, value: 4, admitted: false },
    ]),
    inputs: [],
  };
}
export function applyIsolationInput(state: IsolationState, input: IsolationInput): IsolationState {
  if (state.tick >= state.horizon) return state;
  if (
    input.type === 'isolate' &&
    (input.domain !== 'product' ||
      state.isolated !== null ||
      state.incident.status === 'resolved' ||
      state.focus < 2)
  )
    return state;
  if (
    input.type === 'release' &&
    (input.domain !== state.isolated || state.incident.status !== 'resolved' || state.focus < 1)
  )
    return state;
  if (
    input.type === 'repair' &&
    (state.incident.status !== 'active' || state.focus < quoteRecovery(state.incident, 'fix').focus)
  )
    return state;
  if (input.type === 'admit') {
    const task = state.tasks.find((t) => t.id === input.id);
    if (!task || task.admitted || task.domain === state.isolated) return state;
  }
  const next = structuredClone(state);
  if (input.type === 'isolate') {
    next.isolated = input.domain;
    next.focus -= 2;
    next.focusSpent += 2;
  } else if (input.type === 'release') {
    next.isolated = null;
    next.focus--;
    next.focusSpent++;
  } else if (input.type === 'admit') {
    next.tasks.find((t) => t.id === input.id)!.admitted = true;
  } else if (input.type === 'repair') {
    const quote = quoteRecovery(next.incident, 'fix');
    next.incident.status = 'recovering';
    next.incident.method = 'fix';
    next.incident.workLeft = quote.work;
    next.focus -= quote.focus;
    next.focusSpent += quote.focus;
  } else {
    next.tick++;
    const active = next.incident.status !== 'resolved';
    const spreading = active && next.isolated === null;
    if (active) next.customerLoss += next.incident.lossPerTick;
    if (spreading) {
      next.spreadTicks++;
      next.customerLoss++; // 対象外領域への波及。隔離は元の事故・損失を消さない。
    }
    for (const domain of ['product', 'platform'] as const) {
      const task = next.tasks.find((t) => t.domain === domain && t.admitted && t.stage !== 'done');
      if (!task) continue;
      if (next.isolated === domain || (active && (domain === 'product' || spreading))) {
        next.blockedCapacity[domain]++;
        continue;
      }
      task.workLeft--;
      if (task.workLeft === 0) {
        if (task.stage === 'coding') {
          task.stage = 'review';
          task.workLeft = 2;
        } else task.stage = 'done';
      }
    }
    // 両領域の通常担当とは別の復旧担当1枠。完了tickから遡って作業を再開しない。
    if (next.incident.status === 'recovering') {
      next.incident.workLeft--;
      next.recoveryWork++;
      if (next.incident.workLeft === 0) {
        next.incident.status = 'resolved';
        next.incident.resolvedTick = next.tick;
      }
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeIsolation(state: IsolationState) {
  const value = state.tasks
    .filter((t) => t.admitted && t.stage === 'done')
    .reduce((n, t) => n + t.value, 0);
  const remainingWork =
    state.incident.status === 'active' ? state.incident.fixWork : state.incident.workLeft;
  const outstandingImpact =
    remainingWork * (state.incident.lossPerTick + (state.isolated === null ? 1 : 0));
  return {
    value,
    focusSpent: state.focusSpent,
    customerLoss: state.customerLoss,
    spreadTicks: state.spreadTicks,
    blockedCapacity: state.blockedCapacity,
    recoveryWork: state.recoveryWork,
    remainingWork,
    outstandingImpact,
    pausedValue: state.tasks
      .filter((t) => t.admitted && t.stage !== 'done' && t.domain === state.isolated)
      .reduce((n, t) => n + t.value, 0),
    remaining: state.tasks
      .filter((t) => t.admitted && t.stage !== 'done')
      .map((t) => ({ id: t.id, stage: t.stage, workLeft: t.workLeft })),
    // 公開済み成果20は隔離では失わない。未完仕事の機会損失はvalueの差として扱う。
    netValue: 20 + value - state.focusSpent - state.customerLoss - outstandingImpact,
  };
}
export function compareIsolationStrategies(seed: string) {
  return [false, true].flatMap((severe) =>
    (['open', 'isolate'] as const).map((strategy) => {
      const initial = createIsolationPrototype(seed, severe);
      let state =
        strategy === 'isolate'
          ? applyIsolationInput(initial, { type: 'isolate', domain: 'product' })
          : initial;
      state = applyIsolationInput(state, { type: 'repair' });
      while (state.tick < state.horizon) {
        if (state.isolated && state.incident.status === 'resolved')
          state = applyIsolationInput(state, { type: 'release', domain: state.isolated });
        state = applyIsolationInput(state, { type: 'tick' });
      }
      return { severe, strategy, initial, inputs: state.inputs, result: summarizeIsolation(state) };
    }),
  );
}
