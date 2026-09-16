/**
 * タイトル画面の開始 CTA がファーストビューで使え、フッターに隠れない契約（#358）。
 */
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';

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

const CARD_DOCK_VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'title-dock-1280', width: 1280, height: 800 },
] as const;

async function assertTitleShellKeepsDockInFlow(
  page: Page,
  viewport: { name: string; width: number; height: number },
): Promise<{ scrollBox: Box; dockBox: Box }> {
  const title = page.getByTestId('title');
  const shell = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflowY: style.overflowY,
      display: style.display,
      reserve: style.getPropertyValue('--title-dock-reserve').trim(),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    };
  });
  expect(shell.display, `${viewport.name} のタイトル面が grid ではない`).toBe('grid');
  expect(
    shell.overflowY === 'hidden' || shell.overflowY === 'clip',
    `${viewport.name} のタイトル面が縦スクロールする`,
  ).toBe(true);
  expect(shell.reserve, `${viewport.name} が --title-dock-reserve に依存している`).toBe('');
  expect(
    shell.scrollHeight,
    `${viewport.name} のタイトル面が親スクロールを持っている`,
  ).toBeLessThanOrEqual(shell.clientHeight + 1);

  const scrollBox = await readBox(page.getByTestId('title-scroll'), 'タイトルのスクロール面');
  const dockBox = await readBox(page.getByTestId('title-launch-dock'), '開始ドック');
  expect(
    overlaps(scrollBox, dockBox),
    `${viewport.name} でスクロール面とドックの矩形が交差している`,
  ).toBe(false);
  expect(
    scrollBox.y + scrollBox.height,
    `${viewport.name} でスクロール面がドックより下にある`,
  ).toBeLessThanOrEqual(dockBox.y + 1);
  return { scrollBox, dockBox };
}

function assertCardClearOfDock(
  cardBox: Box,
  dockBox: Box,
  viewportName: string,
  label: string,
): void {
  expect(overlaps(cardBox, dockBox), `${viewportName} で${label}がドックと交差している`).toBe(
    false,
  );
  expect(
    cardBox.y + cardBox.height,
    `${viewportName} で${label}の下端がドックに隠れている`,
  ).toBeLessThanOrEqual(dockBox.y + 1);
}

test.describe('title difficulty cards stay above launch dock', () => {
  for (const viewport of CARD_DOCK_VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height} でカード下端がドックに隠れない`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?seed=title-launch-cta');
      await expect(page.getByTestId('title')).toBeVisible();

      const { scrollBox, dockBox } = await assertTitleShellKeepsDockInFlow(page, viewport);

      const easyCard = page.getByTestId('difficulty-easy');
      await expect(easyCard).toBeVisible();
      const easyVisible = intersect(await readBox(easyCard, 'Easyカード'), scrollBox);
      if (easyVisible) {
        expect(
          overlaps(easyVisible, dockBox),
          `${viewport.name} で初見の Easy カードがドックに隠れている`,
        ).toBe(false);
      }

      await easyCard.scrollIntoViewIfNeeded();
      assertCardClearOfDock(
        await readBox(easyCard, 'Easyカード（スクロール後）'),
        await readBox(page.getByTestId('title-launch-dock'), '開始ドック'),
        viewport.name,
        'Easyカード全文',
      );

      await page.locator('.difficulty-card:not([disabled])').last().click();
      const lastCard = page.locator('.difficulty-card').last();
      await lastCard.scrollIntoViewIfNeeded();

      const cardBox = await readBox(lastCard, '難易度カード下端');
      const dockAfterScroll = await readBox(page.getByTestId('title-launch-dock'), '開始ドック');
      assertCardClearOfDock(cardBox, dockAfterScroll, viewport.name, '難易度カード下端');

      const startRun = page.getByTestId('start-run');
      await expect(startRun).toBeVisible();
      const startBox = await readBox(startRun, '開始 CTA');
      expect(
        overlaps(cardBox, startBox),
        `${viewport.name} でカード選択とラン開始が同時に破綻している`,
      ).toBe(false);
      expect(
        startBox.y + startBox.height,
        `${viewport.name} でラン開始がビューポート外`,
      ).toBeLessThanOrEqual(viewport.height + 1);
      await expect(page.getByTestId('start-daily-run')).toBeVisible();

      await startRun.click();
      await expect(page.getByTestId('setup')).toBeVisible();
    });
  }
});
