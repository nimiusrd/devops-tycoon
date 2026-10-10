import { describe, expect, it } from 'vitest';
import { JOB_WORK, type ModelJob } from './modelAssignment';
import {
  applyPlanInput as apply,
  choosePlanAction,
  comparePlanStrategies,
  createPlanPrototype as create,
  summarizePlan,
  viewPlan,
  type PlanState,
} from './implementationPlan';
import comparison from '../../docs/prototypes/implementation-plan-comparison.json';

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
