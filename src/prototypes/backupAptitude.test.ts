import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/backup-aptitude-comparison.json';
import { assignMember } from '../sim/member/roster';
import {
  advanceBackupAptitudePeriod,
  compareBackupAptitudeStrategies,
  createBackupAptitudePrototype,
  previewBackupAptitude,
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
