/**
 * RI-91-C4: src/sim/engine.ts の Survived mutation と
 * dispatch / playCard / nextSprint の副作用を exact 断言で潰す。
 * 共有の engine.test.ts / sprint.test.ts は触らない。
 */
import { describe, expect, it } from 'vitest';
import { getAction } from '../../src/data/actions';
import { getCard } from '../../src/data/cards';
import { dealHand, drawDraft, playCost } from '../../src/sim/cards';
import { createEngine, type Engine } from '../../src/sim/engine';
import { createOrgState } from '../../src/sim/org';
import { createRng } from '../../src/sim/rng';

/** sprint.test.ts と同様、完走待ちに上限を置きハングを防ぐ。 */
function runToComplete(engine: Engine, maxSteps = 100_000): void {
  let guard = 0;
  while (!engine.isComplete() && guard < maxSteps) {
    engine.step(1000);
    guard += 1;
  }
  expect(engine.isComplete()).toBe(true);
}

describe('RI-91-C4 engine survived mutants', () => {
  describe('既定値', () => {
    it('createEngine({}) は scenario=default / aiEnabled=false / aiDependency=3', () => {
      const s = createEngine({}).snapshot();
      expect(s.scenario).toBe('default');
      expect(s.aiEnabled).toBe(false);
      expect(s.org.aiDependency).toBe(3);
      expect(s.org).toMatchObject(createOrgState('default', false));
    });
  });

  describe('dispatch focus exact', () => {
    it('overtime は focus / focusSpent / effect.focusCost を exact に更新する', () => {
      const e = createEngine({ seed: 'ri-91-c4-dispatch', fixedStepMs: 100 });
      const def = getAction('overtime')!;
      expect(def.cost).toBe(4);
      const before = e.snapshot();
      expect(before.sprint.focus).toBe(before.sprint.config.focusMax);
      const outcome = e.dispatch('overtime');
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const after = e.snapshot();
      expect(after.sprint.focus).toBe(before.sprint.config.focusMax - def.cost);
      expect(after.sprint.metrics.focusSpent).toBe(def.cost);
      expect(outcome.effect.focusCost).toBe(def.cost);
    });
  });

  describe('playCard focus / org exact', () => {
    it('auto-test は playCost・focus・quality を exact に更新する', () => {
      const e = createEngine({
        seed: 'ri-91-c4-play',
        aiEnabled: true,
        deck: [{ defId: 'auto-test', level: 1 }],
        fixedStepMs: 100,
      });
      const def = getCard('auto-test')!;
      const cost = playCost(def.cost, 1);
      expect(cost).toBe(5);
      expect(def.base.qualityAdd).toBe(10);

      const before = e.snapshot();
      expect(before.sprint.cardPiles.hand).toEqual([0]);
      const outcome = e.playCard(0);
      expect(outcome.ok).toBe(true);
      const after = e.snapshot();
      expect(after.sprint.focus).toBe(before.sprint.focus - cost);
      expect(after.sprint.metrics.focusSpent).toBe(cost);
      expect(after.org.quality).toBe(before.org.quality + 10);
    });
  });

  describe('deal / draft seed', () => {
    it('初期 cardPiles は seed:deal:0 の dealHand と一致する', () => {
      const seed = 'ri-91-c4-deal';
      const deckLen = 3;
      const e = createEngine({
        seed,
        deck: [
          { defId: 'auto-test', level: 1 },
          { defId: 'copilot', level: 1 },
          { defId: 'docs', level: 1 },
        ],
      });
      expect(e.snapshot().sprint.cardPiles).toEqual(dealHand(deckLen, createRng(`${seed}:deal:0`)));
    });

    it('完走後の draft / draftOptions は seed:draft:index と一致する', () => {
      const seed = 'ri-91-c4-draft';
      const e = createEngine({ seed, aiEnabled: true, fixedStepMs: 100 });
      runToComplete(e);
      const s = e.snapshot();
      const expected = drawDraft(createRng(`${seed}:draft:${s.sprintIndex}`));
      expect(s.draft).toEqual(expected);
      expect(e.draftOptions()).toEqual(expected);
      expect(expected).toHaveLength(3);
    });
  });

  describe('nextSprint', () => {
    it('引数省略では deck に push せず index だけ進む', () => {
      const e = createEngine({
        seed: 'ri-91-c4-skip',
        deck: [{ defId: 'copilot', level: 1 }],
        fixedStepMs: 100,
      });
      runToComplete(e);
      const beforeDeck = e.snapshot().deck;
      expect(beforeDeck).toEqual([{ defId: 'copilot', level: 1 }]);
      e.nextSprint();
      const after = e.snapshot();
      expect(after.deck).toEqual([{ defId: 'copilot', level: 1 }]);
      expect(after.sprintIndex).toBe(1);
      expect(after.tick).toBe(0);
      expect(after.elapsedMs).toBe(0);
      expect(after.draft).toBeNull();
      expect(after.sprint.focus).toBe(after.sprint.config.focusMax);
      expect(after.sprint.cardPiles).toEqual(dealHand(1, createRng('ri-91-c4-skip:deal:1')));
    });

    it('pick ありは deck push・org carry・非 carry リセット・focus 全快', () => {
      const seed = 'ri-91-c4-carry';
      const e = createEngine({
        seed,
        aiEnabled: true,
        deck: [{ defId: 'auto-test', level: 1 }],
        fixedStepMs: 100,
      });
      expect(e.playCard(0).ok).toBe(true);
      runToComplete(e);
      const before = e.snapshot();
      expect(before.org.quality).toBeGreaterThan(createOrgState('default', true).quality);

      const picked = before.draft![0]!;
      e.nextSprint(picked);
      const after = e.snapshot();
      const fresh = createOrgState('default', true);

      expect(after.deck).toEqual([
        { defId: 'auto-test', level: 1, baselineAppliedLevel: 1 },
        { defId: picked, level: 1 },
      ]);
      expect(after.sprintIndex).toBe(1);
      // carry
      expect(after.org.deliveryScore).toBe(before.org.deliveryScore);
      expect(after.org.techDebt).toBe(before.org.techDebt);
      expect(after.org.aiLiteracy).toBe(before.org.aiLiteracy);
      expect(after.org.aiDependency).toBe(before.org.aiDependency);
      expect(after.org.quality).toBe(before.org.quality);
      expect(after.org.testCoverage).toBe(before.org.testCoverage);
      // non-carry reset
      expect(after.org.morale).toBe(fresh.morale);
      expect(after.org.seniorHp).toBe(fresh.seniorHp);
      expect(after.org.documentation).toBe(fresh.documentation);
      expect(after.sprint.focus).toBe(after.sprint.config.focusMax);
      expect(after.sprint.cardPiles).toEqual(dealHand(2, createRng(`${seed}:deal:1`)));
      expect(after.draft).toBeNull();
    });
  });

  describe('load', () => {
    it('load 後の deck は exact 空配列', () => {
      const e = createEngine({
        seed: 'ri-91-c4-load-a',
        deck: [
          { defId: 'auto-test', level: 1 },
          { defId: 'copilot', level: 2 },
        ],
      });
      expect(e.snapshot().deck).toHaveLength(2);
      e.load('ri-91-c4-load-b');
      const s = e.snapshot();
      expect(s.deck).toEqual([]);
      expect(s.seed).toBe('ri-91-c4-load-b');
      expect(s.sprintIndex).toBe(0);
      expect(s.tick).toBe(0);
    });
  });
});
