import { describe, expect, it } from 'vitest';
import comparison from '../../docs/prototypes/card-retirement-comparison.json';
import {
  availableRetirementCards,
  beginRetirementSprint,
  compareCardRetirementStrategies,
  createCardRetirementPrototype,
  playRetirementCard,
  retireCard,
  selectRetirementLoadout,
  tickRetirementSprint,
} from './cardRetirement';

describe('施策廃止の比較試作', () => {
  it('廃止した位置だけを以後の候補から外し、同IDの別インスタンスを保持する', () => {
    const initial = createCardRetirementPrototype(1);
    initial.loadout.collection[1] = { defId: 'copilot', level: 2 };
    const retired = retireCard(initial, 0);
    expect(retired.budget).toBe(15);
    expect(initial.retired).toEqual([]);
    expect(retired.loadout.collection).toEqual(initial.loadout.collection);
    expect(availableRetirementCards(retired)).toEqual([1, 2, 3, 4, 5]);
    expect(selectRetirementLoadout(retired, [0, 1, 2])).toBe(retired);
    const next = beginRetirementSprint(retired, 'big-release');
    expect(
      [
        ...next.loadout.current!.sprint.cardPiles.hand,
        ...next.loadout.current!.sprint.cardPiles.drawOrder,
      ].sort(),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(playRetirementCard(next, 0)).toBe(next);
  });

  it('導入済みの正負baselineと台帳を戻さず、再操作で費用や資源を増やさない', () => {
    let state = selectRetirementLoadout(createCardRetirementPrototype(1), [0, 1, 2]);
    state = beginRetirementSprint(state, 'big-release');
    state = playRetirementCard(state, 0);
    while (!state.loadout.current!.sprint.complete) state = tickRetirementSprint(state);
    const before = structuredClone(state);
    const retired = retireCard(state, 0, [1, 2, 3]);
    expect(retired.loadout.current!.org).toEqual(before.loadout.current!.org);
    expect(retired.loadout.collection[0].baselineAppliedLevel).toBe(1);
    expect(retired.loadout.current!.sprint.cardEffects).toEqual(
      before.loadout.current!.sprint.cardEffects,
    );
    expect(retireCard(retired, 0)).toBe(retired);
    const next = beginRetirementSprint(retired, 'security-audit');
    expect(next.loadout.current!.org.aiDependency).toBe(before.loadout.current!.org.aiDependency);
    expect(next.loadout.current!.org.securityLevel).toBe(before.loadout.current!.org.securityLevel);
    expect(next.loadout.current!.sprint.cardEffects.codingSpeedMul).toBe(1);
  });

  it('費用不足・進行中・同じ境界で2枚目・不正候補では変更しない', () => {
    const state = createCardRetirementPrototype(1);
    expect(retireCard({ ...state, budget: 5 }, 0)).toMatchObject({ budget: 5, retired: [] });
    expect(retireCard(state, -1)).toBe(state);
    expect(retireCard(state, 1.5)).toBe(state);
    expect(retireCard(state, 9)).toBe(state);
    expect(retireCard(state, 0, [0, 1, 2])).toBe(state);
    expect(retireCard(state, 0, [1, 2])).toBe(state);
    const active = beginRetirementSprint(state, 'big-release');
    expect(retireCard(active, 0)).toBe(active);
    const retired = retireCard(state, 0);
    expect(retireCard(retired, 1)).toBe(retired);
  });

  it('残3枚で廃止を止め、JSON保存を跨いでも同じ廃止制限を守る', () => {
    let state = createCardRetirementPrototype(1);
    for (const index of [0, 1, 2]) {
      state = retireCard(state, index);
      state = JSON.parse(JSON.stringify(state));
      state = beginRetirementSprint(state, 'security-audit');
      while (!state.loadout.current!.sprint.complete) state = tickRetirementSprint(state);
    }
    expect(state.budget).toBe(5);
    expect(availableRetirementCards(state)).toEqual([3, 4, 5]);
    state.budget = 20;
    expect(retireCard(state, 3)).toBe(state);
  });

  it('狭い持ち込みからの廃止には有効な次候補を指定し、自動で未選択施策を持ち込まない', () => {
    const state = selectRetirementLoadout(createCardRetirementPrototype(1), [0, 1, 2]);
    expect(retireCard(state, 0)).toBe(state);
    expect(retireCard(state, 0, [1, 2, 3]).loadout.selected).toEqual([1, 2, 3]);
  });

  it('同じseedと入力を廃止・保存再開後にも再現する', () => {
    let state = beginRetirementSprint(
      retireCard(createCardRetirementPrototype('RI-188'), 0),
      'security-audit',
    );
    state = playRetirementCard(state, state.loadout.current!.sprint.cardPiles.hand[0]);
    let restored = JSON.parse(JSON.stringify(state));
    while (!state.loadout.current!.sprint.complete) {
      state = tickRetirementSprint(state, true);
      restored = tickRetirementSprint(restored, true);
    }
    expect(restored).toEqual(state);
    expect(selectRetirementLoadout(restored, [0, 1, 2])).toBe(restored);
  });

  it('廃止と未持ち込みの出荷・品質・引きは一致し、廃止だけが予算と将来選択肢を失う', () => {
    for (const row of comparison) {
      const results = compareCardRetirementStrategies(
        row.seed,
        row.boss as 'big-release' | 'security-audit',
      );
      expect(results).toEqual(row.results);
      const [, omit, retired] = results;
      expect(retired.hand).toEqual(omit.hand);
      expect(retired.delivered).toBe(omit.delivered);
      expect(retired.quality).toBe(omit.quality);
      expect(retired.budget).toBe(omit.budget - 5);
      expect(retired.activeOwned).toBe(omit.activeOwned - 1);
    }
  });
});
