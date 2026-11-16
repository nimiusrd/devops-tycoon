/** RI-195: 探索は一度だけ払い、採用しない案の成果は出荷へ足さない。選択中は時間を止める。 */
import { createRng, getRngState } from '../sim/rng';

export type ProposalId = 'fast' | 'durable' | 'spare';
export type CompanyPosture = 'launch' | 'maintain';
export type SolutionStrategy = 'rush' | 'compare-fast' | 'compare-durable' | 'wait';
export type SolutionInput =
  { type: 'explore' } | { type: 'adopt'; proposal: ProposalId } | { type: 'tick' };
export interface SolutionState {
  version: 1;
  seed: number;
  tick: number;
  horizon: number;
  posture: CompanyPosture;
  focus: number;
  focusSpent: number;
  explored: boolean;
  phase: 'ready' | 'exploring' | 'choosing' | 'implementing' | 'shipped';
  workLeft: number;
  adopted: ProposalId | null;
  rejected: ProposalId | null;
  shippedValue: number;
  followUp: number;
  upkeep: number;
  safetyLoss: number;
  generation: number;
  inputs: SolutionInput[];
}
/** 初回比較の資源。保守係数1は姿勢係数のまま。選択停止は3案のときだけ期末を消費する。 */
export interface SolutionRules {
  exploreTicks: number;
  upkeepScale: number;
  safetyLoss: number;
  proposalCount: 2 | 3;
  choicePauseTicks: number;
}
export const baselineSolutionRules: SolutionRules = {
  exploreTicks: 2,
  upkeepScale: 1,
  safetyLoss: 4,
  proposalCount: 2,
  choicePauseTicks: 0,
};
const SHIP = 8;
const FOLLOW = 4;
const FAST_WORK = 2;
const DURABLE_WORK = 5;
const SPARE_WORK = 6;
const EXPLORE_FOCUS = 1;
const PENALTY = 12;
const POSTURE_UPKEEP = { launch: 1, maintain: 3 } as const;
export function createSolutionPrototype(
  seed: number,
  horizon: number,
  posture: CompanyPosture,
): SolutionState {
  const rng = createRng(seed);
  rng();
  return {
    version: 1,
    seed,
    tick: 0,
    horizon,
    posture,
    focus: 2,
    focusSpent: 0,
    explored: false,
    phase: 'ready',
    workLeft: 0,
    adopted: null,
    rejected: null,
    shippedValue: 0,
    followUp: 0,
    upkeep: 0,
    safetyLoss: 0,
    generation: getRngState(rng),
    inputs: [],
  };
}
function upkeepRate(posture: CompanyPosture, id: ProposalId, rules: SolutionRules) {
  if (id !== 'fast') return 0;
  return POSTURE_UPKEEP[posture] * rules.upkeepScale;
}
function workOf(id: ProposalId) {
  if (id === 'fast') return FAST_WORK;
  if (id === 'durable') return DURABLE_WORK;
  return SPARE_WORK;
}
function proposalIds(rules: SolutionRules): ProposalId[] {
  if (rules.proposalCount >= 3) return ['fast', 'durable', 'spare'];
  return ['fast', 'durable'];
}
function enterChoosing(state: SolutionState, rules: SolutionRules) {
  state.phase = 'choosing';
  state.workLeft = rules.proposalCount >= 3 ? rules.choicePauseTicks : 0;
}
function canAdopt(state: SolutionState, proposal: ProposalId, rules: SolutionRules) {
  if (proposal === 'spare' && rules.proposalCount < 3) return false;
  if (state.phase === 'exploring' || state.phase === 'implementing' || state.phase === 'shipped') {
    return false;
  }
  if (state.phase === 'choosing' && state.workLeft > 0) return false;
  if (state.phase === 'ready') return proposal === 'fast';
  return state.phase === 'choosing';
}
export function viewSolution(state: SolutionState, rules: SolutionRules = baselineSolutionRules) {
  return {
    tick: state.tick,
    horizon: state.horizon,
    posture: state.posture,
    phase: state.phase,
    generation: state.generation,
    exploreFocus: EXPLORE_FOCUS,
    exploreTicks: rules.exploreTicks,
    timeStopped: state.phase === 'choosing' && state.workLeft <= 0,
    proposals: proposalIds(rules).map((id) => {
      const known = (state.explored && state.phase !== 'exploring') || state.adopted === id;
      const firstDraft = id === 'fast';
      return {
        id,
        revealed: known,
        work: known || firstDraft ? workOf(id) : null,
        shipValue: known || firstDraft ? SHIP : null,
        upkeepPerTick: known ? upkeepRate(state.posture, id, rules) : null,
        safetyLoss: known ? (id === 'fast' ? rules.safetyLoss : 0) : null,
      };
    }),
  };
}
export function applySolutionInput(
  state: SolutionState,
  input: SolutionInput,
  rules: SolutionRules = baselineSolutionRules,
): SolutionState {
  if (state.tick >= state.horizon) return state;
  if (input.type === 'tick' && state.phase === 'choosing' && state.workLeft <= 0) return state;
  if (
    input.type === 'explore' &&
    (state.phase !== 'ready' || state.explored || state.focus < EXPLORE_FOCUS)
  ) {
    return state;
  }
  if (input.type === 'adopt' && !canAdopt(state, input.proposal, rules)) return state;
  const next = structuredClone(state);
  if (input.type === 'explore') {
    next.focus -= EXPLORE_FOCUS;
    next.focusSpent += EXPLORE_FOCUS;
    next.explored = true;
    if (rules.exploreTicks <= 0) enterChoosing(next, rules);
    else {
      next.phase = 'exploring';
      next.workLeft = rules.exploreTicks;
    }
  } else if (input.type === 'adopt') {
    next.adopted = input.proposal;
    next.rejected = input.proposal === 'fast' ? 'durable' : 'fast';
    next.phase = 'implementing';
    next.workLeft = workOf(input.proposal);
  } else {
    next.tick += 1;
    if (next.phase === 'exploring' || next.phase === 'implementing') {
      next.workLeft -= 1;
      if (next.workLeft === 0 && next.phase === 'exploring') enterChoosing(next, rules);
      if (next.workLeft === 0 && next.phase === 'implementing' && next.adopted !== null) {
        next.phase = 'shipped';
        next.shippedValue += SHIP;
        next.safetyLoss += next.adopted === 'fast' ? rules.safetyLoss : 0;
        next.upkeep += upkeepRate(next.posture, next.adopted, rules) * next.horizon;
      }
    } else if (next.phase === 'choosing') {
      next.workLeft -= 1;
    } else if (next.phase === 'shipped') {
      next.followUp += FOLLOW;
    }
  }
  next.inputs.push(structuredClone(input));
  return next;
}
export function summarizeSolution(state: SolutionState) {
  const withheldValue = state.rejected === null ? 0 : SHIP;
  const unfinishedPenalty = state.phase === 'shipped' ? 0 : PENALTY;
  return {
    phase: state.phase,
    adopted: state.adopted,
    rejected: state.rejected,
    explored: state.explored,
    shippedValue: state.shippedValue,
    followUp: state.followUp,
    upkeep: state.upkeep,
    safetyLoss: state.safetyLoss,
    focusSpent: state.focusSpent,
    withheldValue,
    unfinishedPenalty,
    netValue:
      state.shippedValue +
      state.followUp -
      state.upkeep -
      state.safetyLoss -
      state.focusSpent -
      unfinishedPenalty,
  };
}
export function chooseSolutionAction(
  state: SolutionState,
  strategy: SolutionStrategy,
): SolutionInput {
  if (state.phase === 'choosing') {
    if (state.workLeft > 0) return { type: 'tick' };
    return { type: 'adopt', proposal: strategy === 'compare-durable' ? 'durable' : 'fast' };
  }
  if (state.phase === 'ready' && strategy !== 'wait') {
    if (strategy === 'rush') return { type: 'adopt', proposal: 'fast' };
    return { type: 'explore' };
  }
  return { type: 'tick' };
}
export function compareSolutionStrategies(seed = 195) {
  return (['launch', 'maintain'] as const).flatMap((posture) =>
    ([6, 14] as const).flatMap((horizon) =>
      (['rush', 'compare-fast', 'compare-durable', 'wait'] as const).map((strategy) => {
        const initial = createSolutionPrototype(seed, horizon, posture);
        let state = initial;
        let guard = 0;
        while (state.tick < horizon) {
          if (++guard > 80) throw new Error(`${posture}:${horizon}:${strategy}`);
          const next = applySolutionInput(state, chooseSolutionAction(state, strategy));
          if (next === state) throw new Error(`${posture}:${horizon}:${strategy}@${state.tick}`);
          state = next;
        }
        return {
          posture,
          horizon,
          strategy,
          initial,
          inputs: state.inputs,
          result: summarizeSolution(state),
        };
      }),
    ),
  );
}

const FACTOR_SEED = 195;
const FACTOR_POSTURES = ['launch', 'maintain'] as const;
const FACTOR_HORIZONS = [6, 14] as const;
export type SolutionPreference = 'compare' | 'first' | 'tie';
export interface SolutionFactorRun {
  inputs: SolutionInput[];
  result: ReturnType<typeof summarizeSolution>;
}
export interface SolutionScenarioComparison {
  posture: CompanyPosture;
  horizon: number;
  preference: SolutionPreference;
  margin: number;
  first: SolutionFactorRun;
  compare: SolutionFactorRun;
}
export interface SolutionFactorPoint {
  axis: string;
  parameter: string;
  rules: SolutionRules;
  scenarios: SolutionScenarioComparison[];
}
export interface SolutionFactorReversal {
  axis: string;
  posture: CompanyPosture;
  horizon: number;
  before: { parameter: string; preference: SolutionPreference; first: number; compare: number };
  after: { parameter: string; preference: SolutionPreference; first: number; compare: number };
}
function cloneRules(rules: SolutionRules): SolutionRules {
  return { ...rules };
}
function withRules(patch: Partial<SolutionRules>): SolutionRules {
  return { ...baselineSolutionRules, ...patch };
}
function preferenceOf(first: number, compare: number): SolutionPreference {
  if (compare > first) return 'compare';
  if (first > compare) return 'first';
  return 'tie';
}
function runSolution(
  posture: CompanyPosture,
  horizon: number,
  strategy: SolutionStrategy,
  rules: SolutionRules,
): SolutionFactorRun {
  let state = createSolutionPrototype(FACTOR_SEED, horizon, posture);
  let guard = 0;
  while (state.tick < horizon) {
    if (++guard > 200) throw new Error(`${posture}:${horizon}:${strategy}`);
    const next = applySolutionInput(state, chooseSolutionAction(state, strategy), rules);
    if (next === state) throw new Error(`${posture}:${horizon}:${strategy}@${state.tick}`);
    state = next;
  }
  return { inputs: state.inputs, result: summarizeSolution(state) };
}
function point(axis: string, parameter: string, rules: SolutionRules): SolutionFactorPoint {
  const scenarios = FACTOR_POSTURES.flatMap((posture) =>
    FACTOR_HORIZONS.map((horizon) => {
      const first = runSolution(posture, horizon, 'rush', rules);
      const fast = runSolution(posture, horizon, 'compare-fast', rules);
      const durable = runSolution(posture, horizon, 'compare-durable', rules);
      const compare = durable.result.netValue > fast.result.netValue ? durable : fast;
      return {
        posture,
        horizon,
        preference: preferenceOf(first.result.netValue, compare.result.netValue),
        margin: compare.result.netValue - first.result.netValue,
        first,
        compare,
      };
    }),
  );
  return { axis, parameter, rules: cloneRules(rules), scenarios };
}
function reversalsOf(rows: SolutionFactorPoint[]): SolutionFactorReversal[] {
  const found: SolutionFactorReversal[] = [];
  for (let index = 1; index < rows.length; index += 1) {
    const before = rows[index - 1];
    const after = rows[index];
    if (!before || !after) continue;
    for (const earlier of before.scenarios) {
      const later = after.scenarios.find(
        (item) => item.posture === earlier.posture && item.horizon === earlier.horizon,
      );
      if (!later || earlier.preference === later.preference) continue;
      found.push({
        axis: before.axis,
        posture: earlier.posture,
        horizon: earlier.horizon,
        before: {
          parameter: before.parameter,
          preference: earlier.preference,
          first: earlier.first.result.netValue,
          compare: earlier.compare.result.netValue,
        },
        after: {
          parameter: after.parameter,
          preference: later.preference,
          first: later.first.result.netValue,
          compare: later.compare.result.netValue,
        },
      });
    }
  }
  return found;
}
/** 初回と同じ資源で、探索tick・保守係数・安全損失・3案の選択停止を一つずつ動かす。固定戦略。 */
export function compareSolutionFactorReversals() {
  const sweeps = {
    exploreTicks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((exploreTicks) =>
      point('exploreTicks', String(exploreTicks), withRules({ exploreTicks })),
    ),
    upkeepScale: [0, 0.5, 1, 1.5, 2, 3, 5, 5.5, 6].map((upkeepScale) =>
      point('upkeepScale', String(upkeepScale), withRules({ upkeepScale })),
    ),
    safetyLoss: [0, 4, 6, 7, 8, 18, 19, 20, 30, 31, 32].map((safetyLoss) =>
      point('safetyLoss', String(safetyLoss), withRules({ safetyLoss })),
    ),
    choicePauseTicks: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((choicePauseTicks) =>
      point(
        'choicePauseTicks',
        String(choicePauseTicks),
        withRules({ proposalCount: 3, choicePauseTicks }),
      ),
    ),
  };
  return {
    conditions: {
      seed: FACTOR_SEED,
      postures: [...FACTOR_POSTURES],
      horizons: [...FACTOR_HORIZONS],
      resources: {
        ship: SHIP,
        followPerTick: FOLLOW,
        fastWork: FAST_WORK,
        durableWork: DURABLE_WORK,
        spareWork: SPARE_WORK,
        exploreFocus: EXPLORE_FOCUS,
        unfinishedPenalty: PENALTY,
        postureUpkeep: { ...POSTURE_UPKEEP },
      },
      decision: {
        first: 'rush',
        compare: '探索後、速い案と耐久案のうち差引が高い方。同点は速い案',
        spare: '選ばない。耐久案より実装が1tick遅い',
        score: 'netValue',
      },
      baseline: cloneRules(baselineSolutionRules),
      held: {
        exploreTicks: '探索tickだけ。保守係数1、安全損失4、案は2つ、選択停止0',
        upkeepScale: '速い案の保守 = 姿勢係数 × 保守係数 × 期末。耐久案と予備案は0',
        safetyLoss: '速い案の安全損失だけ。耐久案と予備案は0',
        choicePauseTicks:
          '案を3つにし、選択停止のtickだけ期末を消費する。その間は実装も追随も増やさない',
      },
      spareUpkeep: 0,
      spareSafetyLoss: 0,
      twoProposalChoiceStopsTime: true,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
    },
    sweeps,
    reversals: Object.values(sweeps).flatMap((rows) => reversalsOf(rows)),
  };
}
