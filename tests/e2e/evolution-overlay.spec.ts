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

  const pulseStates = await page.evaluate(() => {
    const app = document.querySelector('.app');
    if (!app) throw new Error('.app が見つからない');
    const risk = document.createElement('div');
    risk.className = 'risk-HIGH';
    const burnout = document.createElement('div');
    burnout.className = 'burnout-chip tone-danger';
    app.appendChild(risk);
    app.appendChild(burnout);
    return {
      risk: getComputedStyle(risk).animationPlayState,
      burnout: getComputedStyle(burnout).animationPlayState,
    };
  });
  expect(pulseStates).toEqual({ risk: 'paused', burnout: 'paused' });
});

test('進化画面を開いている間は背面に届かず、閉じると次の操作へフォーカスが移る', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await advancePublicRun(page, {
    seed: 'evo-overlay-inert',
    difficulty: 'easy',
    target: { phase: 'evolution' },
  });
  const evolution = page.getByTestId('evolution');
  await expect(evolution).toBeVisible();
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await expect(evolution).toHaveAttribute('aria-modal', 'true');
  const sprint = page.getByTestId('sprint-layout');
  await expect(sprint).toHaveAttribute('inert', '');
  await expect(sprint).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByTestId('deck')).toBeVisible();
  expect(
    await page.getByTestId('deck').evaluate((element) => element.closest('[inert]') !== null),
  ).toBe(true);

  for (let step = 0; step < 8; step += 1) {
    const inside = await page.evaluate(() => {
      const overlay = document.querySelector('[data-testid="evolution"]');
      const active = document.activeElement;
      return overlay instanceof HTMLElement && (active === overlay || overlay.contains(active));
    });
    expect(inside, `Tab ${step} で進化画面の外へ出た`).toBe(true);
    await page.keyboard.press('Tab');
  }

  await page.getByTestId('evolution-done').click();
  await expect(evolution).toHaveCount(0);
  const beat = page.getByTestId('beat');
  await expect(beat).toBeVisible();
  await expect(page.locator('.app-background')).not.toHaveAttribute('inert');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const dialog = document.querySelector('[data-testid="beat"]');
        const active = document.activeElement;
        return dialog instanceof HTMLElement && (active === dialog || dialog.contains(active));
      }),
    )
    .toBe(true);
});
