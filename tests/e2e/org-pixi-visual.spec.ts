import { expect, test } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';

const PIXI_SEED = 'zoom-e2e';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    zoomTo(level: string): RunState;
  };
};

/** Pixi 視覚回帰は opt-in のみ（CI 既定 job では WebGL を回さない）。 */
const pixiE2e = !!process.env.PIXI_E2E;

/** 固定 seed で全社マップ（Pixi）へ遷移する。 */
async function openPixiOrgMap(page: import('@playwright/test').Page, seed: string) {
  await page.goto(`/?renderer=pixi&seed=${seed}`);
  await page.evaluate((s) => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], s);
    g.zoomTo('company');
  }, seed);
}

/** CSS アニメーションを止め、WebGL 描画メトリクスが安定するまで待つ。 */
async function stabilizeForScreenshot(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  const mount = page.getByTestId('org-pixi-mount');
  await expect(mount).toBeVisible();
  await expect
    .poll(async () => mount.getAttribute('data-org-sprites'), { timeout: 15_000 })
    .toMatch(/^[1-9]\d*$/);
  // fitToContent / 初回 render の rAF を 1 フレーム分待つ。
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('Pixi 全社マップ視覚回帰 @pixi', () => {
  test.skip(!pixiE2e, 'PIXI_E2E=1 のときだけ実行（既定 CI では WebGL を回さない）');

  test('固定 seed で全社マップ canvas が安定する @pixi', async ({ page }) => {
    await openPixiOrgMap(page, PIXI_SEED);
    await expect(page.getByTestId('org-screen')).toBeVisible();
    await stabilizeForScreenshot(page);

    await expect(page.getByTestId('org-pixi-mount')).toHaveScreenshot('org-pixi-company-fit.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('card LOD: canvas 上でズームイン後 @pixi', async ({ page }) => {
    await openPixiOrgMap(page, PIXI_SEED);
    await stabilizeForScreenshot(page);

    const mount = page.getByTestId('org-pixi-mount');
    const box = await mount.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    // card LOD 閾値 (>= 0.7) へ寄せる。ホイール量は viewport 既定に合わせて固定。
    for (let i = 0; i < 10; i++) {
      await page.mouse.wheel(0, -150);
    }
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    await expect(mount).toHaveScreenshot('org-pixi-card-lod.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });
});
