import { describe, expect, it } from 'vitest';
import {
  applyTimedInput as apply,
  compareTimedSensitivity,
  compareTimedStrategies,
  createTimedPrototype as create,
  peakSignalTick,
  projectUngatedAlwaysBoosted,
  summarizeTimed,
  viewTimed,
} from './timedPolicy';
import comparison from '../../docs/prototypes/timed-policy-comparison.json';
import sensitivity from '../../docs/prototypes/timed-policy-sensitivity.json';

describe('RI-181 時限施策', () => {
  it('発動前に期限とレビュー速度が見え、閲覧は状態を変えない', () => {
    const state = create(1, 8);
    expect(create(1, 8)).toEqual(state);
    const armed = apply(state, { type: 'activate' });
    const before = structuredClone(armed);
    expect(viewTimed(state)).toMatchObject({
      activationCost: 1,
      reactivationCost: 1,
      activationCap: 2,
      nextActivationCost: 1,
      activations: 0,
      canActivate: true,
    });
    expect(viewTimed(armed)).toMatchObject({
      duration: 3,
      remaining: 3,
      active: true,
      permanentAdd: 1,
      reviewThroughput: 4,
      codingThroughput: 1,
      nextActivationCost: 1,
      activations: 1,
      canActivate: false,
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
  it('期限切れは時限乗算だけを外し、恒久加算を未発動のまま残す', () => {
    let boosted = apply(create(1, 8), { type: 'activate' });
    let plain = create(1, 8);
    for (let i = 0; i < 4; i += 1) {
      boosted = apply(boosted, { type: 'tick' });
      plain = apply(plain, { type: 'tick' });
    }
    expect(boosted.activeRemaining).toBe(0);
    expect(boosted.permanentAdd).toBe(plain.permanentAdd);
    expect(boosted.baseThroughput).toBe(plain.baseThroughput);
    expect(boosted.multiplier).toBe(plain.multiplier);
    expect(viewTimed(boosted).reviewThroughput).toBe(viewTimed(plain).reviewThroughput);
    expect(viewTimed(boosted).codingThroughput).toBe(viewTimed(plain).codingThroughput);
    expect(boosted.earnedCoding).toBe(plain.earnedCoding);
    let extra = apply({ ...create(1, 8), permanentAdd: 3 }, { type: 'activate' });
    expect(viewTimed(extra).reviewThroughput).toBe(8);
    for (let i = 0; i < 3; i += 1) extra = apply(extra, { type: 'tick' });
    expect(extra.activeRemaining).toBe(0);
    expect(extra.permanentAdd).toBe(3);
    expect(viewTimed(extra).reviewThroughput).toBe(4);
    expect(viewTimed(extra).codingThroughput).toBe(1);
    extra = apply(extra, { type: 'activate' });
    expect(extra.permanentAdd).toBe(3);
    expect(viewTimed(extra).reviewThroughput).toBe(8);
    for (let i = 0; i < 3; i += 1) extra = apply(extra, { type: 'tick' });
    expect(extra.permanentAdd).toBe(3);
    expect(extra.activations).toBe(2);
    expect(viewTimed(extra).reviewThroughput).toBe(4);
    expect(extra.earnedCoding).toBe(6);
  });
  it('再発動は費用を払い、上限を超えると集中力が残っていても処理は増えない', () => {
    let state = { ...create(1, 8, 1), focus: 8 };
    state = apply(state, { type: 'activate' });
    state = apply(state, { type: 'tick' });
    state = apply(state, { type: 'activate' });
    state = apply(state, { type: 'tick' });
    expect(state.tick).toBeLessThan(state.horizon);
    expect(state.activations).toBe(2);
    expect(state.focusSpent).toBe(2);
    expect(state.focus).toBe(6);
    const blocked = apply(state, { type: 'activate' });
    expect(blocked).toBe(state);
    expect(blocked.earnedReview).toBe(2);
    const refunded = structuredClone(state);
    refunded.focus += 5;
    expect(apply(refunded, { type: 'activate' })).toBe(refunded);
    let poor = { ...create(1, 8), focus: 0 };
    for (let i = 0; i < 5; i += 1) poor = apply(poor, { type: 'activate' });
    expect(poor.activations).toBe(0);
    expect(poor.earnedReview).toBe(0);
    expect(poor.focusSpent).toBe(0);
    const ungated = projectUngatedAlwaysBoosted(1, 8);
    expect(ungated.activations).toBe(0);
    expect(ungated.focusSpent).toBe(0);
    expect(ungated.earnedReview).toBe(17);
    expect(state.earnedReview).toBeLessThan(ungated.earnedReview);
  });
  it('効果期間と予兆を一つずつ動かすと、この境界で優劣が反転する', () => {
    const report = compareTimedSensitivity();
    expect(report).toEqual(sensitivity);
    expect(report.board.fixedStrategies).toBe(true);
    expect(report.board.humanPlaytest).toBe(false);
    expect(report.board.baselineOrders).toEqual({
      3: 'hold = peak > early',
      8: 'peak > hold > early',
    });
    expect(report.board.reviewInflowHorizon8).toEqual([1, 1, 1, 4, 4, 4, 1, 1]);
    expect(report.board.reviewInflowHorizon3).toEqual([1, 1, 1]);
    expect(peakSignalTick(1)).toBe(3);
    expect(peakSignalTick(0)).toBe(4);
    expect(peakSignalTick(4)).toBe(0);
    expect(peakSignalTick(5)).toBe(0);
    expect(report.durationSweep.every((row) => row.foreshadowing === 1 && row.seed === 1)).toBe(
      true,
    );
    expect(report.foreshadowingSweep.every((row) => row.duration === 3 && row.seed === 1)).toBe(
      true,
    );
    expect(
      [...report.durationSweep, ...report.foreshadowingSweep].every(
        (row) =>
          row.initial.focus === 2 &&
          row.initial.permanentAdd === 1 &&
          row.initial.multiplier === 2 &&
          row.initial.baseThroughput === 1 &&
          row.codingInflowPerTick === 1,
      ),
    ).toBe(true);
    const ranking = (varied: string, horizon: number, value: number) =>
      report.rankings.find(
        (row) => row.varied === varied && row.horizon === horizon && row.value === value,
      )!;
    expect(ranking('duration', 8, 3).order).toBe('peak > hold > early');
    expect(ranking('duration', 8, 3).nets).toEqual({ hold: 21, early: 20, peak: 24 });
    expect(ranking('duration', 8, 1).nets).toEqual({ hold: 21, early: 20, peak: 22 });
    expect(ranking('duration', 8, 1).reversed).toBe(false);
    expect(ranking('duration', 8, 4).order).toBe('peak > early > hold');
    expect(ranking('duration', 8, 4).nets).toEqual({ hold: 21, early: 22, peak: 24 });
    expect(ranking('duration', 8, 5).order).toBe('peak = early > hold');
    expect(ranking('duration', 8, 5).nets).toEqual({ hold: 21, early: 24, peak: 24 });
    expect(ranking('duration', 8, 6).order).toBe('peak = early > hold');
    expect(ranking('duration', 3, 6).reversed).toBe(false);
    expect(ranking('duration', 3, 6).activations.peak).toBe(0);
    expect(ranking('foreshadowing', 8, 3).nets).toEqual({ hold: 21, early: 20, peak: 22 });
    expect(ranking('foreshadowing', 8, 3).reversed).toBe(false);
    expect(ranking('foreshadowing', 8, 4).order).toBe('hold > peak = early');
    expect(ranking('foreshadowing', 8, 4).nets).toEqual({ hold: 21, early: 20, peak: 20 });
    expect(ranking('foreshadowing', 3, 1).activations.peak).toBe(0);
    expect(ranking('foreshadowing', 3, 2).order).toBe('hold > peak = early');
    expect(ranking('foreshadowing', 3, 2).activations).toEqual({ hold: 0, early: 1, peak: 1 });
    expect(
      report.rankings
        .filter((row) => row.reversed)
        .map((row) => `${row.varied}:${row.horizon}:${row.value}`),
    ).toEqual([
      'duration:8:4',
      'duration:8:5',
      'duration:8:6',
      'foreshadowing:3:2',
      'foreshadowing:3:3',
      'foreshadowing:3:4',
      'foreshadowing:8:4',
    ]);
    const legal = report.reactivation.legal;
    expect(legal.activationCost).toBe(1);
    expect(legal.reactivationCost).toBe(1);
    expect(legal.activationCap).toBe(2);
    expect(legal.activateAttempts).toBe(8);
    expect(legal.result.activations).toBe(2);
    expect(legal.result.focusSpent).toBe(2);
    expect(legal.result.earnedReview).toBe(13);
    expect(report.reactivation.ungatedAlwaysBoosted.legal).toBe(false);
    expect(report.reactivation.ungatedAlwaysBoosted.result.earnedReview).toBe(17);
    expect(legal.result.earnedReview).toBeLessThan(
      report.reactivation.ungatedAlwaysBoosted.result.earnedReview,
    );
  });
  it('感度比較と再発動プローブは毎入力の保存再開と再生が一致する', () => {
    const report = compareTimedSensitivity();
    const rows = [...report.durationSweep, ...report.foreshadowingSweep];
    for (const row of rows) {
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
    let legal = report.reactivation.legal.initial;
    for (const input of report.reactivation.legal.inputs) {
      legal = apply(JSON.parse(JSON.stringify(legal)), input);
    }
    expect(summarizeTimed(legal)).toEqual(report.reactivation.legal.result);
  });
});
