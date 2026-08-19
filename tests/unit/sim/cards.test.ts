import { describe, expect, it } from 'vitest';
import { CARD_DEFS } from '../../../src/data/cards';
import { CARD_BALANCE } from '../../../src/data/balance';
import {
  applyDeckBaseline,
  baselineAppliedLevelFor,
  clampCardEffects,
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
  emptyCardPiles,
  inheritBaselineAppliedForTeams,
  playCardFromHand,
} from '../../../src/sim/cards';
import { IDENTITY_CARD_EFFECTS, reworkProbability } from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import { createRng } from '../../../src/sim/rng';
import { createEngine, type Engine } from '../../../src/sim/engine';
import type { CardInstance, OrgState, SprintResult, Task } from '../../../src/sim/types';
import { createSprint, resolveSprintConfig } from '../../../src/sim/sprint';

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
    expect(o.aiLiteracy).toBe(60);
    expect(o.aiDependency).toBe(37);
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

  it('dealHand は preferIndices を手札へ優先する（RI-78）', () => {
    const piles = dealHand(6, createRng('deal:prefer'), HAND_SIZE, [5, 1]);
    expect(piles.hand.slice(0, 2)).toEqual([5, 1]);
    expect(piles.hand).toHaveLength(HAND_SIZE);
    expect(new Set([...piles.hand, ...piles.drawOrder]).size).toBe(6);
  });

  it('playCost は明示した focusCost を使い、強化で下がる', () => {
    expect(playCost(2, 1)).toBe(2);
    expect(playCost(3, 2)).toBe(2);
    expect(playCost(4, 1)).toBe(4);
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

  it('migrateBaselineAppliedByTeam は部分マップの不足 ID をレガシーで埋めない', () => {
    const deck: CardInstance[] = [
      {
        defId: 'auto-test',
        level: 2,
        baselineAppliedLevel: 1,
        // v2 で特定チームにだけ発動済みの状態。
        baselineAppliedByTeam: { 'product-t2': 1 },
      },
    ];
    const migrated = migrateBaselineAppliedByTeam(deck, [
      'product-t0',
      'product-t2',
      'platform-t1',
    ]);
    expect(migrated[0]!.baselineAppliedByTeam).toEqual({ 'product-t2': 1 });
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

describe('RI-91-C3 cards NoCoverage / Survived mutants', () => {
  describe('emptyCardPiles', () => {
    it('4 山すべて空配列の山を返す', () => {
      expect(emptyCardPiles()).toEqual({
        drawOrder: [],
        hand: [],
        discard: [],
        played: [],
      });
    });
  });

  describe('playCardFromHand 失敗経路', () => {
    const org = () => createOrgState('default', true);
    const baseSprint = () => createSprint(resolveSprintConfig('default'), org(), () => 0.5);

    it('complete スプリントは reason complete で拒否する', () => {
      const sprint = baseSprint();
      sprint.complete = true;
      sprint.cardPiles.hand = [0];
      const deck: CardInstance[] = [{ defId: 'copilot', level: 1 }];
      expect(playCardFromHand(sprint, org(), deck, 0)).toEqual({
        ok: false,
        reason: 'complete',
      });
    });

    it('手札に無い deckIndex は reason no-card で拒否する', () => {
      const sprint = baseSprint();
      sprint.cardPiles.hand = [0];
      const deck: CardInstance[] = [{ defId: 'copilot', level: 1 }];
      expect(playCardFromHand(sprint, org(), deck, 1)).toEqual({
        ok: false,
        reason: 'no-card',
      });
    });

    it('deck 欠落は reason invalid で拒否する', () => {
      const sprint = baseSprint();
      sprint.cardPiles.hand = [0];
      const deck: CardInstance[] = [];
      expect(playCardFromHand(sprint, org(), deck, 0)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });

    it('未知 defId は reason invalid で拒否する', () => {
      const sprint = baseSprint();
      sprint.cardPiles.hand = [0];
      const deck: CardInstance[] = [{ defId: 'does-not-exist', level: 1 }];
      expect(playCardFromHand(sprint, org(), deck, 0)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    });
  });

  describe('migrateBaselineAppliedByTeam / inheritBaselineAppliedForTeams', () => {
    it('空の teamIds は同一参照を返す', () => {
      const deck: CardInstance[] = [{ defId: 'auto-test', level: 2, baselineAppliedLevel: 1 }];
      expect(migrateBaselineAppliedByTeam(deck, [])).toBe(deck);
    });

    it('空の newTeamIds は同一参照を返す', () => {
      const deck: CardInstance[] = [
        { defId: 'auto-test', level: 2, baselineAppliedByTeam: { home: 1 } },
      ];
      expect(inheritBaselineAppliedForTeams(deck, 'home', [])).toBe(deck);
    });

    it('inherited===0 のカードは不変（<=0 ガード）', () => {
      const deck: CardInstance[] = [
        { defId: 'copilot', level: 1 },
        { defId: 'auto-test', level: 2, baselineAppliedByTeam: { home: 0 } },
      ];
      const next = inheritBaselineAppliedForTeams(deck, 'home', ['spawn']);
      expect(next[0]).toBe(deck[0]);
      expect(next[1]).toBe(deck[1]);
      expect(next[0]!.baselineAppliedByTeam).toBeUndefined();
      expect(next[1]!.baselineAppliedByTeam).toEqual({ home: 0 });
    });

    it('正の inherited を新チームへ Math.max で継承する', () => {
      const deck: CardInstance[] = [
        {
          defId: 'auto-test',
          level: 3,
          baselineAppliedByTeam: { home: 2, spawn: 3 },
        },
      ];
      const next = inheritBaselineAppliedForTeams(deck, 'home', ['spawn', 'other']);
      expect(next[0]!.baselineAppliedByTeam).toEqual({
        home: 2,
        spawn: 3, // 既存 3 > inherited 2
        other: 2,
      });
      expect(next[0]).not.toBe(deck[0]);
    });
  });

  describe('upgradeCard / upgradeCardAt', () => {
    it('upgradeCard は先頭一致の defId だけを強化する', () => {
      const deck: CardInstance[] = [
        { defId: 'copilot', level: 1 },
        { defId: 'auto-test', level: 1 },
        { defId: 'auto-test', level: 1 },
      ];
      const next = upgradeCard(deck, 'auto-test');
      expect(next[0]!.level).toBe(1);
      expect(next[0]!.defId).toBe('copilot');
      expect(next[1]!.level).toBe(2);
      expect(next[2]!.level).toBe(1);
    });

    it('upgradeCardAt は範囲外 index で同一参照を返す', () => {
      const deck: CardInstance[] = [
        { defId: 'copilot', level: 1 },
        { defId: 'auto-test', level: 1 },
      ];
      expect(upgradeCardAt(deck, -1)).toBe(deck);
      expect(upgradeCardAt(deck, deck.length)).toBe(deck);
      expect(upgradeCardAt(deck, deck.length + 1)).toBe(deck);
      expect(deck[0]!.level).toBe(1);
      expect(deck[1]!.level).toBe(1);
    });
  });

  describe('playCost / scaleEffects exact', () => {
    it('playCost は明示 focusCost と強化減・下限1を固定する', () => {
      expect(playCost(2, 1)).toBe(2);
      expect(playCost(3, 1)).toBe(3);
      expect(playCost(3, 4)).toBe(1); // base 3 - 3 → 下限 1
      expect(playCost(4, 1)).toBe(4);
      expect(playCost(0.5, 1)).toBe(1); // 不正な小数も下限1へ
    });

    it('全カードは集中力費用を2〜4で定義し、ショップ価格と分離する', () => {
      expect(CARD_DEFS.every((def) => def.focusCost >= 2 && def.focusCost <= 4)).toBe(true);
      expect(Object.fromEntries(CARD_DEFS.map((def) => [def.id, def.focusCost]))).toEqual({
        copilot: 2,
        'pr-size-limit': 2,
        docs: 2,
        'static-analysis': 2,
        'feature-flags': 2,
        'pair-programming': 2,
        'auto-test': 3,
        'claude-code': 3,
        'ai-guideline': 3,
        'review-bot': 3,
        'code-owners': 3,
        devin: 4,
        'hire-senior': 4,
      });
      // RI-78: 出荷正側カードの店頭価格を抑える。
      expect(CARD_DEFS.find((def) => def.id === 'copilot')?.cost).toBe(1);
      expect(CARD_DEFS.find((def) => def.id === 'claude-code')?.cost).toBe(4);
      expect(CARD_DEFS.find((def) => def.id === 'feature-flags')?.cost).toBe(1);
    });

    it('scaleEffects はレベル係数 k=1+0.5*max(0,level-1) を exact で返す', () => {
      expect(scaleEffects({ codingSpeedMul: 1.15 }, 1).codingSpeedMul).toBe(1.15);
      expect(scaleEffects({ codingSpeedMul: 1.15 }, 0).codingSpeedMul).toBe(1.15); // level<=1 → k=1
      // 1 + (1.15-1)*1.5 — IEEE754 で 1.224999… になるため式で固定する
      expect(scaleEffects({ codingSpeedMul: 1.15 }, 2).codingSpeedMul).toBe(1 + (1.15 - 1) * 1.5);
      expect(scaleEffects({ qualityAdd: 10 }, 2).qualityAdd).toBe(15);
      expect(scaleEffects({ qualityAdd: 10 }, 1).qualityAdd).toBe(10);
    });

    it('clampCardEffects は乗算・Rework加算・その他加算をレジストリ境界へ収める', () => {
      const over = clampCardEffects({
        ...IDENTITY_CARD_EFFECTS,
        codingSpeedMul: 10,
        reviewEfficiencyMul: 0.01,
        reworkRateAdd: 1,
        qualityAdd: 200,
        aiLiteracyAdd: -200,
      });
      expect(over.codingSpeedMul).toBe(CARD_BALANCE.effectMultiplierMaximum.value);
      expect(over.reviewEfficiencyMul).toBe(CARD_BALANCE.effectMultiplierMinimum.value);
      expect(over.reworkRateAdd).toBe(CARD_BALANCE.effectReworkRateAddMaximum.value);
      expect(over.qualityAdd).toBe(CARD_BALANCE.effectAdditiveMaximum.value);
      expect(over.aiLiteracyAdd).toBe(CARD_BALANCE.effectAdditiveMinimum.value);

      const underRework = clampCardEffects({
        ...IDENTITY_CARD_EFFECTS,
        reworkRateAdd: -1,
      });
      expect(underRework.reworkRateAdd).toBe(CARD_BALANCE.effectReworkRateAddMinimum.value);

      const mid = clampCardEffects({
        ...IDENTITY_CARD_EFFECTS,
        codingSpeedMul: 1.2,
        reworkRateAdd: 0.1,
        qualityAdd: 10,
      });
      expect(mid.codingSpeedMul).toBe(1.2);
      expect(mid.reworkRateAdd).toBe(0.1);
      expect(mid.qualityAdd).toBe(10);
    });
  });
});
