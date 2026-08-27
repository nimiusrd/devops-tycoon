/**
 * プレイヤー Pause（#370）。❚❚ トグル・1x/2x 再開・停止中の手札ロック。
 * `game.pause()`（E2E 固定）とは独立した UI 速度コントロールを検証する。
 */
import { expect, test } from './fixtures';
import type { CardPlayOutcome } from '../../src/sim/types';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    playCard(deckIndex: number): CardPlayOutcome;
    engine: {
      deck: Array<{ defId: string; level: number }>;
    };
  };
};

test('❚❚ はトグルでき、1x / 2x でも再開でき、停止中は手札を発動できない', async ({ page }) => {
  await page.goto('/?renderer=dom&seed=issue-370-pause');
  await expect(page.getByTestId('title')).toBeVisible();

  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], 'issue-370-pause');
    g.engine.deck.push({ defId: 'copilot', level: 1 });
    g.beginSetupSprint();
    g.pause();
  });

  const pauseBtn = page.getByTestId('speed-pause');
  const speed1x = page.getByTestId('speed-1x');
  const speed2x = page.getByTestId('speed-2x');
  const controls = page.getByTestId('speed-controls');
  const playableCard = page.getByTestId('hand-card-copilot');

  await expect(playableCard).toBeVisible();
  await expect(playableCard).toBeEnabled();
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
