import { expect, test, type Locator } from '@playwright/test';
import type { GameWindow } from './gameWindow';

async function assertButtonLabelsVisible(dialog: Locator): Promise<void> {
  for (const name of ['編成に戻る', 'このまま開始']) {
    const button = dialog.getByRole('button', { name, exact: true });
    const layout = await button.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const lines = [...range.getClientRects()].filter((line) => line.width > 0 && line.height > 0);
      const bounds = element.getBoundingClientRect();
      return {
        text: element.textContent,
        lineCount: new Set(lines.map((line) => Math.round(line.top * 100))).size,
        contained: lines.every(
          (line) =>
            line.left >= bounds.left - 1 &&
            line.right <= bounds.right + 1 &&
            line.top >= bounds.top - 1 &&
            line.bottom <= bounds.bottom + 1,
        ),
      };
    });
    expect(layout.contained, `${name} の文字がボタン枠から欠けない`).toBe(true);
    expect(layout.lineCount, `${name} の表示行`).toBeGreaterThan(0);
  }
}

async function assertDialogCopyContained(dialog: Locator): Promise<void> {
  const card = dialog.locator('.setup-coder-confirm-card');
  await expect(card).toBeVisible();
  const contained = await card.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return ['#setup-no-coder-title', '#setup-no-coder-description'].map((selector) => {
      const target = element.querySelector(selector);
      if (!target) return { selector, ok: false };
      const range = document.createRange();
      range.selectNodeContents(target);
      const lines = [...range.getClientRects()].filter((line) => line.width > 0 && line.height > 0);
      return {
        selector,
        ok: lines.every(
          (line) =>
            line.left >= bounds.left - 1 &&
            line.right <= bounds.right + 1 &&
            line.top >= bounds.top - 1 &&
            line.bottom <= bounds.bottom + 1,
        ),
      };
    });
  });
  for (const entry of contained) {
    expect(entry.ok, `${entry.selector} が確認カード内に収まる`).toBe(true);
  }
}

for (const viewport of [
  { label: '320', width: 320, height: 568 },
  { label: '390', width: 390, height: 844 },
] as const) {
  test(`${viewport.label}pxでコーダー0人の開始確認が1回だけ出てキーボード操作できる（#990）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.emulateMedia({
      reducedMotion: viewport.width === 320 ? 'reduce' : 'no-preference',
    });
    await page.goto('/?renderer=pixi&tutorial=off&seed=qa-seed-1022c');
    await page.getByTestId('difficulty-easy').click();
    await page.getByTestId('start-run').click();
    const setup = page.getByTestId('setup');
    for (const id of ['m0', 'm1', 'm2']) {
      await setup.getByTestId(`assign-${id}-review`).click();
    }
    const dialog = page.getByRole('dialog', { name: 'コーダー0人で始めますか' });
    await setup.getByTestId('begin-sprint').click();
    await expect(dialog).toBeVisible();
    await assertDialogCopyContained(dialog);
    await assertButtonLabelsVisible(dialog);
    await expect(dialog.getByRole('button', { name: '編成に戻る' })).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath(`setup-no-coder-confirm-${viewport.label}.png`),
    });

    await dialog.getByRole('button', { name: '編成に戻る' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(setup.getByTestId('begin-sprint')).toBeFocused();
    const rosterBefore = await page.evaluate(() =>
      (window as GameWindow).game!.getState().roster.members.map((member) => member.assignment),
    );
    await setup.getByTestId('begin-sprint').click();
    await expect(dialog).toBeVisible();
    const rosterAfter = await page.evaluate(() =>
      (window as GameWindow).game!.getState().roster.members.map((member) => member.assignment),
    );
    expect(rosterAfter).toEqual(rosterBefore);

    await dialog.getByRole('button', { name: 'このまま開始' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('board')).toBeVisible();
    expect(await page.evaluate(() => (window as GameWindow).game!.getState().phase)).toBe('sprint');
  });
}

test('コーダーが1人以上いるときは開始確認を出さない（#990）', async ({ page }) => {
  await page.goto('/?renderer=pixi&tutorial=off&seed=qa-seed-1022c');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  const setup = page.getByTestId('setup');
  await setup.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('setup-no-coder-confirm')).toHaveCount(0);
  await expect(page.getByTestId('board')).toBeVisible();
});
