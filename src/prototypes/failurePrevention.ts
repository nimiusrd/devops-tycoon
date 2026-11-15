/** RI-164: 点火sourceと分離した原因分類。対策は仕様漏れのチェックリスト1種だけ。 */
export type FailureCause = 'spec-omission' | 'migration-failure';
export type PreventionInput = 'work' | 'checklist' | 'induce-failure';
export interface PreventionJob {
  id: string;
  cause: FailureCause;
  stage: 'work' | 'repair' | 'done';
  remaining: number;
  /** 無いときは失敗する。失敗しなかった仕事は台帳へ原因を書かない。 */
  fails?: boolean;
  /** 無いときは cause だけ。複数のときは各原因の損失を足し、修復は長い方の1回。 */
  causes?: FailureCause[];
}
export interface PreventionState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  prevention: 0 | 1;
  investment: number;
  loss: number;
  incidents: { jobId: string | null; cause: FailureCause; loss: number; induced: boolean }[];
  jobs: PreventionJob[];
  inputs: PreventionInput[];
  /** 無いときは1。対策済みの仕様漏れの損失だけを置き換える。修復は1のまま。 */
  residualLoss?: number;
  /** 無いときは0。対策後の作業tickごとに投資へ足す。導入の2tickには掛けない。 */
  maintenancePerTick?: number;
}
export function createPreventionPrototype(
  seed: string | number,
  nextCause: FailureCause,
): PreventionState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 12,
    prevention: 0,
    investment: 0,
    loss: 0,
    incidents: [],
    jobs: ['spec-omission', nextCause, nextCause].map((cause, index) => ({
      id: `job-${index}`,
      cause: cause as FailureCause,
      stage: 'work',
      remaining: 2,
    })),
    inputs: [],
  };
}
/** 免疫ではなく限定軽減。残損失の既定は1で、修復は対策済みの仕様漏れだけ1。 */
export function describePrevention(cause: FailureCause, prevention: 0 | 1, residualLoss = 1) {
  const protectedJob = cause === 'spec-omission' && prevention === 1;
  return { loss: protectedJob ? residualLoss : 4, repairTicks: protectedJob ? 1 : 2 };
}
export function tickPreventionPrototype(
  state: PreventionState,
  input: PreventionInput,
): PreventionState {
  if (state.tick >= state.horizon || state.jobs.every((job) => job.stage === 'done')) return state;
  const active = state.jobs.find((job) => job.stage !== 'done')!;
  // 投資と故意の失敗は仕事開始前のみ。対策は実際に記録した原因に結び付ける。
  if (input !== 'work' && (active.stage !== 'work' || active.remaining !== 2)) return state;
  if (
    input === 'checklist' &&
    (state.prevention === 1 ||
      !state.incidents.some((incident) => incident.cause === 'spec-omission'))
  )
    return state;
  if (input !== 'work' && state.horizon - state.tick < 2) return state;
  const next = structuredClone(state);
  if (input === 'checklist') {
    next.prevention = 1;
    next.investment += 2;
    next.tick += 2;
  } else if (input === 'induce-failure') {
    // 故意の事故は成果なし・損失4・2工数。対策済みでも強さは増えない。
    next.tick += 2;
    next.loss += 4;
    next.incidents.push({ jobId: null, cause: 'spec-omission', loss: 4, induced: true });
  } else {
    if (next.prevention === 1 && (next.maintenancePerTick ?? 0) > 0) {
      next.investment += next.maintenancePerTick ?? 0;
    }
    next.tick++;
    const job = next.jobs.find((candidate) => candidate.id === active.id)!;
    job.remaining--;
    if (job.remaining === 0) {
      if (job.stage === 'work') {
        if (job.fails === false) job.stage = 'done';
        else {
          const causes = job.causes ?? [job.cause];
          let repairTicks = 0;
          for (const cause of causes) {
            const effect = describePrevention(cause, next.prevention, next.residualLoss ?? 1);
            next.loss += effect.loss;
            next.incidents.push({ jobId: job.id, cause, loss: effect.loss, induced: false });
            repairTicks = Math.max(repairTicks, effect.repairTicks);
          }
          job.stage = 'repair';
          job.remaining = repairTicks;
        }
      } else job.stage = 'done';
    }
  }
  next.inputs.push(input);
  return next;
}
export function summarizePrevention(state: PreventionState) {
  const value = state.jobs.filter((job) => job.stage === 'done').length * 8;
  return {
    value,
    loss: state.loss,
    investment: state.investment,
    netValue: value - state.loss - state.investment,
    prevention: state.prevention,
    incidents: state.incidents,
    pending: state.jobs.filter((job) => job.stage !== 'done'),
  };
}
export function comparePreventionStrategies(seed: string | number) {
  return (['spec-omission', 'migration-failure'] as const).flatMap((nextCause) =>
    (['ship', 'prevent', 'farm'] as const).map((strategy) => {
      const initial = createPreventionPrototype(seed, nextCause);
      let state = initial;
      // 共通の初仕事を完了し、確認済みの失敗原因を得る。
      for (let tick = 0; tick < 4; tick++) state = tickPreventionPrototype(state, 'work');
      if (strategy === 'farm') {
        state = tickPreventionPrototype(state, 'induce-failure');
        state = tickPreventionPrototype(state, 'induce-failure');
      }
      if (strategy !== 'ship') state = tickPreventionPrototype(state, 'checklist');
      while (state.tick < state.horizon && state.jobs.some((job) => job.stage !== 'done')) {
        state = tickPreventionPrototype(state, 'work');
      }
      return {
        nextCause,
        strategy,
        initial,
        inputs: state.inputs,
        result: summarizePrevention(state),
      };
    }),
  );
}

export const baselinePreventionFactors = {
  forecastHits: 2,
  failurePattern: '2',
  residualLoss: 1,
  maintenancePerTick: 0,
  earlyAccidents: 0,
  multiPattern: '0',
  opportunityPerTick: 0,
} as const;

export type PreventionFactors = {
  forecastHits: 0 | 1 | 2;
  failurePattern: '2' | '1-leading' | '1-trailing' | '0';
  residualLoss: 0 | 1 | 2 | 3 | 4;
  maintenancePerTick: 0 | 1 | 2 | 3;
  earlyAccidents: 0 | 1 | 2;
  multiPattern: '0' | '1-leading' | '1-trailing' | '2';
  opportunityPerTick: 0 | 1 | 2 | 3 | 4;
};
export type PreventionFactorAxis = keyof PreventionFactors;
export type PreventionChoice = 'ship' | 'place';

const FACTOR_LEVELS = {
  forecastHits: [2, 1, 0],
  failurePattern: ['2', '1-leading', '1-trailing', '0'],
  residualLoss: [0, 1, 2, 3, 4],
  maintenancePerTick: [0, 1, 2, 3],
  earlyAccidents: [0, 1, 2],
  multiPattern: ['0', '1-leading', '1-trailing', '2'],
  opportunityPerTick: [0, 1, 2, 3, 4],
} as const satisfies Record<PreventionFactorAxis, readonly (number | string)[]>;

const FACTOR_AXES = Object.keys(FACTOR_LEVELS) as PreventionFactorAxis[];

export interface PreventionDecision {
  value: number;
  loss: number;
  investment: number;
  netValue: number;
  prevention: 0 | 1;
  incidents: PreventionState['incidents'];
  pending: PreventionJob[];
  spareTicks: number;
  spareValue: number;
  score: number;
}

export interface PreventionFactorPoint {
  axis: PreventionFactorAxis;
  level: number | string;
  factors: PreventionFactors;
  initial: PreventionState;
  inputs: Record<PreventionChoice, PreventionInput[]>;
  results: Record<PreventionChoice, PreventionDecision>;
  leaders: PreventionChoice[];
}

export interface PreventionFactorBoundary {
  axis: PreventionFactorAxis;
  placeLeads: (number | string)[];
  ties: (number | string)[];
  shipLeads: (number | string)[];
  edges: {
    before: number | string;
    after: number | string;
    beforeLeaders: PreventionChoice[];
    afterLeaders: PreventionChoice[];
  }[];
  fractionalTie:
    | { kind: 'perTick'; num: number; den: number }
    | { kind: 'endpointWeight'; high: 2; low: 0; num: number; den: number }
    | null;
}

function levelOf<T extends number | string>(levels: readonly T[], level: number | string): T {
  const found = levels.find((candidate) => candidate === level);
  if (found === undefined) throw new Error(`unknown factor level ${String(level)}`);
  return found;
}

function factorsAt(axis: PreventionFactorAxis, level: number | string): PreventionFactors {
  const next: PreventionFactors = { ...baselinePreventionFactors };
  if (axis === 'opportunityPerTick') next.failurePattern = '0';
  if (axis === 'forecastHits') next.forecastHits = levelOf(FACTOR_LEVELS.forecastHits, level);
  else if (axis === 'failurePattern')
    next.failurePattern = levelOf(FACTOR_LEVELS.failurePattern, level);
  else if (axis === 'residualLoss') next.residualLoss = levelOf(FACTOR_LEVELS.residualLoss, level);
  else if (axis === 'maintenancePerTick')
    next.maintenancePerTick = levelOf(FACTOR_LEVELS.maintenancePerTick, level);
  else if (axis === 'earlyAccidents')
    next.earlyAccidents = levelOf(FACTOR_LEVELS.earlyAccidents, level);
  else if (axis === 'multiPattern') next.multiPattern = levelOf(FACTOR_LEVELS.multiPattern, level);
  else next.opportunityPerTick = levelOf(FACTOR_LEVELS.opportunityPerTick, level);
  return next;
}

function remainingCauses(hits: PreventionFactors['forecastHits']): [FailureCause, FailureCause] {
  if (hits === 2) return ['spec-omission', 'spec-omission'];
  if (hits === 1) return ['spec-omission', 'migration-failure'];
  return ['migration-failure', 'migration-failure'];
}

function failureFlags(pattern: PreventionFactors['failurePattern']): [boolean, boolean] {
  if (pattern === '2') return [true, true];
  if (pattern === '0') return [false, false];
  if (pattern === '1-leading') return [true, false];
  return [false, true];
}

function multiFlags(pattern: PreventionFactors['multiPattern']): [boolean, boolean] {
  if (pattern === '0') return [false, false];
  if (pattern === '2') return [true, true];
  if (pattern === '1-leading') return [true, false];
  return [false, true];
}

function factorJob(
  index: number,
  cause: FailureCause,
  fails: boolean,
  multi: boolean,
): PreventionJob {
  const job: PreventionJob = { id: `job-${index}`, cause, stage: 'work', remaining: 2 };
  if (!fails) job.fails = false;
  if (multi) job.causes = ['spec-omission', 'migration-failure'];
  return job;
}

export function createPreventionFactorState(
  seed: string | number,
  factors: PreventionFactors,
): PreventionState {
  const state = createPreventionPrototype(seed, 'spec-omission');
  const [second, third] = remainingCauses(factors.forecastHits);
  const fails = failureFlags(factors.failurePattern);
  const multi = multiFlags(factors.multiPattern);
  state.jobs = [
    factorJob(0, 'spec-omission', true, false),
    factorJob(1, second, fails[0], multi[0]),
    factorJob(2, third, fails[1], multi[1]),
  ];
  if (factors.residualLoss !== 1) state.residualLoss = factors.residualLoss;
  if (factors.maintenancePerTick !== 0) state.maintenancePerTick = factors.maintenancePerTick;
  return state;
}

function playChoice(
  initial: PreventionState,
  choice: PreventionChoice,
  factors: PreventionFactors,
) {
  let state = initial;
  if (choice === 'place') {
    if (factors.earlyAccidents > 0) {
      for (let count = 0; count < factors.earlyAccidents; count += 1) {
        state = tickPreventionPrototype(state, 'induce-failure');
      }
    } else {
      for (let count = 0; count < 4; count += 1) state = tickPreventionPrototype(state, 'work');
    }
    state = tickPreventionPrototype(state, 'checklist');
    if (state.prevention !== 1) throw new Error('checklist rejected');
  }
  while (state.tick < state.horizon && state.jobs.some((job) => job.stage !== 'done')) {
    const next = tickPreventionPrototype(state, 'work');
    if (next === state) break;
    state = next;
  }
  const summary = summarizePrevention(state);
  const spareTicks = state.horizon - state.tick;
  const spareValue = spareTicks * factors.opportunityPerTick;
  return {
    inputs: state.inputs,
    result: { ...summary, spareTicks, spareValue, score: summary.netValue + spareValue },
  };
}

function leadersOf(place: number, ship: number): PreventionChoice[] {
  if (place === ship) return ['place', 'ship'];
  return place > ship ? ['place'] : ['ship'];
}

function fraction(num: number, den: number) {
  let left = Math.abs(num);
  let right = Math.abs(den);
  while (right !== 0) {
    const rest = left % right;
    left = right;
    right = rest;
  }
  return { num: num / left, den: den / left };
}

function fractionalTie(
  axis: PreventionFactorAxis,
  points: readonly PreventionFactorPoint[],
): PreventionFactorBoundary['fractionalTie'] {
  if (axis === 'maintenancePerTick') {
    const zero = points.find((point) => point.level === 0);
    const one = points.find((point) => point.level === 1);
    if (!zero || !one) return null;
    const charged = one.results.place.investment - zero.results.place.investment;
    const margin = zero.results.place.score - zero.results.ship.score;
    if (charged <= 0 || margin <= 0) return null;
    return { kind: 'perTick', ...fraction(margin, charged) };
  }
  if (axis === 'forecastHits') {
    const hit = points.find((point) => point.level === 2);
    const miss = points.find((point) => point.level === 0);
    if (!hit || !miss || hit.results.ship.score !== miss.results.ship.score) return null;
    const num = hit.results.ship.score - miss.results.place.score;
    const den = hit.results.place.score - miss.results.place.score;
    if (den <= 0 || num <= 0 || num >= den) return null;
    return { kind: 'endpointWeight', high: 2, low: 0, ...fraction(num, den) };
  }
  return null;
}

function boundaryOf(
  axis: PreventionFactorAxis,
  points: readonly PreventionFactorPoint[],
): PreventionFactorBoundary {
  const edges: PreventionFactorBoundary['edges'] = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (!before || !after || before.leaders.join('|') === after.leaders.join('|')) continue;
    edges.push({
      before: before.level,
      after: after.level,
      beforeLeaders: before.leaders,
      afterLeaders: after.leaders,
    });
  }
  return {
    axis,
    placeLeads: points
      .filter((point) => point.leaders.length === 1 && point.leaders[0] === 'place')
      .map((point) => point.level),
    ties: points.filter((point) => point.leaders.length > 1).map((point) => point.level),
    shipLeads: points
      .filter((point) => point.leaders.length === 1 && point.leaders[0] === 'ship')
      .map((point) => point.level),
    edges,
    fractionalTie: fractionalTie(axis, points),
  };
}

/** 初回と同じ資源で要因を一つずつ動かす。固定戦略の計算で、初回の事故稼ぎは再走しない。 */
export function comparePreventionFactorSweep(seed: string | number) {
  const points = FACTOR_AXES.flatMap((axis) =>
    FACTOR_LEVELS[axis].map((level) => {
      const factors = factorsAt(axis, level);
      const initial = createPreventionFactorState(seed, factors);
      const ship = playChoice(initial, 'ship', factors);
      const place = playChoice(initial, 'place', factors);
      return {
        axis,
        level,
        factors,
        initial,
        inputs: { ship: ship.inputs, place: place.inputs },
        results: { ship: ship.result, place: place.result },
        leaders: leadersOf(place.result.score, ship.result.score),
      };
    }),
  );
  return {
    conditions: {
      seed,
      horizon: 12,
      jobs: 3,
      workTicks: 2,
      jobValue: 8,
      failureLoss: 4,
      failureRepair: 2,
      checklistTicks: 2,
      checklistInvestment: 2,
      protectedRepair: 1,
      repeatedFirstComparison: false,
      strategies: ['ship', 'place'] as const,
      excludedStrategies: ['farm'] as const,
      held: baselinePreventionFactors,
      opportunityHeldFailurePattern: '0' as const,
      maintenanceSkipsAdoptionTicks: true,
      multiCauseLoss: 'sum' as const,
      multiCauseRepair: 'max' as const,
      forecastDoesNotAdapt: true,
      fixedStrategies: true,
      humanPlaytest: false,
      productionIntegration: false,
      values: FACTOR_LEVELS,
    },
    points,
    boundaries: FACTOR_AXES.map((axis) =>
      boundaryOf(
        axis,
        points.filter((point) => point.axis === axis),
      ),
    ),
  };
}
