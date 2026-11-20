import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.PLAYWRIGHT_PREVIEW === '1', '試作はViteの開発用ルートでのみ提供する');
test.setTimeout(60_000);

const TRIAL = '/?rd=office-build';
const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function openOffice(page: Page) {
  await page.goto(TRIAL);
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await expect(page.getByTestId('count-review')).toHaveText('10');
  await expect(page.getByTestId('office-incidents')).toHaveText('炎上中 1 件');
}

for (const { name, width, height } of VIEWPORTS) {
  test(`${name} でオフィスと工程・予測・試走操作が見える`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openOffice(page);

    const board = page.getByTestId('board');
    const summary = page.getByRole('region', { name: '開発フローの工程別件数' });
    await summary.scrollIntoViewIfNeeded();
    await expect(summary).toBeInViewport({ ratio: 1 });
    await expect(summary.getByLabel('レビュー 10件')).toBeVisible();
    expect(await board.locator('canvas').count()).toBeGreaterThan(0);
    const stage = page.getByTestId('office-build-stage');
    const boardBox = (await stage.boundingBox())!;
    const summaryBox = (await summary.boundingBox())!;
    expect(summaryBox.x + summaryBox.width).toBeLessThanOrEqual(boardBox.x + boardBox.width);
    expect(summaryBox.y + summaryBox.height).toBeLessThan(boardBox.y);
    const backlog = page.getByTestId('overflow-backlog');
    const backlogBox = (await backlog.boundingBox())!;
    expect(backlogBox.y).toBeGreaterThan(summaryBox.y + summaryBox.height);
    await expect(backlog).toBeVisible();

    for (const title of [
      'Coding',
      'Review',
      '担当とAI配布',
      '開始時の変化と見込み',
      'プランを試す',
    ]) {
      const heading = page.getByRole('heading', { name: title, exact: true });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeInViewport();
    }

    await expect(page.getByText('初期プランの見込み')).toBeVisible();
    const apply = page.getByRole('button', { name: 'プランを適用して試走' });
    await apply.scrollIntoViewIfNeeded();
    // 小数座標の交差領域はブラウザの丸めで1をわずかに下回る。
    await expect(apply).toBeInViewport({ ratio: 0.99 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

    await page.getByRole('button', { name: 'レビュー応援を選ぶ' }).click();
    const caption = page.getByText('変更案で始める場合の盤面です。');
    const captionBox = (await caption.boundingBox())!;
    const candidateSummary = (await summary.boundingBox())!;
    expect(captionBox.y + captionBox.height).toBeLessThanOrEqual(candidateSummary.y);
  });
}

test('キーボードで配置・AI配布・施策を選び、候補の取消と実際の適用を確認できる', async ({
  page,
}) => {
  await openOffice(page);
  expect(await page.evaluate(() => 'game' in window)).toBe(false);

  const normalGame = page.getByRole('link', { name: '通常ゲームへ戻る' });
  const member = page.getByRole('button', { name: /を選択（AI配布中）/ });
  const memberId = (await member.getAttribute('data-testid'))!;
  const review = page.getByRole('button', { name: 'Reviewに配置' });
  const ai = page.getByRole('button', { name: 'AIを配る' });
  const help = page.getByRole('button', { name: 'レビュー応援を選ぶ' });
  const status = page.getByTestId('office-review-help-status');
  const balances = page.getByTestId('office-build-balances');

  await page.keyboard.press('Tab');
  await expect(normalGame).toBeFocused();
  await member.focus();
  await page.keyboard.press('Enter');
  await expect(member).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '担当とAI配布' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Codingに配置' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(review).toBeFocused();
  await expect(review).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Codingに配置' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Space');
  await expect(review).toBeFocused();
  await expect(review).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('region', { name: 'Review', exact: true }).getByTestId(memberId),
  ).toBeVisible();
  await expect(ai).toBeDisabled();

  await help.focus();
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('適用候補');
  await expect(balances).toHaveText('予算 45 → 39 ・ Reviewの引き継ぎ 10 → 5 件');
  await expect(page.getByTestId('count-review')).toHaveText('5');
  await expect(page.locator('[data-lane="review"][data-action-target="true"]')).toBeVisible();
  await expect(page.getByText('変更案の見込み')).toBeVisible();
  await expect(page.getByText(/回試算/)).toHaveCount(2, { timeout: 15_000 });

  const cancel = page.getByRole('button', { name: '変更を取り消す' });
  await cancel.focus();
  await page.keyboard.press('Enter');
  await expect(cancel).toBeFocused();
  await expect(status).toHaveText('未適用');
  await expect(page.getByTestId('count-review')).toHaveText('10');
  await expect(ai).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('変更案の見込み')).toHaveCount(0);

  await ai.focus();
  await page.keyboard.press('Space');
  await expect(ai).toHaveAttribute('aria-pressed', 'false');
  await help.focus();
  await page.keyboard.press('Enter');
  const apply = page.getByRole('button', { name: 'プランを適用して試走' });
  await apply.focus();
  await page.keyboard.press('Enter');
  await expect(status).toHaveText('適用済み');
  await expect(page.getByTestId('count-review')).toHaveText('5');
  await expect(page.getByRole('heading', { name: 'スプリントを進める' })).toBeFocused();
  await expect(page.getByText('経過 0 tick')).toBeVisible();
  await expect(page.getByTestId('office-build-result')).toHaveCount(0);
  await page.getByRole('button', { name: '1 tick進める' }).click();
  await expect(page.getByText('経過 1 tick')).toBeVisible();

  const finish = page.getByRole('button', { name: '最後まで進める' });
  await finish.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('heading', { name: 'スプリントの実測' })).toBeFocused();
  await expect(page.getByTestId('office-build-result')).toContainText('AI利用 0%');
  await expect(page.getByText('適用プランの見込み')).toBeVisible();
  await page.getByRole('button', { name: '同じ条件でやり直す' }).click();
  await expect(status).toHaveText('未適用');
  await expect(page.getByRole('heading', { name: '準備中のオフィス' })).toBeFocused();
  await expect(page.getByTestId('count-review')).toHaveText('10');
  await expect(page.getByTestId('office-build-result')).toHaveCount(0);
});

test.describe('画面タッチ・動きの低減', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'reduce',
  });

  test('タッチで配置を選び直せ、動きを抑えても試走結果を読める', async ({ page }) => {
    await openOffice(page);
    const member = page.getByRole('button', { name: /を選択（AI配布中）/ });
    const memberId = (await member.getAttribute('data-testid'))!;
    const bench = page.getByRole('button', { name: '控えに配置' });
    const coding = page.getByRole('button', { name: 'Codingに配置' });
    const ai = page.getByRole('button', { name: 'AIを配る' });
    const help = page.getByRole('button', { name: 'レビュー応援を選ぶ' });
    const apply = page.getByRole('button', { name: 'プランを適用して試走' });

    for (const control of [member, bench, coding, ai, help, apply]) {
      const box = await control.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByTestId('board')).toHaveCSS('transition-duration', '0s');
    await member.tap();
    await bench.tap();
    await expect(
      page.getByRole('region', { name: '控え', exact: true }).getByTestId(memberId),
    ).toBeVisible();
    await expect(ai).toBeDisabled();
    await coding.tap();
    await ai.tap();
    await expect(ai).toHaveAttribute('aria-pressed', 'true');
    await help.tap();
    await help.tap();
    await expect(page.getByTestId('office-review-help-status')).toHaveText('未適用');
    await apply.tap();
    await page.getByRole('button', { name: '最後まで進める' }).tap();
    await expect(page.getByTestId('office-build-result')).toContainText('出荷');
  });
});

test('WebGLの失敗中は試走を開始できず、試作データの案内を読んで再試行できる', async ({ page }) => {
  await page.addInitScript(() => {
    window.__forceBoardPixiInitFailure = {};
  });
  await page.goto(TRIAL);
  const dialog = page.getByRole('dialog', { name: '盤面を表示できませんでした' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(
    dialog.getByText('再読み込みすると試作のプランと結果は初期状態に戻ります。'),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'プランを適用して試走', includeHidden: true }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    delete window.__forceBoardPixiInitFailure;
  });
  await dialog.getByRole('button', { name: '再試行' }).click();
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'プランを適用して試走' })).toBeEnabled();
});
