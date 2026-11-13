/**
 * 対象ピッカー一覧の縦スクロール続き合図（#981）。
 */
import { beginPublicSprint, expect, test } from './fixtures';

async function advanceToSplitCandidateCount(page: import('@playwright/test').Page, target: number) {
  const reached = await page.evaluate((wanted) => {
    const game = window.game;
    if (!game) throw new Error('window.game が公開されていない');
    const count = () => {
      const sprint = game.getState().sprint;
      if (!sprint) return 0;
      return sprint.tasks.filter(
        (task) => (task.lane === 'review' || task.lane === 'coding') && !task.split,
      ).length;
    };
    let guard = 0;
    let stepMs = 80;
    while (game.getState().phase === 'sprint' && guard < 8000) {
      const current = count();
      if (current === wanted) {
        game.pause();
        return current;
      }
      if (current > wanted) {
        game.pause();
        throw new Error(`PR分割候補が ${current} 件で ${wanted} 件を飛び越した`);
      }
      if (wanted - current <= 3) stepMs = 10;
      guard += 1;
      game.step(stepMs);
    }
    game.pause();
    throw new Error(`PR分割候補が ${wanted} 件に到達しない`);
  }, target);
  expect(reached).toBe(target);
}

test.describe('対象ピッカー一覧の続き合図（#981）', () => {
  test('1280×800 で 16 件は端フェードが出て、最下端では下だけ消える', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await beginPublicSprint(page, { seed: 'devops-tycoon', renderer: 'pixi' });
    await advanceToSplitCandidateCount(page, 16);
    await page.getByTestId('action-splitPr').click();
    await expect(page.getByTestId('action-target-picker')).toBeVisible();

    const host = page.getByTestId('action-target-picker-list-host');
    const list = page.locator('.action-target-picker-list');
    await expect(host).toHaveAttribute('data-scroll-overflow', 'y');
    await expect(host).toHaveAttribute('data-scroll-overflow-start', 'true');
    await expect(host).toHaveAttribute('data-scroll-overflow-end', 'false');

    const bottomFadeOpacity = await host.evaluate(
      (element) => getComputedStyle(element, '::after').opacity,
    );
    expect(Number.parseFloat(bottomFadeOpacity)).toBeGreaterThan(0);

    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(host).toHaveAttribute('data-scroll-overflow-end', 'true');
    await expect(host).toHaveAttribute('data-scroll-overflow-start', 'false');

    const topFadeOpacity = await host.evaluate(
      (element) => getComputedStyle(element, '::before').opacity,
    );
    expect(Number.parseFloat(topFadeOpacity)).toBeGreaterThan(0);

    await page.keyboard.press('Tab');
    const focused = page.locator('.action-target-option:focus-visible');
    await expect(focused).toBeVisible();
    await expect(focused).toBeInViewport({ ratio: 0.85 });
  });
});
