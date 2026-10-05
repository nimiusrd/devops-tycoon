import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/handover-comparison.json';
import {
  advanceHandoverPeriod,
  compareHandoverStrategies,
  createHandoverPrototype,
  previewHandover,
} from './handover';

describe('担当変更前の知識引き継ぎ', () => {
  it('記録した比較を同じseedと期間入力から再現する', () => {
    for (const row of comparison) {
      expect(compareHandoverStrategies(row.seed, row.periods)).toEqual(row.results);
    }
  });
  it('同じ人物の対象能力を引き継ぎ、完了の翌期に担当を変える', () => {
    const initial = createHandoverPrototype('RI-214');
    expect(previewHandover(initial)).toMatchObject({
      knowledge: 'release-review',
      mentorCapacityCost: 3,
      apprenticeCapacityCost: 1,
      effectiveFromPeriod: 2,
    });
    const first = advanceHandoverPeriod(initial, { teach: true });
    const second = advanceHandoverPeriod(first, { teach: true });
    const moved = advanceHandoverPeriod(second, { move: true });
    expect(initial.mentorship.period).toBe(0);
    expect(second.mentorship.lessons).toBe(2);
    expect(moved.movedAt).toBe(3);
    expect(moved.history[2]).toMatchObject({ codingWork: 4, reviewWork: 5 });
    expect(
      moved.mentorship.roster.members.find((m) => m.id === initial.mentorship.mentorId),
    ).toMatchObject({ assignment: 'coding', aiAssigned: false });
    expect(
      moved.mentorship.roster.members.find((m) => m.id === initial.mentorship.apprenticeId)!.stats
        .review,
    ).toBe(
      initial.mentorship.roster.members.find((m) => m.id === initial.mentorship.apprenticeId)!.stats
        .review + 20,
    );
  });

  it('新担当の成果と元担当の継続性を別々に比較する', () => {
    const [immediate, handover, stay] = compareHandoverStrategies('RI-214', 8);
    expect(immediate.codingDelivered).toBeGreaterThan(handover.codingDelivered);
    expect(handover.codingDelivered).toBeGreaterThan(stay.codingDelivered);
    expect(handover.reviewDelivered).toBeGreaterThan(immediate.reviewDelivered);
    expect(stay.reviewDelivered).toBeGreaterThan(handover.reviewDelivered);
    expect(handover.teachingCost).toBe(8);
    expect(immediate.teachingCost).toBe(0);
    expect(compareHandoverStrategies('RI-214', 8)).toEqual([immediate, handover, stay]);
  });

  it('不在で引き継ぎが止まり、復帰まで完了後移動を待てる', () => {
    let state = createHandoverPrototype(1);
    state.mentorship.roster.members.find((m) => m.id === state.mentorship.mentorId)!.onLeave = true;
    state = advanceHandoverPeriod(state, { teach: true });
    expect(state.mentorship.lessons).toBe(0);
    expect(state.movedAt).toBeNull();
    state.mentorship.roster.members.find((m) => m.id === state.mentorship.mentorId)!.onLeave =
      false;
    state = advanceHandoverPeriod(state, { teach: true });
    expect(state.mentorship.lessons).toBe(1);
    const restored = JSON.parse(JSON.stringify(state));
    expect(advanceHandoverPeriod(restored, { teach: true })).toEqual(
      advanceHandoverPeriod(state, { teach: true }),
    );
  });

  it('移動と育成を同時指定しても異なる工程で二重稼働せず、移動は一度だけ記録する', () => {
    const state = advanceHandoverPeriod(createHandoverPrototype(1), { teach: true, move: true });
    expect(state.mentorship.lessons).toBe(0);
    expect(state.history[0]).toMatchObject({ codingWork: 4, reviewWork: 3 });
    expect(advanceHandoverPeriod(state, { move: true }).movedAt).toBe(1);
    expect(
      advanceHandoverPeriod(createHandoverPrototype(1), {
        teach: true,
        reviewDemand: 0,
        codingDemand: 0,
      }).history[0],
    ).toMatchObject({ codingWork: 0, reviewWork: 0 });
  });

  it.each([-1, 1.5, NaN])('不正な仕事量%sを受け付けない', (codingDemand) => {
    expect(() => advanceHandoverPeriod(createHandoverPrototype(1), { codingDemand })).toThrow();
  });
});
