/**
 * 組織進化オーバーレイの初見レイアウト契約（#355）。
 *
 * 5列グリッドでは 3 行目カードのコスト・ペナルティが枠で欠けないこと。
 * 1列（narrow）ではカード単位でスクロールでき、閉じる操作が viewport に残ること。
 */
import type { Locator, Page } from '@playwright/test';
import { RESPONSIVE_BREAKPOINTS } from '../../src/ui/responsiveMode';
import { advancePublicRun, expect, test } from './fixtures';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const THIRD_ROW_NODE_IDS = ['dev-3', 'review-3', 'quality-3', 'ai-3', 'culture-3'] as const;

type Box = { x: number; y: number; width: number; height: number };

function waitForLayoutFrame(page: Page): Promise<void> {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function readBox(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} の bounding box が取得できない`);
  return box;
}

function completelyOutsideY(inner: Box, outer: Box): boolean {
  return inner.y + inner.height <= outer.y + 1 || inner.y >= outer.y + outer.height - 1;
}

function assertFullyInside(inner: Box, outer: Box, label: string): void {
  expect(inner.x, `${label} の左端がクリップ枠の外`).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.y, `${label} の上端がクリップ枠の外`).toBeGreaterThanOrEqual(outer.y - 1);
  expect(inner.x + inner.width, `${label} の右端がクリップ枠の外`).toBeLessThanOrEqual(
    outer.x + outer.width + 1,
  );
  expect(inner.y + inner.height, `${label} の下端がクリップ枠の外`).toBeLessThanOrEqual(
    outer.y + outer.height + 1,
  );
}

/** 交差するカードは枠内に完全に収まり、部分クリップなら失敗する。 */
async function assertCardNotPartiallyClipped(
  page: Page,
  nodeId: string,
  clip: Box,
): Promise<'visible' | 'hidden'> {
  const card = page.getByTestId(`evo-${nodeId}`);
  const cardBox = await readBox(card, nodeId);
  if (completelyOutsideY(cardBox, clip)) return 'hidden';

  assertFullyInside(cardBox, clip, `${nodeId} カード`);

  const costBox = await readBox(card.locator('.evo-cost'), `${nodeId} コスト`);
  assertFullyInside(costBox, clip, `${nodeId} コスト`);

  const penalty = card.locator('.effect-tag.tone-negative').first();
  if ((await penalty.count()) > 0) {
    const penaltyBox = await penalty.boundingBox();
    if (penaltyBox) assertFullyInside(penaltyBox, clip, `${nodeId} ペナルティ`);
  }

  return 'visible';
}

async function openEvolutionOverlay(page: Page): Promise<void> {
  await advancePublicRun(page, {
    seed: 'devops-tycoon',
    difficulty: 'easy',
    target: { phase: 'evolution' },
  });
  await expect(page.getByTestId('evolution')).toBeVisible();
  await expect(page.getByTestId('evolution-branches')).toBeVisible();
}

test.describe('組織進化オーバーレイの初見レイアウト', () => {
  test('5 viewport で 3 行目カードが枠に欠けず、CTA が届く', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openEvolutionOverlay(page);

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await waitForLayoutFrame(page);

      const overlay = page.getByTestId('evolution');
      await expect(overlay).toBeVisible();
      await expect(page.getByTestId('evolution-done')).toBeInViewport({ ratio: 1 });

      const clip = await readBox(page.getByTestId('evolution-branches'), '進化グリッド');
      const wide = viewport.width > RESPONSIVE_BREAKPOINTS.narrowMaxWidth;
      const visibilities: Array<'visible' | 'hidden'> = [];

      for (const nodeId of THIRD_ROW_NODE_IDS) {
        visibilities.push(await assertCardNotPartiallyClipped(page, nodeId, clip));
      }

      if (wide) {
        expect(
          visibilities,
          `${viewport.name} の 3 行目が初見で欠けているか、行ごと隠れていない`,
        ).toEqual(Array.from({ length: THIRD_ROW_NODE_IDS.length }, () => 'visible' as const));
      }

      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(scrollWidth, `${viewport.name} で横スクロールが発生している`).toBeLessThanOrEqual(
        viewport.width + 1,
      );
    }
  });

  test('narrow では 3 行目カードをスクロールしてコストまで読める', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openEvolutionOverlay(page);

    const branches = page.getByTestId('evolution-branches');
    const target = page.getByTestId('evo-dev-3');
    await target.scrollIntoViewIfNeeded();
    await waitForLayoutFrame(page);

    const clip = await readBox(branches, '進化グリッド');
    expect(await assertCardNotPartiallyClipped(page, 'dev-3', clip)).toBe('visible');
    await expect(page.getByTestId('evolution-done')).toBeInViewport({ ratio: 1 });
  });
});
