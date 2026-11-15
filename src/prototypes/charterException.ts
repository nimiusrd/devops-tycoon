/** RI-220: 小PR憲章を1件だけ破る。RI-219 の禁止判定を共用する。 */

import { charterBlocks, SMALL_PR_LIMIT } from './smallPrCharter';

export type ExceptionBoard = 'deadline' | 'precedent';
export type ExceptionStrategy = 'hold' | 'except';
export type ExceptionInput =
  | { type: 'except' }
  | { type: 'ship-urgent' }
  | { type: 'ship' }
  | { type: 'ship-large' }
  | { type: 'wait' }
  | { type: 'view' };

export interface ExceptionState {
  version: 1;
  seed: string;
  board: ExceptionBoard;
  tick: number;
  horizon: number;
  charter: boolean;
  limit: typeof SMALL_PR_LIMIT;
  urgentSize: number;
  urgentValue: number;
  urgentDeadline: 0;
  urgentDone: boolean;
  urgentExpired: boolean;
  ordinaryValue: number;
  followUpCost: number;
  followUpTick: number;
  /** 無いときは1。例外を取ったtickから、禁止判定に憲章を渡さない期間。 */
  exceptionDuration?: number;
  followUpApplied: boolean;
  exceptionUsed: boolean;
  exceptionTick: number | null;
  value: number;
  trustCost: number;
  inputs: ExceptionInput[];
}

const PRESET: Record<ExceptionBoard, { urgent: number; followUp: number }> = {
  deadline: { urgent: 12, followUp: 4 },
  precedent: { urgent: 6, followUp: 8 },
};

export const BASELINE_EXCEPTION_FACTORS = {
  duration: 1,
  followUpTick: 3,
  urgentValue: null,
} as const;

export interface CharterExceptionFactors {
  duration: number;
  followUpTick: number;
  urgentValue: number | null;
}

function durationOf(state: ExceptionState): number {
  return state.exceptionDuration ?? BASELINE_EXCEPTION_FACTORS.duration;
}

/** 持続のあいだだけ憲章を外して、禁止判定は charterBlocks に任せる。 */
function charterForProhibition(state: ExceptionState): boolean {
  const duration = durationOf(state);
  if (state.exceptionTick !== null && duration > 0 && state.tick < state.exceptionTick + duration) {
    return false;
  }
  return state.charter;
}

function blocks(state: ExceptionState, size: number): boolean {
  return charterBlocks(charterForProhibition(state), size);
}

function followUpReachable(state: ExceptionState): boolean {
  return state.followUpTick > state.tick && state.followUpTick <= state.horizon;
}

export function createCharterException(seed: string, board: ExceptionBoard): ExceptionState {
  const preset = PRESET[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 4,
    charter: true,
    limit: SMALL_PR_LIMIT,
    urgentSize: 4,
    urgentValue: preset.urgent,
    urgentDeadline: 0,
    urgentDone: false,
    urgentExpired: false,
    ordinaryValue: 3,
    followUpCost: preset.followUp,
    followUpTick: 3,
    followUpApplied: false,
    exceptionUsed: false,
    exceptionTick: null,
    value: 0,
    trustCost: 0,
    inputs: [],
  };
}

function expireAndFollowUp(state: ExceptionState): void {
  if (!state.urgentDone && state.tick > state.urgentDeadline) state.urgentExpired = true;
  if (state.exceptionUsed && state.tick === state.followUpTick && !state.followUpApplied) {
    state.trustCost += state.followUpCost;
    state.followUpApplied = true;
  }
}

export function applyCharterException(
  state: ExceptionState,
  input: ExceptionInput,
): ExceptionState {
  if (input.type === 'view') return state;
  if (state.tick >= state.horizon) return state;
  if (input.type === 'except') {
    if (
      durationOf(state) <= 0 ||
      !charterBlocks(state.charter, state.urgentSize) ||
      state.exceptionUsed ||
      state.urgentDone ||
      state.urgentExpired ||
      state.tick > state.urgentDeadline
    ) {
      return state;
    }
    const next = structuredClone(state);
    next.urgentDone = true;
    next.exceptionUsed = true;
    next.exceptionTick = state.tick;
    next.value += next.urgentValue;
    next.tick += 1;
    next.inputs.push({ type: 'except' });
    expireAndFollowUp(next);
    return next;
  }
  if (input.type === 'ship-urgent') {
    if (
      blocks(state, state.urgentSize) ||
      state.urgentDone ||
      state.urgentExpired ||
      state.tick > state.urgentDeadline
    ) {
      return state;
    }
    const next = structuredClone(state);
    next.urgentDone = true;
    next.value += next.urgentValue;
    next.tick += 1;
    next.inputs.push({ type: 'ship-urgent' });
    expireAndFollowUp(next);
    return next;
  }
  if (input.type === 'ship-large') {
    if (blocks(state, state.urgentSize)) return state;
    const next = structuredClone(state);
    next.value += 20;
    next.tick += 1;
    next.inputs.push({ type: 'ship-large' });
    expireAndFollowUp(next);
    return next;
  }
  if (input.type !== 'ship' && input.type !== 'wait') return state;
  const next = structuredClone(state);
  if (input.type === 'ship') next.value += next.ordinaryValue;
  next.tick += 1;
  next.inputs.push(input.type === 'ship' ? { type: 'ship' } : { type: 'wait' });
  expireAndFollowUp(next);
  return next;
}

function scheduledFollowUp(state: ExceptionState): number | null {
  if (state.followUpApplied || !followUpReachable(state)) return null;
  const stillPossible =
    state.exceptionUsed ||
    (durationOf(state) > 0 &&
      charterBlocks(state.charter, state.urgentSize) &&
      !state.urgentDone &&
      !state.urgentExpired &&
      state.tick <= state.urgentDeadline);
  return stillPossible ? state.followUpCost : null;
}

export function viewCharterException(state: ExceptionState) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    charter: state.charter,
    limit: state.charter ? state.limit : null,
    brokenFor: brokenForLabel(state),
    urgent: {
      size: state.urgentSize,
      done: state.urgentDone,
      expired: state.urgentExpired,
      deadline: state.urgentDeadline,
      blocked: blocks(state, state.urgentSize) && !state.urgentDone && !state.urgentExpired,
    },
    followUp: {
      tick: state.followUpTick,
      applied: state.followUpApplied,
      trustCost: state.trustCost,
      scheduledCost: scheduledFollowUp(state),
    },
    blockedLarge: blocks(state, state.urgentSize),
  };
}

function brokenForLabel(state: ExceptionState): string | null {
  if (state.exceptionTick === null) return null;
  const duration = durationOf(state);
  if (duration === 1) return 'tick ' + String(state.exceptionTick) + ' の1期間';
  return 'tick ' + String(state.exceptionTick) + ' から' + String(duration) + '期間';
}

export function summarizeCharterException(state: ExceptionState) {
  return {
    value: state.value,
    trustCost: state.trustCost,
    score: state.value - state.trustCost,
    exceptionUsed: state.exceptionUsed,
    exceptionTick: state.exceptionTick,
    followUpApplied: state.followUpApplied,
    urgentDone: state.urgentDone,
    urgentExpired: state.urgentExpired,
    lost: false,
  };
}

export function chooseExceptionAction(
  state: ExceptionState,
  strategy: ExceptionStrategy,
): ExceptionInput {
  if (
    strategy === 'except' &&
    durationOf(state) > 0 &&
    !state.exceptionUsed &&
    !state.urgentDone &&
    !state.urgentExpired &&
    state.tick <= state.urgentDeadline
  ) {
    return charterBlocks(state.charter, state.urgentSize)
      ? { type: 'except' }
      : { type: 'ship-urgent' };
  }
  return { type: 'ship' };
}

export function compareCharterExceptions(seed = 'RI-220') {
  return (['deadline', 'precedent'] as const).flatMap((board) =>
    (['hold', 'except'] as const).map((strategy) => {
      const initial = createCharterException(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 20) throw new Error(`${board}:${strategy}`);
        const input = chooseExceptionAction(state, strategy);
        const next = applyCharterException(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeCharterException(state),
      };
    }),
  );
}

export type ExceptionPreference = 'hold' | 'except' | 'tie';
export type ExceptionFactorName = 'duration' | 'followUpTick' | 'urgentValue';

const DURATION_LEVELS = [0, 1, 2, 3, 4, 5];
const FOLLOW_UP_LEVELS = [0, 1, 2, 3, 4, 5];
const URGENT_LEVELS = Array.from({ length: 17 }, (_, value) => value);

function baselineFactors(): CharterExceptionFactors {
  return {
    duration: BASELINE_EXCEPTION_FACTORS.duration,
    followUpTick: BASELINE_EXCEPTION_FACTORS.followUpTick,
    urgentValue: BASELINE_EXCEPTION_FACTORS.urgentValue,
  };
}

export function charterExceptionFactorsFor(
  factor: ExceptionFactorName,
  level: number,
): CharterExceptionFactors {
  const factors = baselineFactors();
  if (factor === 'duration') factors.duration = level;
  else if (factor === 'followUpTick') factors.followUpTick = level;
  else factors.urgentValue = level;
  return factors;
}

export function prepareCharterException(
  seed: string,
  board: ExceptionBoard,
  factors: CharterExceptionFactors,
): ExceptionState {
  const next = structuredClone(createCharterException(seed, board));
  next.followUpTick = factors.followUpTick;
  if (factors.urgentValue !== null) next.urgentValue = factors.urgentValue;
  if (factors.duration !== 1) next.exceptionDuration = factors.duration;
  return next;
}

function acceptsLarge(state: ExceptionState): boolean {
  return applyCharterException(state, { type: 'ship-large' }) !== state;
}

function runFactorStrategy(
  seed: string,
  board: ExceptionBoard,
  strategy: ExceptionStrategy,
  factors: CharterExceptionFactors,
) {
  let state = prepareCharterException(seed, board, factors);
  const openTicks: number[] = [];
  const mark = (current: ExceptionState) => {
    if (acceptsLarge(current)) openTicks.push(current.tick);
  };
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 20) throw new Error(`${board}:${strategy}`);
    mark(state);
    const input = chooseExceptionAction(state, strategy);
    const next = applyCharterException(state, input);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  mark(state);
  return { inputs: state.inputs, result: summarizeCharterException(state), openTicks };
}

function preferenceOf(hold: number, exceptScore: number): ExceptionPreference {
  if (hold > exceptScore) return 'hold';
  if (exceptScore > hold) return 'except';
  return 'tie';
}

function factorPoint(
  seed: string,
  board: ExceptionBoard,
  factor: ExceptionFactorName,
  level: number,
) {
  const factors = charterExceptionFactorsFor(factor, level);
  const hold = runFactorStrategy(seed, board, 'hold', factors);
  const except = runFactorStrategy(seed, board, 'except', factors);
  return {
    level,
    factors,
    preference: preferenceOf(hold.result.score, except.result.score),
    hold,
    except,
  };
}

interface FactorReversal {
  factor: ExceptionFactorName;
  board: ExceptionBoard;
  before: { level: number; preference: ExceptionPreference; hold: number; except: number };
  after: { level: number; preference: ExceptionPreference; hold: number; except: number };
}

/**
 * 初回と同じ資源の上で、持続、後日談の発生tick、緊急価値を一つずつ動かす。
 * 固定戦略の計算。初回の2盤面比較は再実行しない。
 */
export function compareCharterExceptionFactors(seed = 'RI-220') {
  const specs: { factor: ExceptionFactorName; levels: readonly number[] }[] = [
    { factor: 'duration', levels: DURATION_LEVELS },
    { factor: 'followUpTick', levels: FOLLOW_UP_LEVELS },
    { factor: 'urgentValue', levels: URGENT_LEVELS },
  ];
  const series = specs.flatMap((spec) =>
    (['deadline', 'precedent'] as const).map((board) => ({
      factor: spec.factor,
      board,
      points: spec.levels.map((level) => factorPoint(seed, board, spec.factor, level)),
    })),
  );
  const reversals: FactorReversal[] = series.flatMap((entry) => {
    const found: FactorReversal[] = [];
    for (let index = 1; index < entry.points.length; index += 1) {
      const before = entry.points[index - 1];
      const after = entry.points[index];
      if (!before || !after || before.preference === after.preference) continue;
      found.push({
        factor: entry.factor,
        board: entry.board,
        before: {
          level: before.level,
          preference: before.preference,
          hold: before.hold.result.score,
          except: before.except.result.score,
        },
        after: {
          level: after.level,
          preference: after.preference,
          hold: after.hold.result.score,
          except: after.except.result.score,
        },
      });
    }
    return found;
  });
  return {
    conditions: {
      seed,
      horizon: 4,
      ordinaryValue: 3,
      urgentSize: 4,
      urgentDeadline: 0,
      limit: SMALL_PR_LIMIT,
      presets: {
        deadline: { urgentValue: PRESET.deadline.urgent, followUpCost: PRESET.deadline.followUp },
        precedent: {
          urgentValue: PRESET.precedent.urgent,
          followUpCost: PRESET.precedent.followUp,
        },
      },
      baseline: baselineFactors(),
      score: 'value - trustCost',
      preference: '差引が高い方を上とする。同じなら同点',
      strategies: {
        hold: '毎tick通常出荷する。例外は取らない',
        except:
          '期限前で未完なら1件だけ例外にし、その後は通常出荷する。持続0では例外できず通常出荷に戻る',
      },
      held: {
        duration: '後日談tickは3、緊急価値は盤面のまま。持続だけを0から5まで動かす。1が初回',
        followUpTick:
          '持続は1、緊急価値は盤面のまま。後日談の発生tickだけを0から5まで動かす。3が初回。費用は行動後のtickと一致したとき一度だけ引く',
        urgentValue:
          '持続は1、後日談tickは3、後日談費用は盤面のまま。緊急価値だけを0から16まで動かす',
      },
      controls: ['duration:1', 'followUpTick:3', 'urgentValue:preset'],
      oneAtATime: true,
      fixedStrategies: true,
      humanPlaytest: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
      normalRun: false,
      randomDraws: false,
      largeShip:
        '持続が2以上のとき、例外tickより後で窓が開いているtickでは大きい出荷を禁止しない。固定戦略はその入力を送らない',
    },
    series,
    reversals,
  };
}
