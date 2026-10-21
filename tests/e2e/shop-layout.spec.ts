import { expect, test, type Page } from './fixtures';

/** 報告時の seed を公開操作だけで Q2 の採用つきショップまで進める。 */
async function openRecruitShop(page: Page) {
  await page.goto('/?seed=devops-tycoon');
  await expect(page.getByTestId('title')).toBeVisible();
  await page.evaluate(() => {
    const game = window.game;
    if (!game) throw new Error('window.game が公開されていない');
    game.startRun('easy', [], 'devops-tycoon');
    game.pause();
    for (let guard = 0; guard < 60000; guard += 1) {
      const state = game.getState();
      if (state.phase === 'shop' && state.quarterNumber >= 2 && state.shop?.recruit) return;
      switch (state.phase) {
        case 'setup':
          game.beginSetupSprint();
          game.pause();
          break;
        case 'sprint': {
          if ((state.sprint?.tasks.filter((task) => task.lane === 'review').length ?? 0) >= 6)
            game.dispatch('interruptReview');
          if (state.sprint?.tasks.some((task) => task.incident)) game.dispatch('firefight');
          game.step(300);
          break;
        }
        case 'result':
          game.acknowledgeResult();
          break;
        case 'draft':
          if (state.draft?.length) game.chooseCard(state.draft[0]);
          else game.skipDraft();
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
        case 'recruit':
          game.recruitChoose('skip');
          break;
        case 'quarterReview':
          if (state.quarterReview?.outcome === 'missed_adjustable')
            game.chooseGoalAdjustment(state.quarterReview.availableAdjustments[0] ?? 'cut_scope');
          else game.acknowledgeQuarterReview();
          break;
        default:
          throw new Error(`採用つきショップへ到達しない: ${state.phase}`);
      }
    }
    throw new Error('採用つきショップへ到達しない');
  });
  await expect(page.getByTestId('shop')).toBeVisible();
  await expect(page.getByTestId('shop-recruit')).toBeVisible();
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`${viewport.width}×${viewport.height}: 採用つきショップの退出ボタンが常に見える（#893）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await openRecruitShop(page);
    await expect(page.getByTestId('shop-scroll')).toHaveRole('region');
    await expect(page.getByTestId('shop-scroll')).toHaveAccessibleName('商品一覧');
    const leave = page.getByTestId('shop-leave');
    await expect(leave).toBeInViewport({ ratio: 1 });
    const initial = await leave.boundingBox();
    await page.screenshot({ path: testInfo.outputPath('ショップ初期表示.png') });
    const recruit = page.getByTestId('shop-recruit');
    await recruit.scrollIntoViewIfNeeded();
    await expect(recruit).toBeInViewport({ ratio: 1 });
    await expect(leave).toBeInViewport({ ratio: 1 });
    expect(await leave.boundingBox()).toEqual(initial);
    await leave.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('shop')).toHaveCount(0);
  });
}
