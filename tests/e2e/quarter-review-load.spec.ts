/**
 * 四半期レビューの lazy chunk 失敗時も HUD と再試行を残す（#1021）。
 */
import { expect, test } from './fixtures';
import { E2E_MISSED_ADJUSTABLE_SEED } from '../../src/sim/run/quarterReviewSeeds';
import type { RunState } from '../../src/sim/run/types';

type GameWindow = Window & {
  game: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
    acknowledgeResult(): RunState;
    skipDraft(): RunState;
    finishEvolution(): RunState;
    resolveBeat(choice?: number): RunState;
    leaveShop(): RunState;
    restChoose(option: string): RunState;
    recruitChoose(option: 'hire' | 'skip'): RunState;
  };
};

async function pauseAtBossResult(page: import('@playwright/test').Page, seed: string) {
  await page.goto(`/?seed=${seed}&tutorial=off`);
  const ready = await page.evaluate((runSeed) => {
    const game = (window as GameWindow).game;
    game.startRun('easy', [], runSeed);
    game.pause();
    let guard = 0;
    let state = game.getState();
    while (state.status === 'playing' && guard < 50_000) {
      guard += 1;
      if (state.phase === 'result' && state.sprintsPlayed === 6) {
        return {
          ok: true as const,
          quarterReviewReady: state.quarterReview !== null,
        };
      }
      switch (state.phase) {
        case 'setup':
          game.beginSetupSprint();
          break;
        case 'sprint':
          game.step(1_000_000);
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
          game.resolveBeat(0);
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
        default:
          return { ok: false as const, phase: state.phase, sprintsPlayed: state.sprintsPlayed };
      }
      state = game.getState();
    }
    return {
      ok: false as const,
      phase: state.phase,
      sprintsPlayed: state.sprintsPlayed,
    };
  }, seed);
  expect(ready.ok, JSON.stringify(ready)).toBe(true);
  if (!ready.ok || !ready.quarterReviewReady)
    throw new Error('四半期レビュー用の結果画面に届かない');
}

test('四半期レビューの chunk 取得失敗でも HUD を残し、再試行で Q1 レビューを一度だけ表示する', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await pauseAtBossResult(page, E2E_MISSED_ADJUSTABLE_SEED);

  let available = false;
  await page.route(
    /\/(?:src\/ui\/QuarterReviewScreen\.tsx|assets\/QuarterReviewScreen-[^/]+\.js)(?:\?.*)?$/,
    async (route) => {
      if (available) await route.continue();
      else await route.abort('failed');
    },
  );

  await page.getByTestId('result-continue').click();
  await expect(page.getByTestId('quarter-review-load-failed')).toHaveText('読み込めませんでした');
  await expect(page.getByTestId('hud')).toBeVisible();
  expect(
    await page.evaluate(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0),
  ).toBe(true);

  await expect(page.getByTestId('quarter-review')).toHaveCount(0);

  await page.getByTestId('quarter-review-retry').click();
  await expect(page.getByTestId('quarter-review-load-failed')).toBeVisible();
  await expect(page.getByTestId('quarter-review')).toHaveCount(0);

  available = true;
  await page.getByTestId('quarter-review-retry').click();
  const review = page.getByTestId('quarter-review');
  await expect(review).toHaveCount(1);
  await expect(review).toContainText('Q1');
  await expect(page.getByTestId('quarter-review-load')).toHaveCount(0);
  expect(await page.getByTestId('quarter-review').count()).toBe(1);
});
