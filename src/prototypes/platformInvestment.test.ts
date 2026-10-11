import { describe, expect, it } from 'vitest';
import {
  applyPlatformInvestment as apply,
  chooseInvestmentAction,
  comparePlatformInvestments,
  createPlatformInvestment as create,
  pipelineActive,
  produceValue,
  summarizePlatformInvestment,
  teamCapacity,
  viewPlatformInvestment,
} from './platformInvestment';
import comparison from '../../docs/prototypes/platform-investment-comparison.json';

describe('RI-217 基盤投資を仕事にする', () => {
  it('着工費用、担当、残作業、完成後の対象チームを事前に示す', () => {
    const first = create('RI-217', 'sprint');
    expect(create('RI-217', 'sprint')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewPlatformInvestment(first);
    for (let i = 0; i < 8; i++) expect(viewPlatformInvestment(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(blank).toMatchObject({
      startCost: 2,
      assignee: 'platform',
      workLeft: 4,
      jobTotal: 4,
      targets: ['product', 'incident'],
      effectLive: false,
      capacity: { platform: 1, product: 1, incident: 1 },
    });
    blank.targets.push('platform');
    blank.capacity.product = 99;
    expect(viewPlatformInvestment(first).targets).toEqual(['product', 'incident']);
    expect(teamCapacity(first).product).toBe(1);
  });

  it('完成と同じ期間には効果が出ず、対象へは一度ずつしか足さない', () => {
    let state = create('RI-217', 'quarter');
    state = apply(state, { type: 'start' });
    const deltas: number[] = [];
    while (state.jobDoneTick === null) {
      const before = state.value;
      state = apply(state, { type: 'work', platform: 'build' });
      deltas.push(state.value - before);
    }
    expect(deltas).toEqual([7, 7, 7, 7]);
    expect(state).toMatchObject({ tick: 4, effectApplied: true, bonusTicks: 0, jobDoneTick: 3 });
    expect(pipelineActive(state)).toBe(true);
    expect(teamCapacity(state)).toEqual({ platform: 1, product: 2, incident: 2 });

    const doubled = structuredClone(state);
    doubled.targets = ['product', 'product', 'incident', 'platform'];
    expect(teamCapacity(doubled)).toEqual({ platform: 1, product: 2, incident: 2 });
    expect(produceValue(state, ['platform', 'product', 'incident'], 'ship')).toBe(16);
    expect(produceValue(state, ['incident', 'product', 'platform'], 'ship')).toBe(16);

    const before = state.value;
    state = apply(state, { type: 'work', platform: 'ship' });
    expect(state.value - before).toBe(16);
    expect(teamCapacity(state)).toEqual({ platform: 1, product: 2, incident: 2 });
    expect(state.bonusTicks).toBe(1);
  });

  it('着工前の建設、二重の開始、即時との同時利用を受け付けない', () => {
    const fresh = create('RI-217', 'sprint');
    expect(apply(fresh, { type: 'work', platform: 'build' })).toBe(fresh);
    const started = apply(fresh, { type: 'start' });
    expect(apply(started, { type: 'start' })).toBe(started);
    expect(apply(started, { type: 'immediate' })).toBe(started);
    const instant = apply(fresh, { type: 'immediate' });
    expect(instant.instantLeft).toBe(2);
    expect(apply(instant, { type: 'start' })).toBe(instant);
    expect(apply(instant, { type: 'immediate' })).toBe(instant);
    let done = instant;
    while (done.tick < done.horizon) done = apply(done, { type: 'work', platform: 'ship' });
    expect(apply(done, { type: 'work', platform: 'ship' })).toBe(done);
    expect(summarizePlatformInvestment(done).lost).toBe(false);
  });

  it('短い期末は即時、長い期末は早い着工の差引が上回る', () => {
    const rows = comparePlatformInvestments(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const score = (board: string, strategy: string) =>
      rows.find((row) => row.board === board && row.strategy === strategy)!.result.score;
    expect([
      score('sprint', 'immediate'),
      score('sprint', 'ship'),
      score('sprint', 'late'),
      score('sprint', 'invest'),
    ]).toEqual([40, 36, 30, 26]);
    expect([
      score('quarter', 'invest'),
      score('quarter', 'late'),
      score('quarter', 'immediate'),
      score('quarter', 'ship'),
    ]).toEqual([90, 76, 76, 72]);
    const sprintInvest = rows.find((row) => row.board === 'sprint' && row.strategy === 'invest')!;
    expect(sprintInvest.result).toMatchObject({
      bonusTicks: 0,
      effectApplied: true,
      jobWorkLeft: 0,
    });
    const quarterInvest = rows.find((row) => row.board === 'quarter' && row.strategy === 'invest')!;
    expect(quarterInvest.result.bonusTicks).toBe(4);
    expect(rows.every((row) => row.result.lost === false)).toBe(true);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of comparePlatformInvestments(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseInvestmentAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
      }
      expect(summarizePlatformInvestment(live)).toEqual(row.result);
    }
  });
});
