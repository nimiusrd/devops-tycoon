import { describe, expect, it } from 'vitest';
import {
  applyDeckBaseline,
  baselineAppliedLevelFor,
  dealHand,
  deckEffects,
  drawDraft,
  HAND_SIZE,
  migrateBaselineAppliedByTeam,
  playCost,
  PREFERRED_DRAFT_WEIGHT_MUL,
  scaleEffects,
  upgradeCard,
  upgradeCardAt,
} from '../../src/sim/cards';
import { reworkProbability } from '../../src/sim/model';
import { createOrgState } from '../../src/sim/org';
import { createRng } from '../../src/sim/rng';
import { createEngine, type Engine } from '../../src/sim/engine';
import type { CardInstance, OrgState, SprintResult, Task } from '../../src/sim/types';

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 0,
  kind: 'normal',
  highValue: false,
  aiAssisted: false,
  lane: 'review',
  progress: 0,
  reworkAttempts: 0,
  wasReworked: false,
  incident: false,
  debt: false,
  ...overrides,
});

const org = (overrides: Partial<OrgState> = {}): OrgState => ({
  ...createOrgState('default', true),
  ...overrides,
});

describe('カード効果の状態反映（第7.2）', () => {
  it('自動テスト強化は Rework 率を下げる', () => {
    // クランプ下限に当たらない「荒れた」組織で減少を確認する。
    const hot = org({ aiDependency: 90, quality: 20, aiLiteracy: 10 });
    const effects = deckEffects([{ defId: 'auto-test', level: 1 }]);
    const base = reworkProbability(hot, task());
    const carded = reworkProbability(hot, task(), effects);
    expect(carded).toBeLessThan(base);
  });

  it('AI利用ガイドラインは教育で AI Literacy を上げ、AI依存度を下げる', () => {
    const o = org({ aiLiteracy: 40, aiDependency: 55 });
    applyDeckBaseline(o, deckEffects([{ defId: 'ai-guideline', level: 1 }]));
    expect(o.aiLiteracy).toBe(55);
    expect(o.aiDependency).toBe(45);
  });

  it('強化レベルが上がるほど効果が強まる', () => {
    const l1 = scaleEffects({ codingSpeedMul: 1.15 }, 1).codingSpeedMul;
    const l2 = scaleEffects({ codingSpeedMul: 1.15 }, 2).codingSpeedMul;
    expect(l2).toBeGreaterThan(l1);
  });

  it('upgradeCard は対象カードを 1 段強化する', () => {
    const deck: CardInstance[] = [
      { defId: 'copilot', level: 1 },
      { defId: 'copilot', level: 1 },
    ];
    const next = upgradeCard(deck, 'copilot');
    expect(next[0].level).toBe(2);
    expect(next[1].level).toBe(1); // 1 枚だけ強化
    expect(deck[0].level).toBe(1); // 元配列は不変
  });

  it('upgradeCardAt は指定位置だけを 1 段強化する', () => {
    const deck: CardInstance[] = [
      { defId: 'copilot', level: 1 },
      { defId: 'copilot', level: 2 },
    ];
    const next = upgradeCardAt(deck, 1);
    expect(next[0].level).toBe(1);
    expect(next[1].level).toBe(3);
    expect(deck[1].level).toBe(2);
  });

  it('未知カードは効果に影響しない（無効果へフォールバック）', () => {
    const effects = deckEffects([{ defId: 'does-not-exist', level: 1 }]);
    expect(effects.codingSpeedMul).toBe(1);
    expect(effects.reworkRateAdd).toBe(0);
  });
});

describe('手札配布・発動（RI-30）', () => {
  it('dealHand は同一 seed で再現し HAND_SIZE 枚配る', () => {
    const a = dealHand(5, createRng('deal:a'));
    const b = dealHand(5, createRng('deal:a'));
    expect(a).toEqual(b);
    expect(a.hand).toHaveLength(HAND_SIZE);
    expect(a.hand.length + a.drawOrder.length).toBe(5);
  });

  it('playCost は cost/4 を丸め、強化で下がる', () => {
    expect(playCost(10, 1)).toBe(3);
    expect(playCost(10, 2)).toBe(2);
    expect(playCost(8, 1)).toBe(2);
  });

  it('playCardFromHand は focus を消費し cardEffects を合成する', () => {
    const e = createEngine({
      seed: 'play-card',
      aiEnabled: true,
      deck: [{ defId: 'copilot', level: 1 }],
    });
    const before = e.snapshot();
    expect(before.sprint.cardPiles.hand).toHaveLength(1);
    expect(before.sprint.cardEffects.codingSpeedMul).toBe(1);
    const outcome = e.playCard(before.sprint.cardPiles.hand[0]!);
    expect(outcome.ok).toBe(true);
    const after = e.snapshot();
    expect(after.sprint.focus).toBeLessThan(before.sprint.focus);
    expect(after.sprint.cardEffects.codingSpeedMul).toBeGreaterThan(1);
    expect(after.sprint.cardPiles.hand).toHaveLength(0);
    expect(after.sprint.cardPiles.played).toEqual([0]);
  });
  it('強化後の再発動は加算系の差分だけを適用する', () => {
    const e = createEngine({
      seed: 'baseline-upgrade',
      aiEnabled: true,
      deck: [{ defId: 'auto-test', level: 1 }],
    });
    const deckIndex = e.snapshot().sprint.cardPiles.hand[0]!;
    expect(e.playCard(deckIndex).ok).toBe(true);
    const afterFirst = e.snapshot().org.quality;

    // 次スプリントへ進め、強化して再発動。
    while (!e.isComplete()) e.step(1000);
    e.nextSprint();
    const s = e.snapshot();
    // 加算系 baseline は次スプリントの org に持ち越される。
    expect(s.org.quality).toBe(afterFirst);
    // deck[0] を強化
    (e as unknown as { deck: Array<{ level: number }> }).deck[0]!.level = 2;
    // 手札に戻す（新スプリントで deal 済み）
    const hand = s.sprint.cardPiles.hand;
    expect(hand).toContain(0);
    const beforeSecond = e.snapshot().org.quality;
    expect(e.playCard(0).ok).toBe(true);
    const afterSecond = e.snapshot().org.quality;
    expect(afterFirst).toBeGreaterThan(0);
    expect(afterSecond).toBeGreaterThan(beforeSecond);
  });

  it('migrateBaselineAppliedByTeam はレガシー値を全チームへ写経する', () => {
    const deck: CardInstance[] = [
      { defId: 'auto-test', level: 2, baselineAppliedLevel: 1 },
      { defId: 'copilot', level: 1 },
    ];
    const migrated = migrateBaselineAppliedByTeam(deck, ['product-t0', 'platform-t1']);
    expect(migrated[0]!.baselineAppliedByTeam).toEqual({
      'product-t0': 1,
      'platform-t1': 1,
    });
    expect(migrated[1]!.baselineAppliedByTeam).toBeUndefined();
  });

  it('baselineAppliedLevelFor はマップ未作成時のみレガシー値を使う', () => {
    const legacy: CardInstance = {
      defId: 'auto-test',
      level: 2,
      baselineAppliedLevel: 1,
    };
    expect(baselineAppliedLevelFor(legacy, 'platform-t1')).toBe(1);
    const mapped: CardInstance = {
      defId: 'auto-test',
      level: 2,
      baselineAppliedLevel: 1,
      baselineAppliedByTeam: { 'product-t0': 1 },
    };
    expect(baselineAppliedLevelFor(mapped, 'product-t0')).toBe(1);
    expect(baselineAppliedLevelFor(mapped, 'platform-t1')).toBe(0);
  });
});

describe('ドラフト抽選（第7.1）', () => {
  it('同一 seed なら同じ 3 枚、重複なし', () => {
    const a = drawDraft(createRng('draft:0'));
    const b = drawDraft(createRng('draft:0'));
    expect(a).toEqual(b);
    expect(a).toHaveLength(3);
    expect(new Set(a).size).toBe(3);
  });

  it('異なる seed では別の組み合わせになりうる', () => {
    const a = drawDraft(createRng('draft:1'));
    const b = drawDraft(createRng('draft:2'));
    expect(a.join() !== b.join()).toBe(true);
  });

  it('allowed 指定時は未解放カードが出ない', () => {
    const allowed = new Set(['copilot', 'auto-test', 'docs']);
    const picked = drawDraft(createRng('draft:filter'), 3, allowed);
    expect(picked).toHaveLength(3);
    expect(picked.every((id) => allowed.has(id))).toBe(true);
  });

  it('allowed 未指定時は従来どおり全カードから抽選する', () => {
    const all = drawDraft(createRng('draft:legacy'));
    expect(all).toHaveLength(3);
  });

  it('優先施策は同一 seed でも出やすくなり、allowed 外には出ない（RI-34⁗）', () => {
    expect(PREFERRED_DRAFT_WEIGHT_MUL).toBeGreaterThan(1);
    const allowed = new Set(['copilot', 'auto-test', 'docs', 'pr-size-limit', 'ai-guideline']);
    const preferred = new Set(['docs']);
    let plainHits = 0;
    let preferredHits = 0;
    for (let i = 0; i < 200; i += 1) {
      const plain = drawDraft(createRng(`bias:${i}`), 3, allowed);
      const biased = drawDraft(createRng(`bias:${i}`), 3, allowed, preferred);
      if (plain.includes('docs')) plainHits += 1;
      if (biased.includes('docs')) preferredHits += 1;
      expect(biased.every((id) => allowed.has(id))).toBe(true);
      expect(biased).not.toContain('devin');
    }
    expect(preferredHits).toBeGreaterThan(plainHits);
    // 決定論: 同じ入力は同じ結果
    expect(drawDraft(createRng('bias:0'), 3, allowed, preferred)).toEqual(
      drawDraft(createRng('bias:0'), 3, allowed, preferred),
    );
  });
});

describe('デッキで結果が変わる（DoD: 手札発動で効果が出る / RI-30）', () => {
  function run(deck: CardInstance[], playAll = true): SprintResult {
    const e: Engine = createEngine({ seed: 'deck-cmp', aiEnabled: true, deck });
    if (playAll) {
      // 手札をすべて発動してからスプリントを進める。
      while (true) {
        const hand = e.snapshot().sprint.cardPiles.hand;
        if (hand.length === 0) break;
        const outcome = e.playCard(hand[0]!);
        if (!outcome.ok) break;
      }
    }
    let guard = 0;
    while (!e.isComplete() && guard < 100_000) {
      e.step(1000);
      guard += 1;
    }
    return e.result();
  }

  it('カードを発動するとリザルトが変わる', () => {
    const base = run([]);
    const carded = run([{ defId: 'auto-test', level: 1 }]);
    const differs =
      base.delivered !== carded.delivered ||
      base.rework !== carded.rework ||
      base.incidents !== carded.incidents ||
      base.reviewQueueMax !== carded.reviewQueueMax;
    expect(differs).toBe(true);
  });

  it('未発動のデッキは結果に影響しない', () => {
    const base = run([]);
    const held = run([{ defId: 'auto-test', level: 1 }], false);
    expect(held).toEqual(base);
  });

  it('同一デッキ・同一 seed・同一発動なら完全再現する', () => {
    const a = run([{ defId: 'copilot', level: 1 }]);
    const b = run([{ defId: 'copilot', level: 1 }]);
    expect(a).toEqual(b);
  });
});

describe('ドラフト → 次スプリントの周回（第7.1 / engine.nextSprint）', () => {
  it('完了時に 3 枚のドラフトが提示され、選ぶとデッキ・スプリントが進む', () => {
    const e = createEngine({ seed: 'progress', aiEnabled: true });
    let guard = 0;
    while (!e.isComplete() && guard < 100_000) {
      e.step(1000);
      guard += 1;
    }
    const completed = e.snapshot();
    expect(completed.draft).not.toBeNull();
    expect(completed.draft).toHaveLength(3);

    const picked = completed.draft![0];
    e.nextSprint(picked);
    const next = e.snapshot();

    expect(next.sprintIndex).toBe(1);
    expect(next.deck).toEqual([{ defId: picked, level: 1 }]);
    expect(next.sprint.complete).toBe(false);
    expect(next.draft).toBeNull();
    // 集中力はスプリントごとに満タンへ回復する（第6.2）。
    expect(next.sprint.focus).toBe(next.sprint.config.focusMax);
    // 累積（出荷ポイント）は引き継ぐ。
    expect(next.org.deliveryScore).toBe(completed.org.deliveryScore);
  });
});
