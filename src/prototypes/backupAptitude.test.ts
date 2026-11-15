import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/backup-aptitude-comparison.json';
import factors from '../../docs/prototypes/backup-aptitude-factor-comparison.json';
import { assignMember } from '../sim/member/roster';
import {
  advanceBackupAptitudePeriod,
  baselineBackupRules,
  compareBackupAptitudeFactorReversals,
  compareBackupAptitudeStrategies,
  createBackupAptitudePrototype,
  previewBackupAptitude,
  runBackupFactor,
  type BackupAptitudeRules,
  type BackupFactorPoint,
} from './backupAptitude';

const finish = (initial: ReturnType<typeof createBackupAptitudePrototype>) => {
  let state = initial;
  while (state.release.handover.mentorship.period < state.release.deadline)
    state = advanceBackupAptitudePeriod(state);
  return state;
};

describe('代打の実処理から適性を発見する', () => {
  it('記録した比較結果を再現し、全戦略の初期編成・資源を揃える', () => {
    expect(compareBackupAptitudeStrategies(comparison.seed)).toEqual(comparison.results);
    const states = (['none', 'successor', 'experienced'] as const).map((strategy) =>
      createBackupAptitudePrototype(comparison.seed, strategy),
    );
    for (const state of states) {
      expect(state.release).toEqual(states[0].release);
      expect(state.evidence).toEqual([]);
    }
  });
  it('予告で対象・条件・翌期効果を確認し、2期6工数で一度発見する', () => {
    let state = createBackupAptitudePrototype('RI-207', 'successor');
    expect(previewBackupAptitude(state)).toMatchObject({
      backupId: state.successorId,
      requiredWork: 6,
      requiredPeriods: 2,
      maximumReviewGain: 10,
      absentFrom: 2,
      returnsAt: 6,
    });
    const initial = structuredClone(state);
    for (let period = 1; period <= 6; period += 1) {
      const next = advanceBackupAptitudePeriod(state);
      expect(advanceBackupAptitudePeriod(JSON.parse(JSON.stringify(state)))).toEqual(next);
      expect(state.release.handover.mentorship.period).toBe(period - 1);
      state = next;
      expect(state.discovery !== null).toBe(period >= 3);
    }
    expect(state.discovery).toEqual({ memberId: state.successorId, period: 3, reviewGain: 10 });
    expect(state.history.map((row) => row.backupWork)).toEqual([0, 3, 3, 4, 4, 4]);
    expect(state.history.filter((row) => row.discovered)).toHaveLength(1);
    expect(state.release.absence.returned).toBe(true);
    expect(previewBackupAptitude(state).discovered).toEqual(state.discovery);
    expect(advanceBackupAptitudePeriod(state)).toBe(state);
    expect(initial.evidence).toEqual([]);
    expect(
      initial.release.handover.mentorship.roster.members.find((m) => m.id === initial.successorId)!
        .stats.review,
    ).toBe(32);
  });
  it('配置だけ、仕事なし、体力なし、休職では実績を得ない', () => {
    for (const condition of ['no-work', 'no-stamina', 'leave'] as const) {
      const state = createBackupAptitudePrototype(1, 'successor');
      const person = state.release.handover.mentorship.roster.members.find(
        (m) => m.id === state.successorId,
      )!;
      if (condition === 'no-work') state.release.handover.mentorship.backlog = 0;
      if (condition === 'no-stamina') person.stamina = 0;
      if (condition === 'leave') person.onLeave = true;
      const end = finish(state);
      expect(end.evidence).toEqual([]);
      expect(end.discovery).toBeNull();
      expect(person.stats.review).toBe(32);
    }
  });
  it('一度に大量処理しても2稼働期を満たすまで発見しない', () => {
    let state = createBackupAptitudePrototype(1, 'successor');
    state.release.handover.mentorship.roster.members.find(
      (m) => m.id === state.successorId,
    )!.stats.review = 90;
    state = advanceBackupAptitudePeriod(advanceBackupAptitudePeriod(state));
    expect(state.evidence[0].work).toBe(9);
    expect(state.discovery).toBeNull();
    state = advanceBackupAptitudePeriod(state);
    expect(state.discovery?.reviewGain).toBe(10);
    expect(
      finish(state).release.handover.mentorship.roster.members.find(
        (m) => m.id === state.successorId,
      )!.stats.review,
    ).toBe(100);
  });
  it('少量の2期では発見せず、累計工数も必要とする', () => {
    let state = createBackupAptitudePrototype(1, 'successor');
    state.release.handover.mentorship.roster.members.find(
      (m) => m.id === state.successorId,
    )!.stats.review = 10;
    state = advanceBackupAptitudePeriod(
      advanceBackupAptitudePeriod(advanceBackupAptitudePeriod(state)),
    );
    expect(state.evidence).toHaveLength(2);
    expect(state.evidence.reduce((sum, row) => sum + row.work, 0)).toBe(2);
    expect(finish(state).discovery).toBeNull();
  });
  it('不在中に代打を外した後は自動で戻さず、復帰後の処理を不在実績にしない', () => {
    let state = createBackupAptitudePrototype(1, 'successor');
    state = advanceBackupAptitudePeriod(advanceBackupAptitudePeriod(state));
    state.release.handover.mentorship.roster = assignMember(
      state.release.handover.mentorship.roster,
      state.successorId,
      'bench',
    );
    const end = finish(state);
    expect(end.evidence).toHaveLength(1);
    expect(end.discovery).toBeNull();
    expect(end.history.slice(2).every((row) => row.backupWork === 0)).toBe(true);
  });
  it('能力上限直前の発見も上限を超えず、繰り返し増やさない', () => {
    const state = createBackupAptitudePrototype(1, 'successor');
    state.release.handover.mentorship.roster.members.find(
      (m) => m.id === state.successorId,
    )!.stats.review = 98;
    const end = finish(state);
    expect(end.discovery?.reviewGain).toBe(2);
    expect(end.history.filter((row) => row.discovered)).toHaveLength(1);
    expect(
      end.release.handover.mentorship.roster.members.find((m) => m.id === state.successorId)!.stats
        .review,
    ).toBe(100);
  });
  it('代打なし・控え・経験者を同じ人物・仕事・期限で比較し、機会費用を残す', () => {
    const results = compareBackupAptitudeStrategies('RI-207');
    expect(compareBackupAptitudeStrategies('RI-207')).toEqual(results);
    const [none, successor, experienced] = results;
    expect(none.discovery).toBeNull();
    expect(none.absenceDelivered).toBe(0);
    expect(none.delivered).toBeGreaterThan(0);
    expect(successor.discovery).not.toBeNull();
    expect(experienced.discovery).toBeNull();
    expect(experienced.foregoneCodingCapacity).toBeGreaterThan(0);
    expect(successor.foregoneCodingCapacity).toBe(0);
    expect(experienced.absenceDelivered).toBeGreaterThan(successor.absenceDelivered);
    for (const result of results) expect(result.delivered + result.remaining).toBe(40);
  });
});

const changedKeys = (rules: BackupAptitudeRules) =>
  (Object.keys(baselineBackupRules) as (keyof BackupAptitudeRules)[]).filter(
    (key) => rules[key] !== baselineBackupRules[key],
  );

describe('代打適性の要因を一つずつ動かす', () => {
  it('記録した要因比較を再計算し、代打なしの処理を残す', () => {
    const data = compareBackupAptitudeFactorReversals();
    expect(data).toEqual(factors);
    expect(compareBackupAptitudeFactorReversals()).toEqual(data);
    for (const point of Object.values(data.sweeps).flat()) {
      expect(point.withhold.reviewDelivered).toBeGreaterThan(0);
      expect(point.discover.reviewDelivered + point.discover.remaining).toBe(40);
      expect(point.withhold.reviewDelivered + point.withhold.remaining).toBe(40);
      expect(point.borrow.reviewDelivered + point.borrow.remaining).toBe(40);
      expect(runBackupFactor('discover', point.rules)).toEqual(point.discover);
      expect(runBackupFactor('withhold', point.rules)).toEqual(point.withhold);
      expect(runBackupFactor('borrow', point.rules)).toEqual(point.borrow);
    }
    for (const point of data.benchExchange) {
      expect(point.exchange.reviewDelivered + point.exchange.remaining).toBe(40);
      expect(runBackupFactor(point.parameter, point.rules)).toEqual(point.exchange);
      expect(point.exchange.discovery).toBeNull();
      expect(point.exchange.staminaGained).toBe(0);
    }
  });

  it('基準行は初回のレビューと一致し、動かした規則は一つである', () => {
    const data = compareBackupAptitudeFactorReversals();
    const first = compareBackupAptitudeStrategies(comparison.seed);
    const [none, successor, experienced] = first;
    if (!none || !successor || !experienced) throw new Error('first');
    const baselines = [
      data.sweeps.codingDemand.find((point) => point.parameter === '0'),
      data.sweeps.absenceLength.find((point) => point.parameter === '4'),
      data.sweeps.requiredWork.find((point) => point.parameter === '6'),
      data.sweeps.requiredPeriods.find((point) => point.parameter === '2'),
      data.sweeps.qualitySuccess.find((point) => point.parameter === '1/1'),
    ];
    for (const point of baselines) {
      if (!point) throw new Error('baseline');
      expect(changedKeys(point.rules)).toEqual([]);
      expect(point.discover.reviewDelivered).toBe(successor.delivered);
      expect(point.withhold.reviewDelivered).toBe(none.delivered);
      expect(point.borrow.reviewDelivered).toBe(experienced.delivered);
      expect(point.discover.codingDelivered).toBe(0);
      expect(point.discover.discovery).toEqual(successor.discovery);
      expect(point.discover.inputs).toEqual([
        { period: 1, action: 'unchanged', memberId: null },
        { period: 2, action: 'assign-review', memberId: 'm1' },
        { period: 3, action: 'unchanged', memberId: null },
        { period: 4, action: 'unchanged', memberId: null },
        { period: 5, action: 'unchanged', memberId: null },
        { period: 6, action: 'unchanged', memberId: null },
      ]);
    }
    const only: Record<string, (keyof BackupAptitudeRules)[]> = {
      codingDemand: ['codingDemand'],
      absenceLength: ['absenceEnd'],
      requiredWork: ['requiredWork'],
      requiredPeriods: ['requiredPeriods'],
      qualitySuccess: ['qualityNumerator', 'qualityDenominator'],
    };
    for (const [axis, keys] of Object.entries(only)) {
      for (const point of data.sweeps[axis as keyof typeof data.sweeps])
        expect(changedKeys(point.rules).every((name) => keys.includes(name))).toBe(true);
    }
    for (const point of data.benchExchange) expect(changedKeys(point.rules)).toEqual([]);
    const saturated = data.sweeps.codingDemand.find((point) => point.parameter === '5');
    const capped = data.sweeps.codingDemand.find((point) => point.parameter === '8');
    if (!saturated || !capped) throw new Error('coding');
    expect(saturated.discover.codingDelivered - saturated.borrow.codingDelivered).toBe(
      experienced.foregoneCodingCapacity,
    );
    expect(capped.discover.net).toBe(saturated.discover.net);
    expect(capped.borrow.net).toBe(saturated.borrow.net);
    expect(saturated.discover.reviewDelivered).toBe(successor.delivered);
    expect(saturated.borrow.reviewDelivered).toBe(experienced.delivered);
  });

  it('優劣の反転箇所を固定し、反転しない軸を残す', () => {
    const data = compareBackupAptitudeFactorReversals();
    expect(
      data.reversals.map((item) => [
        item.axis,
        item.pair,
        item.before.parameter,
        item.before.preference,
        item.after.parameter,
        item.after.preference,
      ]),
    ).toEqual([
      ['codingDemand', 'discoverVsBorrow', '0', 'borrow', '1', 'discover'],
      ['absenceLength', 'discoverVsBorrow', '2', 'tie', '3', 'borrow'],
      ['qualitySuccess', 'discoverVsWithhold', '1/3', 'discover', '0/1', 'tie'],
    ]);
    expect(data.reversals.some((item) => item.axis === 'requiredWork')).toBe(false);
    expect(data.reversals.some((item) => item.axis === 'requiredPeriods')).toBe(false);
    expect(data.reversals.some((item) => item.axis === 'benchExchange')).toBe(false);
    const nets = (axis: keyof typeof data.sweeps) =>
      data.sweeps[axis].map((point: BackupFactorPoint) => [
        point.parameter,
        point.discover.net,
        point.withhold.net,
        point.borrow.net,
        point.discoverVsWithhold,
        point.discoverVsBorrow,
      ]);
    expect(nets('codingDemand')).toEqual([
      ['0', 30, 12, 32, 'discover', 'borrow'],
      ['1', 36, 18, 33, 'discover', 'discover'],
      ['2', 42, 24, 34, 'discover', 'discover'],
      ['5', 60, 42, 37, 'discover', 'discover'],
      ['8', 60, 42, 37, 'discover', 'discover'],
    ]);
    expect(nets('absenceLength')).toEqual([
      ['1', 40, 30, 40, 'discover', 'tie'],
      ['2', 40, 24, 40, 'discover', 'tie'],
      ['3', 36, 18, 38, 'discover', 'borrow'],
      ['4', 30, 12, 32, 'discover', 'borrow'],
    ]);
    expect(data.sweeps.absenceLength[0]?.discover.discovery).toBeNull();
    expect(
      data.sweeps.requiredWork.find((point) => point.parameter === '14')?.discover.discovery,
    ).toBeNull();
    expect(
      data.sweeps.requiredPeriods.find((point) => point.parameter === '5')?.discover.discovery,
    ).toBeNull();
    expect(data.sweeps.requiredWork.map((point) => point.discover.net)).toEqual([
      30, 29, 28, 28, 27, 27,
    ]);
    expect(
      data.benchExchange.map((point) => [
        point.parameter,
        point.exchange.net,
        point.preference,
        point.exchange.successorReview,
        point.exchange.staminaGained,
      ]),
    ).toEqual([
      ['train', 15, 'discover', 42, 0],
      ['rest', 15, 'discover', 32, 0],
    ]);
    expect(data.benchExchange[0]?.discover.successorReview).toBe(42);
    expect(data.conditions.humanPlaytest).toBe(false);
    expect(data.conditions.fixedStrategies).toBe(true);
    expect(data.conditions.productionAdoption).toBe(false);
    expect(data.conditions.normalRun).toBe(false);
  });

  it('品質を下げた規則もJSONで再開できる', () => {
    let state = createBackupAptitudePrototype('RI-207', 'successor', {
      ...baselineBackupRules,
      qualityNumerator: 1,
      qualityDenominator: 2,
    });
    for (let period = 1; period <= 6; period += 1) {
      const next = advanceBackupAptitudePeriod(state);
      expect(advanceBackupAptitudePeriod(JSON.parse(JSON.stringify(state)))).toEqual(next);
      state = next;
    }
    expect(state.discovery).toBeNull();
    expect(state.release.handover.mentorship.delivered).toBe(17);
    expect(
      state.release.handover.mentorship.delivered + state.release.handover.mentorship.backlog,
    ).toBe(40);
  });
});
