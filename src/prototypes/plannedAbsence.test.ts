import { describe, expect, it } from 'vitest';
import factors from '../../docs/prototypes/planned-absence-factor-comparison.json';
import { assignMember, recoverStamina } from '../sim/member/roster';
import { createAbsenceReleasePrototype, compareAbsenceReleaseStrategies } from './absenceRelease';
import {
  applyPlannedAbsence,
  comparePlannedAbsenceFactorReversals,
  createPlannedAbsence,
  previewPlannedAbsence,
} from './plannedAbsence';
import type { PlannedAbsence } from './plannedAbsence';

const setup = () => {
  const run = createAbsenceReleasePrototype('RI-205', 'normal');
  return { roster: run.handover.mentorship.roster, id: run.absence.memberId };
};

describe('予定不在の編成モデル', () => {
  it('共通型で保持したリリース予定にも理由を保存し、直接プレビューできる', () => {
    const run = createAbsenceReleasePrototype('RI-205', 'normal');
    const saved: PlannedAbsence = JSON.parse(JSON.stringify(run.absence));
    expect(previewPlannedAbsence(run.handover.mentorship.roster, saved).reason).toBe('vacation');
    const next = applyPlannedAbsence(run.handover.mentorship.roster, saved, saved.start);
    expect(next.absence.reason).toBe('vacation');
  });
  it.each(['vacation', 'training', 'business-trip'] as const)(
    '理由%sを開始前に確認し、同じ人物が一度復帰する',
    (reason) => {
      const { roster, id } = setup();
      const schedule = createPlannedAbsence(roster, id, reason, 2, 4);
      expect(previewPlannedAbsence(roster, schedule)).toMatchObject({
        memberId: id,
        reason,
        announcedAt: 0,
        absentFrom: 2,
        returnsAt: 4,
        onLeave: false,
      });
      const first = applyPlannedAbsence(roster, schedule, 1);
      expect(first.absence.active).toBe(false);
      const absent = applyPlannedAbsence(first.roster, first.absence, 2);
      const tampered = assignMember(absent.roster, id, 'coding');
      tampered.members.find((m) => m.id === id)!.aiAssigned = true;
      const stillAbsent = applyPlannedAbsence(tampered, absent.absence, 3);
      expect(stillAbsent.roster.members.find((m) => m.id === id)).toMatchObject({
        assignment: 'bench',
        aiAssigned: false,
      });
      const returned = applyPlannedAbsence(stillAbsent.roster, stillAbsent.absence, 4);
      expect(returned.roster.members.find((m) => m.id === id)).toMatchObject({
        assignment: 'review',
      });
      expect(returned.absence).toMatchObject({ active: false, returned: true });
      const reassigned = assignMember(returned.roster, id, 'coding');
      expect(applyPlannedAbsence(reassigned, returned.absence, 5).roster).toEqual(reassigned);
      expect(
        applyPlannedAbsence(stillAbsent.roster, JSON.parse(JSON.stringify(stillAbsent.absence)), 4),
      ).toEqual(returned);
      expect(roster.members.find((m) => m.id === id)!.assignment).toBe('review');
      expect(returned.roster.members.map((m) => m.id)).toEqual(roster.members.map((m) => m.id));
    },
  );
  it('休職が先に回復しても予定終了まで不在を維持する', () => {
    const { roster, id } = setup();
    const person = roster.members.find((m) => m.id === id)!;
    person.onLeave = true;
    person.assignment = 'bench';
    person.stamina = 0;
    const schedule = createPlannedAbsence(roster, id, 'vacation', 1, 3);
    const absent = applyPlannedAbsence(roster, schedule, 1);
    const recovered = recoverStamina(absent.roster, 100);
    expect(recovered.members.find((m) => m.id === id)!.onLeave).toBe(false);
    const next = applyPlannedAbsence(assignMember(recovered, id, 'review'), absent.absence, 2);
    expect(next.roster.members.find((m) => m.id === id)!.assignment).toBe('bench');
  });
  it('予定終了で休職を解除せず、回復後も控えから再配置する', () => {
    const { roster, id } = setup();
    const schedule = createPlannedAbsence(roster, id, 'vacation', 1, 2);
    const absent = applyPlannedAbsence(roster, schedule, 1);
    const person = absent.roster.members.find((m) => m.id === id)!;
    person.onLeave = true;
    person.stamina = 0;
    const returned = applyPlannedAbsence(absent.roster, absent.absence, 2);
    expect(returned.roster.members.find((m) => m.id === id)).toMatchObject({
      onLeave: true,
      assignment: 'bench',
    });
    const recovered = recoverStamina(returned.roster, 100);
    expect(
      applyPlannedAbsence(recovered, returned.absence, 3).roster.members.find((m) => m.id === id),
    ).toMatchObject({ onLeave: false, assignment: 'bench' });
  });
  it('CodingのAI配布を一度だけ復元する', () => {
    const { roster, id } = setup();
    const coderRoster = assignMember(roster, id, 'coding');
    coderRoster.members.find((m) => m.id === id)!.aiAssigned = true;
    const absent = applyPlannedAbsence(
      coderRoster,
      createPlannedAbsence(coderRoster, id, 'business-trip', 1, 2),
      1,
    );
    expect(
      applyPlannedAbsence(absent.roster, absent.absence, 2).roster.members.find((m) => m.id === id),
    ).toMatchObject({ assignment: 'coding', aiAssigned: true });
  });
  it.each([
    [0, 2],
    [2, 2],
    [3, 2],
    [1.5, 3],
    [1, Infinity],
  ])('不正期間%s/%sを拒否する', (start, end) => {
    const { roster, id } = setup();
    expect(() => createPlannedAbsence(roster, id, 'vacation', start, end)).toThrow();
  });
  it('前倒しと代打育成の成果・費用を同条件で比較する', () => {
    const results = compareAbsenceReleaseStrategies('RI-205');
    expect(results[1].preparationDelivered).toBeGreaterThan(results[2].preparationDelivered);
    expect(results[2].absenceDelivered).toBeGreaterThan(results[1].absenceDelivered);
    expect(results[1].specialistStaminaSpent).toBeGreaterThan(results[2].specialistStaminaSpent);
  });
});

describe('RI-205 要因の反転', () => {
  const data = comparePlannedAbsenceFactorReversals();
  const point = (axis: 'futureCapability' | 'arrival' | 'absenceLength', parameter: string) => {
    const found = data.sweeps[axis].find((row) => row.parameter === parameter);
    if (!found) throw new Error(`${axis}:${parameter}`);
    return found;
  };
  const delivered = (axis: 'futureCapability' | 'arrival' | 'absenceLength', parameter: string) => {
    const row = point(axis, parameter);
    return [row.runs.ignore.delivered, row.runs.reorganize.delivered];
  };

  it('記録した条件・入力列・結果を再計算と照合する', () => {
    expect(data).toEqual(factors);
    expect(data.conditions).toMatchObject({
      seed: 'RI-205',
      horizon: 6,
      work: 40,
      absenceStart: 2,
      score: 'delivered',
      baseline: { futureCapability: 10, arrivalPeriod: 1, absenceLength: 4 },
      oneFactorAtATime: true,
      fixedStrategies: true,
      humanPlaytest: false,
      normalRun: false,
      repeatedFirstComparison: false,
      productionIntegration: false,
      traitMultipliers: false,
      naturalGrowth: false,
    });
    expect(data.conditions.resources).toMatchObject({
      specialistId: 'm2',
      successorId: 'm1',
      specialistReview: 64,
      successorReview: 32,
    });
  });

  it('要因は一つだけ動き、対照行は初回の通常と代打育成に一致する', () => {
    expect(
      data.sweeps.futureCapability.every(
        (row) => row.factor.arrivalPeriod === 1 && row.factor.absenceLength === 4,
      ),
    ).toBe(true);
    expect(
      data.sweeps.arrival.every(
        (row) => row.factor.futureCapability === 10 && row.factor.absenceLength === 4,
      ),
    ).toBe(true);
    expect(
      data.sweeps.absenceLength.every(
        (row) => row.factor.futureCapability === 10 && row.factor.arrivalPeriod === 1,
      ),
    ).toBe(true);
    for (const row of Object.values(data.sweeps).flat()) {
      expect(row.runs.ignore.inputs.every((input) => !input.teach)).toBe(true);
      expect(row.runs.reorganize.inputs.map((input) => input.teach)).toEqual([
        true,
        false,
        false,
        false,
        false,
        false,
      ]);
      expect(
        row.runs.ignore.inputs.map(({ demand }) => demand).reduce((sum, demand) => sum + demand, 0),
      ).toBe(40);
      expect(
        row.runs.ignore.inputs.map(({ period, demand, absent }) => ({ period, demand, absent })),
      ).toEqual(
        row.runs.reorganize.inputs.map(({ period, demand, absent }) => ({
          period,
          demand,
          absent,
        })),
      );
    }
    const [normal, , handover] = compareAbsenceReleaseStrategies('RI-205');
    const anchor = point('futureCapability', '10');
    const work = (run: typeof anchor.runs.ignore) =>
      run.history.map((row) => row.specialistWork + row.successorWork);
    expect(work(anchor.runs.ignore)).toEqual(
      normal.history.map((row) => row.reviewWork + row.overtimeWork),
    );
    expect(work(anchor.runs.reorganize)).toEqual(
      handover.history.map((row) => row.reviewWork + row.overtimeWork),
    );
    expect(anchor.runs.ignore.history.map((row) => row.remaining)).toEqual(
      normal.history.map((row) => row.remaining),
    );
    expect(anchor.runs.reorganize.history.map((row) => row.remaining)).toEqual(
      handover.history.map((row) => row.remaining),
    );
    expect(anchor.runs.ignore).toMatchObject({
      delivered: normal.delivered,
      absenceDelivered: normal.absenceDelivered,
      preparationDelivered: normal.preparationDelivered,
      specialistStaminaSpent: normal.specialistStaminaSpent,
      successorStaminaSpent: normal.successorStaminaSpent,
      successorReview: 32,
    });
    expect(anchor.runs.reorganize).toMatchObject({
      delivered: handover.delivered,
      absenceDelivered: handover.absenceDelivered,
      preparationDelivered: handover.preparationDelivered,
      teachingCost: handover.teachingCost,
      specialistStaminaSpent: handover.specialistStaminaSpent,
      successorStaminaSpent: handover.successorStaminaSpent,
      successorReview: handover.successorReview,
    });
    expect(point('arrival', '1').runs).toEqual(anchor.runs);
    expect(point('absenceLength', '4').runs).toEqual(anchor.runs);
  });

  it('将来能力は7と8、不在の長さは2と3で優劣が変わり、到着時期では変わらない', () => {
    expect(delivered('futureCapability', '7')).toEqual([30, 26]);
    expect(point('futureCapability', '7').runs.reorganize).toMatchObject({
      successorReview: 39,
      successorCapacity: 3,
      teachingCost: 4,
    });
    expect(point('futureCapability', '7').runs.reorganize.history[0]?.taught).toBe(true);
    expect(delivered('futureCapability', '8')).toEqual([30, 31]);
    expect(point('futureCapability', '8').runs.reorganize.successorCapacity).toBe(4);
    expect(delivered('futureCapability', '10')).toEqual([30, 31]);
    expect(delivered('futureCapability', '18')).toEqual([30, 36]);
    expect(point('futureCapability', '18').runs.reorganize.successorCapacity).toBe(5);
    expect(data.sweeps.arrival.map((row) => row.preference)).toEqual([
      'reorganize',
      'reorganize',
      'reorganize',
      'reorganize',
      'reorganize',
      'reorganize',
    ]);
    expect(delivered('arrival', '1')).toEqual([30, 31]);
    expect(delivered('arrival', '6')).toEqual([9, 10]);
    expect(delivered('absenceLength', '2')).toEqual([40, 40]);
    expect(point('absenceLength', '2').preference).toBe('tie');
    expect(point('absenceLength', '0').runs.ignore.specialistStaminaSpent).not.toBe(
      point('absenceLength', '0').runs.reorganize.specialistStaminaSpent,
    );
    expect(delivered('absenceLength', '3')).toEqual([36, 37]);
    expect(delivered('absenceLength', '5')).toEqual([24, 25]);
    expect(data.reversals).toEqual([
      {
        axis: 'futureCapability',
        before: { parameter: '7', preference: 'ignore', ignore: 30, reorganize: 26 },
        after: { parameter: '8', preference: 'reorganize', ignore: 30, reorganize: 31 },
      },
      {
        axis: 'absenceLength',
        before: { parameter: '2', preference: 'tie', ignore: 40, reorganize: 40 },
        after: { parameter: '3', preference: 'reorganize', ignore: 36, reorganize: 37 },
      },
    ]);
  });
});
