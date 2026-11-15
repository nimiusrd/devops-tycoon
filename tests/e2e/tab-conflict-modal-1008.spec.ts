import { expect, type Page } from '@playwright/test';
import type { MetaState } from '../../src/state/meta';
import { test } from './fixtures';
import { seedMeta } from './seedMeta';

type Box = { x: number; y: number; width: number; height: number };

type TabGameWindow = Window & {
  game?: {
    purchaseMetaUnlock(unlockId: string): { ok: boolean };
    setSoundMuted(muted: boolean): void;
    startRun(difficulty?: string, trials?: string[], seed?: string): unknown;
    beginSetupSprint(): unknown;
    pause(): void;
    zoomTo(level: string): void;
  };
};

const initialMeta: MetaState = {
  points: 100,
  unlockedDifficulties: ['easy', 'normal'],
  defeatedBosses: [],
  achievements: ['review-exceeded'],
  bestScore: 0,
  unlockedCards: [],
  unlockedRelics: [],
};

async function seedBoth(page: Page, other: Page) {
  await seedMeta(page, initialMeta);
  await seedMeta(other, initialMeta);
}

async function triggerMetaConflict(other: Page, page: Page) {
  expect(
    await page.evaluate(() => (window as TabGameWindow).game?.purchaseMetaUnlock('unlock-devin')),
  ).toEqual({ ok: true });
  await other.evaluate(() => (window as TabGameWindow).game?.setSoundMuted(false));
}

async function openConflictOnTitle(page: Page, other: Page, seed: string) {
  await other.setViewportSize(page.viewportSize() ?? { width: 1280, height: 720 });
  await seedBoth(page, other);
  await page.goto(`/?seed=${seed}-a`);
  await other.goto(`/?seed=${seed}-b`);
  await expect(other.getByTestId('title')).toBeVisible();
  const opener = other.getByTestId('open-help');
  await opener.focus();
  await expect(opener).toBeFocused();
  await triggerMetaConflict(other, page);
  await expect(other.getByTestId('tab-conflict-overlay')).toBeVisible();
  return opener;
}

function overlaps(a: Box, b: Box): boolean {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0.5 && height > 0.5;
}

function insideFrame(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x - 1 &&
    inner.y >= outer.y - 1 &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1
  );
}

async function focusedTestId(page: Page) {
  return page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
}

for (const width of [320, 390, 1280] as const) {
  test(`${width}px: Esc で競合モーダルを閉じ、直前の操作へフォーカスが戻る`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 568 });
    const other = await page.context().newPage();
    const opener = await openConflictOnTitle(page, other, `conflict-esc-${width}`);
    await other.keyboard.press('Escape');
    await expect(other.getByTestId('tab-conflict-overlay')).toHaveCount(0);
    await expect(other.getByTestId('tab-conflict-quiet')).toBeVisible();
    await expect.poll(() => focusedTestId(other)).toBe('open-help');
    await expect(opener).toBeFocused();
  });

  test(`${width}px: 枠外タップで競合モーダルを閉じ、バナー本体は閉じない`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 568 });
    const other = await page.context().newPage();
    await openConflictOnTitle(page, other, `conflict-scrim-${width}`);
    const notice = other.getByTestId('tab-conflict-notice');
    await notice.click({ position: { x: 12, y: 12 } });
    await expect(other.getByTestId('tab-conflict-overlay')).toBeVisible();

    const viewport = other.viewportSize();
    expect(viewport).not.toBeNull();
    await other.mouse.click(Math.min(12, viewport!.width - 4), viewport!.height - 8);
    await expect(other.getByTestId('tab-conflict-overlay')).toHaveCount(0);
    await expect(other.getByTestId('tab-conflict-quiet')).toBeVisible();
    await expect.poll(() => focusedTestId(other)).toBe('open-help');
  });
}

for (const width of [320, 390, 1280] as const) {
  test(`${width}px: 常駐チップのボタンは重ならず、保存停止中が見え、他オーバーレイの背面になる`, async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const height = width === 1280 ? 720 : width === 390 ? 844 : 568;
    await page.setViewportSize({ width, height });
    const other = await page.context().newPage();
    await other.setViewportSize({ width, height });
    await seedBoth(page, other);
    const seed = `conflict-chip-${width}`;
    await page.goto(`/?seed=${seed}-a`);
    await other.goto(`/?tutorial=off&seed=${seed}-b`);
    await expect(other.getByTestId('title')).toBeVisible();
    await other.evaluate((runSeed) => {
      const game = (window as TabGameWindow).game;
      if (!game) throw new Error('game missing');
      game.startRun('easy', [], runSeed);
      game.beginSetupSprint();
      game.pause();
    }, seed);
    await expect(other.getByTestId('open-formation')).toBeVisible();

    await triggerMetaConflict(other, page);
    await expect(other.getByTestId('tab-conflict-export')).toBeVisible();
    await other.getByTestId('tab-conflict-continue').click();
    await expect(other.getByTestId('tab-conflict-overlay')).toHaveCount(0);

    const chip = other.getByTestId('tab-conflict-quiet');
    await expect(chip).toBeVisible();
    await expect(chip).toHaveJSProperty('inert', false);
    const detail = chip.locator('.persistence-notice-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('保存停止中');
    const detailShown = await detail.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && rect.width > 0 && rect.height > 0;
    });
    expect(detailShown).toBe(true);

    const chipBox = await chip.boundingBox();
    const exportBox = await other.getByTestId('tab-conflict-export').boundingBox();
    const reloadBox = await other.getByTestId('tab-conflict-reload').boundingBox();
    expect(chipBox).not.toBeNull();
    expect(exportBox).not.toBeNull();
    expect(reloadBox).not.toBeNull();
    for (const box of [exportBox!, reloadBox!]) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeLessThanOrEqual(320);
      expect(insideFrame(box, chipBox!)).toBe(true);
    }
    expect(overlaps(exportBox!, reloadBox!)).toBe(false);
    if (width === 1280) {
      expect(Math.abs(exportBox!.y - reloadBox!.y)).toBeLessThan(1);
      expect(exportBox!.x + exportBox!.width).toBeLessThanOrEqual(reloadBox!.x + 1);
    }

    const fontSize = await detail.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(fontSize).toBeGreaterThanOrEqual(11);

    const formationReachable = await other.evaluate(() => {
      const button = document.querySelector('[data-testid="open-formation"]');
      if (!(button instanceof HTMLElement)) return false;
      const rect = button.getBoundingClientRect();
      const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return top instanceof Node && button.contains(top);
    });
    expect(formationReachable).toBe(true);
    await other.getByTestId('open-formation').evaluate((button) => {
      if (button instanceof HTMLButtonElement) button.click();
    });
    await expect(other.getByTestId('formation')).toBeVisible();
    await expect(chip).toHaveJSProperty('inert', true);
    await other.getByTestId('formation-close').click({ trial: true });
    await other.getByTestId('formation-close').click();
    await expect(other.getByTestId('formation')).toHaveCount(0);
    await expect(chip).toHaveJSProperty('inert', false);

    await other.evaluate(() => (window as TabGameWindow).game?.zoomTo('company'));
    await expect(other.getByTestId('zoom-overlay')).toHaveAttribute('data-level', 'company');
    await expect(chip).toHaveJSProperty('inert', true);
    await other.getByTestId('crumb-team').click({ trial: true });
  });
}
