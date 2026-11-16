import type { Page } from '@playwright/test';
import { expect, test, type PublicGameWindow } from './fixtures';

const VIEWPORTS = [
  { name: '320', width: 320, height: 568 },
  { name: '1280', width: 1280, height: 800 },
] as const;

async function clickOutsideSpendConfirm(page: Page): Promise<void> {
  const point = await page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="org-lever-spend-dialog"]');
    const panel = document.querySelector('[data-testid="spend-confirm"]');
    if (!(dialog instanceof HTMLElement) || !(panel instanceof HTMLElement)) return null;
    const dialogRect = dialog.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const candidates = [
      { x: dialogRect.left + 6, y: dialogRect.top + 6 },
      { x: dialogRect.right - 6, y: dialogRect.top + 6 },
      { x: dialogRect.left + 6, y: dialogRect.bottom - 6 },
      { x: dialogRect.right - 6, y: dialogRect.bottom - 6 },
    ];
    for (const candidate of candidates) {
      const insidePanel =
        candidate.x >= panelRect.left &&
        candidate.x <= panelRect.right &&
        candidate.y >= panelRect.top &&
        candidate.y <= panelRect.bottom;
      if (insidePanel) continue;
      const top = document.elementFromPoint(candidate.x, candidate.y);
      const id = top?.closest('[data-testid]')?.getAttribute('data-testid') ?? null;
      if (id === 'org-lever-spend-dialog') {
        return { ...candidate, id };
      }
    }
    return null;
  });
  expect(point, '確認パネルの外に取消できる地点がある').not.toBeNull();
  await page.mouse.click(point!.x, point!.y);
}

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
    await expect(page.locator('[aria-label="予算枯渇の確認"]')).toHaveCount(1);
    await expect(page.getByTestId('spend-confirm')).not.toHaveAttribute(
      'aria-label',
      '予算枯渇の確認',
    );
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

    await confirm.getByText('予算枯渇でランが終了する').click();
    await expect(confirm).toBeVisible();

    await clickOutsideSpendConfirm(page);
    await expect(confirm).toHaveCount(0);
    await expect(page.locator('.app')).toHaveJSProperty('inert', false);
    await expect(firefighters).toBeFocused();
    await expect
      .poll(() => page.evaluate(() => (window as PublicGameWindow).game!.getState().budget))
      .toBe(20);
    await expect(firefighters).toBeEnabled();

    await firefighters.click();
    await expect(confirm).toBeVisible();
    await expect(page.getByTestId('spend-confirm-cancel')).toBeFocused();
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

  test(`枯渇を確定すると GAME OVER の主操作へフォーカスが移る (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1Setup(page);
    await page.evaluate(() => {
      const game = (window as PublicGameWindow).game;
      if (!game) throw new Error('window.game が公開されていない');
      game.zoomTo('company');
      (game as { applyOrgLever(id: string): unknown }).applyOrgLever('recruitDraft');
    });
    await expect
      .poll(() => page.evaluate(() => (window as PublicGameWindow).game!.getState().budget))
      .toBe(20);

    const firefighters = page.getByTestId('lever-firefighters');
    await firefighters.click();
    await page.getByTestId('spend-confirm-accept').click();
    await expect(page.getByTestId('new-run')).toBeFocused();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const state = (window as PublicGameWindow).game!.getState();
          return { budget: state.budget, phase: state.phase, loseReason: state.loseReason };
        }),
      )
      .toEqual({ budget: 0, phase: 'lost', loseReason: 'budgetExhausted' });
    await expect(page.getByTestId('new-run')).toBeFocused();
  });

  test(`部門・チームレバーの名前に支払後残高と枯渇警告が残る (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1Setup(page);
    await page.evaluate(() => {
      const game = (window as PublicGameWindow).game;
      if (!game) throw new Error('window.game が公開されていない');
      game.zoomTo('department');
    });
    await expect(page.getByTestId('zoom-overlay')).toHaveAttribute('data-level', 'department');

    const team = page.getByTestId('lever-teamReviewHelp');
    const dept = page.getByTestId('lever-reviewReinforce');
    await expect(team).toContainText('💰6→54');
    await expect(team).toHaveAttribute('aria-label', /💰6→54/);
    await expect(team).not.toHaveAttribute('aria-label', /予算枯渇でランが終了する/);
    await expect(dept).toContainText('💰12→48');
    await expect(dept).toHaveAttribute('aria-label', /💰12→48/);

    const company = page.getByTestId('lever-firefighters');
    await page.evaluate(() => {
      const game = (window as PublicGameWindow).game as {
        engine: { budget: number };
        playCard(index: number): unknown;
        zoomTo(level: string): unknown;
      };
      game.zoomTo('company');
    });
    await expect(page.getByTestId('org-levers')).toBeVisible();
    await expect(company).toContainText('💰20→40');
    await expect(company).not.toHaveAttribute('aria-label', /.+/);

    await page.evaluate(() => {
      const game = (window as PublicGameWindow).game as {
        engine: { budget: number };
        playCard(index: number): unknown;
        zoomTo(level: string): unknown;
      };
      game.engine.budget = 6;
      game.playCard(-1);
      game.zoomTo('department');
    });
    await expect(team).toContainText('💰6→0');
    await expect(team).toContainText('予算枯渇でランが終了する');
    await expect(team).toHaveAttribute('aria-label', /💰6→0/);
    await expect(team).toHaveAttribute('aria-label', /予算枯渇でランが終了する/);
    const freeze = page.getByTestId('lever-deptFreeze');
    await expect(freeze).toContainText('💰6→0');
    await expect(freeze).toContainText('予算枯渇でランが終了する');
    await expect(freeze).toHaveAttribute('aria-label', /💰6→0/);
    await expect(freeze).toHaveAttribute('aria-label', /予算枯渇でランが終了する/);
  });
}
