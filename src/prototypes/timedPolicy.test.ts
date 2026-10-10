import { describe, expect, it } from 'vitest';
import {
  applyTimedInput as apply,
  compareTimedStrategies,
  createTimedPrototype as create,
  summarizeTimed,
  viewTimed,
} from './timedPolicy';
import comparison from '../../docs/prototypes/timed-policy-comparison.json';

describe('RI-181 時限施策', () => {
  it('発動前に期限とレビュー速度が見え、閲覧は状態を変えない', () => {
    const state = create(1, 8);
    expect(create(1, 8)).toEqual(state);
    const armed = apply(state, { type: 'activate' });
    const before = structuredClone(armed);
    expect(viewTimed(armed)).toMatchObject({
      duration: 3,
      remaining: 3,
      active: true,
      permanentAdd: 1,
      reviewThroughput: 4,
      codingThroughput: 1,
    });
    expect(armed).toEqual(before);
  });
  it('期限中のレビューだけが倍速になり、終了後も恒久加算は残る', () => {
    let state = apply(create(1, 8), { type: 'activate' });
    const throughput: number[] = [];
    for (let i = 0; i < 4; i++) {
      state = apply(state, { type: 'tick' });
      throughput.push(viewTimed(state).reviewThroughput);
    }
    expect(state.affected.map((item) => item.throughput)).toEqual([4, 4, 4]);
    expect(state.affected.every((item) => item.lane === 'review')).toBe(true);
    expect(throughput).toEqual([4, 4, 2, 2]);
    expect(state.permanentAdd).toBe(1);
    expect(state.earnedCoding).toBe(4);
    expect(viewTimed(state).codingThroughput).toBe(1);
    const viewed = viewTimed(state);
    expect(viewed.affected).not.toBe(state.affected);
    viewed.affected.push({ tick: 99, lane: 'review', throughput: 0 });
    viewed.affected[0].throughput = 0;
    expect(state.affected.map((item) => item.throughput)).toEqual([4, 4, 4]);
  });
  it('効果中の再発動は拒否し、終了後の再発動は同じ倍率を新しい期限で足す', () => {
    let state = apply(create(1, 8), { type: 'activate' });
    expect(apply(state, { type: 'activate' })).toBe(state);
    for (let i = 0; i < 3; i++) state = apply(state, { type: 'tick' });
    expect(state.activeRemaining).toBe(0);
    const again = apply(state, { type: 'activate' });
    expect(again.activations).toBe(2);
    expect(again.focusSpent).toBe(2);
    expect(again.multiplier).toBe(2);
    expect(again.permanentAdd).toBe(1);
    expect(viewTimed(again).remaining).toBe(3);
    expect(viewTimed(again).reviewThroughput).toBe(4);
  });
  it('集中力不足と期末の操作は無消費で拒否する', () => {
    const poor = { ...create(1, 8), focus: 0 };
    expect(apply(poor, { type: 'activate' })).toBe(poor);
    const ended = { ...create(1, 8), tick: 8 };
    expect(apply(ended, { type: 'activate' })).toBe(ended);
    expect(apply(ended, { type: 'tick' })).toBe(ended);
  });
  it('短い期末は温存、山場のある期末はピーク発動が序盤発動と再発動を上回る', () => {
    const rows = compareTimedStrategies();
    expect(rows).toEqual(comparison.results);
    const net = (horizon: number, strategy: string) =>
      rows.find((row) => row.horizon === horizon && row.strategy === strategy)!.result.netValue;
    expect(net(3, 'hold')).toBe(6);
    expect(net(3, 'early')).toBe(5);
    expect(net(8, 'peak')).toBe(24);
    expect(net(8, 'rearm')).toBe(23);
    expect(net(8, 'hold')).toBe(21);
    expect(net(8, 'early')).toBe(20);
    const peak = rows.find((row) => row.strategy === 'peak')!;
    expect(peak.result.affectedTicks).toEqual([4, 5, 6]);
    expect(peak.result.earnedCoding).toBe(8);
    expect(rows.every((row) => row.result.earnedCoding === row.horizon)).toBe(true);
    expect(rows.find((row) => row.horizon === 8)!.reviewInflow).toEqual([1, 1, 1, 4, 4, 4, 1, 1]);
    expect(rows.find((row) => row.horizon === 3)!.reviewInflow).toEqual([1, 1, 1]);
    expect(rows.every((row) => row.codingInflowPerTick === 1)).toBe(true);
  });
  it('全入力の再生と毎入力JSON保存再開が一致し、元状態を変えない', () => {
    for (const row of compareTimedStrategies()) {
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
      expect(summarizeTimed(live)).toEqual(row.result);
    }
  });
});
