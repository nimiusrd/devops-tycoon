/**
 * #1005: 1024 / 1280 で開発フロー列名（Backlog など）が「Bac…」に省略されない。
 */
import { expect, test } from './fixtures';
import { beginPublicSprint } from './fixtures';

const FLOW_LABELS = ['Backlog', 'Coding', 'Review', 'Rework', 'Done'] as const;

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
] as const;

async function assertFlowNameNotEllipsized(
  page: import('@playwright/test').Page,
  label: string,
  viewportWidth: number,
): Promise<void> {
  const name = page.locator('.board-flow-name', { hasText: label }).first();
  await expect(name, `${label} が表示される`).toHaveText(label);
  const layout = await name.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      textOverflow: style.textOverflow,
      overflow: style.overflow,
      fontSize: parseFloat(style.fontSize),
      whiteSpace: style.whiteSpace,
    };
  });
  expect(
    layout.scrollWidth,
    `${label} が ${viewportWidth}px で省略されている（scrollWidth > clientWidth）`,
  ).toBeLessThanOrEqual(layout.clientWidth + 1);
  expect(layout.textOverflow, `${label} の text-overflow`).not.toBe('ellipsis');
  expect(layout.whiteSpace, `${label} が単語の途中で改行している`).toBe('nowrap');
  expect(layout.fontSize, `${label} のフォントが 11px 未満`).toBeGreaterThanOrEqual(11);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px: 開発フロー列名が省略されず全文表示される（#1005）`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await beginPublicSprint(page, { seed: `board-flow-labels-${viewport.width}` });
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByTestId('board-flow-summary')).toBeVisible();

    for (const label of FLOW_LABELS) {
      await assertFlowNameNotEllipsized(page, label, viewport.width);
    }

    const columnBoxes = await page.locator('.board-flow-list > li').evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { lane: item.getAttribute('data-lane') ?? '', right: box.right, left: box.left };
      }),
    );
    expect(columnBoxes).toHaveLength(FLOW_LABELS.length);
    for (let i = 0; i < columnBoxes.length - 1; i += 1) {
      expect(
        columnBoxes[i].right,
        `${columnBoxes[i].lane} と ${columnBoxes[i + 1].lane} の列が重なっている`,
      ).toBeLessThanOrEqual(columnBoxes[i + 1].left + 1);
    }
  });
}
