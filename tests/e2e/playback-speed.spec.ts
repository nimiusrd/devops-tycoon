/**
 * プレイヤー Pause（#370）。❚❚ トグル・1x/2x 再開・停止中の手札ロック。
 * `game.pause()`（E2E 固定）とは独立した UI 速度コントロールを検証する。
 * 手札は公開 GameHandle のドラフト選択だけで用意し、engine は参照しない。
 */
import {
  advanceCurrentSprintToResult,
  beginCurrentSetupSprint,
  beginPublicSprint,
  expect,
  RI94_RELIC_CHOICE_BY_EVENT,
  test,
  type PublicGameWindow,
} from './fixtures';
import type { Page } from '@playwright/test';

/** 1 本目を公開 API で完走し、ドラフト採用後の次スプリントへ入る。 */
async function beginNextSprintWithDraftedHand(page: Page): Promise<void> {
  await beginPublicSprint(page, { seed: 'issue-370-pause', renderer: 'dom' });
  await advanceCurrentSprintToResult(page);
  await page.evaluate((relicChoiceByEvent) => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    let state = game.getState();
    let guard = 0;
    let drafted = false;
    while (state.phase !== 'setup' && guard < 60_000) {
      guard += 1;
      switch (state.phase) {
        case 'result':
          game.acknowledgeResult();
          break;
        case 'draft':
          if (state.draft && state.draft.length > 0) {
            game.chooseCard(state.draft[0]!);
            drafted = true;
          } else {
            game.skipDraft();
          }
          break;
        case 'evolution':
          game.finishEvolution();
          break;
        case 'beat': {
          const eventId = state.beat?.eventId;
          game.resolveBeat(eventId ? relicChoiceByEvent[eventId] : undefined);
          break;
        }
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
          if (state.quarterReview?.outcome === 'missed_adjustable') {
            game.chooseGoalAdjustment(state.quarterReview.availableAdjustments[0] ?? 'cut_scope');
          } else {
            game.acknowledgeQuarterReview();
          }
          break;
        default:
          throw new Error(`次スプリントへ進めない phase=${state.phase}`);
      }
      state = game.getState();
    }
    if (state.phase !== 'setup') {
      throw new Error(`setup に到達しない: phase=${state.phase} guard=${guard}`);
    }
    if (!drafted) throw new Error('ドラフトでカードを取れなかった');
  }, RI94_RELIC_CHOICE_BY_EVENT);
  await beginCurrentSetupSprint(page);
}

test('❚❚ はトグルでき、1x / 2x でも再開でき、停止中は手札を発動できない', async ({ page }) => {
  await beginNextSprintWithDraftedHand(page);

  const pauseBtn = page.getByTestId('speed-pause');
  const speed1x = page.getByTestId('speed-1x');
  const speed2x = page.getByTestId('speed-2x');
  const controls = page.getByTestId('speed-controls');
  const enabledHand = page.locator('[data-testid^="hand-card-"]:not([disabled])');
  await expect(enabledHand.first()).toBeVisible();
  const cardTestId = await enabledHand.first().getAttribute('data-testid');
  if (!cardTestId) throw new Error('発動可能な手札の testid が取れない');
  const playableCard = page.getByTestId(cardTestId);
  const titleAt1x = await playableCard.getAttribute('title');
  if (!titleAt1x) throw new Error('手札のツールチップが空');
  expect(titleAt1x).toContain('発動 ⚡');

  await expect(speed1x).toHaveAttribute('aria-pressed', 'true');
  await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(pauseBtn).toHaveAttribute('aria-label', '一時停止');

  await pauseBtn.click();
  await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(pauseBtn).toHaveAttribute('aria-label', '一時停止');
  await expect(controls).toHaveAttribute('data-paused', 'true');
  await expect(page.getByTestId('deck')).toHaveAttribute('data-paused', 'true');
  await expect(playableCard).toBeDisabled();
  await expect(playableCard).toHaveAttribute(
    'title',
    `${titleAt1x} / 一時停止中はカードを発動できない`,
  );

  const handBefore = await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    return game.getState().sprint?.cardPiles.hand.length ?? -1;
  });
  await playableCard.click({ force: true });
  const handAfterClick = await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    return game.getState().sprint?.cardPiles.hand.length ?? -1;
  });
  expect(handAfterClick).toBe(handBefore);

  await pauseBtn.click();
  await expect(speed1x).toHaveAttribute('aria-pressed', 'true');
  await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(pauseBtn).toHaveAttribute('aria-label', '一時停止');
  await expect(controls).toHaveAttribute('data-paused', 'false');
  await expect(playableCard).toBeEnabled();
  await expect(playableCard).toHaveAttribute('title', titleAt1x);

  await speed2x.click();
  await expect(speed2x).toHaveAttribute('aria-pressed', 'true');
  await pauseBtn.click();
  await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(playableCard).toBeDisabled();
  await pauseBtn.click();
  await expect(speed2x).toHaveAttribute('aria-pressed', 'true');

  await pauseBtn.click();
  await speed1x.click();
  await expect(speed1x).toHaveAttribute('aria-pressed', 'true');
  await expect(playableCard).toBeEnabled();

  await pauseBtn.click();
  await speed2x.click();
  await expect(speed2x).toHaveAttribute('aria-pressed', 'true');
  await expect(controls).toHaveAttribute('data-paused', 'false');
  await expect(playableCard).toBeEnabled();
});
