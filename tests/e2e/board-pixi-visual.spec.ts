import { expect, test } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';

const PIXI_SEED = 'zoom-e2e';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
  };
  __boardPixiTest?: {
    freezeForScreenshot(): void;
    getDotCount(): number | null;
  };
};

const pixiE2e = !!process.env.PIXI_E2E;

async function openPixiBoard(page: import('@playwright/test').Page, seed: string) {
  await page.goto(`/?renderer=pixi&seed=${seed}`);
  await page.evaluate((s) => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], s);
    g.beginSetupSprint();
  }, seed);
}

async function stabilizeBoard(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  const mount = page.getByTestId('board-pixi-mount');
  await expect(mount).toBeVisible();
  await expect
    .poll(async () => mount.getAttribute('data-board-stations'), { timeout: 15_000 })
    .toBe('5');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('Pixi 現場盤面 @pixi', () => {
  test.skip(!pixiE2e, 'PIXI_E2E=1 のときだけ実行（既定 CI では WebGL を回さない）');

  test('固定 seed で現場 canvas が描画される @pixi', async ({ page }) => {
    await openPixiBoard(page, PIXI_SEED);
    await expect(page.getByTestId('board')).toHaveAttribute('data-renderer', 'pixi');
    await stabilizeBoard(page);
    await page.evaluate(() => {
      const hook = (window as GameWindow).__boardPixiTest;
      if (!hook) throw new Error('__boardPixiTest hook missing');
      hook.freezeForScreenshot();
    });
    await expect(page.getByTestId('board-pixi-mount')).toBeVisible();
    await expect(page.getByTestId('count-review')).toBeAttached();
  });
});
