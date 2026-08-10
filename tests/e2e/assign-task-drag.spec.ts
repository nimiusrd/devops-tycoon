/**
 * RI-30: タスク差配の対象指定 / 手札発動の E2E。
 */
import { expect, test } from './fixtures';
import type { ActionTarget, CardPlayOutcome, InterventionOutcome } from '../../src/sim/types';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
    dispatch(id: string, target?: ActionTarget): InterventionOutcome;
    playCard(deckIndex: number): CardPlayOutcome;
    engine: {
      deck: Array<{ defId: string; level: number }>;
      sprint: { focus: number } | null;
    };
  };
};

test('タスク差配は taskId 指定で対象を進められる（RI-30）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri30-assign');

  const result = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ri30-assign');
    g.beginSetupSprint();
    let guard = 0;
    let s = g.getState();
    while (guard < 2000) {
      const coding = s.sprint?.tasks.filter((t) => t.lane === 'coding') ?? [];
      if (coding.length > 0) break;
      s = g.step(100);
      guard += 1;
    }
    const target = s.sprint!.tasks.find((t) => t.lane === 'coding')!;
    const beforeProgress = target.progress;
    const beforeMorale = s.org.morale;
    const outcome = g.dispatch('assignTask', {
      taskId: target.id,
      lane: 'coding',
      assignee: 'senior',
    });
    const after = g.getState();
    const afterTask = after.sprint!.tasks.find((t) => t.id === target.id)!;
    return {
      ok: outcome.ok,
      affected: outcome.effect?.affectedTaskIds,
      beforeProgress,
      afterProgress: afterTask.progress,
      moraleDropped: after.org.morale < beforeMorale,
    };
  });

  expect(result.ok).toBe(true);
  expect(result.affected?.[0]).toEqual(expect.any(Number));
  expect(result.afterProgress).toBeGreaterThan(result.beforeProgress);
  expect(result.moraleDropped).toBe(true);
});

test('手札カードを発動すると focus と cardEffects が変わる（RI-30）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri30-hand');

  const result = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ri30-hand');
    g.engine.deck.push({ defId: 'copilot', level: 1 });
    g.beginSetupSprint();
    const before = g.getState();
    const hand = before.sprint?.cardPiles.hand ?? [];
    const focusBefore = before.sprint!.focus;
    const speedBefore = before.sprint!.cardEffects.codingSpeedMul;
    const play = g.playCard(hand[0]!);
    const after = g.getState();
    return {
      handSize: hand.length,
      ok: play.ok,
      focusBefore,
      focusAfter: after.sprint?.focus ?? 0,
      speedBefore,
      speedAfter: after.sprint?.cardEffects.codingSpeedMul ?? 1,
      handAfter: after.sprint?.cardPiles.hand.length ?? -1,
    };
  });

  expect(result.handSize).toBe(1);
  expect(result.ok).toBe(true);
  expect(result.focusAfter).toBeLessThan(result.focusBefore);
  expect(result.speedAfter).toBeGreaterThan(result.speedBefore);
  expect(result.handAfter).toBe(0);
});

test('手札カードは明示した集中力費用を表示し、不足時だけ無効になる（RI-78）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri78-hand-cost');

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ri78-hand-cost');
    g.engine.deck.push({ defId: 'copilot', level: 1 });
    g.beginSetupSprint();
    g.engine.sprint!.focus = 1;
    g.playCard(-1); // UI の再描画だけを起こす
  });

  const card = page.getByTestId('hand-card-copilot');
  await expect(card).toContainText('⚡2');
  await expect(card).toBeDisabled();
});

test('ActionBar でタスク差配を武装できる（RI-30）', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=ri30-arm');

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ri30-arm');
    g.beginSetupSprint();
    let guard = 0;
    let s = g.getState();
    while (guard < 2000) {
      const coding = s.sprint?.tasks.filter((t) => t.lane === 'coding') ?? [];
      if (coding.length > 0) break;
      s = g.step(100);
      guard += 1;
    }
  });

  const assign = page.getByTestId('action-assignTask');
  await expect(assign).toBeVisible();
  if (await assign.isEnabled()) {
    await assign.click();
    await expect(assign).toHaveAttribute('data-armed', 'true');
    await expect(page.getByTestId('board')).toHaveAttribute('data-armed', 'assignTask');
  }
});
