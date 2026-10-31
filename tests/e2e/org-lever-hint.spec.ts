import type { Page } from '@playwright/test';
import { expect, test, type PublicGameWindow } from './fixtures';

const VIEWPORTS = [
  { name: '320', width: 320, height: 568 },
  { name: '1280', width: 1280, height: 800 },
] as const;

interface ButtonBox {
  id: string;
  x: number;
  y: number;
}

async function startQ1(page: Page): Promise<void> {
  await page.goto('/?seed=org-lever-hint');
  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.startRun('easy', [], 'org-lever-hint');
    game.pause();
  });
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('open-org')).toBeVisible();
}

/** 組織レバー以外のランバーボタン。案内の出入りで位置が変わらない契約。 */
async function otherRunbarButtons(page: Page): Promise<ButtonBox[]> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-testid="runbar"]');
    if (!root) throw new Error('runbar がありません');
    return [...root.querySelectorAll('button')]
      .filter((button) => button.getAttribute('data-testid') !== 'open-org')
      .map((button) => {
        const box = button.getBoundingClientRect();
        return {
          id: button.getAttribute('data-testid') ?? '',
          x: box.x,
          y: box.y,
        };
      });
  });
}

function expectSamePositions(before: ButtonBox[], after: ButtonBox[]): void {
  expect(after.map((box) => box.id)).toEqual(before.map((box) => box.id));
  expect(before.length).toBeGreaterThan(0);
  for (const [index, previous] of before.entries()) {
    expect(after[index]?.x, `${previous.id} の x`).toBe(previous.x);
    expect(after[index]?.y, `${previous.id} の y`).toBe(previous.y);
  }
}

for (const viewport of VIEWPORTS) {
  test(`Q1開始で組織レバーが見え、案内は開くと消え、他ボタンは動かない (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1(page);

    const opener = page.getByTestId('open-org');
    await expect(opener).toBeInViewport();
    await expect(opener).toHaveAccessibleName(/組織レバー/);
    await expect(opener).toHaveAttribute('data-org-lever-hint', 'true');
    const hint = page.getByTestId('org-lever-hint');
    await expect(hint).toHaveText('予算は組織レバーで使えます');
    await expect(page.getByTestId('org-lever-hint-mark')).toBeVisible();
    await expect(hint).toHaveCSS('position', 'absolute');

    const before = await otherRunbarButtons(page);
    const openerBefore = await opener.boundingBox();
    expect(openerBefore).not.toBeNull();

    await opener.click();
    await expect(page.getByTestId('org-levers')).toBeVisible();
    await expect(hint).toHaveCount(0);
    await expect(page.getByTestId('org-lever-hint-mark')).toHaveCount(0);

    await page.getByTestId('crumb-team').click();
    await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(hint).toHaveCount(0);
    await expect(opener).toHaveAttribute('data-org-lever-hint', 'false');

    const after = await otherRunbarButtons(page);
    expectSamePositions(before, after);
    const openerAfter = await opener.boundingBox();
    expect(openerAfter?.x).toBe(openerBefore?.x);
    expect(openerAfter?.y).toBe(openerBefore?.y);

    await opener.click();
    await expect(page.getByTestId('org-levers')).toBeVisible();
    await page.getByTestId('crumb-team').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(hint).toHaveCount(0);
    expectSamePositions(before, await otherRunbarButtons(page));
  });
}
