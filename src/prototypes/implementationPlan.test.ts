import { describe, expect, it } from 'vitest';
import { JOB_WORK, type ModelJob } from './modelAssignment';
import {
  applyPlanInput as apply,
  BASELINE_PLAN_FACTORS,
  choosePlanAction,
  comparePlanFactorReversals,
  comparePlanStrategies,
  createPlanFactorState,
  createPlanPrototype as create,
  summarizePlan,
  viewPlan,
  WANDER_PENALTY,
  WANDER_WORK,
  type PlanFactors,
  type PlanInput,
  type PlanScenario,
  type PlanState,
  type PlanStrategy,
} from './implementationPlan';
import comparison from '../../docs/prototypes/implementation-plan-comparison.json';
import factorComparison from '../../docs/prototypes/implementation-plan-factor-comparison.json';

function withSibling(state: PlanState, job: ModelJob): PlanState {
  const next = structuredClone(state);
  next.board.horizon = 30;
  next.board.jobs.push(job);
  return next;
}

describe('RI-190 計画してから実装', () => {
  it('計画中は対象の進捗が増えず、完了後にその仕事の見落としだけが記録される', () => {
    const started = apply(create('RI-190', 'complexTight'), { type: 'plan' });
    expect(started.board.jobs[0]).toMatchObject({ progress: 0, work: JOB_WORK, shipped: null });
    expect(started).toMatchObject({ planningTicks: 1, findings: [], planned: [] });
    expect(started.board.tick).toBe(1);
    expect(apply(started, { type: 'tick' })).toBe(started);
    expect(started.board.jobs[0]).toMatchObject({ progress: 0, work: JOB_WORK });
    const sibling = withSibling(started, {
      id: 's9',
      kind: 'simple',
      work: JOB_WORK,
      progress: 0,
      value: 10,
      model: null,
      shipped: null,
      defect: false,
    });
    const planned = apply(sibling, { type: 'plan' });
    expect(planned.planned).toEqual(['c1']);
    expect(planned.findings).toEqual(['c1:dependency:ledger-order']);
    expect(planned.board.jobs[0]).toMatchObject({ progress: 0, work: JOB_WORK });
    expect(planned.board.jobs[1].work).toBe(JOB_WORK);
    expect(apply(planned, { type: 'plan' })).toBe(planned);
    let coding = planned;
    for (let count = 0; count < JOB_WORK; count += 1) coding = apply(coding, { type: 'tick' });
    expect(coding.board.jobs[0].shipped).toBe(18);
    expect(coding.board.jobs[1]).toMatchObject({ progress: 0, work: JOB_WORK });
    const second = apply(apply(coding, { type: 'plan' }), { type: 'plan' });
    expect(second.planned).toEqual(['c1', 's9']);
    expect(second.findings[1]).toBe('s9:no-hidden-scope');
    expect(second.board.jobs[0].shipped).toBe(18);
    expect(second.board.jobs[1]).toMatchObject({ progress: 0, work: JOB_WORK });
  });

  it('未計画の複雑仕事だけ作業量が増え、着手後の計画と予算のない高速割当は拒否する', () => {
    const initial = create('RI-190', 'complexTight');
    expect(apply(initial, { type: 'assign', model: 'fast' })).toBe(initial);
    const rushed = apply(initial, { type: 'tick' });
    expect(rushed.wandered).toEqual(['c1']);
    expect(rushed.board.jobs[0]).toMatchObject({ work: JOB_WORK + 3, progress: 1, shipped: null });
    expect(rushed.board.resolutions[0]).toBe('wander:c1+3');
    expect(apply(rushed, { type: 'plan' })).toBe(rushed);
    const sibling = withSibling(initial, {
      id: 's9',
      kind: 'simple',
      work: JOB_WORK,
      progress: 0,
      value: 10,
      model: null,
      shipped: null,
      defect: false,
    });
    const first = apply(sibling, { type: 'tick' });
    expect(first.board.jobs[0].work).toBe(JOB_WORK + 3);
    expect(first.board.jobs[1].work).toBe(JOB_WORK);
    let done = first;
    while (done.board.jobs[0].shipped === null) done = apply(done, { type: 'tick' });
    expect(done.board.jobs[0].shipped).toBe(12);
    expect(done.board.resolutions[done.board.resolutions.length - 1]).toBe('wander-penalty:c1-6');
    expect(done.board.jobs[1]).toMatchObject({ work: JOB_WORK, progress: 0 });
  });

  it('閲覧では計画も実装も進まず、期末の操作は無消費で拒否する', () => {
    const initial = create('RI-190', 'simpleShort');
    const before = structuredClone(initial);
    for (let count = 0; count < 30; count += 1) viewPlan(initial);
    expect(initial).toEqual(before);
    const viewed = viewPlan(initial);
    expect(viewed).toMatchObject({ tick: 0, findings: [], planningTicks: 0 });
    viewed.planned.push('extra');
    viewed.findings.push('extra');
    viewed.wandered.push('extra');
    expect(initial.planned).toEqual([]);
    expect(initial.findings).toEqual([]);
    expect(initial.wandered).toEqual([]);
    const ended = structuredClone(initial);
    ended.board.tick = ended.board.horizon;
    expect(apply(ended, { type: 'plan' })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
  });

  it('短い単純仕事は即着手、時間のある複雑仕事は計画が有利になる', () => {
    const rows = comparePlanStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect([net('simpleShort', 'rush'), net('simpleShort', 'plan')]).toEqual([10, 0]);
    expect([net('complexTight', 'rush'), net('complexTight', 'plan')]).toEqual([0, 18]);
    expect([net('complexLong', 'rush'), net('complexLong', 'plan')]).toEqual([12, 18]);
    const planned = rows.find((row) => row.scenario === 'complexLong' && row.strategy === 'plan')!;
    expect(planned.result.findings).toEqual(['c1:dependency:ledger-order']);
    expect(planned.result.wandered).toEqual([]);
    const rushed = rows.find((row) => row.scenario === 'complexLong' && row.strategy === 'rush')!;
    expect(rushed.result.findings).toEqual([]);
    expect(rushed.result.wandered).toEqual(['c1']);
    expect(rushed.result.shippedValue).toBe(12);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、出荷合計が崩れない', () => {
    for (const row of comparePlanStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(choosePlanAction(previous, row.strategy)).toEqual(input);
        expect(live.board.spent).toBe(0);
        expect(live.board.jobs.reduce((sum, job) => sum + (job.shipped ?? 0), 0)).toBe(
          live.board.shippedValue,
        );
      }
      expect(summarizePlan(live)).toEqual(row.result);
      const again = row.inputs.reduce((state, input) => apply(state, input), row.initial);
      expect(again).toEqual(live);
    }
  });
});

describe('RI-190 計画tickと迷走量の感度', () => {
  const report = comparePlanFactorReversals(comparison.seed);
  const rows = [
    ...report.sweeps.planTicks,
    ...report.sweeps.wanderWork,
    ...report.sweeps.wanderPenalty,
  ];

  function playOf(
    row: (typeof rows)[number],
    strategy: PlanStrategy,
  ): (typeof rows)[number]['plays'][number] {
    const found = row.plays.find((play) => play.strategy === strategy);
    if (found === undefined) throw new Error(strategy);
    return found;
  }

  function replay(
    scenario: PlanScenario,
    factors: PlanFactors,
    inputs: PlanInput[],
    strategy: PlanStrategy,
  ) {
    let live = createPlanFactorState(comparison.seed, scenario, factors);
    let saved = structuredClone(live);
    for (const input of inputs) {
      const previous = live;
      const before = structuredClone(live);
      live = apply(live, input);
      saved = apply(JSON.parse(JSON.stringify(saved)), input);
      expect(previous).toEqual(before);
      expect(saved).toEqual(live);
      expect(choosePlanAction(previous, strategy)).toEqual(input);
      expect(live.board.spent).toBe(0);
      expect(live.board.jobs.reduce((sum, job) => sum + (job.shipped ?? 0), 0)).toBe(
        live.board.shippedValue,
      );
    }
    return live;
  }

  it('記録した要因比較を再計算し、初回の盤面と係数を対照のまま残す', () => {
    expect(report).toEqual(factorComparison);
    expect(report.conditions).toMatchObject({
      anchor: BASELINE_PLAN_FACTORS,
      variedOneAtATime: true,
      fixedStrategies: true,
      humanPlaytest: false,
      productionAdoption: false,
      repeatedFirstComparison: false,
    });
    expect(report.conditions.ranges).toEqual({
      planTicks: [1, 2, 3, 4, 5, 6, 7, 8],
      wanderWork: [0, 1, 2, 3, 4, 5, 6, 7],
      wanderPenalty: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    });
    expect(report.reversals).toEqual([
      {
        factor: 'planTicks',
        scenario: 'complexTight',
        before: {
          factors: { planTicks: 2, wanderWork: 3, wanderPenalty: 6 },
          relation: 'plan',
          gap: 18,
        },
        after: {
          factors: { planTicks: 3, wanderWork: 3, wanderPenalty: 6 },
          relation: 'tie',
          gap: 0,
        },
      },
      {
        factor: 'planTicks',
        scenario: 'complexLong',
        before: {
          factors: { planTicks: 6, wanderWork: 3, wanderPenalty: 6 },
          relation: 'plan',
          gap: 6,
        },
        after: {
          factors: { planTicks: 7, wanderWork: 3, wanderPenalty: 6 },
          relation: 'rush',
          gap: -12,
        },
      },
      {
        factor: 'wanderPenalty',
        scenario: 'complexLong',
        before: {
          factors: { planTicks: 2, wanderWork: 3, wanderPenalty: 0 },
          relation: 'tie',
          gap: 0,
        },
        after: {
          factors: { planTicks: 2, wanderWork: 3, wanderPenalty: 1 },
          relation: 'plan',
          gap: 1,
        },
      },
    ]);
    const untouched = createPlanFactorState(comparison.seed, 'complexLong', {
      ...BASELINE_PLAN_FACTORS,
    });
    expect(untouched).not.toHaveProperty('factors');
    expect(untouched).toEqual(create(comparison.seed, 'complexLong'));
    const custom = { planTicks: 1, wanderWork: WANDER_WORK, wanderPenalty: WANDER_PENALTY };
    const quick = createPlanFactorState(comparison.seed, 'complexLong', custom);
    custom.planTicks = 9;
    expect(quick.factors).toEqual({ planTicks: 1, wanderWork: 3, wanderPenalty: 6 });
    const planned = apply(quick, { type: 'plan' });
    expect(planned.planned).toEqual(['c1']);
    expect(planned.findings).toEqual(['c1:dependency:ledger-order']);
    expect(quick.planned).toEqual([]);
    const heavy = apply(
      createPlanFactorState(comparison.seed, 'complexLong', {
        planTicks: 2,
        wanderWork: 0,
        wanderPenalty: 6,
      }),
      { type: 'tick' },
    );
    expect(heavy.board.jobs[0].work).toBe(JOB_WORK);
    expect(heavy.board.resolutions[0]).toBe('wander:c1+0');
  });

  it('各行は対照から要因を一つだけ動かし、初回の入力と結果に一致する', () => {
    expect(
      report.sweeps.planTicks
        .filter((row) => row.scenario === 'complexLong')
        .map((row) => row.factors.planTicks),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(
      report.sweeps.wanderWork
        .filter((row) => row.scenario === 'complexTight')
        .map((row) => row.factors.wanderWork),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(
      report.sweeps.wanderPenalty
        .filter((row) => row.scenario === 'complexLong')
        .map((row) => row.factors.wanderPenalty),
    ).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    for (const [axis, series] of Object.entries(report.sweeps) as [
      keyof typeof report.sweeps,
      typeof rows,
    ][]) {
      for (const row of series) {
        const changed = (['planTicks', 'wanderWork', 'wanderPenalty'] as const).filter(
          (name) => row.factors[name] !== BASELINE_PLAN_FACTORS[name],
        );
        expect(changed.length).toBeLessThanOrEqual(1);
        expect(changed.every((name) => name === axis)).toBe(true);
        expect(row.differsFromAnchor).toEqual(changed);
        expect(row.sameAsFirstComparison).toBe(changed.length === 0);
        expect(row.gap).toBe(row.planNet - row.rushNet);
        const originalBoard = comparison.results.find((item) => item.scenario === row.scenario);
        const initial = createPlanFactorState(comparison.seed, row.scenario, row.factors);
        expect(initial.board.jobs).toEqual(originalBoard?.initial.board.jobs);
        expect(initial.board.horizon).toBe(originalBoard?.initial.board.horizon);
        expect(initial.board.budget).toBe(0);
        expect(initial.board.seed).toBe(comparison.seed);
        if (!row.sameAsFirstComparison) continue;
        for (const play of row.plays) {
          const original = comparison.results.find(
            (item) => item.scenario === row.scenario && item.strategy === play.strategy,
          );
          expect(play.inputs).toEqual(original?.inputs);
          expect(play.result).toEqual(original?.result);
        }
      }
    }
  });

  it('計画tickは期末8で同点へ、期末12で即着手へ反転し、追加作業では反転しない', () => {
    const nets = (
      series: typeof rows,
      scenario: PlanScenario,
      factor: keyof PlanFactors,
    ): [number, string, number, number][] =>
      series
        .filter((row) => row.scenario === scenario)
        .map((row): [number, string, number, number] => [
          row.factors[factor],
          row.relation,
          row.rushNet,
          row.planNet,
        ]);
    expect(nets(report.sweeps.planTicks, 'simpleShort', 'planTicks')).toEqual([
      [1, 'rush', 10, 0],
      [2, 'rush', 10, 0],
      [3, 'rush', 10, 0],
      [4, 'rush', 10, 0],
      [5, 'rush', 10, 0],
      [6, 'rush', 10, 0],
      [7, 'rush', 10, 0],
      [8, 'rush', 10, 0],
    ]);
    expect(nets(report.sweeps.planTicks, 'complexTight', 'planTicks')).toEqual([
      [1, 'plan', 0, 18],
      [2, 'plan', 0, 18],
      [3, 'tie', 0, 0],
      [4, 'tie', 0, 0],
      [5, 'tie', 0, 0],
      [6, 'tie', 0, 0],
      [7, 'tie', 0, 0],
      [8, 'tie', 0, 0],
    ]);
    expect(nets(report.sweeps.planTicks, 'complexLong', 'planTicks')).toEqual([
      [1, 'plan', 12, 18],
      [2, 'plan', 12, 18],
      [3, 'plan', 12, 18],
      [4, 'plan', 12, 18],
      [5, 'plan', 12, 18],
      [6, 'plan', 12, 18],
      [7, 'rush', 12, 0],
      [8, 'rush', 12, 0],
    ]);
    expect(nets(report.sweeps.wanderWork, 'complexTight', 'wanderWork')).toEqual([
      [0, 'plan', 12, 18],
      [1, 'plan', 12, 18],
      [2, 'plan', 12, 18],
      [3, 'plan', 0, 18],
      [4, 'plan', 0, 18],
      [5, 'plan', 0, 18],
      [6, 'plan', 0, 18],
      [7, 'plan', 0, 18],
    ]);
    expect(nets(report.sweeps.wanderWork, 'complexLong', 'wanderWork')).toEqual([
      [0, 'plan', 12, 18],
      [1, 'plan', 12, 18],
      [2, 'plan', 12, 18],
      [3, 'plan', 12, 18],
      [4, 'plan', 12, 18],
      [5, 'plan', 12, 18],
      [6, 'plan', 12, 18],
      [7, 'plan', 0, 18],
    ]);
    expect(
      report.sweeps.wanderWork
        .filter((row) => row.scenario === 'simpleShort')
        .every((row) => row.relation === 'rush' && row.rushNet === 10 && row.planNet === 0),
    ).toBe(true);
    expect(nets(report.sweeps.wanderPenalty, 'complexLong', 'wanderPenalty')).toEqual([
      [0, 'tie', 18, 18],
      [1, 'plan', 17, 18],
      [2, 'plan', 16, 18],
      [3, 'plan', 15, 18],
      [4, 'plan', 14, 18],
      [5, 'plan', 13, 18],
      [6, 'plan', 12, 18],
      [7, 'plan', 11, 18],
      [8, 'plan', 10, 18],
    ]);
    expect(
      report.sweeps.wanderPenalty
        .filter((row) => row.scenario === 'complexTight')
        .every((row) => row.relation === 'plan' && row.rushNet === 0 && row.planNet === 18),
    ).toBe(true);
    const finding = (ticks: number) =>
      playOf(
        report.sweeps.planTicks.find(
          (row) => row.scenario === 'simpleShort' && row.factors.planTicks === ticks,
        )!,
        'plan',
      ).result.findings;
    expect(finding(6)).toEqual(['s1:no-hidden-scope']);
    expect(finding(7)).toEqual([]);
    const tightTie = report.sweeps.planTicks.find(
      (row) => row.scenario === 'complexTight' && row.factors.planTicks === 3,
    )!;
    expect(playOf(tightTie, 'plan').result.findings).toEqual(['c1:dependency:ledger-order']);
    expect(playOf(tightTie, 'plan').result.wandered).toEqual([]);
    expect(playOf(tightTie, 'rush').result.wandered).toEqual(['c1']);
    expect(playOf(tightTie, 'rush').result.shippedValue).toBe(0);
  });

  it('全行の再生と毎入力JSON保存再開が一致し、迷走は複雑仕事だけに乗る', () => {
    for (const row of rows) {
      const horizon = comparison.results.find((item) => item.scenario === row.scenario)?.initial
        .board.horizon;
      const plan = playOf(row, 'plan');
      const rush = playOf(row, 'rush');
      expect(plan.inputs).toHaveLength(horizon ?? 0);
      expect(rush.inputs).toHaveLength(horizon ?? 0);
      expect(plan.inputs.filter((input) => input.type === 'plan')).toHaveLength(
        Math.min(row.factors.planTicks, horizon ?? 0),
      );
      expect(rush.inputs.every((input) => input.type === 'tick')).toBe(true);
      for (const play of row.plays) {
        const live = replay(row.scenario, row.factors, play.inputs, play.strategy);
        expect(summarizePlan(live)).toEqual(play.result);
        if (row.scenario === 'simpleShort') {
          expect(live.wandered).toEqual([]);
          expect(live.board.jobs[0]?.work).toBe(JOB_WORK);
          continue;
        }
        if (play.strategy === 'plan') {
          expect(live.wandered).toEqual([]);
          expect(live.board.jobs[0]?.work).toBe(JOB_WORK);
          continue;
        }
        expect(live.wandered).toEqual(['c1']);
        expect(live.board.jobs[0]?.work).toBe(JOB_WORK + row.factors.wanderWork);
        expect(live.board.resolutions[0]).toBe(`wander:c1+${row.factors.wanderWork}`);
        const shipped = live.board.jobs[0]?.shipped;
        if (shipped === null || shipped === undefined) {
          expect(live.board.resolutions.some((line) => line.startsWith('wander-penalty'))).toBe(
            false,
          );
        } else {
          expect(shipped).toBe(18 - row.factors.wanderPenalty);
          expect(live.board.resolutions).toContain(
            `wander-penalty:c1-${row.factors.wanderPenalty}`,
          );
        }
      }
    }
  });
});
