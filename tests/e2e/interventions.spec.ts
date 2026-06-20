import { expect, test } from '@playwright/test';
import type { InterventionOutcome, SimState } from '../../src/sim/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): SimState;
    step(ms: number): SimState;
    loadState(seed: string, scenario?: string, aiEnabled?: boolean): SimState;
    dispatch(id: string): InterventionOutcome;
    isComplete(): boolean;
  };
};

test('割り込みレビューを発動すると Review 渋滞が捌ける（第6.1 / DoD）', async ({ page }) => {
  await page.goto('/?seed=ops');

  // Review キューが溜まるまで手動で前進させる（決定論・一時停止）。
  const before = await page.evaluate(
    ([queueTarget]) => {
      const g = (window as GameWindow).game!;
      g.pause();
      g.loadState('ops', 'default', true);
      let guard = 0;
      let s = g.getState();
      while (guard < 4000 && !g.isComplete()) {
        s = g.step(100);
        const q = s.sprint.tasks.filter((t) => t.lane === 'review').length;
        if (q >= queueTarget) return { queue: q, focus: s.sprint.focus };
        guard += 1;
      }
      return {
        queue: s.sprint.tasks.filter((t) => t.lane === 'review').length,
        focus: s.sprint.focus,
      };
    },
    [4],
  );
  expect(before.queue).toBeGreaterThanOrEqual(4);

  const after = await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    const outcome = g.dispatch('interruptReview');
    const s = g.getState();
    return {
      ok: outcome.ok,
      queue: s.sprint.tasks.filter((t) => t.lane === 'review').length,
      focus: s.sprint.focus,
    };
  });

  expect(after.ok).toBe(true);
  expect(after.queue).toBeLessThan(before.queue);
  expect(after.focus).toBe(before.focus - 3);
});

test('集中力が UI に表示され、アクションバーが並ぶ', async ({ page }) => {
  await page.goto('/?seed=bar');
  await expect(page.getByTestId('action-bar')).toBeVisible();
  await expect(page.getByTestId('focus')).toContainText('⚡');
  for (const id of ['interruptReview', 'firefight', 'overtime', 'andon']) {
    await expect(page.getByTestId(`action-${id}`)).toBeVisible();
  }
});

test('スプリント後のドラフトでカードを選ぶとデッキが育つ（第7章 / DoD）', async ({ page }) => {
  await page.goto('/?seed=draftrun');

  // 1 スプリントを自動進行してリザルトへ。
  await expect(page.getByTestId('sprint-result')).toBeVisible({ timeout: 20000 });

  // デッキは最初は空。
  await expect(page.getByTestId('deck')).toContainText('まだカードがありません');

  // リザルト → ドラフトへ。
  await page.getByTestId('result-continue').click();
  const draft = page.getByTestId('draft');
  await expect(draft).toBeVisible();

  // 提示された 3 枚から 1 枚を選ぶ。
  const cards = draft.locator('[data-testid^="draft-card-"]');
  await expect(cards).toHaveCount(3);
  await cards.first().click();

  // デッキが 1 枚に増え、スプリント番号が 2 に進む。
  await expect(page.getByTestId('deck').locator('[data-testid^="deck-card-"]')).toHaveCount(1);
  await expect(page.getByTestId('sprint-no')).toContainText('2');
});
