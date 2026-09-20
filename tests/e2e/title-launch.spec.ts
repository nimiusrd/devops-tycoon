/**
 * タイトル画面の開始 CTA がファーストビューで使え、フッターに隠れない契約（#358）。
 */
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { RESPONSIVE_BREAKPOINTS } from '../../src/ui/responsiveModeCore';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone-start', width: 390, height: 667 },
  { name: 'phone-landscape', width: 667, height: 375 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

type Box = { x: number; y: number; width: number; height: number };

/** 隣接する grid 行は丸めで 1px 交差することがある。視覚的な隠れは 2px 超えてから見る。 */
const LAYOUT_SLOP_PX = 2;

function overlaps(a: Box, b: Box, slop = 0): boolean {
  return (
    a.x + slop < b.x + b.width &&
    a.x + a.width > b.x + slop &&
    a.y + slop < b.y + b.height &&
    a.y + a.height > b.y + slop
  );
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
  const box = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  });
  if (!box || (box.width <= 0 && box.height <= 0)) {
    throw new Error(`${label} の bounding box が取得できない`);
  }
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
      if (viewport.width <= RESPONSIVE_BREAKPOINTS.stackMaxWidth) {
        expect(
          startBox.y,
          `${viewport.name} で開始 CTA がデイリーの下に積み上がっていない`,
        ).toBeGreaterThan(dailyBox.y);
      } else if (viewport.width <= RESPONSIVE_BREAKPOINTS.narrowMaxWidth) {
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
  const expectedHeight =
    viewport.height <= RESPONSIVE_BREAKPOINTS.shortMaxHeight ? 'short' : 'normal';
  const expectedWidth = viewport.width <= RESPONSIVE_BREAKPOINTS.narrowMaxWidth ? 'narrow' : 'wide';
  await expect(page.locator('html')).toHaveAttribute('data-responsive-height', expectedHeight);
  await expect(page.locator('html')).toHaveAttribute('data-responsive-width', expectedWidth);
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());

  const title = page.getByTestId('title');
  const shell = await title.evaluate((element) => {
    const style = getComputedStyle(element);
    const html = document.documentElement;
    const body = document.body;
    const dock = document.querySelector('[data-testid="title-launch-dock"]');
    const dockStyle = dock ? getComputedStyle(dock) : null;
    return {
      overflowY: style.overflowY,
      display: style.display,
      reserve: style.getPropertyValue('--title-dock-reserve').trim(),
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      htmlOverflowY: getComputedStyle(html).overflowY,
      bodyOverflowY: getComputedStyle(body).overflowY,
      htmlScroll: html.scrollHeight,
      htmlClient: html.clientHeight,
      bodyScroll: body.scrollHeight,
      bodyClient: body.clientHeight,
      dockPosition: dockStyle?.position ?? '',
    };
  });
  expect(shell.display, `${viewport.name} のタイトル面が grid ではない`).toBe('grid');
  expect(
    shell.overflowY === 'hidden' || shell.overflowY === 'clip',
    `${viewport.name} のタイトル面が縦スクロールする`,
  ).toBe(true);
  expect(shell.reserve, `${viewport.name} が --title-dock-reserve に依存している`).toBe('');
  expect(
    shell.dockPosition === 'static' || shell.dockPosition === 'relative',
    `${viewport.name} のドックが ${shell.dockPosition} でスクロール面に重なる`,
  ).toBe(true);
  expect(
    shell.scrollHeight,
    `${viewport.name} のタイトル面が親スクロールを持っている`,
  ).toBeLessThanOrEqual(shell.clientHeight + 1);
  expect(
    shell.htmlOverflowY === 'hidden' || shell.htmlOverflowY === 'clip',
    `${viewport.name} の html が縦スクロールする`,
  ).toBe(true);
  expect(
    shell.bodyOverflowY === 'hidden' || shell.bodyOverflowY === 'clip',
    `${viewport.name} の body が縦スクロールする`,
  ).toBe(true);
  expect(
    shell.htmlScroll,
    `${viewport.name} の html がウィンドウスクロールする`,
  ).toBeLessThanOrEqual(shell.htmlClient + 1);
  expect(
    shell.bodyScroll,
    `${viewport.name} の body がウィンドウスクロールする`,
  ).toBeLessThanOrEqual(shell.bodyClient + 1);

  let settled: { scrollBox: Box; dockBox: Box } | null = null;
  await expect
    .poll(async () => {
      const scrollBox = await readBox(page.getByTestId('title-scroll'), 'タイトルのスクロール面');
      const dockBox = await readBox(page.getByTestId('title-launch-dock'), '開始ドック');
      const clear =
        !overlaps(scrollBox, dockBox, LAYOUT_SLOP_PX) &&
        scrollBox.y + scrollBox.height <= dockBox.y + LAYOUT_SLOP_PX;
      if (clear) settled = { scrollBox, dockBox };
      return clear;
    })
    .toBe(true);
  if (!settled) {
    throw new Error(`${viewport.name} でスクロール面とドックの矩形が交差している`);
  }
  return settled;
}

function assertCardClearOfDock(
  cardBox: Box,
  dockBox: Box,
  viewportName: string,
  label: string,
): void {
  expect(
    cardBox.y + cardBox.height,
    `${viewportName} で${label}の下端がドックに隠れている`,
  ).toBeLessThanOrEqual(dockBox.y + LAYOUT_SLOP_PX);
}

async function scrollFullyIntoTitleScroll(locator: Locator): Promise<void> {
  await locator.evaluate((element, slack) => {
    const scroll = element.closest('[data-testid="title-scroll"]');
    if (!(scroll instanceof HTMLElement)) return;
    const cardRect = element.getBoundingClientRect();
    const scrollRect = scroll.getBoundingClientRect();
    if (cardRect.bottom > scrollRect.bottom - slack) {
      scroll.scrollTop += Math.ceil(cardRect.bottom - scrollRect.bottom + slack);
    }
    if (cardRect.top < scrollRect.top + slack) {
      scroll.scrollTop -= Math.ceil(scrollRect.top - cardRect.top + slack);
    }
  }, LAYOUT_SLOP_PX);
}

async function assertCardScrolledClearOfDock(
  page: Page,
  card: Locator,
  viewportName: string,
  label: string,
): Promise<Box> {
  let settled: Box | null = null;
  await expect
    .poll(async () => {
      await scrollFullyIntoTitleScroll(card);
      const cardBox = await readBox(card, label);
      const scrollBox = await readBox(page.getByTestId('title-scroll'), 'タイトルのスクロール面');
      const dockBox = await readBox(page.getByTestId('title-launch-dock'), '開始ドック');
      const visible = intersect(cardBox, scrollBox);
      const fullyInScroll =
        cardBox.y >= scrollBox.y - LAYOUT_SLOP_PX &&
        cardBox.y + cardBox.height <= scrollBox.y + scrollBox.height + LAYOUT_SLOP_PX;
      const hiddenByDock = visible ? overlaps(visible, dockBox, LAYOUT_SLOP_PX) : true;
      if (fullyInScroll && !hiddenByDock) settled = cardBox;
      return { fullyInScroll, hiddenByDock };
    })
    .toMatchObject({ fullyInScroll: true, hiddenByDock: false });
  if (!settled) {
    throw new Error(`${viewportName} で${label}の矩形がドックと交差している`);
  }
  return settled;
}

async function assertActionClearOfDock(
  page: Page,
  card: Locator,
  dockBox: Box,
  viewportName: string,
  label: string,
): Promise<void> {
  const action = card.getByTestId(/difficulty-.*-action/);
  await expect(action).toBeVisible();
  assertCardClearOfDock(await readBox(action, label), dockBox, viewportName, label);
}

test.describe('title difficulty cards stay above launch dock', () => {
  for (const viewport of CARD_DOCK_VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height} でカード下端がドックに隠れない`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?seed=title-launch-cta');
      await expect(page.getByTestId('title')).toBeVisible();

      const { dockBox } = await assertTitleShellKeepsDockInFlow(page, viewport);

      const cards = page.locator('.difficulty-card');
      const cardCount = await cards.count();
      expect(cardCount, `${viewport.name} で難易度カードが無い`).toBeGreaterThan(1);

      const firstViewFitsAll = viewport.width >= 1280 && viewport.height >= 800;
      if (firstViewFitsAll) {
        for (let index = 0; index < cardCount; index += 1) {
          const card = cards.nth(index);
          await expect(card).toBeVisible();
          assertCardClearOfDock(
            await readBox(card, `難易度カード${index + 1}`),
            dockBox,
            viewport.name,
            `初見の難易度カード${index + 1}全文`,
          );
          await assertActionClearOfDock(
            page,
            card,
            dockBox,
            viewport.name,
            `初見の「この組織で始める」${index + 1}`,
          );
        }
      } else {
        await assertCardScrolledClearOfDock(page, cards.first(), viewport.name, 'Easyカード全文');
        await assertActionClearOfDock(
          page,
          cards.first(),
          await readBox(page.getByTestId('title-launch-dock'), '開始ドック'),
          viewport.name,
          'Easy の「この組織で始める」',
        );
      }

      for (let index = 0; index < cardCount; index += 1) {
        const card = cards.nth(index);
        await assertCardScrolledClearOfDock(
          page,
          card,
          viewport.name,
          `難易度カード${index + 1}下端`,
        );
        await assertCardScrolledClearOfDock(
          page,
          card.getByTestId(/difficulty-.*-action/),
          viewport.name,
          `「この組織で始める」${index + 1}`,
        );
      }

      await page.locator('.difficulty-card:not([disabled])').last().click();
      const lastCard = page.locator('.difficulty-card:not([disabled])').last();
      const cardBox = await assertCardScrolledClearOfDock(
        page,
        lastCard,
        viewport.name,
        '選択中の難易度カード下端',
      );

      const startRun = page.getByTestId('start-run');
      await expect(startRun).toBeVisible();
      const startBox = await readBox(startRun, '開始 CTA');
      expect(
        overlaps(cardBox, startBox, LAYOUT_SLOP_PX),
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

test('タイトルの列数は860/861/900/901pxで幅モードと同じ正本を使う', async ({ page }) => {
  await page.goto('/?seed=title-width-unify');
  await expect(page.getByTestId('title')).toBeVisible();

  for (const [width, expectedWidth, columns, dock] of [
    [560, 'narrow', 1, 'stack'],
    [860, 'narrow', 1, 'split'],
    [861, 'narrow', 1, 'split'],
    [900, 'narrow', 1, 'split'],
    [901, 'wide', 4, 'wide'],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('html')).toHaveAttribute('data-responsive-width', expectedWidth);
    const layout = await page.evaluate(() => {
      const grid = document.querySelector('.difficulty-grid');
      const daily = document.querySelector('[data-testid="start-daily-run"]');
      const start = document.querySelector('[data-testid="start-run"]');
      if (!grid || !daily || !start) throw new Error('タイトル列の要素が無い');
      const dailyBox = daily.getBoundingClientRect();
      const startBox = start.getBoundingClientRect();
      return {
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
        startBelowDaily: startBox.y > dailyBox.y + 8,
        startRightOfDaily: startBox.x > dailyBox.x + dailyBox.width - 8,
      };
    });
    expect(layout.columns, `${width}px の難易度列数が違う`).toBe(columns);
    if (dock === 'stack') {
      expect(layout.startBelowDaily, `${width}px でドックが縦積みでない`).toBe(true);
    } else {
      expect(layout.startRightOfDaily, `${width}px で開始 CTA がデイリーの右にない`).toBe(true);
    }
  }
});
