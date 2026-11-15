import { createRng } from '../sim/rng';

/** RI-172: 原因は初期化時だけ抽選し、表示には既知情報のみを渡す。 */
export type IncidentCause = 'configuration' | 'code';
export type InvestigationMethod = IncidentCause | 'rollback';
export type InvestigationInput =
  | { type: 'investigate' }
  | { type: 'recover'; method: InvestigationMethod }
  | { type: 'interrupt' }
  | { type: 'tick' };

/** 比較で一つずつ動かす規則。状態に無いときは baselineInvestigationRules。 */
export interface InvestigationRules {
  wrongFixWork: number;
  rollbackLostValue: number;
  unresolvedPenalty: number;
  /** 追加症状から見た、設定不備である事前確率の百分率。原因の再抽選には使わない。 */
  priorConfigurationPercent: number;
  /** null は調査中の中断を拒否する。数値は中断で追加する集中力。 */
  interruptFocus: number | null;
}

export const baselineInvestigationRules: InvestigationRules = {
  wrongFixWork: 6,
  rollbackLostValue: 14,
  unresolvedPenalty: 10,
  priorConfigurationPercent: 50,
  interruptFocus: null,
};

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
  /** 無いときは初回と同じ規則。初回の比較JSONはこのフィールドを持たない。 */
  rules?: InvestigationRules;
}

function rulesOf(state: InvestigationState): InvestigationRules {
  return state.rules ?? baselineInvestigationRules;
}

/** 同点では症状の偏りを出さない。決め打ちの同点処理は investigationGuessMethod。 */
function leaningCause(priorConfigurationPercent: number): IncidentCause | null {
  if (priorConfigurationPercent > 50) return 'configuration';
  if (priorConfigurationPercent < 50) return 'code';
  return null;
}

/** 同点のときは初回比較の設定決め打ちに合わせる。隠れた原因は見ない。 */
export function investigationGuessMethod(priorConfigurationPercent: number): IncidentCause {
  return leaningCause(priorConfigurationPercent) ?? 'configuration';
}

export function createInvestigationPrototype(
  seed: number,
  horizon = 8,
  rules?: InvestigationRules,
): InvestigationState {
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
    ...(rules ? { rules: { ...rules } } : {}),
  };
}

/** 未調査の修正幅と巻き戻し損失は規則から出す。原因そのものは出さない。 */
export function viewInvestigation(state: InvestigationState) {
  const rules = rulesOf(state);
  return {
    tick: state.tick,
    horizon: state.horizon,
    symptom: 'release-errors',
    knownCause: state.knownCause,
    priorConfigurationPercent: rules.priorConfigurationPercent,
    likelyCause: leaningCause(rules.priorConfigurationPercent),
    phase: state.phase,
    workLeft: state.workLeft,
    investigationTicks: 2,
    lossPerTick: 4,
    unresolvedPenalty: rules.unresolvedPenalty,
    interruptAvailable: rules.interruptFocus !== null,
    methods: (['configuration', 'code', 'rollback'] as const).map((method) => ({
      method,
      focus: 1,
      lostValue: method === 'rollback' ? rules.rollbackLostValue : 0,
      workRange:
        method === 'rollback'
          ? [1, 1]
          : state.knownCause === null
            ? [1, rules.wrongFixWork]
            : method === state.knownCause
              ? [1, 1]
              : [rules.wrongFixWork, rules.wrongFixWork],
    })),
  };
}

export function applyInvestigationInput(
  state: InvestigationState,
  input: InvestigationInput,
): InvestigationState {
  if (state.tick >= state.horizon) return state;
  const rules = rulesOf(state);
  if (input.type === 'interrupt') {
    if (state.phase !== 'investigating' || rules.interruptFocus === null) return state;
    if (state.focus < rules.interruptFocus) return state;
    const next = structuredClone(state);
    next.focus -= rules.interruptFocus;
    next.focusSpent += rules.interruptFocus;
    next.phase = 'active';
    next.workLeft = 0;
    next.inputs.push(structuredClone(input));
    return next;
  }
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
    next.workLeft =
      input.method === 'rollback' || input.method === next.cause ? 1 : rules.wrongFixWork;
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
              next.shippedValue -= rules.rollbackLostValue;
              next.lostValue += rules.rollbackLostValue;
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
  // 残障害は消去しない。調査後は原因修正、未調査は誤修正工数（既定6）で見積もる。
  const rules = rulesOf(state);
  const remainingWork =
    state.phase === 'resolved'
      ? 0
      : state.phase === 'recovering'
        ? state.workLeft
        : state.phase === 'investigating'
          ? state.workLeft + 1
          : state.knownCause === null
            ? rules.wrongFixWork
            : 1;
  const outstandingImpact = remainingWork * 4;
  const unresolvedPenalty = state.phase === 'resolved' ? 0 : rules.unresolvedPenalty;
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

export type InvestigationFactor =
  | 'wrongFixWork'
  | 'rollbackLostValue'
  | 'unresolvedPenalty'
  | 'priorConfigurationPercent'
  | 'interruptFocus';

export type SensitivityStrategy =
  'investigate' | 'guess' | 'rollback' | 'interrupt-guess' | 'interrupt-rollback';

export interface SensitivityRow {
  factor: InvestigationFactor;
  level: number;
  horizon: number;
  seed: number;
  strategy: SensitivityStrategy;
  initial: InvestigationState;
  inputs: InvestigationInput[];
  result: ReturnType<typeof summarizeInvestigation>;
}

const sensitivityLevels: { factor: InvestigationFactor; levels: number[] }[] = [
  { factor: 'wrongFixWork', levels: [5] },
  { factor: 'rollbackLostValue', levels: [12, 13] },
  { factor: 'unresolvedPenalty', levels: [0, 2, 4] },
  { factor: 'priorConfigurationPercent', levels: [56, 57] },
  { factor: 'interruptFocus', levels: [0] },
];

function strategiesFor(factor: InvestigationFactor): SensitivityStrategy[] {
  return factor === 'interruptFocus'
    ? ['investigate', 'guess', 'rollback', 'interrupt-guess', 'interrupt-rollback']
    : ['investigate', 'guess', 'rollback'];
}

function playSensitivity(
  seed: number,
  horizon: number,
  strategy: SensitivityStrategy,
  rules: InvestigationRules,
): { initial: InvestigationState; state: InvestigationState } {
  const initial = createInvestigationPrototype(seed, horizon, rules);
  let state = initial;
  const play = (input: InvestigationInput) => {
    state = applyInvestigationInput(state, input);
  };
  if (strategy === 'investigate') play({ type: 'investigate' });
  else if (strategy === 'guess') {
    play({ type: 'recover', method: investigationGuessMethod(rules.priorConfigurationPercent) });
  } else if (strategy === 'rollback') play({ type: 'recover', method: 'rollback' });
  else {
    play({ type: 'investigate' });
    play({ type: 'tick' });
    play({ type: 'interrupt' });
    play({
      type: 'recover',
      method:
        strategy === 'interrupt-rollback'
          ? 'rollback'
          : investigationGuessMethod(rules.priorConfigurationPercent),
    });
  }
  while (state.tick < state.horizon) {
    if (strategy === 'investigate' && state.phase === 'active' && state.knownCause !== null) {
      play({ type: 'recover', method: state.knownCause });
    }
    play({ type: 'tick' });
  }
  return { initial, state };
}

/** 対照値は初回比較に残し、ここには動かした段だけを置く。固定戦略であり適応はしない。 */
export function compareInvestigationSensitivities(): SensitivityRow[] {
  return sensitivityLevels.flatMap(({ factor, levels }) =>
    levels.flatMap((level) => {
      const rules = { ...baselineInvestigationRules, [factor]: level };
      return [2, 8].flatMap((horizon) =>
        [0, 1].flatMap((seed) =>
          strategiesFor(factor).map((strategy) => {
            const { initial, state } = playSensitivity(seed, horizon, strategy, rules);
            return {
              factor,
              level,
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
    }),
  );
}

/** 事前確率の百分率で二つの原因の差引を加重する。50なら平均の100倍。 */
export function weighCauseOutcomes(
  configuration: number,
  code: number,
  priorConfigurationPercent: number,
): number {
  return priorConfigurationPercent * configuration + (100 - priorConfigurationPercent) * code;
}

export function rankInvestigationChoice(scores: {
  investigate: number;
  guess: number;
  rollback: number;
}): { better: 'investigate' | 'immediate' | 'tie'; immediateBy: 'guess' | 'rollback' | 'tie' } {
  const immediate = Math.max(scores.guess, scores.rollback);
  return {
    better:
      scores.investigate > immediate
        ? 'investigate'
        : scores.investigate < immediate
          ? 'immediate'
          : 'tie',
    immediateBy:
      scores.guess > scores.rollback
        ? 'guess'
        : scores.rollback > scores.guess
          ? 'rollback'
          : 'tie',
  };
}
