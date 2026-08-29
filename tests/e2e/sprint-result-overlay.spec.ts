/**
 * SPRINT RESULT オーバーレイの操作契約（#384 / #424）。
 */
import { expect, test } from './fixtures';
import { advanceCurrentSprintToResult, beginPublicSprint } from './fixtures';

test('SPRINT RESULT 中は KPI詳細／ラン詳細にフォーカスもクリックもできない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await beginPublicSprint(page, { seed: 'issue-384-result-lock-0' });
  const hudToggle = page.getByTestId('hud-toggle');
  const runbarToggle = page.getByTestId('runbar-details-toggle');
  await expect(hudToggle).toBeVisible();
  await expect(runbarToggle).toBeVisible();
  await expect(hudToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(runbarToggle).toHaveAttribute('aria-expanded', 'false');

  await advanceCurrentSprintToResult(page);

  const overlay = page.getByTestId('sprint-result');
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute('role', 'dialog');
  await expect(overlay).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('result-restart')).toHaveText('リプレイに残さずタイトルへ');
  await expect(page.getByTestId('result-restart')).toHaveAttribute(
    'title',
    '勝利または敗北の前にタイトルへ戻ると、このランはリプレイに保存されません',
  );

  const layout = page.getByTestId('sprint-layout');
  await expect(layout).toHaveAttribute('inert', '');
  await expect(layout).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => overlay.evaluate((el) => el === document.activeElement)).toBe(true);

  const focusedIds: string[] = [];
  for (let i = 0; i < 40; i += 1) {
    const focused = await page.evaluate(() => {
      const overlayEl = document.querySelector('[data-testid="sprint-result"]');
      const active = document.activeElement;
      const testId = active instanceof HTMLElement ? (active.dataset.testid ?? active.tagName) : '';
      const inside =
        overlayEl instanceof HTMLElement && (active === overlayEl || overlayEl.contains(active));
      return { testId, inside };
    });
    expect(
      focused.inside,
      `Tab ${i} でフォーカスがオーバーレイ外へ抜けた (${focused.testId})`,
    ).toBe(true);
    expect(['hud-toggle', 'runbar-details-toggle']).not.toContain(focused.testId);
    focusedIds.push(focused.testId);
    await page.keyboard.press('Tab');
  }
  expect(focusedIds, '結果ダイアログ内を Tab しても続行へ届かない').toContain('result-continue');

  await page.keyboard.press('Shift+Tab');
  const afterShiftTab = await page.evaluate(() => {
    const overlayEl = document.querySelector('[data-testid="sprint-result"]');
    const active = document.activeElement;
    const testId = active instanceof HTMLElement ? (active.dataset.testid ?? active.tagName) : '';
    const inside =
      overlayEl instanceof HTMLElement && (active === overlayEl || overlayEl.contains(active));
    return { testId, inside };
  });
  expect(afterShiftTab.inside, `Shift+Tab でオーバーレイ外へ抜けた (${afterShiftTab.testId})`).toBe(
    true,
  );
  expect(['hud-toggle', 'runbar-details-toggle']).not.toContain(afterShiftTab.testId);

  const hudBox = await hudToggle.boundingBox();
  if (!hudBox) throw new Error('KPI詳細ボタンの位置が取れない');
  await page.mouse.click(hudBox.x + hudBox.width / 2, hudBox.y + hudBox.height / 2);
  const runbarBox = await runbarToggle.boundingBox();
  if (!runbarBox) throw new Error('ラン詳細ボタンの位置が取れない');
  await page.mouse.click(runbarBox.x + runbarBox.width / 2, runbarBox.y + runbarBox.height / 2);

  await expect(hudToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(runbarToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'true');
  await expect(page.getByTestId('runbar-details')).toHaveCount(0);

  await page.getByTestId('result-continue').scrollIntoViewIfNeeded();
  await page.getByTestId('result-continue').click();
  await expect(overlay).toHaveCount(0);
});
