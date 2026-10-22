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

for (const viewport of [
  ...NARROW_SETUP_VIEWPORTS,
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'desktop-wide', width: 1440, height: 900 },
]) {
  test(`${viewport.width}pxで今回見る一点が出入りしても編成と開始の操作位置が動かない（#928）`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({
      reducedMotion: viewport.width === 320 ? 'reduce' : 'no-preference',
    });
    await page.goto('/?renderer=pixi&tutorial=off&seed=devops-tycoon');
    await page.getByTestId('difficulty-easy').click();
    await page.getByTestId('start-run').click();
    const setup = page.getByTestId('setup');
    const forecast = setup.getByTestId('formation-forecast');
    await expect(forecast).toHaveAttribute('data-what-if-status', 'ready', { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(setup.getByTestId('setup-observation')).toHaveCount(0);
    await page.locator('.formation-panel').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const coding = setup.getByTestId('assign-m2-coding');
    await expect(coding).toBeInViewport();
    const positions = () =>
      setup
        .locator(
          '.formation-member, .fm-lane, .fm-ai, .formation-forecast, [data-testid="begin-sprint"]',
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { id: element.getAttribute('data-testid'), x, y, width, height };
          }),
        );
    const before = await positions();
    await coding.click();
    await expect(setup.getByTestId('setup-observation-review-staff')).toContainText(
      'Review担当 0人',
    );
    expect(await positions()).toEqual(before);
    await expect(forecast).toHaveAttribute('data-what-if-status', 'ready', { timeout: 15_000 });
    expect(await positions()).toEqual(before);
    await setup.getByTestId('assign-m2-review').click();
    await expect(setup.getByTestId('setup-observation')).toHaveCount(0);
    expect(await positions()).toEqual(before);
    await expect(forecast).toHaveAttribute('data-what-if-status', 'ready', { timeout: 15_000 });
    expect(await positions()).toEqual(before);
  });
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
]) {
  test(`${viewport.width}pxでコーディング担当不在に開始前に気づき、その場で配置を直せる（#927）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/?renderer=pixi&tutorial=off&seed=qa-seed-1022c');
    await page.getByTestId('difficulty-easy').click();
    await page.getByTestId('start-run').click();
    const setup = page.getByTestId('setup');
    // 通常の観察案内を閉じた後も、コーダー不在の警告は抑制しない。
    await setup.getByTestId('assign-m2-coding').click();
    await setup.getByTestId('setup-observation-dismiss').click();
    for (const id of ['m0', 'm1', 'm2']) {
      await setup.getByTestId(`assign-${id}-review`).click();
    }
    const warning = setup.getByTestId('setup-observation-coding-staff');
    await warning.scrollIntoViewIfNeeded();
    await expect(warning).toBeInViewport();
    await expect(warning).toContainText('コーディング担当 0人');
    await expect(warning).toContainText('出荷は0になります');
    await expect(warning).toContainText('下のメンバー配置');
    await expect(setup.getByTestId('setup-observation-dismiss')).toHaveCount(0);
    await expect(setup.getByTestId('begin-sprint')).toHaveAccessibleDescription(
      /コーディング担当 0人.*出荷は0になります/,
    );
    await setup.getByTestId('begin-sprint').focus();
    await expect(setup.getByTestId('begin-sprint')).toBeInViewport();
    await expect(warning).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: testInfo.outputPath('setup-no-coders.png'), fullPage: true });
    await page.screenshot({ path: testInfo.outputPath('setup-no-coders-start.png') });
    await setup.getByTestId('assign-m0-coding').click();
    await expect(warning).toHaveCount(0);
    await expect(setup.getByTestId('begin-sprint')).not.toHaveAttribute('aria-describedby');
    const state = await page.evaluate(() => (window as GameWindow).game!.getState());
    expect(state.phase).toBe('setup');
    expect(
      state.roster.members.filter((m) => !m.onLeave && m.assignment === 'coding'),
    ).toHaveLength(1);
    await setup.getByTestId('begin-sprint').click();
    await expect(page.getByTestId('board')).toBeVisible();
  });
}

for (const viewport of [
  ...NARROW_SETUP_VIEWPORTS,
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'desktop-wide', width: 1440, height: 900 },
]) {
  test(`${viewport.width}pxでAI配布不可の理由をホバーなしで読める（#815）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?seed=formation-disabled-reason');
    await page.getByTestId('difficulty-normal').click();
    await page.getByTestId('start-run').click();
    const setup = page.getByTestId('setup');
    const ai = setup.getByTestId('ai-m2');
    const reason = setup.getByTestId('formation-member-m2').locator('.fm-ai-reason');
    await expect(ai).toBeDisabled();
    await expect(reason).toHaveText('コーディング担当にのみ配れます');
    await expect(reason).toBeVisible();
    await expect(reason).toHaveCSS('font-size', '12px');
    await expect(ai).toHaveAccessibleDescription('コーディング担当にのみ配れます');
    await expect(ai).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(ai).toHaveCSS('border-style', 'dashed');
    await expect(ai).toHaveCSS('opacity', '1');
    const buttonBox = await ai.boundingBox();
    const reasonBox = await reason.boundingBox();
    if (!buttonBox || !reasonBox) throw new Error('AIボタンと理由の位置を取得できない');
    expect(reasonBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height);
    const member = setup.getByTestId('formation-member-m2');
    expect(await member.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await member.scrollIntoViewIfNeeded();
    await member.screenshot({ path: test.info().outputPath(`ai-disabled-${viewport.width}.png`) });

    await page.getByTestId('open-formation').click();
    const dialog = page.getByTestId('formation');
    await expect(dialog.getByTestId('ai-m2')).toHaveAccessibleDescription(
      'コーディング担当にのみ配れます',
    );
    await expect(dialog.getByTestId('formation-member-m2').locator('.fm-ai-reason')).toBeVisible();
    const ids = await page
      .locator('.fm-ai-reason')
      .evaluateAll((elements) => elements.map((el) => el.id));
    expect(new Set(ids).size).toBe(ids.length);
    await dialog.getByTestId('assign-m2-coding').click();
    await expect(dialog.getByTestId('ai-m2')).toBeEnabled();
    await expect(dialog.getByTestId('ai-m2')).not.toHaveAttribute('aria-describedby');
    const placeholder = dialog.getByTestId('formation-member-m2').locator('.fm-ai-reason');
    await expect(placeholder).toBeHidden();
    await expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    await page.keyboard.press('Escape');
    await expect(setup.getByTestId('ai-m2')).toBeEnabled();
  });
}

for (const viewport of [
  ...NARROW_SETUP_VIEWPORTS,
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'desktop-wide', width: 1440, height: 900 },
]) {
  test(`${viewport.width}pxで一覧の下端から担当を切り替えても編成の操作位置が動かない（#920）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?renderer=pixi&tutorial=off&seed=devops-tycoon');
    await page.getByTestId('difficulty-easy').click();
    await page.getByTestId('start-run').click();
    const setup = page.getByTestId('setup');
    await expect(setup).toBeVisible();

    // 狭幅では末尾カードの理由を消し、デスクトップでは同じ行のカードへ理由を出す。
    const memberId = viewport.width < 1024 ? 'm2' : 'm0';
    const initial = viewport.width < 1024 ? 'bench' : 'coding';
    const changed = viewport.width < 1024 ? 'coding' : 'review';
    await setup.getByTestId(`assign-${memberId}-${initial}`).click();
    const dismissObservation = setup.getByTestId('setup-observation-dismiss');
    if (await dismissObservation.isVisible()) await dismissObservation.click();
    const forecast = setup.getByTestId('formation-forecast');
    await expect(forecast).toHaveAttribute('data-what-if-status', 'ready', { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    expect(await forecast.evaluate((element) => element.getBoundingClientRect().height)).toBe(66);
    await page.locator('.formation-panel').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const changedButton = setup.getByTestId(`assign-${memberId}-${changed}`);
    await expect(changedButton).toBeInViewport();

    const positions = () =>
      setup
        .locator(
          '.formation-member, .fm-lane, .fm-ai, .formation-forecast, [data-testid="begin-sprint"]',
        )
        .evaluateAll((elements) =>
          elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { id: element.getAttribute('data-testid'), x, y, width, height };
          }),
        );
    const before = await positions();
    await changedButton.click();
    await expect(changedButton).toHaveAttribute('aria-pressed', 'true');
    expect(await positions()).toEqual(before);
    // 非同期の予測結果が出た後も、初回の切り替えと同じ位置を維持する。
    await expect(forecast).toHaveAttribute('data-what-if-status', 'ready', { timeout: 15_000 });
    expect(await positions()).toEqual(before);

    // 逆方向でも理由の出入りによる高さ・スクロール位置の変化を起こさない。
    const initialButton = setup.getByTestId(`assign-${memberId}-${initial}`);
    await initialButton.click();
    await expect(initialButton).toHaveAttribute('aria-pressed', 'true');
    expect(await positions()).toEqual(before);
    await expect(forecast).toHaveAttribute('data-what-if-status', 'ready', { timeout: 15_000 });
    expect(await positions()).toEqual(before);
    await setup
      .getByTestId(`formation-member-${memberId}`)
      .screenshot({ path: test.info().outputPath(`assignment-stable-${viewport.width}.png`) });
  });
}

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
  const start = page.getByRole('button', { name: 'スプリント開始' });
  await start.focus();
  await expect(start).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('board')).toBeVisible();
});

test('RunBar の編成は dialog へフォーカスし、Escape で起点へ戻る', async ({ page }) => {
  await page.goto('/?seed=formation-overlay-a11y');
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();

  const openButton = page.getByTestId('open-formation');
  await openButton.focus();
  await expect(openButton).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByTestId('formation');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(page.locator('.app-background')).toHaveAttribute('inert', '');
  await expect(dialog).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.app-background')).not.toHaveAttribute('inert');
  await expect(openButton).toBeFocused();
});
