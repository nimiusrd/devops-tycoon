/**
 * 引火演出が移動中の粒へ追従する（#979）。
 */
import type { Page } from '@playwright/test';
import {
  advanceCurrentSprintToBurning,
  advanceCurrentSprintToReviewQueue,
  beginPublicSprint,
  expect,
  test,
} from './fixtures';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
] as const;

type BoardPixiHook = {
  getMaxIgniteDotDistancePx(): number | null;
  getDotDisplayPositions(): Record<number, { x: number; y: number }>;
};

declare global {
  interface Window {
    __boardPixiTest?: BoardPixiHook;
  }
}

async function waitPixiFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function sampleIgniteFollow(page: Page): Promise<{
  maxDelta: number;
  samples: number;
  motionSamples: number;
}> {
  let maxDelta = 0;
  let samples = 0;
  let motionSamples = 0;
  let prevDots: Record<number, { x: number; y: number }> = {};

  for (let i = 0; i < 180; i += 1) {
    await page.evaluate(() => window.game!.step(12));
    await waitPixiFrame(page);
    const frame = await page.evaluate(() => {
      const hook = window.__boardPixiTest;
      if (!hook) throw new Error('Pixi テストフックが無い');
      return {
        delta: hook.getMaxIgniteDotDistancePx(),
        dots: hook.getDotDisplayPositions(),
      };
    });
    if (frame.delta !== null) {
      samples += 1;
      maxDelta = Math.max(maxDelta, frame.delta);
      for (const [id, dot] of Object.entries(frame.dots)) {
        const taskId = Number(id);
        const prev = prevDots[taskId];
        if (prev && Math.hypot(dot.x - prev.x, dot.y - prev.y) > 0.5) {
          motionSamples += 1;
          break;
        }
      }
    }
    prevDots = frame.dots;
  }
  return { maxDelta, samples, motionSamples };
}

test.describe('引火演出の粒追従（#979）', () => {
  test.setTimeout(90_000);

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

      const result = await sampleIgniteFollow(page);

      expect(result.samples, '点火演出が再生される').toBeGreaterThan(0);
      expect(result.motionSamples, '粒の移動中に観測する').toBeGreaterThan(0);
      expect(result.maxDelta).toBeLessThan(2);
    });
  }
});
