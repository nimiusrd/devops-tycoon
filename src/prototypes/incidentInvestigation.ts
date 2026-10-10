import { createRng } from '../sim/rng';

/** RI-172: 原因は初期化時だけ抽選し、表示には既知情報のみを渡す。 */
export type IncidentCause = 'configuration' | 'code';
export type InvestigationMethod = IncidentCause | 'rollback';
export type InvestigationInput =
  | { type: 'investigate' }
  | { type: 'recover'; method: InvestigationMethod }
  | { type: 'tick' };
export interface InvestigationState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  cause: IncidentCause;
  knownCause: IncidentCause | null;
  phase: 'active' | 'investigating' | 'recovering' | 'resolved';
  workLeft: number;
  method: InvestigationMethod | null;
  focus: number;
  focusSpent: number;
  customerLoss: number;
  shippedValue: number;
  lostValue: number;
  otherValue: number;
  resolvedTick: number | null;
  inputs: InvestigationInput[];
}
export function createInvestigationPrototype(seed: number, horizon = 8): InvestigationState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    cause: createRng(seed)() < 0.5 ? 'configuration' : 'code',
    knownCause: null,
    phase: 'active',
    workLeft: 0,
    method: null,
    focus: 4,
    focusSpent: 0,
    customerLoss: 0,
    shippedValue: 20,
    lostValue: 0,
    otherValue: 0,
    resolvedTick: null,
    inputs: [],
  };
}
/** 未調査では対象修正1〜6tick、巻き戻し1tick/成果14損失という範囲を示す。 */
export function viewInvestigation(state: InvestigationState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    symptom: 'release-errors',
    knownCause: state.knownCause,
    phase: state.phase,
    workLeft: state.workLeft,
    investigationTicks: 2,
    lossPerTick: 4,
    methods: (['configuration', 'code', 'rollback'] as const).map((method) => ({
      method,
      focus: 1,
      lostValue: method === 'rollback' ? 14 : 0,
      workRange:
        method === 'rollback'
          ? [1, 1]
          : state.knownCause === null
            ? [1, 6]
            : method === state.knownCause
              ? [1, 1]
              : [6, 6],
    })),
  };
}
export function applyInvestigationInput(
  state: InvestigationState,
  input: InvestigationInput,
): InvestigationState {
  if (state.tick >= state.horizon) return state;
  if (input.type !== 'tick' && (state.phase !== 'active' || state.focus < 1)) return state;
  if (input.type === 'investigate' && state.knownCause !== null) return state;
  const next = structuredClone(state);
  if (input.type === 'investigate') {
    next.phase = 'investigating';
    next.workLeft = 2;
    next.focus--;
    next.focusSpent++;
  } else if (input.type === 'recover') {
    next.phase = 'recovering';
    next.method = input.method;
    next.workLeft = input.method === 'rollback' || input.method === next.cause ? 1 : 6;
    next.focus--;
    next.focusSpent++;
  } else {
    next.tick++;
    if (next.phase === 'resolved') next.otherValue += 2;
    else {
      next.customerLoss += 4;
      if (next.phase === 'investigating' || next.phase === 'recovering') {
        next.workLeft--;
        if (next.workLeft === 0) {
          if (next.phase === 'investigating') {
            next.knownCause = next.cause;
            next.phase = 'active';
          } else {
            next.phase = 'resolved';
            next.resolvedTick = next.tick;
            if (next.method === 'rollback') {
              next.shippedValue -= 14;
              next.lostValue += 14;
            }
          }
        }
      }
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeInvestigation(state: InvestigationState) {
  // 残障害は消去しない。調査後は原因修正、未調査は最悪6工数で見積もる。
  const remainingWork =
    state.phase === 'resolved'
      ? 0
      : state.phase === 'recovering'
        ? state.workLeft
        : state.phase === 'investigating'
          ? state.workLeft + 1
          : state.knownCause === null
            ? 6
            : 1;
  const outstandingImpact = remainingWork * 4;
  const unresolvedPenalty = state.phase === 'resolved' ? 0 : 10;
  return {
    knownCause: state.knownCause,
    phase: state.phase,
    resolvedTick: state.resolvedTick,
    shippedValue: state.shippedValue,
    lostValue: state.lostValue,
    otherValue: state.otherValue,
    customerLoss: state.customerLoss,
    focusSpent: state.focusSpent,
    remainingWork,
    outstandingImpact,
    unresolvedPenalty,
    netValue:
      state.shippedValue +
      state.otherValue -
      state.customerLoss -
      state.focusSpent -
      outstandingImpact -
      unresolvedPenalty,
  };
}
export function compareInvestigationStrategies() {
  return [2, 8].flatMap((horizon) =>
    [0, 1].flatMap((seed) =>
      (['investigate', 'configuration', 'rollback', 'none'] as const).map((strategy) => {
        const initial = createInvestigationPrototype(seed, horizon);
        let state =
          strategy === 'none'
            ? initial
            : applyInvestigationInput(
                initial,
                strategy === 'investigate'
                  ? { type: 'investigate' }
                  : { type: 'recover', method: strategy },
              );
        while (state.tick < state.horizon) {
          if (strategy === 'investigate' && state.phase === 'active' && state.knownCause !== null)
            state = applyInvestigationInput(state, { type: 'recover', method: state.knownCause });
          state = applyInvestigationInput(state, { type: 'tick' });
        }
        return {
          horizon,
          seed,
          strategy,
          initial,
          inputs: state.inputs,
          result: summarizeInvestigation(state),
        };
      }),
    ),
  );
}
