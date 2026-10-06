import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/sprint-loadout-comparison.json';
import {
  beginSprintLoadout,
  compareSprintLoadouts,
  createSprintLoadoutPrototype,
  exchangeSprintLoadoutCard,
  playSprintLoadoutCard,
  selectSprintLoadout,
  tickSprintLoadout,
} from './sprintLoadout';

describe('所持カードのスプリント持ち込み試作', () => {
  it('JSON再開でも持ち込み対象の完全な分割だけを交換し、未選択・欠落を拒否する', () => {
    const state = beginSprintLoadout(
      selectSprintLoadout(createSprintLoadoutPrototype(1), [0, 1, 2, 3, 4]),
      'big-release',
    );
    const restored = JSON.parse(JSON.stringify(state));
    expect(restored.current.sprintDeckIndices).toEqual([0, 1, 2, 3, 4]);
    const index = restored.current.sprint.cardPiles.hand[0];
    expect(exchangeSprintLoadoutCard(restored, index).current!.exchanges).toBe(1);
    for (const corruption of ['missing', 'unselected']) {
      const invalid = structuredClone(restored);
      if (corruption === 'missing') invalid.current.sprint.cardPiles.drawOrder.pop();
      else invalid.current.sprint.cardPiles.drawOrder[1] = 5;
      const before = structuredClone(invalid);
      expect(exchangeSprintLoadoutCard(invalid, index)).toBe(invalid);
      expect(invalid).toEqual(before);
    }
  });

  it.each(
    [[], [0, 1], [0, 1, 2, 3, 4, 5, 6], [0, 1, 6], [-1, 0, 1], [0, 1, 1], [0, 1, 2.5]].map(
      (indices) => ({ indices }),
    ),
  )('無効候補$indicesを選んでも所持・選択・準備を変えない', ({ indices }) => {
    const state = createSprintLoadoutPrototype(1);
    expect(selectSprintLoadout(state, indices)).toBe(state);
  });

  it('最小3枚を選んでも所持6枚を残し、実手札には持ち込みだけを配る', () => {
    const initial = createSprintLoadoutPrototype('RI-187');
    const prepared = selectSprintLoadout(initial, [5, 3, 4]);
    expect(prepared.selected).toEqual([3, 4, 5]);
    expect(prepared.collection).toEqual(initial.collection);
    expect(initial.selected).toHaveLength(6);
    const state = beginSprintLoadout(prepared, 'security-audit');
    expect(state.current!.sprint.cardPiles.hand.sort()).toEqual([3, 4, 5]);
    expect(state.current!.sprint.cardPiles.drawOrder).toEqual([]);
    expect(playSprintLoadoutCard(state, 0)).toBe(state);
    expect(exchangeSprintLoadoutCard(state, 3)).toBe(state);
  });

  it('同一定義の別インスタンスを所持位置で区別し、別カードのレベルを借用しない', () => {
    const initial = createSprintLoadoutPrototype(1);
    initial.collection[0] = { defId: 'auto-test', level: 1 };
    initial.collection[1] = { defId: 'auto-test', level: 2 };
    const state = beginSprintLoadout(selectSprintLoadout(initial, [1, 3, 4]), 'security-audit');
    const played = playSprintLoadoutCard(state, 1);
    expect(played.current!.deck[1].baselineAppliedLevel).toBe(2);
    expect(played.current!.deck[0].baselineAppliedLevel).toBeUndefined();
    expect(played.current!.org.quality).toBe(60);
  });

  it('進行中は候補変更や再開始で手札・発動効果・集中力を巻き戻さない', () => {
    let state = beginSprintLoadout(
      selectSprintLoadout(createSprintLoadoutPrototype(1), [3, 4, 5]),
      'security-audit',
    );
    state = playSprintLoadoutCard(state, 4);
    const before = structuredClone(state);
    expect(selectSprintLoadout(state, [0, 1, 2])).toBe(state);
    expect(beginSprintLoadout(state, 'big-release')).toBe(state);
    expect(state).toEqual(before);
  });

  it('次スプリントで候補変更を反映し、前回の恒久効果・台帳を保持する', () => {
    let state = beginSprintLoadout(
      selectSprintLoadout(createSprintLoadoutPrototype(1), [3, 4, 5]),
      'security-audit',
    );
    state = playSprintLoadoutCard(state, 4);
    while (!state.current!.sprint.complete) state = tickSprintLoadout(state);
    const quality = state.current!.org.quality;
    const firstEffects = structuredClone(state.current!.sprint.cardEffects);
    const prepared = selectSprintLoadout(state, [0, 1, 2]);
    expect(prepared.current!.sprint.cardEffects).toEqual(firstEffects);
    const next = beginSprintLoadout(prepared, 'big-release');
    expect(next.sprintNumber).toBe(2);
    expect(next.current!.sprint.cardPiles.hand.sort()).toEqual([0, 1, 2]);
    expect(next.current!.org.quality).toBe(quality);
    expect(next.collection[4].baselineAppliedLevel).toBe(1);
    expect(next.current!.sprint.cardPiles.played).toEqual([]);
    expect(next.current!.sprint.cardEffects.qualityAdd).toBe(0);
    expect(next.current!.sprint.metrics.seniorHpStart).toBe(state.current!.org.seniorHp);
    // 次々スプリントで元のカードを再び持ち込んでも恒久加算を二重に得ない。
    next.current!.sprint.complete = true;
    const again = beginSprintLoadout(selectSprintLoadout(next, [3, 4, 5]), 'security-audit');
    expect(playSprintLoadoutCard(again, 4).current!.org.quality).toBe(quality);
  });

  it('広い候補でもカードは一度だけ配られ、交換は未選択カードを引かない', () => {
    const initial = selectSprintLoadout(createSprintLoadoutPrototype(1), [0, 1, 3, 4]);
    let state = beginSprintLoadout(initial, 'big-release');
    state = exchangeSprintLoadoutCard(state, state.current!.sprint.cardPiles.hand[0]);
    const piles = state.current!.sprint.cardPiles;
    expect([...piles.hand, ...piles.drawOrder, ...piles.discard].sort()).toEqual([0, 1, 3, 4]);
    expect(state.current!.exchanges).toBe(1);
  });

  it('候補の並びだけを変えても同じseedの手札を変えず、JSON再開も一致する', () => {
    const initial = createSprintLoadoutPrototype('RI-187');
    const a = beginSprintLoadout(selectSprintLoadout(initial, [0, 1, 3, 4]), 'big-release');
    const b = beginSprintLoadout(selectSprintLoadout(initial, [4, 3, 1, 0]), 'big-release');
    expect(a).toEqual(b);
    let state = playSprintLoadoutCard(a, a.current!.sprint.cardPiles.hand[0]);
    let restored = JSON.parse(JSON.stringify(state));
    while (!state.current!.sprint.complete) {
      state = tickSprintLoadout(state, true);
      restored = tickSprintLoadout(restored, true);
    }
    expect(restored).toEqual(state);
    expect(beginSprintLoadout(restored, 'security-audit')).toEqual(
      beginSprintLoadout(state, 'security-audit'),
    );
  });

  it('異なるボス向けの同一資源比較を再現し、狭い候補の安定と広い候補の対応力を分ける', () => {
    for (const row of comparison)
      expect(compareSprintLoadouts(row.seed, row.boss as 'big-release' | 'security-audit')).toEqual(
        row.results,
      );
    for (const seed of ['RI-187', 'RI-187:1', 'RI-187:2']) {
      expect(compareSprintLoadouts(seed, 'big-release')[0].desiredInInitialHand).toBe(true);
      expect(compareSprintLoadouts(seed, 'security-audit')[1].desiredInInitialHand).toBe(true);
    }
    const audit = compareSprintLoadouts('RI-187', 'security-audit');
    expect(audit[1].auditQualityMet).toBe(true);
    expect(audit[0].auditQualityMet).toBe(false);
  });
});
