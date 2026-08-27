/**
 * プレイヤー Pause（#370）。❚❚ トグル・1x/2x 再開・停止中の手札ロック。
 * `game.pause()`（E2E 固定）とは独立した UI 速度コントロールを検証する。
 */
import { beginPublicSprint, expect, test } from './fixtures';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    getState(): RunState;
  };
};

test('❚❚ はトグルでき、1x / 2x でも再開でき、停止中は手札を発動できない', async ({ page }) => {
  await beginPublicSprint(page, { seed: 'issue-370-pause', renderer: 'dom' });

  const pauseBtn = page.getByTestId('speed-pause');
  const speed1x = page.getByTestId('speed-1x');
  const speed2x = page.getByTestId('speed-2x');
  const controls = page.getByTestId('speed-controls');
  const enabledHand = page.locator('[data-testid^="hand-card-"]:not([disabled])');
  await expect(enabledHand.first()).toBeVisible();
  const cardTestId = await enabledHand.first().getAttribute('data-testid');
  if (!cardTestId) throw new Error('発動可能な手札の testid が取れない');
  const playableCard = page.getByTestId(cardTestId);

  await expect(speed1x).toHaveAttribute('aria-pressed', 'true');
  await expect(pauseBtn).toHaveAttribute('aria-pressed', 'false');

  await pauseBtn.click();
  await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(pauseBtn).toHaveAttribute('aria-label', '再開');
  await expect(controls).toHaveAttribute('data-paused', 'true');
  await expect(page.getByTestId('deck')).toHaveAttribute('data-paused', 'true');
  await expect(playableCard).toBeDisabled();

  const handBefore = await page.evaluate(() => {
    const game = (window as GameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    return game.getState().sprint?.cardPiles.hand.length ?? -1;
  });
  await playableCard.click({ force: true });
  const handAfterClick = await page.evaluate(() => {
    const game = (window as GameWindow).game;
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
