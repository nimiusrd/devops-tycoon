/**
 * タイトル画面の開始 CTA がファーストビューで使え、フッターに隠れない契約（#358）。
 */
import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone-start', width: 390, height: 667 },
  { name: 'phone-landscape', width: 667, height: 375 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function intersect(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function visibleInViewport(box: Box, viewport: { width: number; height: number }): Box | null {
  return intersect(box, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}

async function readBox(locator: Locator, label: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} の bounding box が取得できない`);
  return box;
}

test.describe('title launch CTA first view', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height} でスクロールせず開始できる`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?seed=title-launch-cta');
      await expect(page.getByTestId('title')).toBeVisible();

      const scroll = page.getByTestId('title-scroll');
      await expect(scroll).toBeVisible();
      await expect.poll(async () => scroll.evaluate((el) => el.scrollTop)).toBe(0);

      const startRun = page.getByTestId('start-run');
      await expect(startRun).toBeVisible();
      await expect(startRun).toContainText('四半期を始める');

      const startBox = await readBox(startRun, '開始 CTA');
      expect(startBox.y, `${viewport.name} で開始 CTA の上端が viewport 外`).toBeGreaterThanOrEqual(
        -1,
      );
      expect(
        startBox.y + startBox.height,
        `${viewport.name} で開始 CTA の下端が viewport 外`,
      ).toBeLessThanOrEqual(viewport.height + 1);

      const dailyBox = await readBox(page.getByTestId('start-daily-run'), 'デイリー開始');
      if (viewport.width <= 560) {
        expect(
          startBox.y,
          `${viewport.name} で開始 CTA がデイリーの下に積み上がっていない`,
        ).toBeGreaterThan(dailyBox.y);
      } else if (viewport.width <= 900) {
        expect(
          startBox.x,
          `${viewport.name} で2カラムドックの開始 CTA が右列にない`,
        ).toBeGreaterThan(dailyBox.x + dailyBox.width - 8);
      }

      const labelBox = await startRun.evaluate((el) => {
        const label =
          [...el.querySelectorAll('span, small')].find((node) =>
            node.textContent?.includes('四半期を始める'),
          ) ?? el;
        const rect = label.getBoundingClientRect();
        const button = el.getBoundingClientRect();
        return {
          label: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
          button: {
            top: button.top,
            bottom: button.bottom,
            left: button.left,
            right: button.right,
          },
        };
      });
      expect(
        labelBox.label.top,
        `${viewport.name} で開始文言の上端がボタンから切れている`,
      ).toBeGreaterThanOrEqual(labelBox.button.top - 1);
      expect(
        labelBox.label.bottom,
        `${viewport.name} で開始文言の下端がボタンから切れている`,
      ).toBeLessThanOrEqual(labelBox.button.bottom + 1);
      expect(
        labelBox.label.bottom,
        `${viewport.name} で開始文言が viewport 下端で切れている`,
      ).toBeLessThanOrEqual(viewport.height + 1);

      await page.getByTestId('title-footer').evaluate((el) => {
        el.scrollIntoView({ block: 'end', inline: 'nearest' });
      });
      const scrollBox = await readBox(scroll, 'タイトルのスクロール領域');
      const footerBox = await readBox(page.getByTestId('title-footer'), 'フッター');
      const dockedStart = await readBox(startRun, '開始 CTA（スクロール後）');
      const visibleStart = visibleInViewport(dockedStart, viewport);
      const paintedFooter = intersect(footerBox, scrollBox);
      expect(visibleStart, `${viewport.name} でスクロール後に開始 CTA が見えない`).not.toBeNull();
      expect(paintedFooter, `${viewport.name} でフッターがスクロール領域に現れない`).not.toBeNull();
      if (paintedFooter && visibleStart) {
        expect(
          overlaps(paintedFooter, visibleStart),
          `${viewport.name} でフッターが開始 CTA と重なっている`,
        ).toBe(false);
      }

      await startRun.click();
      await expect(page.getByTestId('setup')).toBeVisible();
    });
  }
});
