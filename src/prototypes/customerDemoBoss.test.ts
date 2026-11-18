import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/customer-demo-boss-comparison.json';
import {
  applyCustomerDemoInput as apply,
  baselineDemoRules,
  compareCustomerDemoBoss,
  createCustomerDemoBoss as create,
  replayCustomerDemo as replay,
  runCustomerDemo,
  summarizeCustomerDemo as summarize,
  viewCustomerDemo as view,
  type DemoInput,
  type DemoState,
  type DemoTaskId,
} from './customerDemoBoss';

function step(state: DemoState) {
  return apply(state, { seq: state.nextSequence, type: 'step' });
}
function priority(state: DemoState, taskId: DemoTaskId) {
  return apply(state, { seq: state.nextSequence, type: 'priority', taskId });
}
function atDemo(strategy: 'demo' | 'equalShipment' | 'throughput') {
  const play = runCustomerDemo('RI-263', strategy);
  let state = play.initial;
  for (const input of play.inputs) {
    state = apply(state, input);
    if (state.demo) return state;
  }
  throw new Error('期限評価がない');
}

describe('RI-263 指定時刻の顧客デモ', () => {
  it('開始前に必須条件、全工数、資源、部分評価、未完成の代償を公開する', () => {
    const state = create('RI-263');
    const before = structuredClone(state);
    const contract = view(state);
    expect(contract).toMatchObject({
      tick: 0,
      requiredTaskIds: ['api', 'screen', 'data'],
      rules: { deadline: 7, horizon: 10, workBudget: 10, trustLossPerMissing: 2 },
      workerSlots: 1,
      workPerTick: 1,
      partialCreditPerCompletedRequired: 2,
      initialTrust: 6,
      workRemaining: 10,
      demo: null,
    });
    expect(
      contract.tasks.map((task) => [task.id, task.required, task.work, task.shipment]),
    ).toEqual([
      ['api', true, 2, 4],
      ['screen', true, 2, 4],
      ['data', true, 3, 4],
      ['urgent', false, 2, 4],
      ['bulk', false, 2, 8],
    ]);
    for (let i = 0; i < 5; i++) expect(view(state)).toEqual(contract);
    contract.tasks[0].progress = 100;
    contract.rules.deadline = 100;
    (contract.autoOrder as DemoTaskId[]).reverse();
    expect(state).toEqual(before);
    expect(view(create('other-seed'))).toEqual(view(state));
  });

  it('同じ総出荷12でも必須3件完成と2件完成を区別し、個別成果を二重計上しない', () => {
    const ready = atDemo('demo');
    const partial = atDemo('equalShipment');
    expect([summarize(ready).totalShipment, summarize(partial).totalShipment]).toEqual([12, 12]);
    expect(ready.demo).toMatchObject({
      established: true,
      completedRequired: ['api', 'screen', 'data'],
      partialCredit: 6,
      optionalShipment: 0,
      trustLoss: 0,
    });
    expect(partial.demo).toMatchObject({
      established: false,
      completedRequired: ['api', 'screen'],
      missingRequired: [{ id: 'data', progress: 1, remaining: 2 }],
      partialCredit: 4,
      optionalShipment: 4,
      trustLoss: 2,
    });
    expect(partial.trust).toBe(4);
    expect(summarize(partial).ended).toBe(false);
    const continued = step(partial);
    expect(continued.tick).toBe(8);
    expect(continued.tasks.find((task) => task.id === 'data')!.progress).toBe(2);
  });

  it('期限tickの完成は間に合い、1tick遅い完成は判定を取り戻さない', () => {
    const play = runCustomerDemo('RI-263', 'demo', { ...baselineDemoRules, deadline: 6 });
    const atSix = replay(
      play.initial,
      play.inputs.filter((input) => input.seq < 9),
    );
    expect(atSix.tick).toBe(6);
    expect(atSix.demo).toMatchObject({
      established: false,
      missingRequired: [{ id: 'data', progress: 2, remaining: 1 }],
    });
    const late = step(atSix);
    expect(late.tasks.find((task) => task.id === 'data')!.completedTick).toBe(7);
    expect(late.demo).toEqual(atSix.demo);
    expect(late.trust).toBe(4);
    expect(atDemo('demo').demo!.established).toBe(true);
    const later = replay(play.initial, play.inputs);
    expect(later.demo).toEqual(atSix.demo);
    expect(later.trust).toBe(4);
    expect(summarize(later).totalShipment).toBe(20);
  });

  it('未介入でも作業・出荷・時計が進み、期限時に無条件で戦を終了しない', () => {
    let state = create('RI-263');
    for (let tick = 1; tick <= 10; tick++) {
      state = step(state);
      expect(state.tick).toBe(tick);
      expect(state.workRemaining).toBe(10 - tick);
      expect(summarize(state).ended).toBe(tick === 10);
    }
    expect(summarize(state)).toMatchObject({ totalShipment: 20, spentWork: 10 });
    expect(state.demo).toMatchObject({ established: false, partialCredit: 4 });
    expect(state.tasks.find((task) => task.id === 'data')!.progress).toBe(2);
    expect(step(state)).toBe(state);
  });

  it('資源切れと全仕事完了後も時計だけ進み、進捗・出荷・資源を増減させない', () => {
    let empty = create('RI-263', { ...baselineDemoRules, workBudget: 0 });
    for (let i = 0; i < 10; i++) empty = step(empty);
    expect(summarize(empty)).toMatchObject({ totalShipment: 0, spentWork: 0, trust: 0 });
    expect(empty.demo!.missingRequired).toHaveLength(3);
    const play = runCustomerDemo('RI-263', 'demo', {
      ...baselineDemoRules,
      horizon: 15,
      workBudget: 20,
    });
    const state = replay(play.initial, play.inputs);
    expect(state.tasks.every((task) => task.completedTick !== null)).toBe(true);
    expect(summarize(state)).toMatchObject({ totalShipment: 24, spentWork: 11, workRemaining: 9 });
    const assessed = atDemo('demo');
    const snapshot = view(assessed);
    snapshot.demo!.completedRequired.length = 0;
    expect(assessed.demo!.completedRequired).toHaveLength(3);
  });

  it('重複step・古い番号・先の番号・完了済み指定は無変化で二重計上しない', () => {
    const initial = create('RI-263');
    const command: DemoInput = { seq: 0, type: 'priority', taskId: 'api' };
    let state = apply(initial, command);
    expect(apply(state, command)).toBe(state);
    expect(priority(state, 'api')).toBe(state);
    const tick: DemoInput = { seq: state.nextSequence, type: 'step' };
    state = apply(state, tick);
    expect(apply(state, tick)).toBe(state);
    expect(apply(state, { seq: 100, type: 'step' })).toBe(state);
    expect(apply(state, { seq: -1, type: 'step' })).toBe(state);
    state = step(state);
    expect(summarize(state).totalShipment).toBe(4);
    expect(priority(state, 'api')).toBe(state);
    expect(priority(state, 'unknown' as DemoTaskId)).toBe(state);
    state = step(state);
    expect(summarize(state).totalShipment).toBe(4);
    expect(state.tasks.find((task) => task.id === 'bulk')!.progress).toBe(1);
  });

  it('比較JSONを再生成し、全入力の再生・毎入力JSON再開・保存値の独立性が一致する', () => {
    const report = compareCustomerDemoBoss();
    expect(report).toEqual(comparison);
    for (const row of report.conditions) {
      for (const play of row.plays) {
        let live = row.initial;
        let saved = JSON.parse(JSON.stringify(live)) as DemoState;
        for (const input of play.inputs) {
          const before = structuredClone(live);
          const previous = live;
          live = apply(live, input);
          saved = JSON.parse(JSON.stringify(apply(saved, input))) as DemoState;
          expect(previous).toEqual(before);
          expect(saved).toEqual(live);
          expect(replay(row.initial, live.inputs)).toEqual(live);
          expect(
            live.workRemaining + live.tasks.reduce((sum, task) => sum + task.progress, 0),
          ).toBe(row.initial.rules.workBudget);
          expect(live.tasks.every((task) => task.progress <= task.work)).toBe(true);
          expect(summarize(live).totalShipment).toBe(
            live.tasks.reduce(
              (sum, task) => sum + (task.completedTick === null ? 0 : task.shipment),
              0,
            ),
          );
        }
        expect(summarize(live)).toEqual(play.result);
        expect(replay(create(report.seed, row.initial.rules), play.inputs)).toEqual(live);
      }
    }
  });

  it('期限・最後の工数・資源・任意成果・信頼の感度を一要因ずつ記録する', () => {
    const rows = compareCustomerDemoBoss().conditions;
    const demo = (name: string) => rows.find((row) => row.name === name)!.plays[0].result.demo!;
    expect(demo('baseline').established).toBe(true);
    expect(demo('deadline-6').established).toBe(false);
    expect(demo('data-work-4').established).toBe(false);
    expect(demo('budget-6').established).toBe(false);
    const ninth = rows.find((row) => row.name === 'deadline-9')!.plays[1].result.demo!;
    expect(ninth).toMatchObject({ totalShipment: 20, optionalShipment: 12, partialCredit: 4 });
    expect(demo('deadline-9')).toMatchObject({
      totalShipment: 20,
      optionalShipment: 8,
      partialCredit: 6,
    });
    const loss = (name: string) =>
      rows.find((row) => row.name === name)!.plays.find((play) => play.strategy === 'throughput')!
        .result.demo!.trustLoss;
    expect([loss('missing-loss-0'), loss('baseline'), loss('missing-loss-4')]).toEqual([0, 4, 6]);
    for (const row of rows) {
      const changes = Object.keys(baselineDemoRules).filter(
        (key) =>
          row.initial.rules[key as keyof typeof baselineDemoRules] !==
          baselineDemoRules[key as keyof typeof baselineDemoRules],
      );
      expect(changes.length).toBe(row.name === 'baseline' ? 0 : 1);
    }
  });

  it('不正な期限・工数・非有限値・小数を開始時に拒否する', () => {
    for (const patch of [
      { deadline: 0 },
      { horizon: 6 },
      { dataWork: 0 },
      { workBudget: -1 },
      { bulkShipment: NaN },
      { trustLossPerMissing: Infinity },
      { dataWork: 1.5 },
    ])
      expect(() => create('RI-263', { ...baselineDemoRules, ...patch })).toThrow();
  });
});
