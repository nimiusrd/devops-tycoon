import { describe, expect, it } from 'vitest';
import {
  applyPermissionInput as apply,
  baselinePermissionRules,
  choosePermissionAction,
  comparePermissionFactorReversals,
  comparePermissionStrategies,
  createPermissionPrototype as create,
  summarizePermission,
  viewPermission,
  type PermissionRules,
} from './agentPermission';
import comparison from '../../docs/prototypes/agent-permission-comparison.json';
import factors from '../../docs/prototypes/agent-permission-factor-comparison.json';

describe('RI-193 エージェントの権限設定', () => {
  it('読み取りは重要領域を承認待ちにし、編集は完了時に影響を一度だけ広げる', () => {
    const read = apply(create('RI-193', 'critical'), { type: 'scope', scope: 'read' });
    expect(viewPermission(read).jobs[0].status).toBe('approval');
    const waiting = apply(read, { type: 'tick' });
    expect(waiting.jobs[0]).toMatchObject({ progress: 0, approvalLeft: 1, shipped: null });
    expect(waiting.resolutions[0]).toBe('t1:c1,approval');
    const edit = apply(create('RI-193', 'critical'), { type: 'scope', scope: 'edit' });
    expect(viewPermission(edit).jobs[0].status).toBe('allowed');
    const shipped = apply(apply(edit, { type: 'tick' }), { type: 'tick' });
    expect(shipped.jobs[0]).toMatchObject({ shipped: 16, blast: 20, progress: 4 });
    expect(shipped.loss).toBe(20);
    expect(shipped.resolutions[1]).toBe('t2:c1,edit+2,ship:16,blast:20');
    const routine = apply(
      apply(apply(create('RI-193', 'routine'), { type: 'scope', scope: 'edit' }), { type: 'tick' }),
      { type: 'tick' },
    );
    expect(routine.jobs[0]).toMatchObject({ shipped: 6, blast: 0 });
    expect(routine.loss).toBe(0);
  });

  it('未知の権限、同じ権限、着手後の変更、未設定の進行を拒否する', () => {
    const initial = create('RI-193', 'routine');
    expect(apply(initial, { type: 'scope', scope: 'admin' })).toBe(initial);
    expect(apply(initial, { type: 'tick' })).toBe(initial);
    const scoped = apply(initial, { type: 'scope', scope: 'read' });
    expect(apply(scoped, { type: 'scope', scope: 'read' })).toBe(scoped);
    const switched = apply(scoped, { type: 'scope', scope: 'edit' });
    expect(switched.scope).toBe('edit');
    const started = apply(switched, { type: 'tick' });
    expect(apply(started, { type: 'scope', scope: 'read' })).toBe(started);
    expect(started.scope).toBe('edit');
  });

  it('閲覧では権限も進捗も動かず、期末は無消費で拒否する', () => {
    const initial = create('RI-193', 'critical');
    const before = structuredClone(initial);
    for (let count = 0; count < 30; count += 1) viewPermission(initial);
    expect(initial).toEqual(before);
    expect(viewPermission(initial).policy.read.critical).toBe('approval');
    const ended = { ...initial, tick: initial.horizon };
    expect(apply(ended, { type: 'tick' })).toBe(ended);
    expect(apply(ended, { type: 'scope', scope: 'edit' })).toBe(ended);
  });

  it('定型は編集が速く、重要領域は読み取りの承認待ちが有利で、編集は上位互換ではない', () => {
    const rows = comparePermissionStrategies(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const net = (scenario: string, strategy: string) =>
      rows.find((row) => row.scenario === scenario && row.strategy === strategy)!.result.netValue;
    expect([net('routine', 'edit'), net('routine', 'read')]).toEqual([12, 6]);
    expect([net('critical', 'read'), net('critical', 'edit')]).toEqual([16, -4]);
    const wide = rows.find((row) => row.scenario === 'critical' && row.strategy === 'edit')!;
    expect(wide.result.loss).toBe(20);
    const narrow = rows.find((row) => row.scenario === 'critical' && row.strategy === 'read')!;
    expect(narrow.result.loss).toBe(0);
    expect(narrow.result.resolutions.slice(0, 2).every((line) => line.endsWith('approval'))).toBe(
      true,
    );
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、出荷と損失が崩れない', () => {
    for (const row of comparePermissionStrategies(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(choosePermissionAction(previous, row.strategy)).toEqual(input);
        expect(live.jobs.reduce((sum, item) => sum + (item.shipped ?? 0), 0)).toBe(
          live.shippedValue,
        );
        expect(live.jobs.reduce((sum, item) => sum + item.blast, 0)).toBe(live.loss);
      }
      expect(summarizePermission(live)).toEqual(row.result);
      const again = row.inputs.reduce((state, input) => apply(state, input), row.initial);
      expect(again).toEqual(live);
    }
  });
});

function changedKeys(rules: PermissionRules): (keyof PermissionRules)[] {
  return (Object.keys(baselinePermissionRules) as (keyof PermissionRules)[]).filter(
    (key) => rules[key] !== baselinePermissionRules[key],
  );
}

describe('RI-193 承認tickと影響の反転', () => {
  it('初回と同じ資源で要因を一つずつ動かし、記録した反転と再計算が一致する', () => {
    const data = comparePermissionFactorReversals();
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-193',
      scenarios: ['routine', 'critical'],
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionAdoption: false,
      scopeConsumesTick: false,
    });
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((item) => [
        item.parameter,
        item.scenarios.map((scenario) => [
          scenario.scenario,
          scenario.preapprove.result.netValue,
          scenario.confirm.result.netValue,
          scenario.preference,
          scenario.margin,
        ]),
      ]);
    const routine = ['routine', 12, 6, 'preapprove', 6];
    const criticalConfirm = (preapprove: number, confirm: number) => [
      'critical',
      preapprove,
      confirm,
      'confirm',
      preapprove - confirm,
    ];
    expect(nets('approvalTicks')).toEqual([
      ['0', [routine, criticalConfirm(-4, 16)]],
      ['1', [routine, criticalConfirm(-4, 16)]],
      ['2', [routine, criticalConfirm(-4, 16)]],
      ['3', [routine, criticalConfirm(-4, 16)]],
      ['4', [routine, criticalConfirm(-4, 16)]],
      ['5', [routine, criticalConfirm(-4, 0)]],
      ['6', [routine, criticalConfirm(-4, 0)]],
      ['7', [routine, criticalConfirm(-4, 0)]],
      ['8', [routine, criticalConfirm(-4, 0)]],
    ]);
    expect(nets('blast')).toEqual([
      ['0', [routine, ['critical', 16, 16, 'tie', 0]]],
      ['1', [routine, criticalConfirm(15, 16)]],
      ['15', [routine, criticalConfirm(1, 16)]],
      ['16', [routine, criticalConfirm(0, 16)]],
      ['20', [routine, criticalConfirm(-4, 16)]],
      ['32', [routine, criticalConfirm(-16, 16)]],
    ]);
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.scenario,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([['blast', 'critical', '0', 'tie', '1', 'confirm']]);
    expect(data.reversals.some((item) => item.axis === 'approvalTicks')).toBe(false);
    expect(data.reversals.some((item) => item.scenario === 'routine')).toBe(false);
  });

  it('基準行は初回の編集・読み取りと一致し、動かした規則は一つである', () => {
    const data = comparePermissionFactorReversals();
    const first = comparePermissionStrategies(comparison.seed);
    for (const point of [
      data.sweeps.approvalTicks.find((item) => item.parameter === '2'),
      data.sweeps.blast.find((item) => item.parameter === '20'),
    ]) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      for (const scenario of point.scenarios) {
        const wide = first.find(
          (row) => row.scenario === scenario.scenario && row.strategy === 'edit',
        );
        const narrow = first.find(
          (row) => row.scenario === scenario.scenario && row.strategy === 'read',
        );
        if (!wide || !narrow) throw new Error('first');
        expect(scenario.preapprove.inputs).toEqual(wide.inputs);
        expect(scenario.preapprove.result).toEqual(wide.result);
        expect(scenario.confirm.inputs).toEqual(narrow.inputs);
        expect(scenario.confirm.result).toEqual(narrow.result);
      }
    }
    for (const item of data.sweeps.approvalTicks) {
      expect(changedKeys(item.rules).every((name) => name === 'approvalTicks')).toBe(true);
      expect(item.rules.blast).toBe(20);
      expect(item.rules.approvalTicks).toBe(Number(item.parameter));
    }
    for (const item of data.sweeps.blast) {
      expect(changedKeys(item.rules).every((name) => name === 'blast')).toBe(true);
      expect(item.rules.approvalTicks).toBe(2);
      expect(item.rules.blast).toBe(Number(item.parameter));
    }
    const shipped = data.sweeps.approvalTicks.find((item) => item.parameter === '4');
    const missed = data.sweeps.approvalTicks.find((item) => item.parameter === '5');
    const criticalShipped = shipped?.scenarios.find((item) => item.scenario === 'critical');
    const criticalMissed = missed?.scenarios.find((item) => item.scenario === 'critical');
    expect(criticalShipped?.confirm.result.jobs[0]).toMatchObject({
      status: 'shipped',
      shipped: 16,
      blast: 0,
    });
    expect(
      criticalShipped?.confirm.result.resolutions.filter((line) => line.endsWith('approval')),
    ).toHaveLength(4);
    expect(criticalMissed?.confirm.result.jobs[0]).toMatchObject({
      status: 'allowed',
      shipped: null,
      blast: 0,
      approvalLeft: 0,
    });
    expect(criticalMissed?.confirm.result.resolutions.some((line) => line.includes('ship:'))).toBe(
      false,
    );
    expect(
      criticalMissed?.confirm.result.resolutions.filter((line) => line.endsWith('approval')),
    ).toHaveLength(5);
    const tied = data.sweeps.blast.find((item) => item.parameter === '0');
    const strict = data.sweeps.blast.find((item) => item.parameter === '1');
    expect(
      tied?.scenarios.find((item) => item.scenario === 'critical')?.preapprove.result.resolutions,
    ).toContain('t2:c1,edit+2,ship:16,blast:0');
    expect(
      strict?.scenarios.find((item) => item.scenario === 'critical')?.preapprove.result.resolutions,
    ).toContain('t2:c1,edit+2,ship:16,blast:1');
    for (const item of [...data.sweeps.approvalTicks, ...data.sweeps.blast]) {
      const routine = item.scenarios.find((scenario) => scenario.scenario === 'routine');
      expect(routine?.preapprove.result.loss).toBe(0);
      expect(routine?.confirm.result.loss).toBe(0);
      expect(routine?.confirm.result.resolutions.some((line) => line.includes('approval'))).toBe(
        false,
      );
    }
  });

  it('規則を渡さない再生は初回の影響20になり、渡した影響だけが出荷時に一度引かれる', () => {
    const rules = { approvalTicks: 2, blast: 0 };
    const started = apply(
      create('RI-193', 'critical', rules),
      { type: 'scope', scope: 'edit' },
      rules,
    );
    const omitted = apply(apply(started, { type: 'tick' }, rules), { type: 'tick' });
    expect(omitted.loss).toBe(20);
    expect(omitted.resolutions[1]).toBe('t2:c1,edit+2,ship:16,blast:20');
    const recorded = apply(apply(started, { type: 'tick' }, rules), { type: 'tick' }, rules);
    expect(recorded.loss).toBe(0);
    expect(recorded.jobs[0]).toMatchObject({ shipped: 16, blast: 0 });
    expect(recorded.resolutions[1]).toBe('t2:c1,edit+2,ship:16,blast:0');
  });

  it('要因比較の入力を再生すると差引が一致し、期末では同じ状態を返す', () => {
    const data = comparePermissionFactorReversals();
    for (const item of Object.values(data.sweeps).flat()) {
      for (const scenario of item.scenarios) {
        for (const strategy of ['preapprove', 'confirm'] as const) {
          const run = scenario[strategy];
          const chosen = strategy === 'preapprove' ? 'edit' : 'read';
          let state = create(data.conditions.seed, scenario.scenario, item.rules);
          const snapshot = structuredClone(state);
          if (scenario.scenario === 'critical') {
            expect(state.jobs[0]?.approvalLeft).toBe(item.rules.approvalTicks);
          } else {
            expect(state.jobs.every((job) => job.approvalLeft === 0)).toBe(true);
          }
          for (const input of run.inputs) {
            const previous = state;
            const before = structuredClone(state);
            expect(choosePermissionAction(state, chosen)).toEqual(input);
            state = apply(state, input, item.rules);
            const restored = apply(JSON.parse(JSON.stringify(before)), input, item.rules);
            expect(previous).toEqual(before);
            expect(restored).toEqual(state);
            expect(state.jobs.reduce((sum, job) => sum + (job.shipped ?? 0), 0)).toBe(
              state.shippedValue,
            );
            expect(state.jobs.reduce((sum, job) => sum + job.blast, 0)).toBe(state.loss);
          }
          expect(snapshot.tick).toBe(0);
          expect(summarizePermission(state)).toEqual(run.result);
          expect(state.inputs).toEqual(run.inputs);
          expect(apply(state, { type: 'tick' }, item.rules)).toBe(state);
        }
      }
    }
  });
});
