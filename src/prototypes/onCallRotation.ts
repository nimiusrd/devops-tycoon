/** RI-221: 当番1枠を主力・新人・持ち回りで比較する。感度の係数は当番の計算にだけ渡す。RI-170 の待機レーンとは未接続。 */

export type PersonId = 'ace' | 'jun';
export type OnCallBoard = 'quiet' | 'severe' | 'mixed';
export type OnCallStrategy = 'ace' | 'junior' | 'rotate';
export type OnCallInput = { type: 'assign'; id: PersonId } | { type: 'view' };

/** 感度で一つだけ動かす係数。出荷と盤面の障害量・罰は含めない。 */
export interface OnCallFactorRules {
  occurTick: number;
  juniorRecover: number;
  aceFatigue: number;
}

export interface OnCallPerson {
  id: PersonId;
  ship: number;
  recover: number;
  fatigueRate: number;
  fatigue: number;
  experience: number;
}

export interface OnCallState {
  version: 1;
  seed: string;
  board: OnCallBoard;
  tick: number;
  horizon: number;
  onCall: PersonId | null;
  incidentLeft: number;
  incidentTotal: number;
  penalty: number;
  penaltyApplied: boolean;
  shipped: number;
  people: OnCallPerson[];
  inputs: OnCallInput[];
}

const BOARDS: Record<OnCallBoard, { incident: number; penalty: number }> = {
  quiet: { incident: 0, penalty: 0 },
  severe: { incident: 5, penalty: 12 },
  mixed: { incident: 4, penalty: 8 },
};

function createPeople(): OnCallPerson[] {
  return [
    { id: 'ace', ship: 4, recover: 3, fatigueRate: 2, fatigue: 0, experience: 0 },
    { id: 'jun', ship: 2, recover: 1, fatigueRate: 1, fatigue: 0, experience: 0 },
  ];
}

/** 初回比較の係数。感度ではこのうち一つだけを変える。 */
export const baselineOnCallRules: OnCallFactorRules = {
  occurTick: 0,
  juniorRecover: 1,
  aceFatigue: 2,
};

function nonNegativeInteger(value: number, fallback: number): number {
  if (!Number.isInteger(value) || value < 0) return fallback;
  return value;
}

function normalizeRules(rules?: OnCallFactorRules): OnCallFactorRules {
  const given = rules ?? baselineOnCallRules;
  return {
    occurTick: nonNegativeInteger(given.occurTick, baselineOnCallRules.occurTick),
    juniorRecover: nonNegativeInteger(given.juniorRecover, baselineOnCallRules.juniorRecover),
    aceFatigue: nonNegativeInteger(given.aceFatigue, baselineOnCallRules.aceFatigue),
  };
}

export function createOnCallRotation(seed: string, board: OnCallBoard): OnCallState {
  const preset = BOARDS[board];
  return {
    version: 1,
    seed,
    board,
    tick: 0,
    horizon: 2,
    onCall: null,
    incidentLeft: preset.incident,
    incidentTotal: preset.incident,
    penalty: preset.penalty,
    penaltyApplied: preset.incident === 0,
    shipped: 0,
    people: createPeople(),
    inputs: [],
  };
}

function person(state: OnCallState, id: PersonId): OnCallPerson | undefined {
  return state.people.find((candidate) => candidate.id === id);
}

/** 新人の復旧に、状態へ保存された主力との差を足す。基準では差2。 */
function appliedRecover(
  active: OnCallPerson,
  state: OnCallState,
  rules: OnCallFactorRules,
): number {
  if (active.id === 'jun') return rules.juniorRecover;
  const junior = person(state, 'jun');
  const gap = junior ? active.recover - junior.recover : 0;
  return Math.max(0, rules.juniorRecover + gap);
}

/** 主力の消耗だけ規則を使う。新人は状態の消耗率のまま。 */
function appliedFatigue(active: OnCallPerson, rules: OnCallFactorRules): number {
  if (active.id === 'ace') return rules.aceFatigue;
  return active.fatigueRate;
}

/** 1期間の当番は1人。消耗と経験はその人へ一度だけ足す。 */
export function assignOnCall(
  state: OnCallState,
  ids: readonly PersonId[],
  rules?: OnCallFactorRules,
): OnCallState {
  if (state.tick >= state.horizon || ids.length !== 1) return state;
  const id = ids[0];
  if (!person(state, id)) return state;
  const activeRules = normalizeRules(rules);
  const next = structuredClone(state);
  const active = person(next, id);
  if (!active) return state;
  active.fatigue += appliedFatigue(active, activeRules);
  if (active.id === 'jun') active.experience += 1;
  if (state.tick >= activeRules.occurTick) {
    next.incidentLeft = Math.max(0, next.incidentLeft - appliedRecover(active, next, activeRules));
  }
  next.onCall = id;
  next.shipped += next.people
    .filter((candidate) => candidate.id !== id)
    .reduce((sum, candidate) => sum + candidate.ship, 0);
  next.tick += 1;
  if (next.tick === next.horizon && next.incidentLeft > 0 && !next.penaltyApplied) {
    next.penaltyApplied = true;
  }
  next.inputs.push({ type: 'assign', id });
  return next;
}

export function applyOnCallRotation(
  state: OnCallState,
  input: OnCallInput,
  rules?: OnCallFactorRules,
): OnCallState {
  if (input.type === 'view') return state;
  if (input.type !== 'assign') return state;
  return assignOnCall(state, [input.id], rules);
}

export function viewOnCallRotation(state: OnCallState) {
  const active = state.onCall === null ? null : person(state, state.onCall);
  return {
    tick: state.tick,
    horizon: state.horizon,
    onCall: state.onCall,
    period: state.tick,
    ordinaryCapacity: state.people
      .filter((candidate) => candidate.id !== state.onCall)
      .reduce((sum, candidate) => sum + candidate.ship, 0),
    incidentLeft: state.incidentLeft,
    people: state.people.map((candidate) => ({
      id: candidate.id,
      fatigue: candidate.fatigue,
      experience: candidate.experience,
      onCall: candidate.id === state.onCall,
    })),
    activeFatigueRate: active?.fatigueRate ?? null,
  };
}

export function summarizeOnCallRotation(state: OnCallState) {
  const fatigue = state.people.reduce((sum, candidate) => sum + candidate.fatigue, 0);
  const unresolved = state.penaltyApplied && state.incidentLeft > 0 ? state.penalty : 0;
  return {
    shipped: state.shipped,
    fatigue,
    unresolved,
    score: state.shipped - fatigue - unresolved,
    incidentLeft: state.incidentLeft,
    experience: state.people.map((candidate) => ({
      id: candidate.id,
      experience: candidate.experience,
    })),
    lost: false,
  };
}

export function chooseOnCallAction(state: OnCallState, strategy: OnCallStrategy): OnCallInput {
  if (strategy === 'ace') return { type: 'assign', id: 'ace' };
  if (strategy === 'junior') return { type: 'assign', id: 'jun' };
  return { type: 'assign', id: state.tick % 2 === 0 ? 'jun' : 'ace' };
}

export function compareOnCallRotations(seed = 'RI-221') {
  return (['quiet', 'severe', 'mixed'] as const).flatMap((board) =>
    (['ace', 'junior', 'rotate'] as const).map((strategy) => {
      const initial = createOnCallRotation(seed, board);
      let state = initial;
      let guard = 0;
      while (state.tick < state.horizon) {
        if (++guard > 10) throw new Error(`${board}:${strategy}`);
        const input = chooseOnCallAction(state, strategy);
        const next = applyOnCallRotation(state, input);
        if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
        state = next;
      }
      return {
        board,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizeOnCallRotation(state),
      };
    }),
  );
}

const FACTOR_SEED = 'RI-221';
const FACTOR_BOARDS = ['quiet', 'severe', 'mixed'] as const;
const FACTOR_STRATEGIES = ['ace', 'junior', 'rotate'] as const;
const OCCUR_STEPS = [0, 1, 2] as const;
const RECOVER_STEPS = [0, 1, 2, 3, 4] as const;
const FATIGUE_STEPS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;
type OnCallFactorAxis = 'occurTick' | 'recover' | 'fatigue';
type OnCallLeader = OnCallStrategy | 'tie';
type OnCallSummary = ReturnType<typeof summarizeOnCallRotation>;
interface OnCallFactorRun {
  strategy: OnCallStrategy;
  inputs: OnCallInput[];
  result: OnCallSummary;
}
interface OnCallFactorBoard {
  board: OnCallBoard;
  scores: Record<OnCallStrategy, number>;
  order: OnCallStrategy[][];
  leader: OnCallLeader;
  runs: OnCallFactorRun[];
}
interface OnCallFactorPoint {
  axis: OnCallFactorAxis;
  parameter: string;
  rules: OnCallFactorRules;
  sameAsFirstComparison: boolean;
  boards: OnCallFactorBoard[];
}
interface OnCallFactorReversal {
  axis: OnCallFactorAxis;
  board: OnCallBoard;
  before: { parameter: string; order: OnCallStrategy[][]; scores: Record<OnCallStrategy, number> };
  after: { parameter: string; order: OnCallStrategy[][]; scores: Record<OnCallStrategy, number> };
}

function rulesMatchBaseline(rules: OnCallFactorRules): boolean {
  return (
    rules.occurTick === baselineOnCallRules.occurTick &&
    rules.juniorRecover === baselineOnCallRules.juniorRecover &&
    rules.aceFatigue === baselineOnCallRules.aceFatigue
  );
}

function runOnCallFactor(
  board: OnCallBoard,
  strategy: OnCallStrategy,
  rules: OnCallFactorRules,
): OnCallFactorRun {
  let state = createOnCallRotation(FACTOR_SEED, board);
  let guard = 0;
  while (state.tick < state.horizon) {
    if (++guard > 10) throw new Error(`${board}:${strategy}`);
    const input = chooseOnCallAction(state, strategy);
    const next = applyOnCallRotation(state, input, rules);
    if (next === state) throw new Error(`${board}:${strategy}@${state.tick}`);
    state = next;
  }
  return { strategy, inputs: state.inputs, result: summarizeOnCallRotation(state) };
}

function ranking(scores: Record<OnCallStrategy, number>): OnCallStrategy[][] {
  const pending: OnCallStrategy[] = [...FACTOR_STRATEGIES];
  const groups: OnCallStrategy[][] = [];
  while (pending.length > 0) {
    const best = Math.max(...pending.map((id) => scores[id]));
    const group = pending.filter((id) => scores[id] === best);
    groups.push(group);
    for (const id of group) pending.splice(pending.indexOf(id), 1);
  }
  return groups;
}

function leaderOf(order: OnCallStrategy[][]): OnCallLeader {
  const top = order[0];
  if (!top || top.length !== 1) return 'tie';
  return top[0];
}

function scoreOf(runs: OnCallFactorRun[], strategy: OnCallStrategy): number {
  const found = runs.find((run) => run.strategy === strategy);
  if (!found) throw new Error(strategy);
  return found.result.score;
}

function factorBoard(board: OnCallBoard, rules: OnCallFactorRules): OnCallFactorBoard {
  const runs = FACTOR_STRATEGIES.map((strategy) => runOnCallFactor(board, strategy, rules));
  const scores = {
    ace: scoreOf(runs, 'ace'),
    junior: scoreOf(runs, 'junior'),
    rotate: scoreOf(runs, 'rotate'),
  };
  const order = ranking(scores);
  return { board, scores, order, leader: leaderOf(order), runs };
}

function factorPoint(
  axis: OnCallFactorAxis,
  parameter: string,
  rules: OnCallFactorRules,
): OnCallFactorPoint {
  return {
    axis,
    parameter,
    rules: { ...rules },
    sameAsFirstComparison: rulesMatchBaseline(rules),
    boards: FACTOR_BOARDS.map((board) => factorBoard(board, rules)),
  };
}

function boardAt(point: OnCallFactorPoint, board: OnCallBoard): OnCallFactorBoard {
  const found = point.boards.find((item) => item.board === board);
  if (!found) throw new Error(board);
  return found;
}

function sameOrder(left: OnCallStrategy[][], right: OnCallStrategy[][]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reversalsOf(rows: OnCallFactorPoint[]): OnCallFactorReversal[] {
  const found: OnCallFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const board of FACTOR_BOARDS) {
      const earlier = boardAt(before, board);
      const later = boardAt(after, board);
      if (sameOrder(earlier.order, later.order)) continue;
      found.push({
        axis: before.axis,
        board,
        before: { parameter: before.parameter, order: earlier.order, scores: earlier.scores },
        after: { parameter: after.parameter, order: later.order, scores: later.scores },
      });
    }
  }
  return found;
}

function factorResources(board: OnCallBoard) {
  const state = createOnCallRotation(FACTOR_SEED, board);
  return {
    horizon: state.horizon,
    incident: state.incidentTotal,
    penalty: state.penalty,
    people: state.people.map((candidate) => ({
      id: candidate.id,
      ship: candidate.ship,
      recover: candidate.recover,
      fatigueRate: candidate.fatigueRate,
    })),
  };
}

/** 初回と同じ資源で、発生tick・復旧量・主力の消耗を一つずつ動かす。固定戦略。 */
export function compareOnCallFactorReversals() {
  const sweeps = {
    occurTick: OCCUR_STEPS.map((occurTick) =>
      factorPoint('occurTick', String(occurTick), { ...baselineOnCallRules, occurTick }),
    ),
    recover: RECOVER_STEPS.map((juniorRecover) =>
      factorPoint('recover', String(juniorRecover), { ...baselineOnCallRules, juniorRecover }),
    ),
    fatigue: FATIGUE_STEPS.map((aceFatigue) =>
      factorPoint('fatigue', String(aceFatigue), { ...baselineOnCallRules, aceFatigue }),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      boards: {
        quiet: factorResources('quiet'),
        severe: factorResources('severe'),
        mixed: factorResources('mixed'),
      },
      decision: {
        strategies: [...FACTOR_STRATEGIES],
        score: 'shipped - fatigue - unresolved' as const,
        order: '差引の高い順。同点は ace、junior、rotate の並び',
      },
      baseline: { ...baselineOnCallRules },
      held: {
        occurTick: '発生tickだけを動かす。新人の復旧1、主力の復旧3、主力の消耗2、新人の消耗1',
        recover: '新人の復旧だけを動かす。主力の復旧はその2上。発生tick0、主力の消耗2、新人の消耗1',
        fatigue: '主力の消耗だけを動かす。新人の消耗1。発生tick0、新人の復旧1、主力の復旧3',
      },
      occurDefinition:
        '障害が発生する期間の開始tick。そのtick未満の当番は復旧しない。消耗・出荷・経験は付く。0は初回。2は期末で2期間とも復旧しない',
      recoverDefinition:
        '新人の1期間の復旧。主力は常にその2上で、状態へ保存した復旧量は書き換えない',
      fatigueDefinition:
        '主力の1期間の待機消耗。新人の消耗率は1のまま。両者へ同じ増分を足すと当番はどの戦略も2人期で差引が同じだけ下がり順序は動かないため、その増分は掃引しない',
      steps: {
        occurTick: [...OCCUR_STEPS],
        recover: [...RECOVER_STEPS],
        fatigue: [...FATIGUE_STEPS],
      },
      omitted: '初回の3盤面×3戦略の表は再出力しない。基準行だけ初回JSONと照合する',
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: [
      ...reversalsOf(sweeps.occurTick),
      ...reversalsOf(sweeps.recover),
      ...reversalsOf(sweeps.fatigue),
    ],
  };
}
