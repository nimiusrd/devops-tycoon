import { describe, expect, it } from 'vitest';
import {
  applySlotInput as apply,
  compareMultiSprintCosts,
  compareSlotStrategies,
  createMultiSprintState,
  createSlotPrototype as create,
  describeOperationSlotCounts,
  summarizeSlots,
  viewSlots,
} from './operationSlots';
import comparison from '../../docs/prototypes/operation-slots-comparison.json';
import costSweep from '../../docs/prototypes/operation-slots-cost-sweep.json';

describe('RI-183 施策の運用枠', () => {
  it('所持3枚と運用枠2を分けて表示し、閲覧は状態を変えない', () => {
    const state = create(1, 'routine');
    expect(create(1, 'routine')).toEqual(state);
    const before = structuredClone(state);
    expect(viewSlots(state)).toMatchObject({
      slotCap: 2,
      owned: ['lint', 'tests', 'platform'],
      active: [],
      usedSlots: 0,
      basePerTick: 1,
    });
    expect(state).toEqual(before);
  });
  it('枠を超える有効化は集中力が残っていても拒否し、無効化は恒久の基礎値を残す', () => {
    const platform = apply(create(1, 'routine'), { type: 'enable', id: 'platform' });
    expect(viewSlots(platform)).toMatchObject({ usedSlots: 2, focus: 2, bonusPerTick: 2 });
    expect(apply(platform, { type: 'enable', id: 'lint' })).toBe(platform);
    let state = apply(platform, { type: 'tick' });
    expect(state.earnedValue).toBe(3);
    expect(state.upkeepPaid).toBe(1);
    state = apply(state, { type: 'disable', id: 'platform' });
    expect(state.active).toEqual([]);
    expect(state.owned).toEqual(['lint', 'tests', 'platform']);
    state = apply(state, { type: 'tick' });
    expect(state.earnedValue).toBe(4);
    expect(state.upkeepPaid).toBe(1);
    state = apply(state, { type: 'enable', id: 'platform' });
    state = apply(state, { type: 'tick' });
    expect(state.earnedValue).toBe(7);
    expect(state.upkeepPaid).toBe(2);
    expect(viewSlots(state).basePerTick).toBe(1);
  });
  it('軽量2つの同時運用は枠ちょうどで、3つ目は無消費で拒否する', () => {
    const state = apply(apply(create(1, 'migration'), { type: 'enable', id: 'lint' }), {
      type: 'enable',
      id: 'tests',
    });
    expect(viewSlots(state)).toMatchObject({ usedSlots: 2, freeSlots: 0, bonusPerTick: 0 });
    expect(apply(state, { type: 'enable', id: 'platform' })).toBe(state);
    expect(apply(state, { type: 'enable', id: 'lint' })).toBe(state);
    expect(apply(state, { type: 'disable', id: 'platform' })).toBe(state);
    const poor = { ...state, focus: 0 };
    expect(apply(poor, { type: 'disable', id: 'lint' })).toBe(poor);
  });
  it('期末の操作は無消費で拒否する', () => {
    const ended = { ...create(1, 'routine'), tick: 6 };
    expect(apply(ended, { type: 'enable', id: 'lint' })).toBe(ended);
    expect(apply(ended, { type: 'disable', id: 'lint' })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
  });
  it('定型は軽量の組合せ、移行は大型施策が有力で、維持費は大型だけが毎tick払う', () => {
    const rows = compareSlotStrategies();
    expect(rows).toEqual(comparison.results);
    const net = (workload: string, strategy: string) =>
      rows.find((row) => row.workload === workload && row.strategy === strategy)!.result.netValue;
    expect(net('routine', 'lights')).toBe(16);
    expect(net('routine', 'platform')).toBe(11);
    expect(net('migration', 'platform')).toBe(23);
    expect(net('migration', 'lights')).toBe(4);
    const platform = rows.find(
      (row) => row.workload === 'migration' && row.strategy === 'platform',
    )!;
    const lights = rows.find((row) => row.workload === 'routine' && row.strategy === 'lights')!;
    expect(platform.result.upkeepPaid).toBe(6);
    expect(lights.result.upkeepPaid).toBe(0);
    expect(rows.every((row) => row.result.ownedCount === 3 && row.result.usedSlots === 2)).toBe(
      true,
    );
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareSlotStrategies()) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizeSlots(live)).toEqual(row.result);
    }
  });
  it('所持枚数・同時運用枠・空き枠を別の文で読む', () => {
    expect(describeOperationSlotCounts({ ownedCount: 3, slotCap: 2, freeSlots: 2 })).toBe(
      '所持3枚。同時に運用できる枠は2。空き枠は2。',
    );
    expect(describeOperationSlotCounts({ ownedCount: 3, slotCap: 2, freeSlots: 1 })).toBe(
      '所持3枚。同時に運用できる枠は2。空き枠は1。',
    );
    expect(describeOperationSlotCounts({ ownedCount: 3, slotCap: 2, freeSlots: 0 })).toBe(
      '所持3枚。同時に運用できる枠は2。空き枠は0。',
    );
    const tied = describeOperationSlotCounts({ ownedCount: 2, slotCap: 2, freeSlots: 2 });
    expect(tied).toBe('所持2枚。同時に運用できる枠は2。空き枠は2。');
    expect(tied.split('。').filter(Boolean)).toEqual([
      '所持2枚',
      '同時に運用できる枠は2',
      '空き枠は2',
    ]);
    const initial = viewSlots(create(1, 'routine'));
    expect(
      describeOperationSlotCounts({
        ownedCount: initial.owned.length,
        slotCap: initial.slotCap,
        freeSlots: initial.freeSlots,
      }),
    ).toBe('所持3枚。同時に運用できる枠は2。空き枠は2。');
    const one = viewSlots(apply(create(1, 'routine'), { type: 'enable', id: 'lint' }));
    expect(
      describeOperationSlotCounts({
        ownedCount: one.owned.length,
        slotCap: one.slotCap,
        freeSlots: one.freeSlots,
      }),
    ).toBe('所持3枚。同時に運用できる枠は2。空き枠は1。');
  });
  it('複数スプリントは維持費と切替費用を一つずつ動かし、一期比較の入力を繰り返さない', () => {
    const sweep = compareMultiSprintCosts();
    expect(sweep).toEqual(costSweep);
    expect(sweep.conditions).toMatchObject({
      seed: 1,
      ticksPerSprint: 6,
      sprints: ['routine', 'migration'],
      focus: 30,
      openingToggleCost: 1,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
    });
    const firstLights = compareSlotStrategies().find((row) => row.strategy === 'lights')!;
    expect(sweep.inputs['keep-lights']).not.toEqual(firstLights.inputs);
    expect(sweep.inputs['keep-lights'].filter((input) => input.type === 'tick')).toHaveLength(12);
    expect(sweep.inputs['switch-to-platform']).toContainEqual({
      type: 'workload',
      workload: 'migration',
    });
    const upkeep = (value: number) =>
      sweep.upkeepSweep.find((row) => row.platformUpkeep === value)!;
    expect(upkeep(2).lightsVersusPlatform).toBe('platform');
    expect(upkeep(2).results['keep-platform'].netValue).toBe(23);
    expect(upkeep(2).results['keep-lights'].netValue).toBe(22);
    expect(upkeep(3).lightsVersusPlatform).toBe('lights');
    expect(upkeep(3).results['keep-lights'].netValue).toBe(22);
    expect(upkeep(3).results['keep-platform'].netValue).toBe(11);
    expect(sweep.switchCostSweep.map((row) => row.lightsVersusPlatform)).toEqual([
      'platform',
      'platform',
      'platform',
      'platform',
    ]);
    const atSwitch = (value: number) =>
      sweep.switchCostSweep.find((row) => row.switchCost === value)!;
    expect(atSwitch(1).results['switch-to-platform']).toMatchObject({
      earnedValue: 48,
      upkeepPaid: 6,
      focusSpent: 5,
      netValue: 37,
    });
    expect(atSwitch(1).results['keep-platform']).toMatchObject({
      earnedValue: 48,
      upkeepPaid: 12,
      focusSpent: 1,
      netValue: 35,
    });
    expect(atSwitch(1).results['keep-lights']).toMatchObject({
      earnedValue: 24,
      upkeepPaid: 0,
      focusSpent: 2,
      netValue: 22,
    });
    expect(sweep.switchCostSweep.every((row) => row.results['keep-lights'].netValue === 22)).toBe(
      true,
    );
    expect(sweep.switchCostSweep.every((row) => row.results['keep-platform'].netValue === 35)).toBe(
      true,
    );
    expect(atSwitch(2).results['switch-to-platform'].netValue).toBe(34);
    expect(atSwitch(2).results['keep-platform'].netValue).toBe(35);
    expect(atSwitch(2).leaders).toEqual(['keep-platform']);
    expect(sweep.upkeepSweep.every((row) => row.results['keep-lights'].netValue === 22)).toBe(true);
    expect(sweep.reversals).toEqual([
      expect.objectContaining({
        axis: 'platformUpkeep',
        question: 'leaders',
        before: expect.objectContaining({ platformUpkeep: 0, leaders: ['keep-platform'] }),
        after: expect.objectContaining({ platformUpkeep: 1, leaders: ['switch-to-platform'] }),
      }),
      expect.objectContaining({
        axis: 'platformUpkeep',
        question: 'lights-versus-platform',
        before: expect.objectContaining({ platformUpkeep: 2, lightsVersusPlatform: 'platform' }),
        after: expect.objectContaining({ platformUpkeep: 3, lightsVersusPlatform: 'lights' }),
      }),
      expect.objectContaining({
        axis: 'platformUpkeep',
        question: 'leaders',
        before: expect.objectContaining({ platformUpkeep: 3, leaders: ['switch-to-platform'] }),
        after: expect.objectContaining({ platformUpkeep: 4, leaders: ['keep-lights'] }),
      }),
      expect.objectContaining({
        axis: 'switchCost',
        question: 'leaders',
        before: expect.objectContaining({ switchCost: 1, leaders: ['switch-to-platform'] }),
        after: expect.objectContaining({ switchCost: 2, leaders: ['keep-platform'] }),
      }),
    ]);
    expect(
      sweep.reversals.some(
        (row) => row.axis === 'switchCost' && row.question === 'lights-versus-platform',
      ),
    ).toBe(false);
  });
  it('費用掃引の入力列を再生すると記録した差引と一致し、元の状態を変えない', () => {
    const sweep = compareMultiSprintCosts();
    const seen = new Set<string>();
    for (const point of [...sweep.upkeepSweep, ...sweep.switchCostSweep]) {
      const key = `${point.platformUpkeep}:${point.switchCost}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const strategy of ['keep-lights', 'keep-platform', 'switch-to-platform'] as const) {
        const inputs = sweep.inputs[strategy];
        const beforeInputs = structuredClone(inputs);
        const initial = createMultiSprintState(point.platformUpkeep, point.switchCost);
        const snapshot = structuredClone(initial);
        let live = initial;
        for (const input of inputs) {
          const previous = live;
          const before = structuredClone(live);
          live = apply(live, input);
          expect(previous).toEqual(before);
        }
        expect(inputs).toEqual(beforeInputs);
        expect(initial).toEqual(snapshot);
        expect(summarizeSlots(live)).toEqual(point.results[strategy]);
        expect(live.tick).toBe(12);
        expect(viewSlots(live).workload).toBe('migration');
        expect(live.focus + live.focusSpent).toBe(snapshot.focus);
      }
    }
    expect(seen.size).toBe(sweep.upkeepSweep.length + sweep.switchCostSweep.length - 1);
  });
  it('tick 0 の有効化は1のまま、経過後の切替費用が足りなければ拒否する', () => {
    const opened = apply(createMultiSprintState(1, 4), { type: 'enable', id: 'platform' });
    expect(opened.focusSpent).toBe(1);
    expect(opened.focus).toBe(29);
    const started = apply(opened, { type: 'tick' });
    expect(apply(started, { type: 'disable', id: 'platform' }).focusSpent).toBe(5);
    const poor = { ...started, focus: 3 };
    expect(apply(poor, { type: 'disable', id: 'platform' })).toBe(poor);
    const ended = { ...create(1, 'routine'), tick: 6 };
    expect(apply(ended, { type: 'workload', workload: 'migration' })).toBe(ended);
  });
  it('初回の集中力3では境界切替を最後まで適用できない', () => {
    const inputs = compareMultiSprintCosts().inputs['switch-to-platform'];
    let state = create(1, 'routine', 12);
    let applied = 0;
    for (const input of inputs) {
      const next = apply(state, input);
      if (next === state) break;
      state = next;
      applied += 1;
    }
    expect(applied).toBeLessThan(inputs.length);
    expect(state.active).toEqual(['tests']);
    expect(state.focus).toBe(0);
    expect(summarizeSlots(state).netValue).not.toBe(37);
  });
});
