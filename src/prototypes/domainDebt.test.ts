import { describe, expect, it } from 'vitest';
import {
  createDebtPrototype,
  tickDebtPrototype,
  summarizeDebt,
  compareDebtStrategies,
  compareDebtFactorReversals,
  createDebtBoard,
  baselineDebtBoard,
  type DebtBoardSpec,
  type DebtInput,
} from './domainDebt';
import comparison from '../../docs/prototypes/domain-debt-comparison.json';
import factors from '../../docs/prototypes/domain-debt-factor-comparison.json';

describe('RI-163 領域別負債', () => {
  it('返済は指定領域だけに作用し、2工数を払い一度だけ選べる', () => {
    const initial = createDebtPrototype(1, 'payment');
    const snapshot = structuredClone(initial);
    const repaired = tickDebtPrototype(initial, 'auth');
    expect(repaired.debt).toEqual({ payment: 4, auth: 0 });
    expect(repaired.tick).toBe(2);
    expect(tickDebtPrototype(repaired, 'payment')).toBe(repaired);
    const working = tickDebtPrototype(repaired, 'work');
    expect(working.jobs[0].remaining).toBe(3);
    expect(initial).toEqual(snapshot);
  });
  it('完了した仕事の発生先を記録し、会社負債は常に領域別合計になる', () => {
    let state = tickDebtPrototype(createDebtPrototype(1, 'payment'), 'payment');
    state = tickDebtPrototype(tickDebtPrototype(state, 'work'), 'work');
    expect(state.ledger).toEqual([{ jobId: 'job-0', domain: 'payment', added: 1 }]);
    expect(state.debt).toEqual({ payment: 1, auth: 4 });
    expect(summarizeDebt(state).techDebt).toBe(5);
    expect(tickDebtPrototype(state, 'work').jobs[1].remaining).toBe(2);
  });
  it('需要を反転すると有力な返済先も反転し、低需要への投資には機会費用がある', () => {
    expect(compareDebtStrategies(comparison.seed)).toEqual(comparison.results);
    for (const demand of ['payment', 'auth']) {
      const rows = comparison.results.filter((row) => row.demand === demand);
      const best = rows.find((row) => row.choice === demand)!;
      const others = rows.filter((row) => row.choice !== demand);
      for (const other of others) expect(best.result.value).toBeGreaterThan(other.result.value);
      expect(best.result.repairEffort).toBe(2);
    }
  });
  it('選択前・資源不足・期末・全件完了を無消費で拒否する', () => {
    const initial = createDebtPrototype(1, 'payment');
    expect(tickDebtPrototype(initial, 'work')).toBe(initial);
    const short = { ...initial, horizon: 1 };
    expect(tickDebtPrototype(short, 'payment')).toBe(short);
    const ended = { ...initial, tick: initial.horizon };
    expect(tickDebtPrototype(ended, 'skip')).toBe(ended);
    const done = { ...initial, jobs: initial.jobs.map((job) => ({ ...job, done: true })) };
    expect(tickDebtPrototype(done, 'payment')).toBe(done);
  });
  it('返済後・仕事途中の保存再開と入力再生が一致する', () => {
    for (const row of compareDebtStrategies(comparison.seed)) {
      let live = row.initial;
      let restored = structuredClone(live);
      for (const input of row.inputs) {
        live = tickDebtPrototype(live, input);
        restored = tickDebtPrototype(JSON.parse(JSON.stringify(restored)), input);
        expect(summarizeDebt(live).techDebt).toBe(live.debt.payment + live.debt.auth);
        expect(restored).toEqual(live);
      }
      expect(summarizeDebt(live)).toEqual(row.result);
    }
  });
});

function asDomain(domain: string) {
  if (domain !== 'payment' && domain !== 'auth') throw new Error(domain);
  return domain;
}
function asInput(input: string): DebtInput {
  if (input !== 'skip' && input !== 'payment' && input !== 'auth' && input !== 'work') {
    throw new Error(input);
  }
  return input;
}
function asBoard(board: {
  debt: { payment: number; auth: number };
  domains: readonly string[];
  crossIndexes: readonly number[];
  horizon: number;
  repairCost: number;
  repairReduction: number;
}): DebtBoardSpec {
  return {
    debt: { payment: board.debt.payment, auth: board.debt.auth },
    domains: board.domains.map(asDomain),
    crossIndexes: [...board.crossIndexes],
    horizon: board.horizon,
    repairCost: board.repairCost,
    repairReduction: board.repairReduction,
  };
}
function boardDiffs(board: DebtBoardSpec, baseline: DebtBoardSpec) {
  const found: string[] = [];
  if (board.debt.payment !== baseline.debt.payment || board.debt.auth !== baseline.debt.auth) {
    found.push('debt');
  }
  if (board.domains.join() !== baseline.domains.join()) found.push('domains');
  if (board.crossIndexes.join() !== baseline.crossIndexes.join()) found.push('crossIndexes');
  if (board.horizon !== baseline.horizon) found.push('horizon');
  if (board.repairCost !== baseline.repairCost) found.push('repairCost');
  if (board.repairReduction !== baseline.repairReduction) found.push('repairReduction');
  return found;
}
function expectControlPlays(plays: { choice: string; inputs: string[]; result: unknown }[]) {
  const first = comparison.results.filter((row) => row.demand === 'payment');
  for (const choice of ['skip', 'payment', 'auth']) {
    const play = plays.find((item) => item.choice === choice);
    const row = first.find((item) => item.choice === choice);
    expect(play?.inputs).toEqual(row?.inputs);
    expect(play?.result).toEqual(row?.result);
  }
}
function replayBoard(board: DebtBoardSpec, inputs: readonly string[], result: unknown) {
  let live = createDebtBoard(factors.seed, board);
  let restored = structuredClone(live);
  for (const input of inputs) {
    live = tickDebtPrototype(live, asInput(input));
    restored = tickDebtPrototype(JSON.parse(JSON.stringify(restored)), asInput(input));
    expect(restored).toEqual(live);
    expect(summarizeDebt(live).techDebt).toBe(live.debt.payment + live.debt.auth);
  }
  expect(summarizeDebt(live)).toEqual(result);
}

describe('RI-163 要因を一つずつ動かした比較', () => {
  it('初回と同じ資源で、需要側への返済が単独首位でなくなる位置を再計算する', () => {
    const report = compareDebtFactorReversals(factors.seed);
    expect(report).toEqual(factors);
    expect(report.fixedStrategies).toBe(true);
    expect(report.humanPlaytest).toBe(false);
    expect(report.productionIntegration).toBe(false);
    expect(report.randomDraws).toBe(false);
    expect(report.numbersAreProductionBalance).toBe(false);
    expect(report.control).toEqual({
      matchesFirstComparison: true,
      demand: 'payment',
      values: { skip: 16, payment: 24, auth: 16 },
    });
    expect(report.resources).toMatchObject({
      horizon: 12,
      jobValue: 8,
      jobCount: 3,
      initialDebt: { payment: 4, auth: 4 },
      repairCost: 2,
      repairReduction: 4,
      demand: 'payment',
    });
    expect(report.unresolved).toContain('40対40');
    expect(report.factors.carriedPeriod.ruleReversed).toBe(false);
    expect(report.factors.carriedPeriod.unfinishedJobsCarry).toBe(false);
    expect(
      report.reversals.map((item) => [
        item.factor,
        item.pattern,
        item.beforeLevel,
        item.afterLevel,
        item.beforeLeaders,
        item.afterLeaders,
      ]),
    ).toEqual([
      ['forecastAccuracy', 'front', 0, 1, ['payment'], ['auth']],
      ['initialDebtSkew', null, 1, 2, ['skip', 'auth'], ['skip', 'payment', 'auth']],
      ['initialDebtSkew', null, 2, 3, ['skip', 'payment', 'auth'], ['payment']],
      ['repairEffort', null, 1, 2, ['payment', 'auth'], ['payment']],
      ['repairEffort', null, 3, 4, ['payment'], ['skip', 'payment']],
      ['repairEffort', null, 7, 8, ['skip', 'payment'], ['skip']],
      ['repairReduction', null, 2, 3, ['skip', 'payment', 'auth'], ['payment']],
      ['crossDomain', null, 'none', '0', ['payment'], ['skip', 'payment', 'auth']],
      ['crossDomain', null, '1', '2', ['skip', 'payment', 'auth'], ['payment']],
      ['carriedPeriod', 'repeat-same-domain', 'payment', 'auth', ['payment'], ['payment', 'auth']],
    ]);
    expect(report.factors.forecastAccuracy.front[1]?.values).toEqual({
      skip: 16,
      payment: 16,
      auth: 24,
    });
    expect(report.factors.forecastAccuracy.front[1]?.actualMajority).toBe('auth');
    expect(report.factors.forecastAccuracy.tail[1]?.values).toEqual({
      skip: 16,
      payment: 24,
      auth: 16,
    });
    expect(report.factors.forecastAccuracy.tail[1]?.actualMajority).toBe('payment');
    const skew = (level: number) =>
      report.factors.initialDebtSkew.points.find((point) => point.level === level);
    expect(skew(0)?.values).toEqual({ skip: 24, payment: 16, auth: 24 });
    expect(skew(1)?.values).toEqual({ skip: 24, payment: 16, auth: 24 });
    expect(skew(2)?.values).toEqual({ skip: 24, payment: 24, auth: 24 });
    expect(skew(3)?.values).toEqual({ skip: 16, payment: 24, auth: 16 });
    expect(skew(0)?.plays.find((play) => play.choice === 'auth')?.result.techDebt).toBe(7);
    expect(skew(0)?.plays.find((play) => play.choice === 'skip')?.result.techDebt).toBe(11);
    const effort = (level: number) =>
      report.factors.repairEffort.points.find((point) => point.level === level);
    expect(effort(0)?.values).toEqual({ skip: 16, payment: 24, auth: 24 });
    expect(effort(4)?.values).toEqual({ skip: 16, payment: 16, auth: 8 });
    expect(effort(8)?.values).toEqual({ skip: 16, payment: 8, auth: 8 });
    const reduction = (level: number) =>
      report.factors.repairReduction.points.find((point) => point.level === level);
    expect(reduction(2)?.values).toEqual({ skip: 16, payment: 16, auth: 16 });
    expect(reduction(3)?.values).toEqual({ skip: 16, payment: 24, auth: 16 });
    expect(
      report.factors.jobOrder.points.every(
        (point) => point.leaders.join() === 'payment' && point.values.payment === 24,
      ),
    ).toBe(true);
    expect(report.factors.crossDomain.points.find((point) => point.level === '0')?.values).toEqual({
      skip: 16,
      payment: 16,
      auth: 16,
    });
    expect(report.factors.crossDomain.points.find((point) => point.level === '2')?.values).toEqual({
      skip: 16,
      payment: 24,
      auth: 16,
    });
    const samePeriod = report.factors.carriedPeriod.points[0];
    const flippedPeriod = report.factors.carriedPeriod.points[1];
    expect(samePeriod?.values).toEqual({ skip: 32, payment: 48, auth: 24, match: 48 });
    expect(samePeriod?.sameInputsAsRepeatingPayment).toBe(true);
    expect(flippedPeriod?.values).toEqual({ skip: 32, payment: 40, auth: 40, match: 48 });
    expect(flippedPeriod?.sameInputsAsRepeatingPayment).toBe(false);
    expect(flippedPeriod?.ruleLeaders).toEqual(['match']);
    const repeatedAuth = flippedPeriod?.plans.find((plan) => plan.plan === 'auth');
    expect(repeatedAuth?.periods[0]?.result.pending[0]).toMatchObject({
      id: 'job-2',
      remaining: 1,
      done: false,
    });
    expect(repeatedAuth?.periods[1]?.result.done).toEqual(['job-0', 'job-1', 'job-2']);
    expect(repeatedAuth?.periods[1]?.board.debt).toEqual(repeatedAuth?.periods[0]?.result.debt);
  });
  it('対照の入力列は初回の決済需要と一致し、各点は一つの要因だけが初回と違う', () => {
    const report = compareDebtFactorReversals(factors.seed);
    const baseline = asBoard(report.baseline);
    expect(baseline).toEqual(baselineDebtBoard);
    expect(createDebtBoard(report.seed, baseline)).toEqual(
      createDebtPrototype(report.seed, 'payment'),
    );
    expectControlPlays(report.factors.forecastAccuracy.front[0]?.plays ?? []);
    expectControlPlays(report.factors.forecastAccuracy.tail[0]?.plays ?? []);
    expectControlPlays(
      report.factors.initialDebtSkew.points.find((point) => point.level === 4)?.plays ?? [],
    );
    expectControlPlays(
      report.factors.repairEffort.points.find((point) => point.level === 2)?.plays ?? [],
    );
    expectControlPlays(
      report.factors.repairReduction.points.find((point) => point.level === 4)?.plays ?? [],
    );
    expectControlPlays(report.factors.jobOrder.points[0]?.plays ?? []);
    expectControlPlays(
      report.factors.crossDomain.points.find((point) => point.level === 'none')?.plays ?? [],
    );
    const single: { points: { board: DebtBoardSpec }[]; allowed: string[] }[] = [
      { points: report.factors.forecastAccuracy.front, allowed: ['domains'] },
      { points: report.factors.forecastAccuracy.tail, allowed: ['domains'] },
      { points: report.factors.initialDebtSkew.points, allowed: ['debt'] },
      { points: report.factors.repairEffort.points, allowed: ['repairCost'] },
      { points: report.factors.repairReduction.points, allowed: ['repairReduction'] },
      { points: report.factors.jobOrder.points, allowed: ['domains'] },
      { points: report.factors.crossDomain.points, allowed: ['crossIndexes'] },
    ];
    for (const factor of single) {
      for (const point of factor.points) {
        const diffs = boardDiffs(asBoard(point.board), baseline);
        expect(diffs.every((diff) => factor.allowed.includes(diff))).toBe(true);
      }
    }
    for (const point of report.factors.initialDebtSkew.points) {
      expect(point.board.debt.payment + point.board.debt.auth).toBe(8);
    }
    for (const point of report.factors.jobOrder.points) {
      expect([...point.board.domains].sort()).toEqual(['auth', 'payment', 'payment']);
    }
    for (const point of report.factors.carriedPeriod.points) {
      for (const plan of point.plans) {
        expect(boardDiffs(asBoard(plan.periods[0]?.board ?? baseline), baseline)).toEqual([]);
        const second = asBoard(plan.periods[1]?.board ?? baseline);
        expect(
          boardDiffs(second, baseline).every((diff) => diff === 'debt' || diff === 'domains'),
        ).toBe(true);
        expect(second.horizon).toBe(12);
        expect(second.repairCost).toBe(2);
        expect(second.repairReduction).toBe(4);
        expect(second.crossIndexes).toEqual([]);
      }
    }
  });
  it('要因比較の入力を保存再開しても再生が一致する', () => {
    const report = compareDebtFactorReversals(factors.seed);
    const singles = [
      ...report.factors.forecastAccuracy.front,
      ...report.factors.forecastAccuracy.tail,
      ...report.factors.initialDebtSkew.points,
      ...report.factors.repairEffort.points,
      ...report.factors.repairReduction.points,
      ...report.factors.jobOrder.points,
      ...report.factors.crossDomain.points,
    ];
    for (const point of singles) {
      for (const play of point.plays) replayBoard(asBoard(point.board), play.inputs, play.result);
    }
    for (const point of report.factors.carriedPeriod.points) {
      for (const plan of point.plans) {
        for (const period of plan.periods) {
          replayBoard(asBoard(period.board), period.inputs, period.result);
        }
      }
    }
  });
  it('横断仕事は両領域へ負債を足し、工数0の返済は指定領域だけを減らす', () => {
    let crossed = tickDebtPrototype(
      createDebtBoard(factors.seed, { ...baselineDebtBoard, crossIndexes: [0] }),
      'payment',
    );
    expect(crossed.debt).toEqual({ payment: 0, auth: 4 });
    for (let step = 0; step < 4; step += 1) crossed = tickDebtPrototype(crossed, 'work');
    expect(crossed.ledger).toEqual([
      { jobId: 'job-0', domain: 'payment', added: 1 },
      { jobId: 'job-0', domain: 'auth', added: 1 },
    ]);
    expect(crossed.debt).toEqual({ payment: 1, auth: 5 });
    const free = tickDebtPrototype(
      createDebtBoard(factors.seed, { ...baselineDebtBoard, repairCost: 0 }),
      'auth',
    );
    expect(free.debt).toEqual({ payment: 4, auth: 0 });
    expect(free.tick).toBe(0);
    expect(free.repairEffort).toBe(0);
    const short = createDebtBoard(factors.seed, { ...baselineDebtBoard, horizon: 1 });
    expect(tickDebtPrototype(short, 'payment')).toBe(short);
  });
});
