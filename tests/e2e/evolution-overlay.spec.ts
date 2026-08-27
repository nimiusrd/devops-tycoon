/**
 * 組織進化オーバーレイ中に背面 sim が止まっていること（#386）。
 *
 * 壁時計進行を resume したうえで数秒待ち、KPI・盤面件数・出来事ログが
 * 増えないことを公開 GameHandle と DOM の両方で確認する。
 */
import { expect, test } from './fixtures';
import { advancePublicRun } from './fixtures';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game?: {
    resume(): void;
    isSprintRunning(): boolean;
    getState(): RunState;
  };
};

test('進化オーバーレイ中は壁時計が進んでも盤面数字と出来事が動かない', async ({ page }) => {
  await advancePublicRun(page, {
    seed: 'evo-overlay-pause',
    difficulty: 'easy',
    target: { phase: 'evolution' },
  });
  await expect(page.getByTestId('evolution')).toBeVisible();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'evolution');
  await expect(page.getByTestId('board')).toHaveAttribute('data-animations-paused', 'true');

  const before = await page.evaluate(() => {
    const game = (window as GameWindow).game!;
    const state = game.getState();
    const sprint = state.sprint;
    const laneCount = (lane: string) =>
      sprint?.tasks.filter((task) => task.lane === lane).length ?? 0;
    return {
      running: game.isSprintRunning(),
      tick: state.sprintTick,
      delivery: state.org.deliveryScore,
      events: sprint?.events.length ?? 0,
      delivered: sprint?.metrics.delivered ?? 0,
      done: sprint?.metrics.doneCount ?? 0,
      coding: laneCount('coding'),
      review: laneCount('review'),
      doneLane: laneCount('done'),
    };
  });
  expect(before.running).toBe(false);

  const beforeEventTexts = await page.locator('.event-ticker-text').allTextContents();
  const beforeDoneLabel = await page.getByTestId('count-done').innerText();

  await page.evaluate(() => {
    (window as GameWindow).game!.resume();
  });

  // 1x は 780ms/tick。2 秒待てば進行していれば tick / 出来事が増える。
  await page.waitForTimeout(2_000);

  const after = await page.evaluate(() => {
    const game = (window as GameWindow).game!;
    const state = game.getState();
    const sprint = state.sprint;
    const laneCount = (lane: string) =>
      sprint?.tasks.filter((task) => task.lane === lane).length ?? 0;
    return {
      running: game.isSprintRunning(),
      tick: state.sprintTick,
      delivery: state.org.deliveryScore,
      events: sprint?.events.length ?? 0,
      delivered: sprint?.metrics.delivered ?? 0,
      done: sprint?.metrics.doneCount ?? 0,
      coding: laneCount('coding'),
      review: laneCount('review'),
      doneLane: laneCount('done'),
    };
  });
  const afterEventTexts = await page.locator('.event-ticker-text').allTextContents();
  const afterDoneLabel = await page.getByTestId('count-done').innerText();

  expect(after).toEqual(before);
  expect(afterEventTexts).toEqual(beforeEventTexts);
  expect(afterDoneLabel).toBe(beforeDoneLabel);
  await expect(page.getByTestId('evolution')).toBeVisible();
  await expect(page.locator('.app')).toHaveAttribute('data-phase', 'evolution');
});
