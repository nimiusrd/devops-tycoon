import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.PLAYWRIGHT_PREVIEW === '1', '試作はViteの開発用ルートでのみ提供する');

const TRIAL = '/?rd=release-forecast';
const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function openWithPausedClock(page: Page) {
  const start = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 60_000));
  await page.goto(TRIAL);
}

for (const { name, width, height } of VIEWPORTS) {
  test(`${name} で段階・次の予定・出荷ゲートと介入に到達できる`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(TRIAL);

    await expect(page.getByRole('heading', { name: '大型リリースの危機予告' })).toBeInViewport();
    await expect(page.getByRole('status')).toHaveText('現在 機能追加');
    await expect(page.getByText('次の予定 変更凍結')).toBeVisible();
    await expect(page.getByText('公開まで 残り 12 tick')).toBeVisible();
    await expect(
      page.getByText('公開期限までに、レビューと最終検証を通した機能を出荷する。'),
    ).toBeVisible();

    for (const title of ['リリース予定', '出荷ゲート', '介入と進行']) {
      const heading = page.getByRole('heading', { name: title });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeInViewport();
    }

    const freeze = page.getByRole('button', { name: '次のtickで変更凍結' });
    await freeze.scrollIntoViewIfNeeded();
    await expect(freeze).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

test('Pause・1倍速・2倍速を切り替えても、予定の意味はtickで決まる', async ({ page }) => {
  await openWithPausedClock(page);
  expect(await page.evaluate(() => 'game' in window)).toBe(false);
  const timeline = page.getByRole('list', { name: 'リリースの段階' });
  const scheduled = timeline.getByText('確定予定', { exact: true });
  const conditional = timeline.getByText('条件付き予定', { exact: true });
  await expect(scheduled).toBeVisible();
  await expect(conditional).toBeVisible();
  await expect(page.getByText('リスク不明')).toBeVisible();

  await page.clock.runFor(4000);
  await expect(page.getByText('経過 0 tick')).toBeVisible();

  await page.getByRole('button', { name: '1倍速' }).click();
  await expect(page.getByRole('button', { name: '1 tick 進める' })).toBeDisabled();
  await page.clock.runFor(2000);
  await expect(page.getByText('経過 1 tick')).toBeVisible();
  await expect(page.getByText('公開まで 残り 11 tick')).toBeVisible();

  await page.getByRole('button', { name: '2倍速' }).click();
  await expect(page.getByRole('button', { name: '2倍速' })).toHaveAttribute('aria-pressed', 'true');
  await page.clock.runFor(9000);
  await expect(page.getByText('経過 10 tick')).toBeVisible();
  await expect(page.getByText('手動で凍結しなければ次のtick処理で自動凍結')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('現在 機能追加');

  await page.getByRole('button', { name: '一時停止' }).click();
  await page.clock.runFor(4000);
  await expect(page.getByText('公開まで 残り 2 tick')).toBeVisible();
  await expect(scheduled).toBeVisible();
  await expect(conditional).toBeVisible();

  await page.getByRole('button', { name: '1 tick 進める' }).click();
  await expect(page.getByRole('status')).toHaveText('現在 変更凍結・検証');
  await expect(timeline.getByText('tick 10 に自動凍結')).toBeVisible();
  await expect(page.getByText('次の予定 公開判定')).toBeVisible();
  await expect(page.getByText('公開まで 残り 1 tick')).toBeVisible();

  await page.getByRole('button', { name: '2倍速' }).click();
  await page.clock.runFor(8000);
  await expect(page.getByRole('status')).toHaveText('現在 公開判定');
  await expect(page.getByText('経過 12 tick')).toBeVisible();
  await expect(page.getByText('23 pt')).toBeVisible();
  await expect(page.getByRole('button', { name: '1 tick 進める' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '次のtickで変更凍結' })).toBeDisabled();
});

test('キーボードで凍結予約・進行・リセットを操作できる', async ({ page }) => {
  await page.goto(TRIAL);
  const back = page.getByRole('link', { name: '通常ゲームへ戻る' });
  const freeze = page.getByRole('button', { name: '次のtickで変更凍結' });
  await expect(back).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(back).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(freeze).toBeFocused();
  await expect(freeze).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Shift+Tab');
  await expect(back).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByText('手動凍結を予約済み。次のtick処理で凍結')).toBeVisible();
  await expect(page.getByText('経過 0 tick')).toBeVisible();

  for (const name of ['一時停止', '1倍速', '2倍速', '1 tick 進める']) {
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name })).toBeFocused();
  }
  await page.keyboard.press('Space');
  await expect(page.getByRole('status')).toHaveText('現在 変更凍結・検証');
  await expect(page.getByText('tick 0 に手動凍結')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '最初から' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(freeze).toBeEnabled();
  await expect(page.getByText('経過 0 tick')).toBeVisible();
});

test.describe('画面タッチ・動きの低減', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });

  test('タッチで凍結を選べ、動きの低減時も予定・出荷ゲートを読める', async ({ page }) => {
    await openWithPausedClock(page);
    const freeze = page.getByRole('button', { name: '次のtickで変更凍結' });
    const step = page.getByRole('button', { name: '1 tick 進める' });

    for (const control of await page.getByRole('button').all()) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    await expect(page.getByText('リスク不明')).toBeVisible();
    for (let tick = 0; tick < 8; tick += 1) await step.tap();
    await expect(page.getByText('公開まで 残り 4 tick')).toBeVisible();
    await freeze.tap();
    await step.tap();
    await expect(page.getByText('tick 8 に手動凍結')).toBeVisible();
    for (let tick = 9; tick < 12; tick += 1) await step.tap();
    await expect(page.getByRole('status')).toHaveText('現在 公開判定');
    await expect(page.getByText('25 pt')).toBeVisible();
    await expect(page.getByText('リスク不明')).toHaveCount(0);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(
      true,
    );
  });
});
