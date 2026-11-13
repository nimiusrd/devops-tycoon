import type { Page } from '@playwright/test';
import { expect, test, type PublicGameWindow } from './fixtures';

const VIEWPORTS = [
  { name: '320', width: 320, height: 568 },
  { name: '1280', width: 1280, height: 800 },
] as const;

async function startQ1Setup(page: Page): Promise<void> {
  await page.goto('/?seed=org-lever-spend-risk');
  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.startRun('easy', [], 'org-lever-spend-risk');
    game.pause();
  });
  await expect(page.getByTestId('setup')).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test(`スプリント1セットアップで 40+20 のレバーは枯渇確認を出し、取消で元に戻る (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1Setup(page);

    const budgetBefore = await page.evaluate(
      () => (window as PublicGameWindow).game!.getState().budget,
    );
    expect(budgetBefore).toBe(60);

    await page.evaluate(() => {
      const game = (window as PublicGameWindow).game;
      if (!game) throw new Error('window.game が公開されていない');
      game.zoomTo('company');
    });
    await expect(page.getByTestId('zoom-overlay')).toHaveAttribute('data-level', 'company');
    await expect(page.getByTestId('org-levers')).toBeVisible();

    const recruit = page.getByTestId('lever-recruitDraft');
    await expect(recruit).toContainText('💰40→20');
    // WebKit では Pixi 更新直後に renderer が落ちることがあるため、初回だけ API で適用する。
    await page.evaluate(() => {
      const game = (window as PublicGameWindow).game;
      if (!game) throw new Error('window.game が公開されていない');
      (game as { applyOrgLever(id: string): unknown }).applyOrgLever('recruitDraft');
    });
    await expect
      .poll(() => page.evaluate(() => (window as PublicGameWindow).game!.getState().budget))
      .toBe(20);

    const firefighters = page.getByTestId('lever-firefighters');
    await expect(firefighters).toContainText('💰20→0');
    await expect(firefighters).toContainText('予算枯渇でランが終了する');
    await firefighters.click();

    const confirm = page.getByTestId('spend-confirm');
    await expect(confirm).toBeVisible();
    await expect(page.getByTestId('org-lever-spend-dialog')).toHaveCSS('z-index', '40');
    await expect(page.getByTestId('spend-confirm-cancel')).toBeFocused();
    const topControl = await page.evaluate((id) => {
      const target = document.querySelector(`[data-testid="${id}"]`);
      if (!(target instanceof HTMLElement)) return null;
      const rect = target.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return top?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
    }, 'spend-confirm-cancel');
    expect(topControl).toBe('spend-confirm-cancel');
    await expect
      .poll(() => page.locator('.app').evaluate((element) => (element as HTMLElement).inert))
      .toBe(true);

    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(page.locator('.app')).toHaveJSProperty('inert', false);
    await expect(firefighters).toBeFocused();

    const afterCancel = await page.evaluate(() => {
      const state = (window as PublicGameWindow).game!.getState();
      return {
        budget: state.budget,
        phase: state.phase,
        status: state.status,
        zoom: state.zoom.level,
      };
    });
    expect(afterCancel).toEqual({
      budget: 20,
      phase: 'setup',
      status: 'playing',
      zoom: 'company',
    });
    await expect(recruit).toBeDisabled();
    await expect(firefighters).toBeEnabled();
  });
}
