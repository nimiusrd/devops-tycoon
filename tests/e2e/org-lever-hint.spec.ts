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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
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

async function usedFontSize(page: Page, selector: string): Promise<number> {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLElement)) return 0;
    return Number.parseFloat(getComputedStyle(element).fontSize);
  }, selector);
}

async function boxOf(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} の寸法が取れません`);
  return box;
}

function expectSamePositions(before: ButtonBox[], after: ButtonBox[]): void {
  expect(after.map((box) => box.id)).toEqual(before.map((box) => box.id));
  expect(before.length).toBeGreaterThan(0);
  for (const [index, previous] of before.entries()) {
    expect(after[index]?.x, `${previous.id} の x`).toBe(previous.x);
    expect(after[index]?.y, `${previous.id} の y`).toBe(previous.y);
  }
}

function expectSameBox(before: Box, after: Box, label: string): void {
  expect(after.x, `${label} x`).toBe(before.x);
  expect(after.y, `${label} y`).toBe(before.y);
  expect(after.width, `${label} width`).toBe(before.width);
  expect(after.height, `${label} height`).toBe(before.height);
}

for (const viewport of VIEWPORTS) {
  test(`Q1開始の編成に案内行があり、ボタン名は見えたまま開くと消える (${viewport.name})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1(page);

    const opener = page.getByTestId('open-org');
    await expect(opener).toBeInViewport();
    await expect(opener).toHaveAccessibleName(/組織レバー/);
    await expect(opener).toHaveAttribute('data-org-lever-hint', 'true');
    await expect(opener).toContainText('🗺');
    await expect(opener).toContainText('組織レバー');
    const labelVisible = await page.evaluate(() => {
      const label = document.querySelector('[data-testid="open-org"] .org-pill-label');
      if (!(label instanceof HTMLElement)) return false;
      const style = getComputedStyle(label);
      return style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) > 0;
    });
    expect(labelVisible).toBe(true);

    const hint = page.getByTestId('org-lever-hint');
    await expect(hint).toHaveText('予算は組織レバーで使えます');
    await expect(page.getByTestId('setup')).toContainText('予算は組織レバーで使えます');
    await expect(page.getByTestId('runbar')).not.toContainText('予算は組織レバーで使えます');
    await expect(page.getByTestId('org-lever-hint-mark')).toBeVisible();

    const labelSize = await usedFontSize(page, '[data-testid="open-org"] .org-pill-label');
    const hintSize = await usedFontSize(page, '[data-testid="org-lever-hint"]');
    console.log(`font-size setup ${viewport.name} label=${labelSize} hint=${hintSize}`);
    expect(labelSize).toBeGreaterThanOrEqual(11);
    expect(hintSize).toBeGreaterThanOrEqual(11);
    await page.screenshot({ path: testInfo.outputPath(`setup-${viewport.name}.png`) });

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
    await expect(opener).toContainText('組織レバー');

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

  test(`スプリント中は案内文を出さず、点の有無で盤面とランバーが動かない (${viewport.name})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1(page);
    await beginCurrentSetupSprint(page);

    await expect(page.getByTestId('org-lever-hint')).toHaveCount(0);
    await expect(page.getByTestId('org-lever-hint-mark')).toBeVisible();
    const opener = page.getByTestId('open-org');
    await expect(opener).toContainText('🗺');
    await expect(opener).toContainText('組織レバー');
    await expect(opener).toHaveAttribute('data-org-lever-hint', 'true');
    const labelSize = await usedFontSize(page, '[data-testid="open-org"] .org-pill-label');
    console.log(`font-size sprint ${viewport.name} label=${labelSize}`);
    expect(labelSize).toBeGreaterThanOrEqual(11);
    await page.screenshot({ path: testInfo.outputPath(`sprint-${viewport.name}.png`) });

    const boardBefore = await boxOf(page, 'board');
    const runbarBefore = await boxOf(page, 'runbar');
    const buttonsBefore = await otherRunbarButtons(page, 'runbar');

    await opener.click();
    await expect(page.getByTestId('org-levers')).toBeVisible();
    await page.getByTestId('crumb-team').click();
    await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
    await expect(page.getByTestId('org-lever-hint')).toHaveCount(0);
    await expect(page.getByTestId('org-lever-hint-mark')).toHaveCount(0);
    await expect(opener).toHaveAttribute('data-org-lever-hint', 'false');

    expectSameBox(boardBefore, await boxOf(page, 'board'), 'board');
    expectSameBox(runbarBefore, await boxOf(page, 'runbar'), 'runbar');
    expectSamePositions(buttonsBefore, await otherRunbarButtons(page, 'runbar'));
  });

  test(`ラン中の編成は開いた時点の案内行を出し、スプリントの盤面は動かない (${viewport.name})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1(page);
    await beginCurrentSetupSprint(page);
    await expect(page.getByTestId('org-lever-hint')).toHaveCount(0);

    const boardBefore = await boxOf(page, 'board');
    const runbarBefore = await boxOf(page, 'runbar');
    await page.getByTestId('open-formation').click();
    await expect(page.getByTestId('formation')).toBeVisible();
    const hint = page.getByTestId('org-lever-hint');
    await expect(hint).toHaveText('予算は組織レバーで使えます');
    const hintSize = await usedFontSize(page, '[data-testid="org-lever-hint"]');
    const labelSize = await usedFontSize(page, '[data-testid="open-org"] .org-pill-label');
    console.log(`font-size formation ${viewport.name} label=${labelSize} hint=${hintSize}`);
    expect(hintSize).toBeGreaterThanOrEqual(11);
    expect(labelSize).toBeGreaterThanOrEqual(11);
    await page.screenshot({ path: testInfo.outputPath(`formation-${viewport.name}.png`) });
    const insideFormation = await page.evaluate(() => {
      const row = document.querySelector('[data-testid="org-lever-hint"]');
      const formation = document.querySelector('[data-testid="formation"]');
      const runbar = document.querySelector('[data-testid="runbar"]');
      return !!row && !!formation && formation.contains(row) && !!runbar && !runbar.contains(row);
    });
    expect(insideFormation).toBe(true);
    expectSameBox(boardBefore, await boxOf(page, 'board'), 'board');
    expectSameBox(runbarBefore, await boxOf(page, 'runbar'), 'runbar');

    await page.getByTestId('formation-close').click();
    await expect(page.getByTestId('formation')).toHaveCount(0);
    await expect(page.getByTestId('org-lever-hint')).toHaveCount(0);
    expectSameBox(boardBefore, await boxOf(page, 'board'), 'board');
    expectSameBox(runbarBefore, await boxOf(page, 'runbar'), 'runbar');
  });
}
