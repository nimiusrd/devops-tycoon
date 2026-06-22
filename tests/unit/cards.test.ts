import { describe, expect, it } from 'vitest';
import {
  applyDeckBaseline,
  deckEffects,
  drawDraft,
  scaleEffects,
  upgradeCard,
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

  it('AI利用ガイドラインは開始時 AI Literacy を底上げする', () => {
    const o = org({ aiLiteracy: 40 });
    applyDeckBaseline(o, deckEffects([{ defId: 'ai-guideline', level: 1 }]));
    expect(o.aiLiteracy).toBe(55);
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

  it('未知カードは効果に影響しない（無効果へフォールバック）', () => {
    const effects = deckEffects([{ defId: 'does-not-exist', level: 1 }]);
    expect(effects.codingSpeedMul).toBe(1);
    expect(effects.reworkRateAdd).toBe(0);
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
});

describe('デッキで結果が変わる（DoD: ドラフトでデッキが育つ）', () => {
  function run(deck: CardInstance[]): SprintResult {
    const e: Engine = createEngine({ seed: 'deck-cmp', aiEnabled: true, deck });
    let guard = 0;
    while (!e.isComplete() && guard < 100_000) {
      e.step(1000);
      guard += 1;
    }
    return e.result();
  }

  it('カードの有無でリザルトが変わる', () => {
    const base = run([]);
    const carded = run([{ defId: 'auto-test', level: 1 }]);
    const differs =
      base.delivered !== carded.delivered ||
      base.rework !== carded.rework ||
      base.incidents !== carded.incidents ||
      base.reviewQueueMax !== carded.reviewQueueMax;
    expect(differs).toBe(true);
  });

  it('同一デッキ・同一 seed なら完全再現する', () => {
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
