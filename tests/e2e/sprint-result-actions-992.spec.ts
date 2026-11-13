/**
 * 320 幅のスプリント結果で主CTAが初見で見える（#992）。
 */
import { expect, test } from './fixtures';
import {
  advanceCurrentSprintToResult,
  beginPublicSprint,
  openSprintResultDetails,
} from './fixtures';

const VIEWPORTS = [
  { label: '320×568', width: 320, height: 568 },
  { label: '390×844', width: 390, height: 844 },
  { label: '1280×800', width: 1280, height: 800 },
] as const;

async function assertPrimaryButtonFullyVisible(
  page: import('@playwright/test').Page,
): Promise<void> {
  const continueBtn = page.getByTestId('result-continue');
  await expect(continueBtn).toBeVisible();
  const box = await continueBtn.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 0.5);

  const clipped = await continueBtn.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return element.scrollWidth > rect.width + 1 || element.scrollHeight > rect.height + 1;
  });
  expect(clipped, '主CTAのラベルが欠けている').toBe(false);
}

test('スプリント結果の主CTAは初見で画面内に収まり、内訳は最後まで読める（#992）', async ({
  page,
}) => {
  for (const viewport of VIEWPORTS) {
    await test.step(viewport.label, async () => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await beginPublicSprint(page, { seed: `issue-992-result-actions-${viewport.width}` });
      await advanceCurrentSprintToResult(page);
      await expect(page.getByTestId('sprint-result')).toBeVisible();

      const scrollTopBefore = await page
        .getByTestId('overlay-scroll')
        .evaluate((el) => el.scrollTop);
      expect(scrollTopBefore, `${viewport.label}: 初見でスクロール位置がずれている`).toBe(0);

      await assertPrimaryButtonFullyVisible(page);
      if (viewport.width === 320) {
        await expect(page.getByTestId('result-continue')).toBeInViewport({ ratio: 1 });
      }

      await openSprintResultDetails(page);
      const gradeBreakdown = page.getByTestId('result-grade-breakdown');
      await expect(gradeBreakdown).toBeVisible();
      await gradeBreakdown.scrollIntoViewIfNeeded();
      await expect(gradeBreakdown).toBeInViewport();

      await page.getByTestId('overlay-scroll').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const scrollTopAfter = await page
        .getByTestId('overlay-scroll')
        .evaluate((el) => el.scrollTop);
      expect(
        scrollTopAfter,
        `${viewport.label}: 結果本文を最後までスクロールできない`,
      ).toBeGreaterThan(0);

      await assertPrimaryButtonFullyVisible(page);

      await page.getByTestId('result-continue').click();
      await expect(page.getByTestId('sprint-result')).toHaveCount(0);
    });
  }
});
