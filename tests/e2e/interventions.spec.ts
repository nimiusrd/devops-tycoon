import { expect, test } from '@playwright/test';
import type { InterventionOutcome } from '../../src/sim/types';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
    dispatch(id: string): InterventionOutcome;
  };
};

test('割り込みレビューを発動すると Review 渋滞が捌ける（第6.1 / DoD）', async ({ page }) => {
  await page.goto('/?seed=ops');

  const before = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'ops');
    g.beginSetupSprint();
    let guard = 0;
    let s = g.getState();
    while (guard < 4000) {
      s = g.step(100);
      if (!s.sprint || s.sprint.complete) break;
      const q = s.sprint.tasks.filter((t) => t.lane === 'review').length;
      if (q >= 4) return { queue: q, focus: s.sprint.focus };
      guard += 1;
    }
    const q = s.sprint ? s.sprint.tasks.filter((t) => t.lane === 'review').length : 0;
    return { queue: q, focus: s.sprint?.focus ?? 0 };
  });
  expect(before.queue).toBeGreaterThanOrEqual(4);

  const after = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    const outcome = g.dispatch('interruptReview');
    const s = g.getState();
    return {
      ok: outcome.ok,
      queue: s.sprint!.tasks.filter((t) => t.lane === 'review').length,
      focus: s.sprint!.focus,
    };
  });

  expect(after.ok).toBe(true);
  expect(after.queue).toBeLessThan(before.queue);
  expect(after.focus).toBe(before.focus - 3);
});

test('スプリント盤面に集中力と介入アクションバーが並ぶ', async ({ page }) => {
  await page.goto('/?seed=bar');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();

  await expect(page.getByTestId('action-bar')).toBeVisible();
  await expect(page.getByTestId('focus')).toContainText('⚡');
  for (const id of ['interruptReview', 'firefight', 'overtime', 'andon']) {
    await expect(page.getByTestId(`action-${id}`)).toBeVisible();
  }
});
