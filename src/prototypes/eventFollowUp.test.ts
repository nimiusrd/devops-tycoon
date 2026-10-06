import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/event-follow-up-comparison.json';
import { SPRINTS_PER_QUARTER } from '../sim/run/constants';
import {
  compareEventFollowUpStrategies,
  completeEventFollowUpSprint,
  createEventFollowUpPrototype,
  giantPrFollowUpOutcomes,
  presentEventFollowUpBeat,
  presentGiantPrOrigin,
  previewGiantPrFollowUp,
  previewGiantPrOriginChoice,
  resolveEventFollowUpBeat,
} from './eventFollowUp';

const origin = (after: number, choice: number) =>
  resolveEventFollowUpBeat(
    presentGiantPrOrigin(createEventFollowUpPrototype('RI-240', after)),
    choice,
  );
const finish = (state: ReturnType<typeof origin>) => {
  const completed = completeEventFollowUpSprint(state);
  const presented = presentEventFollowUpBeat(completed);
  return presented.phase === 'beat' ? presented : { ...presented, phase: 'sprint' as const };
};

describe('巨大PR選択の後日談予約', () => {
  it.each([0, 1])('起点の選択%iと絶対期限を保持し、選択前には予約しない', (choice) => {
    const initial = presentGiantPrOrigin(createEventFollowUpPrototype('RI-240', 2));
    expect(previewGiantPrFollowUp(initial)).toBeNull();
    const state = resolveEventFollowUpBeat(initial, choice);
    expect(state.reservation).toEqual({
      originChoice: choice,
      selectedAfter: 2,
      dueAfter: 4,
      resolvedAfter: null,
    });
    expect(previewGiantPrFollowUp(state)).toMatchObject({
      earliestAfter: 4,
      possibleCost: { seniorHp: 4, budget: 6 },
    });
    expect(initial.reservation).toBeNull();
  });

  it('未経験の起点から後日談を発生させず、通常ビートの枠を維持する', () => {
    const result = compareEventFollowUpStrategies('RI-240')[0];
    expect(result.reservation).toBeNull();
    expect(result.history.every((event) => event.eventId !== 'giant-pr-follow-up')).toBe(true);
  });

  it('選択前に当期の確定費用と追加相談の費用範囲を予告し、効果は発動しない', () => {
    const state = presentGiantPrOrigin(createEventFollowUpPrototype(1, 2));
    expect(previewGiantPrOriginChoice(state, 0)).toEqual({
      immediate: { quality: 4, seniorHp: -14 },
      followUp: { earliestAfter: 4, possibleCost: { seniorHp: 0, budget: 6 } },
    });
    expect(previewGiantPrOriginChoice(state, 1)).toMatchObject({
      followUp: { possibleCost: { seniorHp: 4, budget: 0 } },
    });
    expect(state.reservation).toBeNull();
    expect(previewGiantPrOriginChoice(origin(2, 0), 1).followUp).toBeNull();
  });

  it('期限前は通常イベント、期限には後日談を優先し、通常イベントを次のビートへ繰り延べる', () => {
    let state = origin(1, 1);
    state = finish(state);
    expect(state.active?.kind).toBe('normal');
    state = resolveEventFollowUpBeat(state, 0);
    state = finish(state);
    expect(state.active?.kind).toBe('follow-up');
    const deferred = structuredClone(state.deferredNormal);
    expect(deferred?.kind).toBe('normal');
    expect(presentEventFollowUpBeat(state)).toBe(state);
    state = resolveEventFollowUpBeat(state, 0);
    expect(state.reservation?.resolvedAfter).toBe(3);
    state = finish(state);
    expect(state.active).toEqual(deferred);
    expect(state.deferredNormal).toBeNull();
  });

  it('ボス後にはビートを挿入せず、予約を翌四半期の既存ビートまで保持する', () => {
    let state = origin(SPRINTS_PER_QUARTER - 2, 1);
    state = resolveEventFollowUpBeat(finish(state), 0);
    state = finish(state);
    expect(state.completedSprints).toBe(SPRINTS_PER_QUARTER);
    expect(state.active).toBeNull();
    expect(state.reservation?.resolvedAfter).toBeNull();
    state = finish(state);
    expect(state.active?.kind).toBe('follow-up');
    expect(state.completedSprints).toBe(SPRINTS_PER_QUARTER + 1);
  });

  it.each([0, 1])('選択%iの得失を反映し、無効選択や重複解決で予約と報酬を消費しない', (choice) => {
    let state = resolveEventFollowUpBeat(finish(origin(1, choice)), 0);
    state = finish(state);
    const before = structuredClone(state);
    expect(resolveEventFollowUpBeat(state, -1)).toBe(state);
    expect(resolveEventFollowUpBeat(state, 0.5)).toBe(state);
    expect(resolveEventFollowUpBeat(state, 9)).toBe(state);
    const next = resolveEventFollowUpBeat(state, 0);
    expect(next.history[next.history.length - 1].outcome).toEqual(
      giantPrFollowUpOutcomes(choice as 0 | 1)[0],
    );
    expect(state).toEqual(before);
    expect(resolveEventFollowUpBeat(next, 0)).toBe(next);
    const secondOrigin = { ...next, phase: 'between' as const };
    const resolvedAgain = resolveEventFollowUpBeat(presentGiantPrOrigin(secondOrigin), 1);
    expect(resolvedAgain.reservation).toEqual(next.reservation);
  });

  it('JSON再開を予約前・四半期境界・提示中・解決後に挟んでも一度だけ発生する', () => {
    let state = origin(SPRINTS_PER_QUARTER - 2, 1);
    let restored = JSON.parse(JSON.stringify(state));
    for (let i = 0; i < 5; i += 1) {
      state = finish(state);
      restored = finish(JSON.parse(JSON.stringify(restored)));
      expect(restored).toEqual(state);
      if (state.phase === 'beat') {
        state = resolveEventFollowUpBeat(state, 0);
        restored = resolveEventFollowUpBeat(JSON.parse(JSON.stringify(restored)), 0);
      }
    }
    expect(restored).toEqual(state);
    expect(state.history.filter((event) => event.eventId === 'giant-pr-follow-up')).toHaveLength(1);
  });

  it('後日談での見送りは追加費用を避けるが、品質または士気を譲る', () => {
    for (const choice of [0, 1] as const) {
      let state = resolveEventFollowUpBeat(finish(origin(1, choice)), 0);
      state = finish(state);
      const accepted = resolveEventFollowUpBeat(state, 0);
      const declined = resolveEventFollowUpBeat(state, 1);
      expect(declined.reservation?.resolvedAfter).toBe(3);
      if (choice === 0) {
        expect(declined.budget).toBeGreaterThan(accepted.budget);
        expect(declined.org.quality).toBeLessThan(accepted.org.quality);
      } else {
        expect(declined.org.seniorHp).toBeGreaterThan(accepted.org.seniorHp);
        expect(declined.org.morale).toBeLessThan(accepted.org.morale);
      }
    }
  });

  it('固定seedと資源の比較記録を再現する', () => {
    expect(compareEventFollowUpStrategies(comparison.seed)).toEqual(comparison.results);
    const [, review, split] = comparison.results;
    expect(split.seniorHp).toBeGreaterThan(review.seniorHp);
    expect(review.quality).toBeGreaterThan(split.quality);
    expect(split.budget).toBeGreaterThan(review.budget);
  });
});
