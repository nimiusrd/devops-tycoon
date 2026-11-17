import { recruitCandidateView } from '../../src/render/recruitCandidateView';
import { expect, test, type Page } from './fixtures';

/** 公開操作だけで最初の採用ビートへ進む。候補や能力をテストから作らない。 */
async function openRecruit(page: Page) {
  await page.goto('/?seed=recruit-sample&renderer=pixi');
  await expect(page.getByTestId('title')).toBeVisible();
  const state = await page.evaluate(() => {
    const game = window.game!;
    game.startRun('easy', [], 'recruit-sample-7');
    game.pause();
    for (let step = 0; step < 80; step += 1) {
      const state = game.getState();
      if (state.status !== 'playing') break;
      switch (state.phase) {
        case 'recruit':
          return state;
        case 'setup':
          game.beginSetupSprint();
          game.pause();
          break;
        case 'sprint':
          game.step(180000);
          break;
        case 'result':
          game.acknowledgeResult();
          break;
        case 'draft':
          game.skipDraft();
          break;
        case 'evolution':
          game.finishEvolution();
          break;
        case 'beat':
          game.resolveBeat(state.beat?.kind === 'judgment' ? undefined : 0);
          break;
        case 'shop':
          game.leaveShop();
          break;
        case 'rest':
          game.restChoose('heal');
          break;
        case 'quarterReview':
          game.acknowledgeQuarterReview();
          break;
        default:
          throw new Error(`採用へ進めない: ${state.phase}`);
      }
    }
    throw new Error('採用ビートに到達しなかった');
  });
  await expect(page.getByTestId('recruit')).toBeVisible();
  return state;
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`${viewport.width}pxで実候補・仕事例・比較を読み、同じ人物を採用できる`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: viewport.width === 320 ? 'reduce' : 'no-preference' });
    const state = await openRecruit(page);
    const preview = recruitCandidateView(state)!;
    const candidate = page.getByTestId('recruit-candidate');
    await expect(candidate).toContainText(preview.member.name);
    await expect(candidate).toContainText(preview.sample.example);
    const summary = page.getByText('在籍メンバーと比較する', { exact: true });
    await summary.focus();
    await page.keyboard.press('Enter');
    const select = page.getByTestId('recruit-compare-select');
    await select.selectOption(state.roster.members[1].id);
    await expect(page.getByTestId('recruit-comparison-member')).toContainText(
      state.roster.members[1].name,
    );
    await expect(candidate).toContainText(preview.sample.example);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const control of [
      select,
      page.getByTestId('recruit-hire'),
      page.getByTestId('recruit-skip'),
    ]) {
      await control.evaluate((element) =>
        element.scrollIntoView({ block: 'center', inline: 'nearest' }),
      );
      await expect(control).toBeInViewport({ ratio: 0.99 });
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(box.y).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await candidate.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('recruit.png') });
    const hire = page.getByTestId('recruit-hire');
    await hire.focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId('setup')).toBeVisible({ timeout: 20000 });
    const hired = await page.evaluate(() => window.game!.getState().roster.members.at(-1));
    expect(hired).toEqual(preview.member);
    const memberCard = page.getByTestId(`formation-member-${preview.member.id}`);
    await expect(memberCard).toContainText(preview.member.name);
    await expect(memberCard.locator('.fm-stats')).toContainText(
      String(preview.member.stats.implementation),
    );
    await page.getByTestId('begin-sprint').click();
    await page.evaluate(() => window.game!.pause());
    await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi', {
      timeout: 20000,
    });
    await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  });
}

test('保存再開でも候補・仕事の例を引き直さず、プレビューした本人を迎える', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await openRecruit(page);
  const preview = recruitCandidateView(state)!;
  await page.reload();
  const resume = page.getByTestId('resume-run');
  await expect(resume).toBeEnabled();
  await resume.click();
  await expect(page.getByTestId('recruit-candidate')).toContainText(preview.member.name);
  await expect(page.getByTestId('recruit-work-sample')).toContainText(preview.sample.example);
  await page.getByTestId('recruit-hire').click();
  await expect(page.getByTestId('setup')).toBeVisible({ timeout: 20000 });
  const hired = await page.evaluate(() => window.game!.getState().roster.members.at(-1));
  expect(hired).toEqual(preview.member);
});
