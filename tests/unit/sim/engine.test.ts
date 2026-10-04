import { describe, expect, it } from 'vitest';
import { FIXED_STEP_MS } from '../../../src/data/balance/pacing';
import { getAction } from '../../../src/data/actions';
import { getCard } from '../../../src/data/cards';
import { getDifficulty } from '../../../src/data/difficulties';
import { dealHand, drawDraft, playCost } from '../../../src/sim/cards';
import { createRng } from '../../../src/sim/rng';
import { RunEngine } from '../../../src/sim/run/engine';
import { BETWEEN_SPRINT_RECOVERY } from '../../../src/sim/run/sprintBaselineBuild';
import { finishSprint, setupWithDeck, startWithDeck } from '../helpers/cardLifecycle';
import { playUntil } from '../helpers/runFlow';

// 固定stepと端数の契約はrunEngineTiming.test.tsで検証する（#714）。
// 旧load/nextSprintではなくstartRunとresult→draft→evolution→beat→setupを使う。
describe('RunEngineの入力・スナップショット契約', () => {
  it('同一seed・同一step・dispatch・カード入力列なら同一状態になる', () => {
    const a = startWithDeck('spec-22.3', [{ defId: 'auto-test', level: 1 }]);
    const b = startWithDeck('spec-22.3', [{ defId: 'auto-test', level: 1 }]);
    for (const ms of [100, 250, 50]) {
      a.step(ms);
      b.step(ms);
    }
    const card = a.playCard(0);
    expect(card.ok).toBe(true);
    expect(b.playCard(0)).toEqual(card);
    const action = a.dispatch('overtime');
    expect(action.ok).toBe(true);
    expect(b.dispatch('overtime')).toEqual(action);
    a.step(1_000);
    b.step(1_000);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('startRunでseedを変えるとsetupへ戻り、所持デッキと進行を新規ランへ初期化する', () => {
    const engine = startWithDeck('restart-a', [{ defId: 'auto-test', level: 1 }]);
    expect(engine.playCard(0).ok).toBe(true);
    engine.step(1_000);
    expect(engine.snapshot().sprintTick).toBeGreaterThan(0);
    engine.startRun('easy', [], 'restart-b');
    const fresh = new RunEngine({ seed: 'restart-b', difficulty: 'easy' });
    fresh.startRun();
    expect(engine.snapshot()).toEqual(fresh.snapshot());
    expect(engine.snapshot()).toMatchObject({
      seed: 'restart-b',
      phase: 'setup',
      deck: [],
      sprint: null,
      sprintTick: 0,
      sprintsPlayed: 0,
      sprintIndexInQuarter: 0,
      draft: null,
    });
  });

  it('異なるseedでは実スプリントの乱数由来のタスクが異なる', () => {
    const a = startWithDeck('x');
    const b = startWithDeck('y');
    a.step(1_000);
    b.step(1_000);
    expect(a.snapshot().sprint!.tasks).not.toEqual(b.snapshot().sprint!.tasks);
  });

  it('snapshotのスプリント・組織・デッキ・チーム別適用記録は独立コピー', () => {
    const engine = startWithDeck('snapshot-copy', [{ defId: 'auto-test', level: 1 }]);
    expect(engine.playCard(0).ok).toBe(true);
    const before = engine.snapshot();
    const copy = engine.snapshot();
    copy.sprintTick = 999;
    copy.org.quality = 0;
    copy.sprint!.focus = 0;
    copy.sprint!.tasks[0]!.progress = 999;
    copy.sprint!.cardPiles.played.push(999);
    copy.deck[0]!.level = 999;
    copy.deck[0]!.baselineAppliedByTeam![copy.activeTeamId] = 999;
    copy.teams[0]!.quality = 0;
    expect(engine.snapshot()).toEqual(before);
  });

  it('既定ランはnormal・default・AI導入済みの組織でsetupから始める', () => {
    const engine = new RunEngine();
    expect(engine.currentPhase()).toBe('title');
    engine.startRun();
    const state = engine.snapshot();
    const initial = getDifficulty('normal').org;
    expect(state).toMatchObject({
      difficulty: 'normal',
      scenario: 'default',
      phase: 'setup',
      deck: [],
      sprint: null,
    });
    expect(state.org).toMatchObject({
      aiEnabled: true,
      aiDependency: initial.aiDependencyBase,
      quality: initial.quality,
      morale: initial.morale,
    });
  });
});

describe('RunEngineのカード費用とライフサイクル', () => {
  it('overtimeは集中力・費用集計・効果ペイロードへ同じ費用を反映する', () => {
    const engine = startWithDeck('dispatch-focus');
    const cost = getAction('overtime')!.cost;
    expect(cost).toBe(4);
    const before = engine.snapshot().sprint!;
    const outcome = engine.dispatch('overtime');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const after = engine.snapshot().sprint!;
    expect(after.focus).toBe(before.focus - cost);
    expect(after.metrics.focusSpent).toBe(before.metrics.focusSpent + cost);
    expect(outcome.effect?.focusCost).toBe(cost);
  });

  it('auto-testはplayCost・集中力・集計・品質・チーム別適用レベルを更新する', () => {
    const engine = startWithDeck('play-focus', [{ defId: 'auto-test', level: 1 }]);
    const def = getCard('auto-test')!;
    const cost = playCost(def.focusCost, 1);
    expect(cost).toBe(3);
    expect(def.base.qualityAdd).toBe(10);
    const before = engine.snapshot();
    expect(before.sprint!.cardPiles.hand).toEqual([0]);
    expect(engine.playCard(0)).toEqual({ ok: true, focusCost: cost, deckIndex: 0 });
    const after = engine.snapshot();
    expect(after.sprint!.focus).toBe(before.sprint!.focus - cost);
    expect(after.sprint!.metrics.focusSpent).toBe(before.sprint!.metrics.focusSpent + cost);
    expect(after.org.quality).toBe(before.org.quality + 10);
    expect(after.deck[0]!.baselineAppliedByTeam).toEqual({ [after.activeTeamId]: 1 });
  });

  it('初期配布はseed:deal:q1-s1を使い、ドラフトはresult確認後にseed:draft:完走数で生成する', () => {
    const seed = 'deal-draft';
    const allowed = new Set(['auto-test', 'copilot', 'docs', 'static-analysis']);
    const preferred = new Set(['docs']);
    const engine = setupWithDeck(seed, [
      { defId: 'auto-test', level: 1 },
      { defId: 'copilot', level: 1 },
      { defId: 'docs', level: 1 },
      { defId: 'static-analysis', level: 1 },
      { defId: 'feature-flags', level: 1 },
    ]);
    engine.setUnlockedContent(allowed, new Set());
    engine.setPreferredCards(preferred);
    engine.beginSetupSprint();
    expect(engine.snapshot().sprint!.cardPiles).toEqual(
      dealHand(5, createRng(`${seed}:deal:q1-s1`)),
    );
    finishSprint(engine);
    expect(engine.snapshot().draft).toBeNull();
    expect(engine.snapshot().sprintsPlayed).toBe(1);
    engine.acknowledgeResult();
    expect(engine.currentPhase()).toBe('draft');
    expect(engine.snapshot().draft).toEqual(
      drawDraft(createRng(`${seed}:draft:1`), 3, allowed, preferred),
    );
    expect(engine.snapshot().draft).toHaveLength(3);
  });

  it.each(['pick', 'skip'] as const)(
    '%sはevolutionを経由し、次の編成とスプリントへデッキ・組織を持ち越す',
    (choice) => {
      const seed = `carry-${choice}`;
      const engine = startWithDeck(seed, [{ defId: 'auto-test', level: 1 }]);
      expect(engine.playCard(0).ok).toBe(true);
      engine.step(FIXED_STEP_MS / 2); // 次スプリントに漏れてはいけない端数。
      finishSprint(engine);
      const completed = engine.snapshot();
      engine.acknowledgeResult();
      const draft = engine.snapshot().draft!;
      expect(draft).toHaveLength(3);
      const beforeChoice = engine.snapshot();
      // 候補外の選択は獲得・遷移を起こさない。
      engine.chooseCard('does-not-exist');
      expect(engine.snapshot()).toEqual(beforeChoice);
      if (choice === 'pick') engine.chooseCard(draft[0]!);
      else engine.skipDraft();
      const chosen = engine.snapshot();
      const expectedDeck =
        choice === 'pick' ? [...completed.deck, { defId: draft[0]!, level: 1 }] : completed.deck;
      expect(chosen.phase).toBe('evolution');
      expect(chosen.draft).toBeNull();
      expect(chosen.deck).toEqual(expectedDeck);
      expect(chosen.org).toEqual(completed.org); // 獲得時は未発動なので無効果。
      expect(chosen.sprintIndexInQuarter).toBe(1);
      engine.chooseCard(draft[0]!);
      engine.skipDraft();
      expect(engine.snapshot()).toEqual(chosen);

      // ビートは組織を変えうるため、次のsetup時点を持越しの基準にする。
      expect(playUntil(engine, 'setup').phase).toBe('setup');
      const setup = engine.snapshot();
      expect(setup.deck).toEqual(expectedDeck);
      expect(setup.org.quality).toBe(completed.org.quality);
      expect(setup.org.deliveryScore).toBe(completed.org.deliveryScore);
      engine.beginSetupSprint();
      const next = engine.snapshot();
      expect(next.phase).toBe('sprint');
      expect(next.currentSprintId).toBe('q1-s2');
      expect(next.sprintIndexInQuarter).toBe(2);
      expect(next.sprintTick).toBe(0);
      expect(next.draft).toBeNull();
      expect(next.sprint!.complete).toBe(false);
      expect(next.sprint!.focus).toBe(next.sprint!.config.focusMax);
      expect(next.sprint!.metrics.focusSpent).toBe(0);
      expect(next.deck).toEqual(expectedDeck);
      // 旧Engineの非carry全リセットと異なり、orgは持続しシニアHPだけ部分回復する。
      expect(next.org).toEqual({
        ...setup.org,
        seniorHp: setup.org.seniorHp + (100 - setup.org.seniorHp) * BETWEEN_SPRINT_RECOVERY,
      });
      expect(next.sprint!.cardPiles).toEqual(
        dealHand(expectedDeck.length, createRng(`${seed}:deal:q1-s2`)),
      );
      engine.step(FIXED_STEP_MS - 1);
      expect(engine.snapshot()).toEqual(next);
      engine.step(1);
      expect(engine.snapshot().sprintTick).toBe(1);
    },
  );
});
