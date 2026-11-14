import type { Locator, Page } from '@playwright/test';
import { beginCurrentSetupSprint, expect, test, type PublicGameWindow } from './fixtures';
import { seedMeta } from './seedMeta';

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

async function exhaustBudgetInPlace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    const engine = (game as unknown as { engine: { budget: number } }).engine;
    engine.budget = 0;
    game.playCard(-1);
  });
}

async function fontSize(locator: Locator): Promise<number> {
  return locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
}

async function storedOrgLeverHintDismissed(page: Page): Promise<boolean | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('devops-tycoon');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (![...db.objectStoreNames].includes('runSave')) {
      db.close();
      return null;
    }
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction('runSave', 'readonly').objectStore('runSave').get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const extras = (value as { state?: { extras?: { orgLeverHintDismissed?: boolean } } }).state
      ?.extras;
    return extras?.orgLeverHintDismissed === true
      ? true
      : extras?.orgLeverHintDismissed === false
        ? false
        : null;
  });
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

function expectSamePositions(before: ButtonBox[], after: ButtonBox[]): void {
  expect(after.map((box) => box.id)).toEqual(before.map((box) => box.id));
  expect(before.length).toBeGreaterThan(0);
  for (const [index, previous] of before.entries()) {
    expect(after[index]?.x, `${previous.id} の x`).toBe(previous.x);
    expect(after[index]?.y, `${previous.id} の y`).toBe(previous.y);
  }
}

async function sprintFrame(page: Page): Promise<{
  board: { width: number; height: number };
  runbar: { x: number; y: number };
}> {
  return page.evaluate(() => {
    const layout = document.querySelector('[data-testid="sprint-layout"]');
    const board = document.querySelector('[data-testid="board"]');
    const runbar = document.querySelector('[data-testid="runbar"]');
    if (!layout || !board || !runbar) throw new Error('スプリントの枠がありません');
    // 組織レバー往復で枠内スクロールだけが変わっても、盤面寸法とランバーの配置は同じである。
    layout.scrollTop = 0;
    layout.scrollLeft = 0;
    const layoutBox = layout.getBoundingClientRect();
    const boardBox = board.getBoundingClientRect();
    const runbarBox = runbar.getBoundingClientRect();
    return {
      board: { width: boardBox.width, height: boardBox.height },
      runbar: {
        x: runbarBox.x - layoutBox.x + layout.scrollLeft,
        y: runbarBox.y - layoutBox.y + layout.scrollTop,
      },
    };
  });
}

for (const viewport of [
  { name: '320', width: 320, height: 568 },
  { name: '390', width: 390, height: 844 },
] as const) {
  test(`セットアップで組織レバー案内が最初から画面内にある (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1(page);

    const setupHint = page.getByTestId('setup').getByTestId('org-lever-hint');
    await expect(setupHint).toBeVisible();

    if (viewport.name === '320') {
      await expect(setupHint).toBeInViewport({ ratio: 1 });
      const hintBox = await setupHint.boundingBox();
      const viewportSize = page.viewportSize();
      expect(hintBox).not.toBeNull();
      expect(viewportSize).not.toBeNull();
      expect(hintBox!.y).toBeGreaterThanOrEqual(0);
      expect(hintBox!.y + hintBox!.height).toBeLessThanOrEqual(viewportSize!.height + 1);
      await expect(page.getByTestId('run-setup-org-lever-hint-slot')).toBeVisible();
    } else {
      await expect(setupHint).toBeInViewport();
      await expect(page.getByTestId('run-setup-org-lever-hint-slot')).toHaveCount(0);
    }
  });
}

test('組織レバー案内の role=status は1つで、ボタン説明にヒントが入る (320)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await startQ1(page);

  const hintStatuses = page.locator('[role="status"]', {
    hasText: '予算は組織レバーで使えます',
  });
  await expect(hintStatuses).toHaveCount(1);
  await expect(page.getByTestId('open-org')).toHaveAccessibleDescription(
    /予算は組織レバーで使えます/,
  );

  await page.getByTestId('open-formation').click();
  await expect(page.getByTestId('formation')).toBeVisible();
  await expect(hintStatuses).toHaveCount(1);
  await expect(page.getByTestId('open-org')).toHaveAccessibleDescription(
    /予算は組織レバーで使えます/,
  );
});

for (const viewport of VIEWPORTS) {
  test(`Q1の編成に案内があり、ボタンの文字は残り、他ボタンは動かない (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1(page);

    const opener = page.getByTestId('open-org');
    const setupHint = page.getByTestId('setup').getByTestId('org-lever-hint');
    await expect(opener).toBeInViewport();
    await expect(opener).toHaveAccessibleName(/組織レバー/);
    await expect(opener).toContainText('🗺');
    await expect(opener).toContainText('組織レバー');
    await expect(opener).toHaveAttribute('data-org-lever-hint', 'true');
    await expect(setupHint).toHaveText('予算は組織レバーで使えます');
    await expect(setupHint).toBeInViewport();
    await expect(page.getByTestId('org-lever-hint-mark')).toBeVisible();
    expect(await fontSize(opener)).toBeGreaterThanOrEqual(11);
    expect(await fontSize(setupHint)).toBeGreaterThanOrEqual(11);

    await page.getByTestId('open-formation').click();
    const formationHint = page.getByTestId('formation').getByTestId('org-lever-hint');
    await expect(formationHint).toHaveText('予算は組織レバーで使えます');
    expect(await fontSize(formationHint)).toBeGreaterThanOrEqual(11);
    await page.getByTestId('formation-close').click();
    await expect(page.getByTestId('formation')).toHaveCount(0);

    const before = await otherRunbarButtons(page, 'viewport');
    const openerBefore = await opener.boundingBox();
    expect(openerBefore).not.toBeNull();

    await opener.click();
    await expect(page.getByTestId('org-levers')).toBeVisible();
    await expect(page.getByTestId('org-lever-hint-mark')).toHaveCount(0);

    await page.getByTestId('crumb-team').click();
    await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
    await expect(page.getByTestId('setup')).toBeVisible();
    await expect(setupHint).toBeVisible();
    await expect(opener).toHaveAttribute('data-org-lever-hint', 'false');
    await expect(opener).toContainText('組織レバー');

    await page.getByTestId('open-formation').click();
    await expect(page.getByTestId('formation').getByTestId('org-lever-hint')).toHaveCount(0);
    await page.getByTestId('formation-close').click();

    const after = await otherRunbarButtons(page, 'viewport');
    expectSamePositions(before, after);
    const openerAfter = await opener.boundingBox();
    expect(openerAfter?.x).toBe(openerBefore?.x);
    expect(openerAfter?.y).toBe(openerBefore?.y);
    expect(openerAfter?.width).toBe(openerBefore?.width);
    expect(openerAfter?.height).toBe(openerBefore?.height);
  });

  test(`スプリント中は案内文がなく、盤面とランバーは動かない (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await startQ1(page);
    await beginCurrentSetupSprint(page);

    await expect(page.getByTestId('org-lever-hint')).toHaveCount(0);
    await expect(page.getByTestId('org-lever-hint-mark')).toBeVisible();
    await expect(page.getByTestId('open-org')).toContainText('組織レバー');
    expect(await fontSize(page.getByTestId('open-org'))).toBeGreaterThanOrEqual(11);

    const beforeFrame = await sprintFrame(page);
    const beforeButtons = await otherRunbarButtons(page, 'runbar');

    await page.getByTestId('open-org').click();
    await expect(page.getByTestId('org-levers')).toBeVisible();
    await page.getByTestId('crumb-team').click();
    await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.getByTestId('org-lever-hint')).toHaveCount(0);
    await expect(page.getByTestId('org-lever-hint-mark')).toHaveCount(0);

    expect(await sprintFrame(page)).toEqual(beforeFrame);
    expectSamePositions(beforeButtons, await otherRunbarButtons(page, 'runbar'));
  });
}

test('予算が尽きても開いている画面の案内行は残り、点だけ消える (#985)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startQ1(page);

  const setupHint = page.getByTestId('setup').getByTestId('org-lever-hint');
  const opener = page.getByTestId('open-org');
  await expect(setupHint).toBeVisible();
  await expect(page.getByTestId('org-lever-hint-mark')).toBeVisible();

  await page.getByTestId('open-formation').click();
  const formationHint = page.getByTestId('formation').getByTestId('org-lever-hint');
  await expect(formationHint).toBeVisible();

  await exhaustBudgetInPlace(page);
  await expect(formationHint).toBeVisible();
  await expect(page.getByTestId('org-lever-hint-mark')).toHaveCount(0);
  await expect(opener).toHaveAttribute('data-org-lever-hint', 'false');

  await page.getByTestId('formation-close').click();
  await expect(setupHint).toBeVisible();

  await page.getByTestId('open-formation').click();
  await expect(page.getByTestId('formation').getByTestId('org-lever-hint')).toHaveCount(0);
  await page.getByTestId('formation-close').click();
});

test('レバーを開いたあとリロードして再開しても案内と点が出ない', async ({ page }) => {
  await seedMeta(page, { points: 1 });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/?seed=org-lever-hint-reload');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.startRun('easy', [], 'org-lever-hint-reload');
  });
  await expect(page.getByTestId('setup')).toBeVisible();

  const opener = page.getByTestId('open-org');
  await opener.click();
  await expect(page.getByTestId('org-levers')).toBeVisible();
  await page.getByTestId('crumb-team').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('org-lever-hint-mark')).toHaveCount(0);
  await expect.poll(() => storedOrgLeverHintDismissed(page)).toBe(true);

  await page.reload();
  await expect(page.getByTestId('resume-run')).toBeVisible();
  await page.getByTestId('resume-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('org-lever-hint')).toHaveCount(0);
  await expect(page.getByTestId('org-lever-hint-mark')).toHaveCount(0);
  await expect(opener).toHaveAttribute('data-org-lever-hint', 'false');
});
