import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

const NARROW_VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
] as const;

const DESKTOP = { name: 'desktop', width: 1280, height: 800 } as const;

async function openSetup(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await page.goto('/?seed=setup-term-tip');
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('setup-term-tips')).toBeVisible();
}

async function summaryOffsets(
  page: Page,
): Promise<{ text: string | null; x: number; y: number }[]> {
  return page.getByTestId('setup-term-tips').evaluate((host) => {
    const hostRect = host.getBoundingClientRect();
    return [...host.querySelectorAll('summary')].map((summary) => {
      const rect = summary.getBoundingClientRect();
      return {
        text: summary.textContent,
        x: Math.round(rect.left - hostRect.left),
        y: Math.round(rect.top - hostRect.top),
      };
    });
  });
}

async function expectPanelFullyVisible(page: Page, testId: string): Promise<void> {
  const visible = await page.getByTestId(testId).evaluate((panel) => {
    const rect = panel.getBoundingClientRect();
    const hits = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y);
      return target !== null && (target === panel || panel.contains(target));
    };
    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      inViewport:
        rect.top >= -1 &&
        rect.left >= -1 &&
        rect.bottom <= window.innerHeight + 1 &&
        rect.right <= window.innerWidth + 1 &&
        rect.height > 0 &&
        rect.width > 0,
      topHit: hits(rect.left + 8, rect.top + 4),
      bottomHit: hits(rect.left + 8, rect.bottom - 4),
    };
  });
  expect(visible.inViewport, `${testId} が画面内にない ${JSON.stringify(visible)}`).toBe(true);
  expect(visible.topHit, `${testId} の上端が別の要素に隠れている`).toBe(true);
  expect(visible.bottomHit, `${testId} の下端が別の要素に隠れている`).toBe(true);
}

for (const viewport of NARROW_VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}x${viewport.height} で用語チップを開いても位置を保ち、定義が画面内に収まる（#950）`, async ({
    page,
  }) => {
    await openSetup(page, viewport.width, viewport.height);
    const before = await summaryOffsets(page);
    expect(
      before.map((item) => item.y),
      `${viewport.name} で用語が横一列`,
    ).toEqual([before[0]?.y, before[0]?.y, before[0]?.y]);

    await page.getByTestId('term-tip-aiLiteracy').locator('summary').click();
    await expect(page.getByTestId('term-tip-aiLiteracy-panel')).toBeVisible();
    const afterLiteracy = await summaryOffsets(page);
    expect(afterLiteracy, `${viewport.name} で AIリテラシーを開いてもチップがずれない`).toEqual(
      before,
    );
    await expectPanelFullyVisible(page, 'term-tip-aiLiteracy-panel');
    const stacked = await page.getByTestId('setup-term-tips').evaluate((host) => {
      const hint = host.previousElementSibling;
      const panel = host.querySelector('[data-testid="term-tip-aiLiteracy-panel"]');
      if (!(panel instanceof HTMLElement) || !(hint instanceof HTMLElement)) return null;
      const panelRect = panel.getBoundingClientRect();
      const hintRect = hint.getBoundingClientRect();
      const summaries = [...host.querySelectorAll('summary')].map((summary) => {
        const rect = summary.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return {
          belowPanel: rect.bottom <= panelRect.top + 1,
          hittable: hit !== null && (hit === summary || summary.contains(hit)),
        };
      });
      return {
        paddingBottom: getComputedStyle(host).paddingBottom,
        panelBelowHint: panelRect.top >= hintRect.bottom - 1,
        summaries,
      };
    });
    expect(stacked, `${viewport.name} の用語配置が取れない`).not.toBeNull();
    expect(stacked?.paddingBottom, `${viewport.name} で定義の高さが予約されない`).not.toBe('0px');
    expect(stacked?.panelBelowHint, `${viewport.name} で定義が説明文に重なる`).toBe(true);
    for (const summary of stacked?.summaries ?? []) {
      expect(summary.belowPanel, `${viewport.name} で定義がチップに重なる`).toBe(true);
      expect(summary.hittable, `${viewport.name} で開いたあとにチップを押せない`).toBe(true);
    }

    const literacyBox = await page.getByTestId('term-tip-aiLiteracy-panel').boundingBox();
    const observationBox = await page.getByTestId('setup-observation-slot').boundingBox();
    if (!literacyBox || !observationBox) throw new Error('定義か案内の領域が取得できない');
    expect(observationBox.y, `${viewport.name} で定義が案内に重なる`).toBeGreaterThanOrEqual(
      literacyBox.y + literacyBox.height - 1,
    );

    await page.getByTestId('term-tip-pr').locator('summary').click();
    await expect(page.getByTestId('term-tip-pr-panel')).toBeVisible();
    await expect(page.getByTestId('term-tip-aiLiteracy-panel')).toBeHidden();
    expect(
      await summaryOffsets(page),
      `${viewport.name} で別の用語へ替えてもチップがずれない`,
    ).toEqual(before);
    await expectPanelFullyVisible(page, 'term-tip-pr-panel');

    const prBox = await page.getByTestId('term-tip-pr-panel').boundingBox();
    const observationAfter = await page.getByTestId('setup-observation-slot').boundingBox();
    if (!prBox || !observationAfter) throw new Error('PR の定義か案内の領域が取得できない');
    expect(observationAfter.y, `${viewport.name} で短い定義の下に空きが残りすぎる`).toBeLessThan(
      prBox.y + prBox.height + 24,
    );

    await page.getByTestId('term-tip-pr').locator('summary').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('term-tip-pr-panel')).toBeHidden();
    const closedSpace = await page
      .getByTestId('setup-term-tips')
      .evaluate((host) => getComputedStyle(host).paddingBottom);
    expect(closedSpace, `${viewport.name} で閉じたあとも下段の空きが残る`).toBe('0px');
    expect(await summaryOffsets(page)).toEqual(before);

    const overflow = await page.evaluate(() => {
      const setup = document.querySelector('[data-testid="setup"]');
      return {
        html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        setup: setup instanceof HTMLElement ? setup.scrollWidth - setup.clientWidth : Number.NaN,
      };
    });
    expect(overflow.html, `${viewport.name} でページが横にはみ出す`).toBeLessThanOrEqual(1);
    expect(overflow.setup, `${viewport.name} で編成画面が横にはみ出す`).toBeLessThanOrEqual(1);

    await page.getByTestId('term-tip-aiLiteracy').locator('summary').click();
    await expectPanelFullyVisible(page, 'term-tip-aiLiteracy-panel');
    await page.screenshot({
      path: test.info().outputPath(`setup-term-tip-${viewport.width}.png`),
      fullPage: false,
    });
  });
}

test(`${DESKTOP.name} ${DESKTOP.width}x${DESKTOP.height} では用語チップを開いたレイアウトを変えない（#950）`, async ({
  page,
}) => {
  await openSetup(page, DESKTOP.width, DESKTOP.height);
  const tip = page.getByTestId('term-tip-aiLiteracy');
  await tip.locator('summary').click();
  const panel = page.getByTestId('term-tip-aiLiteracy-panel');
  await expect(panel).toBeVisible();
  await expectPanelFullyVisible(page, 'term-tip-aiLiteracy-panel');

  const layout = await tip.evaluate((details) => {
    const panel = details.querySelector('.term-tip-panel');
    const host = details.closest('.setup-term-tips');
    const detailsRect = details.getBoundingClientRect();
    const hostRect = host?.getBoundingClientRect();
    return {
      panelPosition: panel instanceof HTMLElement ? getComputedStyle(panel).position : '',
      hostPadding: host instanceof HTMLElement ? getComputedStyle(host).paddingBottom : '',
      widthRatio: hostRect && hostRect.width > 0 ? detailsRect.width / hostRect.width : Number.NaN,
    };
  });
  expect(layout.panelPosition).toBe('static');
  expect(layout.hostPadding).toBe('0px');
  expect(layout.widthRatio, 'wide では開いたチップが行幅を使う').toBeGreaterThan(0.95);

  await page.locator('.formation-head').screenshot({
    path: test.info().outputPath('setup-term-tip-1280.png'),
  });
});
