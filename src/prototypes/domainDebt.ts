/** RI-163: 通常ランから隔離した、領域2種・工数増加1種の負債試作。 */
export type DebtDomain = 'payment' | 'auth';
export type DebtInput = DebtDomain | 'skip' | 'work';
export interface DebtJob {
  id: string;
  domain: DebtDomain;
  remaining: number | null;
  done: boolean;
  /** 領域をまたぐ仕事だけ。工数と完了時の負債はここを使い、domain は枠の名前に残す。 */
  spans?: DebtDomain[];
}
export interface DebtState {
  version: 1;
  seed: string | number;
  tick: number;
  horizon: number;
  debt: Record<DebtDomain, number>;
  choice: DebtDomain | 'skip' | null;
  repairEffort: number;
  /** 無いときは初回の規則。返済2工数、軽減4。 */
  repairCost?: number;
  repairReduction?: number;
  jobs: DebtJob[];
  ledger: { jobId: string; domain: DebtDomain; added: number }[];
  inputs: DebtInput[];
}
export interface DebtBoardSpec {
  debt: Record<DebtDomain, number>;
  domains: DebtDomain[];
  crossIndexes: number[];
  horizon: number;
  repairCost: number;
  repairReduction: number;
}
export const baselineDebtBoard: DebtBoardSpec = {
  debt: { payment: 4, auth: 4 },
  domains: ['payment', 'payment', 'auth'],
  crossIndexes: [],
  horizon: 12,
  repairCost: 2,
  repairReduction: 4,
};
export function createDebtPrototype(seed: string | number, demand: DebtDomain): DebtState {
  return {
    version: 1,
    seed,
    tick: 0,
    horizon: 12,
    debt: { payment: 4, auth: 4 },
    choice: null,
    repairEffort: 0,
    jobs: [demand, demand, demand === 'payment' ? 'auth' : 'payment'].map((domain, index) => ({
      id: `job-${index}`,
      domain: domain as DebtDomain,
      remaining: null,
      done: false,
    })),
    ledger: [],
    inputs: [],
  };
}
function affectedDomains(job: DebtJob): DebtDomain[] {
  return job.spans?.length ? [...new Set(job.spans)] : [job.domain];
}
/** 開始時に一度だけ返済する。省略時は2工数・負債4。仕事は着手時に 2+各領域ceil(負債/2) で固定する。 */
export function tickDebtPrototype(state: DebtState, input: DebtInput): DebtState {
  if (state.tick >= state.horizon || state.jobs.every((job) => job.done)) return state;
  if (state.choice === null ? input === 'work' : input !== 'work') return state;
  const next = structuredClone(state);
  if (input !== 'work') {
    next.choice = input;
    if (input !== 'skip') {
      const cost = next.repairCost ?? 2;
      const reduction = next.repairReduction ?? 4;
      if (next.horizon - next.tick < cost) return state;
      next.debt[input] = Math.max(0, next.debt[input] - reduction);
      next.repairEffort = cost;
      next.tick += cost;
    }
  } else {
    const job = next.jobs.find((candidate) => !candidate.done)!;
    const domains = affectedDomains(job);
    job.remaining ??=
      2 + domains.reduce((sum, domain) => sum + Math.ceil(next.debt[domain] / 2), 0);
    job.remaining--;
    next.tick++;
    if (job.remaining === 0) {
      job.done = true;
      for (const domain of domains) {
        next.debt[domain] += 1;
        next.ledger.push({ jobId: job.id, domain, added: 1 });
      }
    }
  }
  next.inputs.push(input);
  return next;
}
export function summarizeDebt(state: DebtState) {
  const done = state.jobs.filter((job) => job.done);
  return {
    value: done.length * 8,
    done: done.map((job) => job.id),
    debt: state.debt,
    techDebt: state.debt.payment + state.debt.auth,
    repairEffort: state.repairEffort,
    workEffort: state.tick - state.repairEffort,
    pending: state.jobs.filter((job) => !job.done),
    ledger: state.ledger,
  };
}
export function compareDebtStrategies(seed: string | number) {
  return (['payment', 'auth'] as const).flatMap((demand) =>
    (['skip', 'payment', 'auth'] as const).map((choice) => {
      const initial = createDebtPrototype(seed, demand);
      let state = tickDebtPrototype(initial, choice);
      while (state.tick < state.horizon && state.jobs.some((job) => !job.done)) {
        state = tickDebtPrototype(state, 'work');
      }
      return { demand, choice, initial, inputs: state.inputs, result: summarizeDebt(state) };
    }),
  );
}
export type DebtChoice = Exclude<DebtInput, 'work'>;
const debtChoices = ['skip', 'payment', 'auth'] as const;

export function createDebtBoard(seed: string | number, board: DebtBoardSpec): DebtState {
  if (board.repairCost < 0 || board.repairReduction < 0 || board.horizon < 0) {
    throw new Error('RI-163 board has a negative rule');
  }
  for (const index of board.crossIndexes) {
    if (!Number.isInteger(index) || index < 0 || index >= board.domains.length) {
      throw new Error('RI-163 cross index out of range');
    }
  }
  const cross = new Set(board.crossIndexes);
  const state: DebtState = {
    version: 1,
    seed,
    tick: 0,
    horizon: board.horizon,
    debt: { payment: board.debt.payment, auth: board.debt.auth },
    choice: null,
    repairEffort: 0,
    jobs: board.domains.map((domain, index) => {
      const job: DebtJob = { id: `job-${index}`, domain, remaining: null, done: false };
      if (cross.has(index)) job.spans = ['payment', 'auth'];
      return job;
    }),
    ledger: [],
    inputs: [],
  };
  if (board.repairCost !== 2) state.repairCost = board.repairCost;
  if (board.repairReduction !== 4) state.repairReduction = board.repairReduction;
  return state;
}
function cloneBoard(board: DebtBoardSpec): DebtBoardSpec {
  return {
    debt: { payment: board.debt.payment, auth: board.debt.auth },
    domains: [...board.domains],
    crossIndexes: [...board.crossIndexes],
    horizon: board.horizon,
    repairCost: board.repairCost,
    repairReduction: board.repairReduction,
  };
}
function withBoard(patch: Partial<DebtBoardSpec>): DebtBoardSpec {
  return { ...cloneBoard(baselineDebtBoard), ...patch };
}
export function runDebtChoice(initial: DebtState, choice: DebtChoice): DebtState {
  let state = tickDebtPrototype(initial, choice);
  if (state === initial) return state;
  while (state.tick < state.horizon && state.jobs.some((job) => !job.done)) {
    const next = tickDebtPrototype(state, 'work');
    if (next === state) break;
    state = next;
  }
  return state;
}
function playBoard(seed: string, board: DebtBoardSpec, choice: DebtChoice) {
  const state = runDebtChoice(createDebtBoard(seed, board), choice);
  return { choice, inputs: state.inputs, result: summarizeDebt(state) };
}
function valuesOf(plays: { choice: DebtChoice; result: { value: number } }[]) {
  return {
    skip: plays.find((play) => play.choice === 'skip')?.result.value ?? 0,
    payment: plays.find((play) => play.choice === 'payment')?.result.value ?? 0,
    auth: plays.find((play) => play.choice === 'auth')?.result.value ?? 0,
  };
}
function leadersOf(values: Record<string, number>, order: readonly string[]): string[] {
  const best = Math.max(...order.map((id) => values[id] ?? Number.NEGATIVE_INFINITY));
  return order.filter((id) => values[id] === best);
}
function majorityOf(domains: readonly DebtDomain[]): DebtDomain | 'tie' {
  const payment = domains.filter((domain) => domain === 'payment').length;
  const auth = domains.length - payment;
  if (payment > auth) return 'payment';
  if (auth > payment) return 'auth';
  return 'tie';
}
function flipDomain(domain: DebtDomain): DebtDomain {
  return domain === 'payment' ? 'auth' : 'payment';
}
function boardPoint(seed: string, level: number | string, board: DebtBoardSpec) {
  const plays = debtChoices.map((choice) => playBoard(seed, board, choice));
  const values = valuesOf(plays);
  return {
    level,
    board: cloneBoard(board),
    plays,
    values,
    leaders: leadersOf(values, debtChoices),
  };
}
interface FactorPoint {
  level: number | string;
  leaders: string[];
  values: Record<string, number>;
}
function adjacentReversals(factor: string, pattern: string | null, points: FactorPoint[]) {
  const found = [];
  for (let index = 1; index < points.length; index += 1) {
    const before = points[index - 1];
    const after = points[index];
    if (!before || !after || before.leaders.join(',') === after.leaders.join(',')) continue;
    found.push({
      factor,
      pattern,
      beforeLevel: before.level,
      afterLevel: after.level,
      beforeLeaders: before.leaders,
      afterLeaders: after.leaders,
      beforeValues: before.values,
      afterValues: after.values,
    });
  }
  return found;
}
function assertFirstComparison(seed: string) {
  const legacy = compareDebtStrategies(seed).filter((row) => row.demand === 'payment');
  const initial = createDebtBoard(seed, baselineDebtBoard);
  const factory = createDebtPrototype(seed, 'payment');
  if (JSON.stringify(initial) !== JSON.stringify(factory)) {
    throw new Error('RI-163 baseline state diverged');
  }
  for (const choice of debtChoices) {
    const play = playBoard(seed, baselineDebtBoard, choice);
    const row = legacy.find((item) => item.choice === choice);
    if (
      !row ||
      JSON.stringify(play.inputs) !== JSON.stringify(row.inputs) ||
      JSON.stringify(play.result) !== JSON.stringify(row.result)
    ) {
      throw new Error(`RI-163 baseline diverged: ${choice}`);
    }
  }
}
function forecastBoards(seed: string, fromEnd: boolean, misses: readonly number[]) {
  const announced = baselineDebtBoard.domains;
  return misses.map((count) => {
    const domains = announced.map((domain, index) => {
      const missed = fromEnd ? index >= announced.length - count : index < count;
      return missed ? flipDomain(domain) : domain;
    });
    const point = boardPoint(seed, count, withBoard({ domains }));
    return { ...point, actualMajority: majorityOf(point.board.domains) };
  });
}
function periodPlans(seed: string, second: DebtDomain) {
  const secondDomains: DebtDomain[] =
    second === 'payment' ? ['payment', 'payment', 'auth'] : ['auth', 'auth', 'payment'];
  const specs = [
    { plan: 'skip', choices: ['skip', 'skip'] },
    { plan: 'payment', choices: ['payment', 'payment'] },
    { plan: 'auth', choices: ['auth', 'auth'] },
    { plan: 'match', choices: ['payment', second] },
  ] as const;
  return specs.map((spec) => {
    const period1 = playBoard(seed, baselineDebtBoard, spec.choices[0]);
    const nextBoard = withBoard({
      debt: { payment: period1.result.debt.payment, auth: period1.result.debt.auth },
      domains: secondDomains,
    });
    const period2 = playBoard(seed, nextBoard, spec.choices[1]);
    return {
      plan: spec.plan,
      choices: [...spec.choices],
      value: period1.result.value + period2.result.value,
      finalDebt: period2.result.debt,
      finalTechDebt: period2.result.techDebt,
      periods: [
        { board: cloneBoard(baselineDebtBoard), ...period1 },
        { board: cloneBoard(nextBoard), ...period2 },
      ],
    };
  });
}
/**
 * 初回と同じ資源の上で要因を一つずつ動かす。
 * 需要側は決済。認証需要の鏡像は初回の比較にあり、ここでは再計算しない。
 * 固定した返済先を最後まで進める。人間のプレイ評価でも本番採用でもない。
 */
export function compareDebtFactorReversals(seed: string) {
  assertFirstComparison(seed);
  const front = forecastBoards(seed, false, [0, 1, 2, 3]);
  const tail = forecastBoards(seed, true, [0, 1]);
  const skew = [0, 1, 2, 3, 4, 6, 8].map((payment) =>
    boardPoint(seed, payment, withBoard({ debt: { payment, auth: 8 - payment } })),
  );
  const repairEffort = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((repairCost) =>
    boardPoint(seed, repairCost, withBoard({ repairCost })),
  );
  const repairReduction = [0, 1, 2, 3, 4, 5].map((repairReduction) =>
    boardPoint(seed, repairReduction, withBoard({ repairReduction })),
  );
  const jobOrder = (
    [
      ['payment', 'payment', 'auth'],
      ['payment', 'auth', 'payment'],
      ['auth', 'payment', 'payment'],
    ] as const
  ).map((domains) => boardPoint(seed, domains.join(','), withBoard({ domains: [...domains] })));
  const crossDomain = (['none', '0', '1', '2'] as const).map((level) =>
    boardPoint(seed, level, withBoard({ crossIndexes: level === 'none' ? [] : [Number(level)] })),
  );
  const carriedPeriod = (['payment', 'auth'] as const).map((secondDemand) => {
    const plans = periodPlans(seed, secondDemand);
    const values = {
      skip: plans.find((plan) => plan.plan === 'skip')?.value ?? 0,
      payment: plans.find((plan) => plan.plan === 'payment')?.value ?? 0,
      auth: plans.find((plan) => plan.plan === 'auth')?.value ?? 0,
      match: plans.find((plan) => plan.plan === 'match')?.value ?? 0,
    };
    const lockedValues = { skip: values.skip, payment: values.payment, auth: values.auth };
    const match = plans.find((plan) => plan.plan === 'match');
    const payment = plans.find((plan) => plan.plan === 'payment');
    const sameInputs =
      JSON.stringify(match?.periods.map((period) => period.inputs)) ===
      JSON.stringify(payment?.periods.map((period) => period.inputs));
    const beaten = plans.some((plan) => plan.plan !== 'match' && plan.value > values.match);
    const tiedWithDifferentPlan = plans.some((plan) => {
      if (plan.plan === 'match' || plan.value !== values.match) return false;
      return (
        JSON.stringify(plan.periods.map((period) => period.inputs)) !==
        JSON.stringify(match?.periods.map((period) => period.inputs))
      );
    });
    return {
      level: secondDemand,
      secondDemand,
      plans,
      values,
      lockedLeaders: leadersOf(lockedValues, debtChoices),
      ruleLeaders: leadersOf(values, ['skip', 'payment', 'auth', 'match']),
      sameInputsAsRepeatingPayment: sameInputs,
      ruleReversed: beaten || tiedWithDifferentPlan,
    };
  });
  const reversals = [
    ...adjacentReversals('forecastAccuracy', 'front', front),
    ...adjacentReversals('forecastAccuracy', 'tail', tail),
    ...adjacentReversals('initialDebtSkew', null, skew),
    ...adjacentReversals('repairEffort', null, repairEffort),
    ...adjacentReversals('repairReduction', null, repairReduction),
    ...adjacentReversals('jobOrder', null, jobOrder),
    ...adjacentReversals('crossDomain', null, crossDomain),
    ...adjacentReversals(
      'carriedPeriod',
      'repeat-same-domain',
      carriedPeriod.map((point) => ({
        level: point.level,
        leaders: point.lockedLeaders,
        values: {
          skip: point.values.skip,
          payment: point.values.payment,
          auth: point.values.auth,
        },
      })),
    ),
  ];
  return {
    seed,
    baseline: cloneBoard(baselineDebtBoard),
    resources: {
      horizon: 12,
      jobValue: 8,
      jobCount: 3,
      initialDebt: { payment: 4, auth: 4 },
      repairCost: 2,
      repairReduction: 4,
      demand: 'payment' as const,
      announcedJobs: ['payment', 'payment', 'auth'] as const,
    },
    scoring: '出荷価値が高い方を上とする。同じなら同点とし、会社負債では順位を割らない。',
    fixedStrategies: true,
    humanPlaytest: false,
    productionIntegration: false,
    randomDraws: false,
    numbersAreProductionBalance: false,
    control: {
      matchesFirstComparison: true,
      demand: 'payment' as const,
      values: { skip: 16, payment: 24, auth: 16 },
    },
    factors: {
      forecastAccuracy: { changed: ['domains'], front, tail },
      initialDebtSkew: { changed: ['debt'], totalDebt: 8, points: skew },
      repairEffort: { changed: ['repairCost'], points: repairEffort },
      repairReduction: { changed: ['repairReduction'], points: repairReduction },
      jobOrder: { changed: ['domains'], points: jobOrder },
      crossDomain: {
        changed: ['crossIndexes'],
        cost: '2 + ceil(payment/2) + ceil(auth/2)',
        points: crossDomain,
      },
      carriedPeriod: {
        changed: ['secondPeriodDemand'],
        perPeriodResourcesMatchBaseline: true,
        unfinishedJobsCarry: false,
        rule: '各期の開始時に、その期の仕事が多い領域を返す',
        ruleReversed: carriedPeriod.some((point) => point.ruleReversed),
        points: carriedPeriod,
      },
    },
    reversals,
    unresolved:
      '未完了仕事の残工数は期の境で捨てている。需要が入れ替わる次期へその残工数を繰り越したとき、決済返済の繰り返しと認証返済の繰り返しの出荷40対40がどちらへ崩れるかは未計算。',
  };
}
