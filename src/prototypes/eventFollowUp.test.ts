import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/event-follow-up-comparison.json';
import pressure from '../../docs/prototypes/event-follow-up-resource-pressure.json';
import { SPRINTS_PER_QUARTER } from '../sim/run/constants';
import {
  canPayFollowUpChoice,
  compareEventFollowUpStrategies,
  compareFollowUpResourcePressure,
  completeEventFollowUpSprint,
  createDueFollowUpState,
  createEventFollowUpPrototype,
  FOLLOW_UP_PRESSURE_CASES,
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

const pressureCase = (id: string) => {
  const found = FOLLOW_UP_PRESSURE_CASES.find((entry) => entry.id === id);
  if (!found) throw new Error(id);
  return found;
};
const dueSplit = (seniorHp: number, budget = 40) =>
  presentEventFollowUpBeat(
    createDueFollowUpState({
      ...pressureCase('low-hp-consult-blocked'),
      seniorHp,
      budget,
      usualBeat: 'rest-offer',
    }),
    'rest-offer',
  );

describe('資源が足りない後日談', () => {
  it('予算不足の応諾は拒否し、予算・HP・品質を増やさない', () => {
    const state = presentEventFollowUpBeat(
      createDueFollowUpState({ ...pressureCase('budget-short-reject'), usualBeat: 'shop-offer' }),
      'shop-offer',
    );
    expect(canPayFollowUpChoice(state, giantPrFollowUpOutcomes(0)[0])).toBe(false);
    expect(resolveEventFollowUpBeat(state, 0)).toBe(state);
    expect(state.budget).toBe(5);
    expect(state.org.seniorHp).toBe(80);
    expect(state.org.quality).toBe(60);
    expect(state.reservation?.resolvedAfter).toBeNull();
    expect(state.history).toEqual([]);
  });

  it('低HPの追加相談は拒否し、HPを0に切り詰めて報酬を足さない', () => {
    const state = dueSplit(3);
    expect(state.active?.kind).toBe('follow-up');
    expect(state.deferredNormal).toEqual({ kind: 'normal', eventId: 'rest-offer' });
    expect(resolveEventFollowUpBeat(state, 0)).toBe(state);
    expect(state.org.seniorHp).toBe(3);
    expect(state.org.morale).toBe(70);
    expect(state.org.quality).toBe(60);
  });

  it('費用ちょうどは支払い、不足の拒否とは別の明示選択だけが代替効果を適用する', () => {
    const payable = presentEventFollowUpBeat(
      createDueFollowUpState({ ...pressureCase('shop-after-follow-up'), budget: 6 }),
      'shop-offer',
    );
    const paid = resolveEventFollowUpBeat(payable, 0);
    expect(paid.budget).toBe(0);
    expect(paid.org.seniorHp).toBe(84);
    expect(paid.org.quality).toBe(66);
    const exactHp = resolveEventFollowUpBeat(dueSplit(4), 0);
    expect(exactHp.org.seniorHp).toBe(0);
    expect(exactHp.org.morale).toBe(78);
    expect(exactHp.org.quality).toBe(64);
    expect(exactHp.phase).toBe('sprint');
    const short = presentEventFollowUpBeat(
      createDueFollowUpState(pressureCase('budget-short-reject')),
      'shop-offer',
    );
    const declined = resolveEventFollowUpBeat(short, 1);
    expect(declined.budget).toBe(5);
    expect(declined.org.seniorHp).toBe(82);
    expect(declined.org.quality).toBe(57);
    expect(declined.history.map((event) => event.choice)).toEqual([1]);
  });

  it('起点のHP不足も拒否し、レリックと予約を増やさない', () => {
    const presented = presentGiantPrOrigin(createEventFollowUpPrototype('RI-240', 2));
    const state = { ...presented, org: { ...presented.org, seniorHp: 10 } };
    expect(resolveEventFollowUpBeat(state, 0)).toBe(state);
    expect(state.org.seniorHp).toBe(10);
    expect(state.reservation).toBeNull();
    expect(state.relics).toEqual([]);
  });

  it('自動代替は比較腕だけで、レビューの見送りはHPを増やす', () => {
    const state = presentEventFollowUpBeat(
      createDueFollowUpState(pressureCase('budget-short-fallback-arm')),
      'shop-offer',
    );
    expect(resolveEventFollowUpBeat(state, 0)).toBe(state);
    const fellBack = resolveEventFollowUpBeat(state, 0, 'fallback');
    expect(fellBack.history[fellBack.history.length - 1]?.choice).toBe(1);
    expect(fellBack.org.seniorHp).toBe(82);
    expect(fellBack.budget).toBe(5);
    const split = dueSplit(3);
    const splitFallback = resolveEventFollowUpBeat(split, 0, 'fallback');
    expect(splitFallback.org.seniorHp).toBe(3);
    expect(splitFallback.org.morale).toBe(66);
    expect(splitFallback.history[splitFallback.history.length - 1]?.choice).toBe(1);
  });

  it('低HPの相談を休息より優先し、休息は次の既存ビートまで繰り延べる', () => {
    const blocked = dueSplit(3);
    expect(resolveEventFollowUpBeat(blocked, 0)).toBe(blocked);
    expect(blocked.deferredNormal?.eventId).toBe('rest-offer');
    const declined = resolveEventFollowUpBeat(blocked, 1);
    const rested = resolveEventFollowUpBeat(
      presentEventFollowUpBeat(completeEventFollowUpSprint(declined)),
      0,
    );
    expect(rested.history.map((event) => event.eventId)).toEqual([
      'giant-pr-follow-up',
      'rest-offer',
    ]);
    expect(rested.org.seniorHp).toBe(43);
    expect(rested.org.morale).toBe(76);
    expect(rested.org.quality).toBe(60);
    expect(rested.deferredNormal).toBeNull();
  });

  it('予算が足りないショップ購入は拒否し、予算を増やさない', () => {
    const consulted = resolveEventFollowUpBeat(
      presentEventFollowUpBeat(
        createDueFollowUpState(pressureCase('shop-after-follow-up')),
        'shop-offer',
      ),
      0,
    );
    const shop = presentEventFollowUpBeat(completeEventFollowUpSprint(consulted));
    expect(shop.active).toEqual({ kind: 'normal', eventId: 'shop-offer' });
    expect(resolveEventFollowUpBeat(shop, 0)).toBe(shop);
    expect(shop.budget).toBe(10);
    expect(shop.relics).toEqual([]);
    const skipped = resolveEventFollowUpBeat(shop, 1);
    expect(skipped.budget).toBe(10);
    expect(skipped.history[skipped.history.length - 1]).toMatchObject({
      eventId: 'shop-offer',
      choice: 1,
    });
  });

  it('四半期境界では休息ビートを挿入せず、予約を次の既存ビートまで保持する', () => {
    const atBoss = createDueFollowUpState({
      ...pressureCase('low-hp-consult-blocked'),
      completedSprints: SPRINTS_PER_QUARTER,
    });
    expect(presentEventFollowUpBeat(atBoss, 'rest-offer')).toBe(atBoss);
    expect(atBoss.active).toBeNull();
    expect(atBoss.org.seniorHp).toBe(3);
    const next = presentEventFollowUpBeat(
      completeEventFollowUpSprint({ ...atBoss, phase: 'sprint' }),
      'rest-offer',
    );
    expect(next.completedSprints).toBe(SPRINTS_PER_QUARTER + 1);
    expect(next.active).toEqual({ kind: 'follow-up', eventId: 'giant-pr-follow-up' });
    expect(next.deferredNormal).toEqual({ kind: 'normal', eventId: 'rest-offer' });
  });

  it('固定戦略の入力列と資源不足の結果を再計算する', () => {
    const report = compareFollowUpResourcePressure();
    expect(report).toEqual(pressure);
    expect(report.humanPlay).toBe(false);
    expect(report.definedPayment).toBe('reject');
    expect(report.definedPriority).toBe('follow-up-first');
    expect(report.productionLossCheck).toBe(false);
    const byId = Object.fromEntries(report.results.map((result) => [result.id, result]));
    expect(byId['low-hp-consult-blocked']).toMatchObject({
      phase: 'beat',
      seniorHp: 3,
      budget: 40,
      active: 'giant-pr-follow-up',
      deferred: 'rest-offer',
      history: [],
      restTaken: false,
    });
    expect(byId['low-hp-rest-next-beat']).toMatchObject({
      seniorHp: 43,
      morale: 76,
      quality: 60,
      budget: 40,
      restTaken: true,
      reservation: { resolvedAfter: 7 },
    });
    expect(byId['low-hp-rest-next-beat'].history.map((event) => event.eventId)).toEqual([
      'giant-pr-follow-up',
      'rest-offer',
    ]);
    expect(byId['low-hp-rest-first-arm']).toMatchObject({
      seniorHp: 39,
      morale: 88,
      quality: 64,
      restTaken: true,
      reservation: { resolvedAfter: 8 },
    });
    expect(byId['low-hp-rest-first-arm'].history.map((event) => event.eventId)).toEqual([
      'rest-offer',
      'giant-pr-follow-up',
    ]);
    expect(byId['shop-after-follow-up']).toMatchObject({
      budget: 10,
      seniorHp: 84,
      quality: 66,
      shopPaid: false,
    });
    expect(byId['shop-before-follow-up-arm']).toMatchObject({
      budget: 4,
      seniorHp: 82,
      quality: 57,
      shopPaid: true,
    });
    expect(byId['budget-short-reject'].budget).toBe(5);
    expect(byId['budget-short-fallback-arm']).toMatchObject({ budget: 5, seniorHp: 82 });
    expect(byId['budget-short-fallback-arm'].attempts[0]).toMatchObject({
      requested: 0,
      applied: 1,
      rejected: false,
    });
    for (const result of report.results) {
      expect(result.history.length).toBeLessThanOrEqual(2);
      expect(result.relics).toEqual([]);
      let budget = report.inputs.find((input) => input.id === result.id)?.budget;
      let seniorHp = report.inputs.find((input) => input.id === result.id)?.seniorHp;
      for (const attempt of result.attempts) {
        if (attempt.rejected) {
          expect(attempt.budget).toBe(budget);
          expect(attempt.seniorHp).toBe(seniorHp);
        }
        budget = attempt.budget;
        seniorHp = attempt.seniorHp;
      }
    }
  });
});
