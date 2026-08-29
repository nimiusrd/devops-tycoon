/**
 * #363: プレイヤー Pause（❚❚ / playbackSpeed=0）中は sim が進まない。
 * E2E 用 `game.pause()` とは独立したまま、壁時計進行だけを止める。
 */
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    pause(): void;
    resume(): void;
    isPaused(): boolean;
    isSprintRunning(): boolean;
    getState(): RunState;
  };
};

type ProgressSnapshot = {
  deliveryScore: number;
  sprintTick: number;
  fireCount: number;
  lanes: Array<{ id: number; lane: string; progress: number }>;
  burn: Array<{ id: number; burnTicksLeft?: number }>;
  gamePaused: boolean;
};

async function progressSnapshot(page: Page): Promise<ProgressSnapshot> {
  return page.evaluate(() => {
    const game = (window as GameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    const state = game.getState();
    const tasks = state.sprint?.tasks ?? [];
    return {
      deliveryScore: state.org.deliveryScore,
      sprintTick: state.sprintTick,
      fireCount: tasks.filter((task) => task.incident).length,
      lanes: tasks.map((task) => ({ id: task.id, lane: task.lane, progress: task.progress })),
      burn: tasks
        .filter((task) => task.incident)
        .map((task) => ({ id: task.id, burnTicksLeft: task.burnTicksLeft })),
      gamePaused: game.isPaused(),
    };
  });
}

test('❚❚ 中は出荷ポイント・レーン・炎上タイマーが進まない（#363）', async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto('/?renderer=dom&seed=daily-2026-08-27');
  await page.getByTestId('difficulty-normal').click();
  await page.getByTestId('start-run').click();
  await page.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('board')).toBeVisible();
  const pauseBtn = page.getByTestId('speed-pause');
  await expect(pauseBtn).toBeVisible();

  await page.evaluate(() => {
    const game = (window as GameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    // lazy 読込 fallback の所有 pause が残っていても、プレイヤー Pause 検証前に外す。
    game.resume();
  });

  await pauseBtn.click();
  await expect(pauseBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('speed-1x')).toHaveAttribute('aria-pressed', 'false');

  const paused = await progressSnapshot(page);
  expect(paused.gamePaused).toBe(false);
  expect(paused.sprintTick).toBeGreaterThanOrEqual(0);

  await page.waitForTimeout(4_000);
  const stillPaused = await progressSnapshot(page);
  expect(stillPaused).toEqual(paused);
  await expect(page.getByTestId('hud-compact-delivery')).toContainText(`${paused.deliveryScore}pt`);
  await expect(page.getByTestId('fire-count')).toHaveText(`🔥${paused.fireCount}`);

  await page.getByTestId('speed-1x').click();
  await expect(page.getByTestId('speed-1x')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(3_000);
  const resumed = await progressSnapshot(page);
  expect(resumed.sprintTick).toBeGreaterThan(paused.sprintTick);
});
