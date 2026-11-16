import { quoteRecovery, type RecoveryIncident } from './incidentRecovery';

/** RI-171: 2領域の固定盤面。復旧と影響範囲の制限は別操作。 */
export type IsolationDomain = 'product' | 'platform';

/**
 * 初回比較の規則。状態に rules が無いときは baselineIsolationRules。
 * 再評価はここから一つだけ動かす。波及確率は抽選せず、当たる試行と外れる試行の期待値にする。
 */
export interface IsolationRules {
  /** 製品側の同種障害の件数。損失率は重ねず、復旧は1件ずつ。 */
  incidentCount: number;
  /** 復旧開始時に、隔離されていない領域の予備仕事を1件入れる。 */
  inflowDuringRecovery: boolean;
  /** 隔離戦略が最初の隔離まで待つtick。0は修理より先に隔離する。 */
  isolationDelay: number;
  /** 真なら差引の顧客損失を、修理時点の公開見積に置き換える。 */
  publicForecast: boolean;
  /** 真ならtick開始時に製品の仕事が未完なら基盤を進めない。 */
  domainDependency: boolean;
  /** 真なら解決のあと1回だけ再発し、追加の修理はしない。 */
  recurrenceAfterRelease: boolean;
  /** 未隔離で波及が当たる割合。1は初回の「対象外も止まる」。 */
  spreadProbability: number;
  /** 隔離が波及を抑える割合。1なら隔離中の実効波及は0。 */
  mitigationRate: number;
}

export const baselineIsolationRules: IsolationRules = {
  incidentCount: 1,
  inflowDuringRecovery: false,
  isolationDelay: 0,
  publicForecast: false,
  domainDependency: false,
  recurrenceAfterRelease: false,
  spreadProbability: 1,
  mitigationRate: 1,
};
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
  /** 無いときは初回の規則。初回の比較JSONはこのフィールドを持たない。 */
  rules?: IsolationRules;
  /** 最初の障害の後ろに待つ同種障害。無いときは0。 */
  incidentQueue?: number;
  /** この試行で波及が当たるか。無いときは当たる。 */
  spreadHits?: boolean;
  /** 隔離が波及を止めるか。無いときは止める。 */
  isolationStopsSpread?: boolean;
  /** 再発を1回済ませたか。 */
  recurred?: boolean;
  /** 修理のたびに足した公開見積。publicForecast の差引だけが使う。 */
  announcedLoss?: number;
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
  if (input.type === 'repair') {
    const quote = quoteRecovery(state.incident, 'fix');
    const startingNext = state.incident.status === 'resolved' && (state.incidentQueue ?? 0) > 0;
    if ((!startingNext && state.incident.status !== 'active') || state.focus < quote.focus)
      return state;
  }
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
    if (rulesOf(next).recurrenceAfterRelease && !next.recurred) reactivate(next);
  } else if (input.type === 'admit') {
    next.tasks.find((t) => t.id === input.id)!.admitted = true;
  } else if (input.type === 'repair') {
    const quote = quoteRecovery(next.incident, 'fix');
    if (next.incident.status === 'resolved') next.incidentQueue = (next.incidentQueue ?? 0) - 1;
    next.incident.status = 'recovering';
    next.incident.method = 'fix';
    next.incident.workLeft = quote.work;
    next.incident.resolvedTick = null;
    next.focus -= quote.focus;
    next.focusSpent += quote.focus;
    if (rulesOf(next).publicForecast) {
      const spread = next.isolated === null ? 1 : 0;
      next.announcedLoss =
        (next.announcedLoss ?? 0) + quote.work * (next.incident.lossPerTick + spread);
    }
  } else {
    next.tick++;
    const rules = rulesOf(next);
    if (
      rules.recurrenceAfterRelease &&
      !next.recurred &&
      next.isolated === null &&
      next.incident.status === 'resolved'
    ) {
      reactivate(next);
    }
    const active = next.incident.status !== 'resolved';
    const spreading = spreadHitsNow(next, active);
    if (active) next.customerLoss += next.incident.lossPerTick;
    if (spreading) {
      next.spreadTicks++;
      next.customerLoss++; // 対象外領域への波及。隔離は元の事故・損失を消さない。
    }
    const productDone = next.tasks.some(
      (task) => task.id === 'product-job' && task.stage === 'done',
    );
    for (const domain of ['product', 'platform'] as const) {
      const task = next.tasks.find((t) => t.domain === domain && t.admitted && t.stage !== 'done');
      if (!task) continue;
      const dependencyBlock = domain === 'platform' && rules.domainDependency && !productDone;
      if (
        next.isolated === domain ||
        dependencyBlock ||
        (active && (domain === 'product' || spreading))
      ) {
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
  const contained = state.isolated !== null && state.isolationStopsSpread !== false;
  const spreadRate = state.spreadHits !== false && !contained ? 1 : 0;
  const outstandingImpact = remainingWork * (state.incident.lossPerTick + spreadRate);
  const scoredLoss =
    state.rules?.publicForecast === true
      ? (state.announcedLoss ?? state.customerLoss)
      : state.customerLoss;
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
    netValue: 20 + value - state.focusSpent - scoredLoss - outstandingImpact,
  };
}

function rulesOf(state: IsolationState): IsolationRules {
  return state.rules ?? baselineIsolationRules;
}

function reactivate(state: IsolationState) {
  state.incident.status = 'active';
  state.incident.method = null;
  state.incident.workLeft = 0;
  state.incident.resolvedTick = null;
  state.recurred = true;
}

/** 未隔離かつ波及が当たるときだけ対象外を止める。隔離は isolationStopsSpread が偽でない限り止める。 */
function spreadHitsNow(state: IsolationState, active: boolean): boolean {
  if (!active || state.spreadHits === false) return false;
  if (state.isolated !== null && state.isolationStopsSpread !== false) return false;
  return true;
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

export type IsolationStrategy = 'open' | 'isolate';
export type IsolationPreference = IsolationStrategy | 'tie';
export interface IsolationFraction {
  num: number;
  den: number;
}
export interface IsolationPlay {
  inputs: IsolationInput[];
  result: ReturnType<typeof summarizeIsolation>;
  announcedLoss: number | null;
}
interface IsolationWorld {
  spreadHits?: boolean;
  isolationStopsSpread?: boolean;
}

function gcd(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

function fraction(num: number, den: number): IsolationFraction {
  if (den === 0) throw new Error('RI-171 zero denominator');
  if (den < 0) {
    num = -num;
    den = -den;
  }
  const divisor = gcd(num, den);
  return { num: num / divisor, den: den / divisor };
}

function compareFractions(left: IsolationFraction, right: IsolationFraction): number {
  return left.num * right.den - right.num * left.den;
}

function preferenceOf(
  openNet: IsolationFraction,
  isolateNet: IsolationFraction,
): IsolationPreference {
  const order = compareFractions(openNet, isolateNet);
  if (order === 0) return 'tie';
  return order > 0 ? 'open' : 'isolate';
}

export function createIsolationCase(
  seed: string,
  severe: boolean,
  rules: IsolationRules = baselineIsolationRules,
  world: IsolationWorld = {},
): IsolationState {
  const state = createIsolationPrototype(seed, severe);
  const queue = rules.incidentCount - 1;
  return {
    ...state,
    rules: { ...rules },
    ...(queue > 0 ? { incidentQueue: queue } : {}),
    ...(world.spreadHits === false ? { spreadHits: false } : {}),
    ...(world.isolationStopsSpread === false ? { isolationStopsSpread: false } : {}),
  };
}

function commit(state: IsolationState, input: IsolationInput): IsolationState {
  const next = applyIsolationInput(state, input);
  if (next === state) throw new Error(`RI-171 rejected ${JSON.stringify(input)}`);
  return next;
}

function maybeRepair(state: IsolationState): IsolationState {
  if (
    state.inputs.filter((input) => input.type === 'repair').length >= rulesOf(state).incidentCount
  ) {
    return state;
  }
  const startingNext = state.incident.status === 'resolved' && (state.incidentQueue ?? 0) > 0;
  if (state.incident.status !== 'active' && !startingNext) return state;
  return commit(state, { type: 'repair' });
}

/** 初回と同じ固定戦略。遅れ0は修理より先に隔離し、正の遅れは修理後に待つ。再隔離はしない。 */
export function runIsolationPlay(
  seed: string,
  severe: boolean,
  strategy: IsolationStrategy,
  rules: IsolationRules = baselineIsolationRules,
  world: IsolationWorld = {},
): IsolationPlay {
  let state = createIsolationCase(seed, severe, rules, world);
  if (strategy === 'isolate' && rules.isolationDelay === 0) {
    state = commit(state, { type: 'isolate', domain: 'product' });
  }
  if (rules.inflowDuringRecovery) {
    state = commit(state, { type: 'admit', id: 'platform-reserve' });
    if (state.isolated !== 'product')
      state = commit(state, { type: 'admit', id: 'product-reserve' });
  }
  state = maybeRepair(state);
  let waited = 0;
  while (state.tick < state.horizon) {
    const isolatedOnce = state.inputs.some((input) => input.type === 'isolate');
    if (
      strategy === 'isolate' &&
      !isolatedOnce &&
      rules.isolationDelay > 0 &&
      waited >= rules.isolationDelay &&
      state.incident.status !== 'resolved'
    ) {
      state = commit(state, { type: 'isolate', domain: 'product' });
    }
    if (
      state.isolated &&
      state.incident.status === 'resolved' &&
      (state.incidentQueue ?? 0) === 0
    ) {
      state = commit(state, { type: 'release', domain: state.isolated });
    }
    state = maybeRepair(state);
    state = commit(state, { type: 'tick' });
    waited += 1;
  }
  return {
    inputs: state.inputs,
    result: summarizeIsolation(state),
    announcedLoss: state.announcedLoss ?? null,
  };
}

function pairPlay(
  seed: string,
  severe: boolean,
  rules: IsolationRules,
  world: IsolationWorld = {},
) {
  const open = runIsolationPlay(seed, severe, 'open', rules, world);
  const isolate = runIsolationPlay(seed, severe, 'isolate', rules, world);
  return {
    open,
    isolate,
    preference: preferenceOf(
      fraction(open.result.netValue, 1),
      fraction(isolate.result.netValue, 1),
    ),
  };
}

function changedKeys(rules: IsolationRules): (keyof IsolationRules)[] {
  return (Object.keys(baselineIsolationRules) as (keyof IsolationRules)[]).filter(
    (key) => rules[key] !== baselineIsolationRules[key],
  );
}

const factorSteps: readonly { factor: keyof IsolationRules; rules: IsolationRules }[] = [
  { factor: 'incidentCount', rules: { ...baselineIsolationRules, incidentCount: 2 } },
  {
    factor: 'inflowDuringRecovery',
    rules: { ...baselineIsolationRules, inflowDuringRecovery: true },
  },
  { factor: 'publicForecast', rules: { ...baselineIsolationRules, publicForecast: true } },
  { factor: 'domainDependency', rules: { ...baselineIsolationRules, domainDependency: true } },
  {
    factor: 'recurrenceAfterRelease',
    rules: { ...baselineIsolationRules, recurrenceAfterRelease: true },
  },
];

function boardNets(play: ReturnType<typeof pairPlay>) {
  return {
    open: play.open.result.netValue,
    isolate: play.isolate.result.netValue,
    preference: play.preference,
  };
}

/** 波及が全期間当たる差引と、全期間外れる差引の重み。p は当たる割合。 */
function mixSpread(
  weight: IsolationFraction,
  spreadNet: number,
  missNet: number,
): IsolationFraction {
  return fraction(weight.num * spreadNet + (weight.den - weight.num) * missNet, weight.den);
}

function mixMitigation(
  mitigation: IsolationFraction,
  failedNet: number,
  containedNet: number,
): IsolationFraction {
  return fraction(
    (mitigation.den - mitigation.num) * failedNet + mitigation.num * containedNet,
    mitigation.den,
  );
}

/**
 * 初回と同じ資源の上で要因を一つずつ動かす。
 * 波及確率と軽減率は、当たる試行と外れる試行の期待値で、抽選しない。
 */
export function compareIsolationReversals(seed: string) {
  const lightBase = pairPlay(seed, false, baselineIsolationRules);
  const severeBase = pairPlay(seed, true, baselineIsolationRules);
  const first = compareIsolationStrategies(seed);
  const sameInputs = [false, true].every((severe) =>
    (['open', 'isolate'] as const).every((strategy) => {
      const legacy = first.find((row) => row.severe === severe && row.strategy === strategy);
      const replay = (severe ? severeBase : lightBase)[strategy];
      return (
        legacy?.inputs.length === replay.inputs.length &&
        legacy.inputs.every(
          (input, index) => JSON.stringify(input) === JSON.stringify(replay.inputs[index]),
        ) &&
        legacy.result.netValue === replay.result.netValue
      );
    }),
  );
  if (!sameInputs) throw new Error('RI-171 baseline diverged from the first comparison');

  const factors = factorSteps.map(({ factor, rules }) => {
    const light = pairPlay(seed, false, rules);
    const severe = pairPlay(seed, true, rules);
    const reversed = (['light', 'severe'] as const).filter((board) => {
      const current = board === 'light' ? light.preference : severe.preference;
      const baseline = board === 'light' ? lightBase.preference : severeBase.preference;
      return current !== baseline;
    });
    return { factor, changed: changedKeys(rules), light, severe, reversed };
  });

  const delays = Array.from({ length: 9 }, (_, delay) => {
    const rules = { ...baselineIsolationRules, isolationDelay: delay };
    const light = pairPlay(seed, false, rules);
    const severe = pairPlay(seed, true, rules);
    return { delay, light, severe };
  });
  const delayReversals = (['light', 'severe'] as const).flatMap((board) => {
    const found: {
      factor: 'isolationDelay';
      board: 'light' | 'severe';
      beforeDelay: number;
      afterDelay: number;
      before: IsolationPreference;
      after: IsolationPreference;
      sameInputs: boolean;
    }[] = [];
    for (let index = 1; index < delays.length; index += 1) {
      const before = delays[index - 1];
      const after = delays[index];
      if (!before || !after || before[board].preference === after[board].preference) continue;
      found.push({
        factor: 'isolationDelay',
        board,
        beforeDelay: before.delay,
        afterDelay: after.delay,
        before: before[board].preference,
        after: after[board].preference,
        sameInputs:
          JSON.stringify(after[board].open.inputs) === JSON.stringify(after[board].isolate.inputs),
      });
    }
    return found;
  });

  const worlds = (severe: boolean) => ({
    openSpread: runIsolationPlay(seed, severe, 'open', baselineIsolationRules),
    openMiss: runIsolationPlay(seed, severe, 'open', baselineIsolationRules, { spreadHits: false }),
    isolateContained: runIsolationPlay(seed, severe, 'isolate', baselineIsolationRules),
    isolateFailed: runIsolationPlay(seed, severe, 'isolate', baselineIsolationRules, {
      isolationStopsSpread: false,
    }),
  });
  const lightWorlds = worlds(false);
  const severeWorlds = worlds(true);
  const thresholdFor = (sample: ReturnType<typeof worlds>) => {
    const openMiss = sample.openMiss.result.netValue;
    const openSpread = sample.openSpread.result.netValue;
    const isolateContained = sample.isolateContained.result.netValue;
    const isolateFailed = sample.isolateFailed.result.netValue;
    return {
      spreadProbability: fraction(isolateContained - openMiss, openSpread - openMiss),
      mitigationRate: fraction(openSpread - isolateFailed, isolateContained - isolateFailed),
    };
  };
  const lightThreshold = thresholdFor(lightWorlds);
  const severeThreshold = thresholdFor(severeWorlds);

  const probabilityPoints = (axis: 'spreadProbability' | 'mitigationRate') => {
    const tie =
      axis === 'spreadProbability'
        ? severeThreshold.spreadProbability
        : severeThreshold.mitigationRate;
    const points = [0, 1, 2, 3, 4].map((num) => fraction(num, 4));
    if (
      tie.num > 0 &&
      tie.num < tie.den &&
      !points.some((point) => compareFractions(point, tie) === 0)
    ) {
      points.push(tie);
    }
    points.sort((left, right) => compareFractions(left, right));
    return points.map((point) => {
      const rate = (sample: ReturnType<typeof worlds>) => {
        if (axis === 'spreadProbability') {
          return {
            open: mixSpread(
              point,
              sample.openSpread.result.netValue,
              sample.openMiss.result.netValue,
            ),
            isolate: fraction(sample.isolateContained.result.netValue, 1),
          };
        }
        return {
          open: fraction(sample.openSpread.result.netValue, 1),
          isolate: mixMitigation(
            point,
            sample.isolateFailed.result.netValue,
            sample.isolateContained.result.netValue,
          ),
        };
      };
      const light = rate(lightWorlds);
      const severe = rate(severeWorlds);
      return {
        value: point,
        light: { ...light, preference: preferenceOf(light.open, light.isolate) },
        severe: { ...severe, preference: preferenceOf(severe.open, severe.isolate) },
      };
    });
  };

  const spreadPoints = probabilityPoints('spreadProbability');
  const mitigationPoints = probabilityPoints('mitigationRate');
  const endpointPreference = (
    points: ReturnType<typeof probabilityPoints>,
    board: 'light' | 'severe',
  ) => ({
    atZero: points[0]?.[board].preference,
    atOne: points[points.length - 1]?.[board].preference,
  });

  return {
    seed,
    resources: {
      publishedValue: 20,
      focus: 6,
      horizon: 8,
      domains: ['product', 'platform'] as const,
      recoveryPerTick: 1,
      jobValue: 8,
      jobWork: 4,
      reserveValue: 4,
      isolateFocus: 2,
      releaseFocus: 1,
      repairFocus: 1,
    },
    baselineRules: baselineIsolationRules,
    scoring: '20 + shipped - focus - scoredLoss - outstandingImpact',
    fixedStrategies: true,
    humanPlaytest: false,
    productionIntegration: false,
    randomDraws: false,
    spreadModel: 'expectation of a full spread and a full miss',
    control: {
      matchesFirstComparison: true,
      light: boardNets(lightBase),
      severe: boardNets(severeBase),
    },
    factors,
    isolationDelay: delays,
    delayReversals,
    spreadWorlds: { light: lightWorlds, severe: severeWorlds },
    thresholds: { light: lightThreshold, severe: severeThreshold },
    spreadProbability: {
      heldMitigationRate: 1,
      points: spreadPoints,
      endpoints: {
        light: endpointPreference(spreadPoints, 'light'),
        severe: endpointPreference(spreadPoints, 'severe'),
      },
    },
    mitigationRate: {
      heldSpreadProbability: 1,
      points: mitigationPoints,
      endpoints: {
        light: endpointPreference(mitigationPoints, 'light'),
        severe: endpointPreference(mitigationPoints, 'severe'),
      },
    },
  };
}
