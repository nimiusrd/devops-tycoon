import type { Page } from '@playwright/test';
import { beginCurrentSetupSprint, expect, test, type PublicGameWindow } from './fixtures';

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
async function otherRunbarButtons(page: Page, origin: 'viewport' | 'runbar'): Promise<ButtonBox[]> {
  return page.evaluate((relativeTo) => {
    const root = document.querySelector('[data-testid="runbar"]');
    if (!root) throw new Error('runbar がありません');
    const originBox = root.getBoundingClientRect();
    return [...root.querySelectorAll('button')]
      .filter((button) => button.getAttribute('data-testid') !== 'open-org')
      .map((button) => {
        const box = button.getBoundingClientRect();
        return {
          id: button.getAttribute('data-testid') ?? '',
          x: relativeTo === 'runbar' ? box.x - originBox.x : box.x,
          y: relativeTo === 'runbar' ? box.y - originBox.y : box.y,
        };
      });
  }, origin);
}

/** 案内の文字が組織レバーの枠の中に収まり、枠からはみ出していない。 */
async function hintFitsInOrgPill(page: Page): Promise<{
  fits: boolean;
  scrollWidth: number;
  clientWidth: number;
  textWidth: number;
  pillWidth: number;
  pillHeight: number;
}> {
  return page.evaluate(() => {
    const hint = document.querySelector('[data-testid="org-lever-hint"]');
    const pill = document.querySelector('[data-testid="open-org"]');
    if (!(hint instanceof HTMLElement) || !pill) {
      return {
        fits: false,
        scrollWidth: 0,
        clientWidth: 0,
        textWidth: 0,
        pillWidth: 0,
        pillHeight: 0,
      };
    }
    const range = document.createRange();
    range.selectNodeContents(hint);
    const textBox = range.getBoundingClientRect();
    const pillBox = pill.getBoundingClientRect();
    const fits =
      textBox.width > 0 &&
      textBox.height > 0 &&
      textBox.left >= pillBox.left - 0.5 &&
      textBox.right <= pillBox.right + 0.5 &&
      textBox.top >= pillBox.top - 0.5 &&
      textBox.bottom <= pillBox.bottom + 0.5 &&
      textBox.width <= pillBox.width + 0.5;
    return {
      fits,
      scrollWidth: hint.scrollWidth,
      clientWidth: hint.clientWidth,
      textWidth: textBox.width,
      pillWidth: pillBox.width,
      pillHeight: pillBox.height,
    };
  });
}

async function overlaps(page: Page, hintId: string, targetId: string): Promise<boolean> {
  return page.evaluate(
    ({ hintTestId, targetTestId }) => {
      const hint = document.querySelector(`[data-testid="${hintTestId}"]`);
      const target = document.querySelector(`[data-testid="${targetTestId}"]`);
      if (!hint || !target) throw new Error(`${hintTestId} または ${targetTestId} がありません`);
      const a = hint.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right;
    },
    { hintTestId: hintId, targetTestId: targetId },
  );
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
    const fitted = await hintFitsInOrgPill(page);
    expect(fitted.fits, JSON.stringify(fitted)).toBe(true);

    const before = await otherRunbarButtons(page, 'viewport');
    const openerBefore = await opener.boundingBox();
    const runbarBefore = await page.getByTestId('runbar').boundingBox();
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

    const after = await otherRunbarButtons(page, 'viewport');
    expectSamePositions(before, after);
    const openerAfter = await opener.boundingBox();
    const runbarAfter = await page.getByTestId('runbar').boundingBox();
    expect(openerAfter?.x).toBe(openerBefore?.x);
    expect(openerAfter?.y).toBe(openerBefore?.y);
    expect(openerAfter?.width).toBe(openerBefore?.width);
    expect(openerAfter?.height).toBe(openerBefore?.height);
    expect(runbarAfter?.height).toBe(runbarBefore?.height);

    await opener.click();
    await expect(page.getByTestId('org-levers')).toBeVisible();
    await page.getByTestId('crumb-team').click();
    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(hint).toHaveCount(0);
    expectSamePositions(before, await otherRunbarButtons(page, 'viewport'));
  });

  test(`案内を残したスプリントでも種別と速度操作に重ならない (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1(page);
    await expect(page.getByTestId('org-lever-hint')).toBeVisible();

    await beginCurrentSetupSprint(page);
    const hint = page.getByTestId('org-lever-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText('予算は組織レバーで使えます');
    const fitted = await hintFitsInOrgPill(page);
    expect(fitted.fits, JSON.stringify(fitted)).toBe(true);
    expect(await overlaps(page, 'org-lever-hint', 'speed-controls')).toBe(false);
    expect(await overlaps(page, 'org-lever-hint', 'sprint-kind')).toBe(false);
    expect(await overlaps(page, 'org-lever-hint', 'board')).toBe(false);
    expect(await overlaps(page, 'org-lever-hint', 'action-bar')).toBe(false);
    await expect(page.getByTestId('sprint-kind')).toBeVisible();
    await expect(page.getByTestId('speed-1x')).toBeVisible();

    const before = await otherRunbarButtons(page, 'runbar');
    await page.getByTestId('open-org').click();
    await expect(page.getByTestId('org-levers')).toBeVisible();
    await page.getByTestId('crumb-team').click();
    await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
    await expect(hint).toHaveCount(0);
    expectSamePositions(before, await otherRunbarButtons(page, 'runbar'));
  });
}
