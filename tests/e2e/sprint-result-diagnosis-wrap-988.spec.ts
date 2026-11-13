/**
 * 320 / 390 のスプリント結果で診断文と評価注記が語中で折り返さない（#988）。
 */
import { expect, test, type Locator } from './fixtures';
import { advanceCurrentSprintToResult } from './fixtures';
import type { Page } from '@playwright/test';

const VIEWPORTS = [
  { label: '320×568', width: 320, height: 568 },
  { label: '320×800', width: 320, height: 800 },
  { label: '390×844', width: 390, height: 844 },
] as const;

async function assertUnbrokenPhrases(text: Locator, label: string): Promise<void> {
  const phrases = await text.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('.text-phrase')].map((phrase) => {
      const range = document.createRange();
      range.selectNodeContents(phrase);
      const lines = [...range.getClientRects()].filter((line) => line.width > 0 && line.height > 0);
      return {
        text: phrase.textContent,
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
  });
  expect(phrases.length, `${label} を意味のある句に分ける`).toBeGreaterThan(0);
  for (const phrase of phrases) {
    expect(phrase.lineCount, `${label} の「${phrase.text}」を語中で改行しない`).toBe(1);
    expect(phrase.contained, `${label} の「${phrase.text}」を本文枠内に収める`).toBe(true);
  }
}

async function beginNoCoderSprint(page: Page): Promise<void> {
  await page.goto('/?renderer=pixi&tutorial=off&seed=qa-seed-1031c');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  const setup = page.getByTestId('setup');
  for (const id of ['m0', 'm1', 'm2']) {
    await setup.getByTestId(`assign-${id}-review`).click();
  }
  await setup.getByTestId('begin-sprint').click();
  const dialog = page.getByRole('dialog', { name: 'コーダーが0人です' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'このまま開始' }).click();
  await expect(page.getByTestId('board')).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.label} で0人スプリントの診断文が語中で折れない（#988）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await beginNoCoderSprint(page);
    await advanceCurrentSprintToResult(page);

    const diagnosis = page.getByTestId('result-diagnosis-text');
    await expect(diagnosis).toContainText('作業が進みませんでした');
    await assertUnbrokenPhrases(diagnosis, `${viewport.label} の診断文`);

    const caption = page.getByTestId('result-grade-caption');
    await expect(caption).toContainText('健全比');
    await assertUnbrokenPhrases(caption, `${viewport.label} の評価注記`);
  });
}
