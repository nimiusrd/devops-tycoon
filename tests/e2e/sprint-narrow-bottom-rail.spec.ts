/**
 * 320×568 で集中力・介入入口と手札1枚をスクロールなしで同時に見せる（#904）。
 */
import { beginPublicSprint, expect, test } from './fixtures';

test.describe('320×568 の下端パネル入れ替え（#904）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await beginPublicSprint(page, { seed: 'devops-tycoon', renderer: 'pixi' });
    await page.evaluate(() => {
      const layout = document.querySelector('[data-testid="sprint-layout"]') as HTMLElement | null;
      if (layout) layout.scrollTop = 0;
      window.scrollTo(0, 0);
    });
  });

  test('初期表示で集中力と介入入口が viewport 内にある', async ({ page }) => {
    await expect(page.getByTestId('sprint-layout')).toHaveAttribute(
      'data-sprint-bottom-rail',
      'deck',
    );
    await expect(page.getByTestId('sprint-layout')).toHaveJSProperty('scrollTop', 0);
    await expect(page.getByTestId('focus')).toBeInViewport();
    await expect(page.getByTestId('sprint-bottom-rail-expand-interventions')).toBeInViewport();
    await expect(
      page.locator('[data-testid="action-bar"] .actions .action').first(),
    ).toBeInViewport();
  });

  test('介入をすべて見るで deck が1行に畳まれる', async ({ page }) => {
    await page.getByTestId('sprint-bottom-rail-expand-interventions').click();
    await expect(page.getByTestId('sprint-layout')).toHaveAttribute(
      'data-sprint-bottom-rail',
      'controls',
    );
    await expect(page.getByTestId('sprint-bottom-rail-expand-deck')).toBeInViewport();
    await expect(page.getByTestId('deck').locator('.deckbar-cards')).toBeHidden();
  });

  test('武装時は controls へ切り替わり盤面と一覧が共存する', async ({ page }) => {
    const reached = await page.evaluate(() => {
      const game = window.game;
      if (!game) throw new Error('window.game がない');
      const count = () => {
        const sprint = game.getState().sprint;
        if (!sprint) return 0;
        return sprint.tasks.filter(
          (task) => (task.lane === 'review' || task.lane === 'coding') && !task.split,
        ).length;
      };
      let guard = 0;
      while (game.getState().phase === 'sprint' && guard < 8000) {
        if (count() === 7) {
          game.pause();
          return 7;
        }
        guard += 1;
        game.step(80);
      }
      game.pause();
      throw new Error('分割候補が7件に到達しない');
    });
    expect(reached).toBe(7);
    await page.getByTestId('sprint-bottom-rail-expand-interventions').click();
    await expect(page.getByTestId('action-splitPr')).toBeEnabled();
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="action-splitPr"]')?.click();
    });
    await expect(page.getByTestId('board')).toHaveAttribute('data-armed', 'splitPr');
    await expect(page.getByTestId('sprint-layout')).toHaveAttribute(
      'data-sprint-bottom-rail',
      'controls',
    );
    await expect(page.getByTestId('action-target-picker')).toBeVisible();
    await expect(page.getByTestId('sprint-layout')).toHaveJSProperty('scrollTop', 0);
    const visibility = await page.evaluate(() => {
      const vh = window.innerHeight;
      const visible = (rect: DOMRect | undefined) =>
        rect == null ? 0 : Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      const board = document.querySelector('[data-testid="board"]')?.getBoundingClientRect();
      const picker = document
        .querySelector('[data-testid="action-target-picker"]')
        ?.getBoundingClientRect();
      return {
        boardVisible: visible(board),
        boardHeight: board?.height ?? 0,
        pickerVisible: visible(picker),
      };
    });
    expect(visibility.boardVisible).toBeGreaterThan(visibility.boardHeight * 0.85);
    expect(visibility.pickerVisible).toBeGreaterThan(44);
  });
});
