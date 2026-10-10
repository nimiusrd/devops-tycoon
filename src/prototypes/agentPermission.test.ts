import { describe, expect, it } from 'vitest';
import {
  applyPermissionInput as apply,
  choosePermissionAction,
  comparePermissionStrategies,
  createPermissionPrototype as create,
  summarizePermission,
  viewPermission,
} from './agentPermission';
import comparison from '../../docs/prototypes/agent-permission-comparison.json';

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
