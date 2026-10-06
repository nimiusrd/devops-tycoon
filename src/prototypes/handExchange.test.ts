import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/hand-exchange-comparison.json';
import {
  compareHandExchangeStrategies,
  createHandExchangePrototype,
  exchangeHandCard,
  playHandExchangeCard,
  tickHandExchangePrototype,
} from './handExchange';

describe('集中力を使う手札交換の隔離試作', () => {
  it.each(['duplicate', 'missing', 'out-of-range', 'fraction', 'invalid-scope'] as const)(
    'JSON復元後の交換対象以外の%sも無消費で拒否する',
    (corruption) => {
      const state = createHandExchangePrototype(1);
      state.sprint.cardPiles = { hand: [3, 4, 5], drawOrder: [0, 1, 2], discard: [], played: [] };
      if (corruption === 'duplicate') state.sprint.cardPiles.drawOrder = [0, 2, 2];
      if (corruption === 'missing') state.sprint.cardPiles.drawOrder = [0, 1];
      if (corruption === 'out-of-range') state.sprint.cardPiles.discard = [99];
      if (corruption === 'fraction') state.sprint.cardPiles.drawOrder[2] = 1.5;
      if (corruption === 'invalid-scope') state.sprintDeckIndices = [0, 1, 2, 3, 4, 4];
      const restored = JSON.parse(JSON.stringify(state));
      const before = structuredClone(restored);
      const result = exchangeHandCard(restored, 3);
      expect(result).toEqual({ ok: false, reason: 'invalid', state: before });
      expect(result.state).toBe(restored);
      expect(restored).toEqual(before);
    },
  );

  it('手札1枚と山札先頭だけを移し、入力・効果・組織・乱数を変えない', () => {
    const state = createHandExchangePrototype('RI-186');
    const before = structuredClone(state);
    const removed = state.sprint.cardPiles.hand[1];
    const drawn = state.sprint.cardPiles.drawOrder[0];
    const result = exchangeHandCard(state, removed);
    expect(result.ok).toBe(true);
    expect(state).toEqual(before);
    expect(result.state.sprint.cardPiles).toEqual({
      hand: [before.sprint.cardPiles.hand[0], drawn, before.sprint.cardPiles.hand[2]],
      drawOrder: before.sprint.cardPiles.drawOrder.slice(1),
      discard: [removed],
      played: [],
    });
    expect(result.state.sprint.focus).toBe(6);
    expect(result.state.sprint.metrics.focusSpent).toBe(2);
    expect(result.state.org).toEqual(state.org);
    expect(result.state.sprint.cardEffects).toEqual(state.sprint.cardEffects);
    expect(result.state.rngState).toBe(state.rngState);
  });

  it.each(['no-focus', 'no-draw', 'complete', 'paused', 'limit', 'no-card', 'invalid'] as const)(
    '%sでは費用・枚数・交換回数を一切変えない',
    (reason) => {
      const state = createHandExchangePrototype(1);
      let index = state.sprint.cardPiles.hand[0];
      if (reason === 'no-focus') state.sprint.focus = 1;
      if (reason === 'no-draw') state.sprint.cardPiles.drawOrder = [];
      if (reason === 'complete') state.sprint.complete = true;
      if (reason === 'paused') state.paused = true;
      if (reason === 'limit') state.exchanges = 2;
      if (reason === 'no-card') index = 99;
      if (reason === 'invalid') state.sprint.cardPiles.drawOrder[0] = 99;
      const before = structuredClone(state);
      const result = exchangeHandCard(state, index);
      expect(result).toEqual({ ok: false, reason, state: before });
      expect(result.state).toBe(state);
    },
  );

  it('下限tick待ちでも交換せず、発動済みカードを交換できない', () => {
    let state = createHandExchangePrototype(1);
    const card = state.sprint.cardPiles.hand[0];
    state = playHandExchangeCard(state, card);
    expect(exchangeHandCard(state, card)).toMatchObject({ ok: false, reason: 'no-card' });
    const played = [...state.sprint.cardPiles.played];
    const effects = structuredClone(state.sprint.cardEffects);
    state = exchangeHandCard(state, state.sprint.cardPiles.hand[0]).state;
    expect(state.sprint.cardPiles.played).toEqual(played);
    expect(state.sprint.cardEffects).toEqual(effects);
    state.sprint.tasks = [];
    state.sprint.config.minCompleteTick = 50;
    expect(exchangeHandCard(state, state.sprint.cardPiles.hand[0])).toMatchObject({
      ok: false,
      reason: 'complete',
    });
  });

  it('交換後の発動は既存処理で一度だけ適用し、全カードの所属を維持する', () => {
    let state = createHandExchangePrototype(1);
    for (let i = 0; i < 2; i += 1)
      state = exchangeHandCard(state, state.sprint.cardPiles.hand[0]).state;
    expect(exchangeHandCard(state, state.sprint.cardPiles.hand[0])).toMatchObject({
      ok: false,
      reason: 'limit',
    });
    const card = state.sprint.cardPiles.hand[0];
    state = playHandExchangeCard(state, card);
    const next = playHandExchangeCard(state, card);
    expect(next).toBe(state);
    const piles = state.sprint.cardPiles;
    expect([...piles.hand, ...piles.drawOrder, ...piles.discard, ...piles.played].sort()).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('同じseed・交換・入力をJSONから再開し、乱数を含む実工程の結果を再現する', () => {
    const initial = createHandExchangePrototype('RI-186');
    let state = exchangeHandCard(initial, initial.sprint.cardPiles.hand[0]).state;
    state = playHandExchangeCard(state, state.sprint.cardPiles.hand[0]);
    for (let i = 0; i < 5; i += 1) state = tickHandExchangePrototype(state, true);
    let restored = JSON.parse(JSON.stringify(state));
    while (!state.sprint.complete) {
      state = tickHandExchangePrototype(state, true);
      restored = tickHandExchangePrototype(restored, true);
    }
    expect(restored).toEqual(state);
  });

  it('同じ資源・仕事・手札から、出荷と現場介入の機会費用を比較する', () => {
    for (const row of comparison)
      expect(compareHandExchangeStrategies(row.seed, row.workload as 'coding' | 'review')).toEqual(
        row.results,
      );
    const results = compareHandExchangeStrategies('RI-186', 'review');
    expect(results[2].interventions).toBeLessThan(results[0].interventions);
    expect(results[0].delivered).toBeGreaterThan(results[1].delivered);
    const coding = compareHandExchangeStrategies('RI-186', 'coding');
    expect(coding[1].delivered).toBeGreaterThan(coding[0].delivered);
  });

  it('不正な重複山札からカードを増殖させず、保存後も交換上限が残る', () => {
    const initial = createHandExchangePrototype(1);
    initial.sprint.cardPiles.drawOrder[0] = initial.sprint.cardPiles.hand[0];
    expect(exchangeHandCard(initial, initial.sprint.cardPiles.hand[0])).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    let state = createHandExchangePrototype(1);
    state = exchangeHandCard(state, state.sprint.cardPiles.hand[0]).state;
    state = JSON.parse(JSON.stringify(state));
    state = exchangeHandCard(state, state.sprint.cardPiles.hand[0]).state;
    expect(exchangeHandCard(state, state.sprint.cardPiles.hand[0])).toMatchObject({
      ok: false,
      reason: 'limit',
    });
  });
});
