import { expect, test } from './fixtures';
import type { GameHandle } from '../../src/game';

type GameWindow = Window & {
  game: GameHandle;
  __forceBoardPixiInitFailure?: { delayMs: number };
  __delayBoardPixiInit?: { delayMs: number };
};

async function start(page: import('@playwright/test').Page) {
  // 廃止したクエリがブックマークに残っていてもGPUで起動する。
  await page.goto('/?renderer=dom&seed=webgl-required');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();
}
async function tick(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as GameWindow).game.getState().sprintTick);
}

test('GPU初期化に失敗すると進行を止め、キーボードで再試行して同じランを再開できる', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as GameWindow).__forceBoardPixiInitFailure = { delayMs: 50 };
  });
  await start(page);
  const dialog = page.getByRole('dialog', { name: '盤面を表示できませんでした' });
  await expect(dialog).toBeVisible();
  const before = await tick(page);
  expect(before).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(500);
  expect(await tick(page)).toBe(before);
  await expect(
    page.locator('.task-dot, .station-actor, .fire-effects, .intervention-effects'),
  ).toHaveCount(0);
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeInViewport();
    await expect(page.getByTestId('webgl-retry')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('webgl-retry')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('webgl-retry')).toBeFocused();
  await page.evaluate(() => {
    delete (window as GameWindow).__forceBoardPixiInitFailure;
    (window as GameWindow).__delayBoardPixiInit = { delayMs: 1500 };
  });
  await dialog.evaluate((element) => element.setAttribute('data-retry-continuity', 'true'));
  await page.keyboard.press('Enter');
  const retrying = page.getByRole('dialog', { name: 'オフィスを準備しています' });
  await expect(retrying).toBeVisible();
  await expect(retrying).toHaveAttribute('data-retry-continuity', 'true');
  await expect(retrying).toBeFocused();
  await page.waitForTimeout(400);
  expect(await tick(page)).toBe(before);
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect.poll(() => tick(page)).toBeGreaterThan(before ?? 0);
});

test('GPU準備中は進行と操作を停止し、準備後に自動進行する', async ({ page }) => {
  await page.addInitScript(() => {
    (window as GameWindow).__delayBoardPixiInit = { delayMs: 1500 };
  });
  await start(page);
  await expect(page.getByRole('dialog', { name: 'オフィスを準備しています' })).toBeVisible();
  const before = await tick(page);
  expect(before).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(400);
  expect(await tick(page)).toBe(before);
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect.poll(() => tick(page)).toBeGreaterThan(before ?? 0);
});

for (const level of ['company', 'department'] as const) {
  test(`${level}でGPU準備中・失敗中のEscapeが背面へ伝わらず、同じビューで再試行できる`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (window as GameWindow).__forceBoardPixiInitFailure = { delayMs: 2000 };
    });
    await start(page);
    await page.evaluate((target) => {
      const game = (window as GameWindow).game;
      if (target === 'department') game.focusDept('product');
      else game.zoomTo('company');
    }, level);
    const zoomLevel = () => page.evaluate(() => (window as GameWindow).game.getState().zoom.level);
    const loading = page.getByRole('dialog', { name: 'オフィスを準備しています' });
    await expect(loading).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await zoomLevel()).toBe(level);
    await expect(loading).toBeVisible();

    const failed = page.getByRole('dialog', { name: '盤面を表示できませんでした' });
    await expect(failed).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await zoomLevel()).toBe(level);
    await expect(failed).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('webgl-retry')).toBeFocused();
    await page.evaluate(() => {
      delete (window as GameWindow).__forceBoardPixiInitFailure;
    });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('webgl-status')).toHaveCount(0);
    expect(await zoomLevel()).toBe(level);
    await expect(
      page.getByTestId(level === 'company' ? 'org-pixi-mount' : 'dept-pixi-mount'),
    ).toBeVisible();
    // ダイアログ終了後は通常のEscapeによる現場への移動が再び有効になる。
    await page.keyboard.press('Escape');
    await expect.poll(zoomLevel).toBe('team');
  });
}

for (const scene of [
  { level: 'team', module: 'BoardPixiLayer', mount: 'board-pixi-mount' },
  { level: 'company', module: 'OrgPixiField', mount: 'org-pixi-mount' },
  { level: 'department', module: 'DeptPixiBoard', mount: 'dept-pixi-mount' },
] as const) {
  test(`${scene.level}の描画チャンク取得失敗からランと階層を保持して再試行できる`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let available = false;
    let requests = 0;
    await page.route(
      new RegExp(`/(?:src/ui/${scene.module}\\.tsx|assets/${scene.module}-[^/]+\\.js)(?:\\?.*)?$`),
      async (route) => {
        requests += 1;
        if (available) await route.continue();
        else await route.abort('failed');
      },
    );
    await start(page);
    if (scene.level !== 'team') {
      await expect(page.getByTestId('webgl-status')).toHaveCount(0);
      await page.evaluate((level) => {
        const game = (window as GameWindow).game;
        if (level === 'department') game.focusDept('product');
        else game.zoomTo('company');
      }, scene.level);
    }
    const failed = page.getByRole('dialog', { name: '盤面を表示できませんでした' });
    await expect(failed).toBeVisible();
    const before = await page.evaluate(() => {
      const state = (window as GameWindow).game.getState();
      return { seed: state.seed, zoom: state.zoom, tick: state.sprintTick };
    });
    await page.waitForTimeout(300);
    expect(await tick(page)).toBe(before.tick);
    // まだ通信が回復していない再試行でも、Reactツリーと復旧操作を失わない。
    await page.getByTestId('webgl-retry').click();
    await expect(failed).toBeVisible();
    expect(await tick(page)).toBe(before.tick);

    available = true;
    await page.getByTestId('webgl-retry').click();
    await expect(page.getByTestId('webgl-status')).toHaveCount(0);
    await expect(page.getByTestId(scene.mount).locator('canvas')).not.toHaveCount(0);
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(
      await page.evaluate(() => {
        const state = (window as GameWindow).game.getState();
        return { seed: state.seed, zoom: state.zoom };
      }),
    ).toEqual({ seed: before.seed, zoom: before.zoom });
    // 全社・部署の閲覧中は仕様として停止するため、現場へ戻って再開を確認する。
    if (scene.level !== 'team') await page.keyboard.press('Escape');
    await expect.poll(() => tick(page)).toBeGreaterThan(before.tick);
    expect(pageErrors).toEqual([]);
  });
}
