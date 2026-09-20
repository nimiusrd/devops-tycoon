import { expect, test } from './fixtures';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
  };
};

test('編成（Setup）画面でメンバーの配置と AI 配布を切り替えてスプリントを開始できる（第12章）', async ({
  page,
}) => {
  await page.goto('/?seed=formation-smoke');
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-run').click();
  // ラン開始直後は編成（Setup）。
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('setup-term-tips')).toBeVisible();
  const prSummary = page.getByTestId('term-tip-pr').locator('summary');
  const prHit = await prSummary.boundingBox();
  if (!prHit) throw new Error('PRチップの bounding box が取得できない');
  expect(prHit.width, 'PRチップのタップ幅が 24px 未満').toBeGreaterThanOrEqual(24);
  expect(prHit.height, 'PRチップのタップ高が 24px 未満').toBeGreaterThanOrEqual(24);
  const rework = page.getByTestId('term-tip-rework');
  await rework.locator('summary').click();
  await expect(page.getByTestId('term-tip-rework-panel')).toBeVisible();
  await expect(page.getByTestId('term-tip-rework-panel')).toContainText('作り直し');
  await page.getByTestId('term-tip-pr').locator('summary').click();
  await expect(page.getByTestId('term-tip-pr-panel')).toBeVisible();
  await expect(page.getByTestId('term-tip-rework-panel')).toBeHidden();
  await page.getByTestId('term-tip-pr').locator('summary').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('term-tip-pr-panel')).toBeHidden();
  await expect(page.getByTestId('term-tip-pr').locator('summary')).toBeFocused();

  // 初期ロスターの3メンバーが表示される（m0/m1/m2）。
  await expect(page.getByTestId('formation-member-m0')).toBeVisible();
  await expect(page.getByTestId('formation-member-m1')).toBeVisible();
  await expect(page.getByTestId('formation-member-m2')).toBeVisible();

  // レビュアー(m2)をコーディングへ移すと、配置ボタンの選択状態が変わる。
  await page.getByTestId('assign-m2-coding').click();
  await expect(page.getByTestId('assign-m2-coding')).toHaveClass(/active/);

  const assignment = await page.evaluate(
    () =>
      (window as GameWindow).game!.getState().roster.members.find((m) => m.id === 'm2')?.assignment,
  );
  expect(assignment).toBe('coding');

  // AI 配布をトグルする（m0）。
  const before = await page.evaluate(
    () =>
      (window as GameWindow).game!.getState().roster.members.find((m) => m.id === 'm0')?.aiAssigned,
  );
  await page.getByTestId('ai-m0').click();
  const after = await page.evaluate(
    () =>
      (window as GameWindow).game!.getState().roster.members.find((m) => m.id === 'm0')?.aiAssigned,
  );
  expect(after).toBe(!before);

  // 編成を確定してスプリントを開始する。
  await page.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('board')).toBeVisible();
});

const NARROW_SETUP_VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
] as const;

test.describe('narrow setup is a reachable 1-column stack', () => {
  for (const viewport of NARROW_SETUP_VIEWPORTS) {
    test(`${viewport.name} ${viewport.width}x${viewport.height} で配置と開始が1カラムで到達できる`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/?seed=formation-narrow-1col');
      await page.getByTestId('difficulty-normal').click();
      await page.getByTestId('start-run').click();
      await expect(page.getByTestId('setup')).toBeVisible();
      const prHit = await page.getByTestId('term-tip-pr').locator('summary').boundingBox();
      if (!prHit) throw new Error(`${viewport.name} で PRチップの bounding box が取得できない`);
      expect(
        prHit.width,
        `${viewport.name} で PRチップのタップ幅が 24px 未満`,
      ).toBeGreaterThanOrEqual(24);
      expect(
        prHit.height,
        `${viewport.name} で PRチップのタップ高が 24px 未満`,
      ).toBeGreaterThanOrEqual(24);

      const heading = page.locator('.formation-head .draft-title');
      const begin = page.getByTestId('begin-sprint');
      const headingBox = await heading.boundingBox();
      const beginBox = await begin.boundingBox();
      const panelBox = await page.locator('.formation-panel').boundingBox();
      if (!headingBox || !beginBox || !panelBox) {
        throw new Error('編成見出し / 開始ボタン / パネルの bounding box が取得できない');
      }
      expect(beginBox.y, `${viewport.name} で開始ボタンが見出しと横並びのまま`).toBeGreaterThan(
        headingBox.y + headingBox.height - 1,
      );
      expect(beginBox.width, `${viewport.name} で開始ボタンが全幅になっていない`).toBeGreaterThan(
        panelBox.width * 0.8,
      );

      const firstMember = page.getByTestId('formation-member-m0');
      const secondMember = page.getByTestId('formation-member-m1');
      const firstBox = await firstMember.boundingBox();
      const secondBox = await secondMember.boundingBox();
      if (!firstBox || !secondBox) throw new Error('編成カードの bounding box が取得できない');
      expect(secondBox.y, `${viewport.name} で編成グリッドが1列になっていない`).toBeGreaterThan(
        firstBox.y + firstBox.height - 8,
      );

      await page.getByTestId('assign-m2-coding').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('assign-m2-coding')).toBeInViewport();
      await begin.scrollIntoViewIfNeeded();
      await expect(begin).toBeInViewport();

      const overflow = await page.evaluate(() => {
        const setup = document.querySelector('[data-testid="setup"]');
        const panel = document.querySelector('.formation-panel');
        const app = document.querySelector('.app');
        const setupBox = setup?.getBoundingClientRect();
        const panelBox = panel?.getBoundingClientRect();
        return {
          html: document.documentElement.scrollWidth <= window.innerWidth + 1,
          setup: setup === null || setup.scrollWidth <= setup.clientWidth + 1,
          app: app === null || app.scrollWidth <= app.clientWidth + 1,
          panelFits:
            setup === null ||
            panel === null ||
            Math.ceil(panel.getBoundingClientRect().width) <= setup.clientWidth + 1,
          panelInViewport: panelBox === null || panelBox.right <= window.innerWidth + 1,
          setupInViewport: setupBox === null || setupBox.right <= window.innerWidth + 1,
        };
      });
      expect(overflow.html, `${viewport.name} でページ横スクロールが発生している`).toBe(true);
      expect(overflow.app, `${viewport.name} で .app が横にはみ出している`).toBe(true);
      expect(overflow.setup, `${viewport.name} で編成コンテナが横スクロールしている`).toBe(true);
      expect(overflow.panelFits, `${viewport.name} で編成パネルが親幅を超えている`).toBe(true);
      expect(
        overflow.panelInViewport,
        `${viewport.name} で編成パネルがビューポート右端を超えている`,
      ).toBe(true);
      expect(
        overflow.setupInViewport,
        `${viewport.name} で編成コンテナがビューポート右端を超えている`,
      ).toBe(true);
    });
  }
});

test('SETUP 390×844 は報告 seed でもページと編成パネルの横スクロールが無い（#489）', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?seed=devops-tycoon&tutorial=off');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  const setup = page.getByTestId('setup');
  await expect(setup).toBeVisible();
  await expect(page.locator('.formation-panel')).toBeVisible();

  const overflow = await page.evaluate(() => {
    const setupEl = document.querySelector('[data-testid="setup"]');
    const panel = document.querySelector('.formation-panel');
    const cards = [...document.querySelectorAll('.formation-member, .map-banner, .setup-okr')];
    return {
      html: document.documentElement.scrollWidth <= window.innerWidth + 1,
      setup: setupEl === null || setupEl.scrollWidth <= setupEl.clientWidth + 1,
      panelFits:
        setupEl === null ||
        panel === null ||
        Math.ceil(panel.getBoundingClientRect().width) <= setupEl.clientWidth + 1,
      cardsInViewport: cards.every(
        (card) => card.getBoundingClientRect().right <= window.innerWidth + 1,
      ),
    };
  });
  expect(overflow.html, 'ページ横スクロールが発生している').toBe(true);
  expect(overflow.setup, '編成コンテナが横スクロールしている').toBe(true);
  expect(overflow.panelFits, '編成パネルが親幅を超えている').toBe(true);
  expect(overflow.cardsInViewport, '主要カードがビューポート幅を超えている').toBe(true);
});

test('ランバーにメンバーの表情が表示される（表情演出 / 第12.2）', async ({ page }) => {
  await page.goto('/?seed=faces-smoke');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('roster-faces')).toBeVisible();
  // 3メンバー分の表情絵文字が並ぶ。
  await expect(page.getByTestId('roster-faces').locator('span')).toHaveCount(3);
});

test('編成は見出しと開始CTAの名前が付き、キーボードで開始できる', async ({ page }) => {
  await page.goto('/?seed=setup-a11y');
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByRole('main', { name: /編成/ })).toBeVisible();
  await expect(page.getByTestId('assign-m0-coding')).toHaveAttribute('aria-pressed', /true|false/);
  const start = page.getByRole('button', { name: 'スプリントを開始' });
  await start.focus();
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('board')).toBeVisible();
});
