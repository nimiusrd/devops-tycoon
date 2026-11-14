/**
 * 引火演出が移動中の粒へ追従する（#979）。
 */
import {
  advanceCurrentSprintToBurning,
  advanceCurrentSprintToReviewQueue,
  beginPublicSprint,
  expect,
  test,
} from './fixtures';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', height: 844, width: 390 },
] as const;

type BoardPixiHook = {
  getMaxIgniteDotDistancePx(): number | null;
};

declare global {
  interface Window {
    __boardPixiTest?: BoardPixiHook;
  }
}

test.describe('引火演出の粒追従（#979）', () => {
  test.setTimeout(60_000);

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: 移動中も点火演出は粒から 2px 以内`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await beginPublicSprint(page, {
        seed: 'ri142-fire-effects',
        difficulty: 'hard',
        renderer: 'pixi',
      });
      await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
      await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-assets', '5', {
        timeout: 30_000,
      });
      await advanceCurrentSprintToBurning(page);
      await advanceCurrentSprintToReviewQueue(page, 2);

      const result = await page.evaluate(() => {
        const game = window.game;
        const hook = window.__boardPixiTest;
        if (!game || !hook) throw new Error('game または Pixi テストフックが無い');

        let samples = 0;
        let maxDelta = 0;
        game.pause();
        for (let i = 0; i < 400; i += 1) {
          game.step(10);
          const delta = hook.getMaxIgniteDotDistancePx();
          if (delta !== null) {
            samples += 1;
            maxDelta = Math.max(maxDelta, delta);
          }
        }
        return { samples, maxDelta, sawIgnite: samples > 0 };
      });

      expect(result.sawIgnite, '点火演出が再生される').toBe(true);
      expect(result.maxDelta).toBeLessThan(2);
    });
  }
});
