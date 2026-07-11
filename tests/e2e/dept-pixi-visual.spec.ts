import { expect, test } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';

const PIXI_SEED = 'zoom-e2e';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    zoomTo(level: string): RunState;
    focusDept(id: string): RunState;
  };
  __deptPixiTest?: {
    freezeForScreenshot(): void;
    getTeamCount(): number | null;
  };
};

const pixiE2e = !!process.env.PIXI_E2E;

async function openPixiDept(page: import('@playwright/test').Page, seed: string) {
  await page.goto(`/?renderer=pixi&seed=${seed}`);
  await page.evaluate((s) => {
    const g = (window as GameWindow).game!;
    g.pause();
    g.startRun('normal', [], s);
    g.beginSetupSprint();
    g.focusDept('product');
  }, seed);
}

async function stabilizeDept(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  const mount = page.getByTestId('dept-pixi-mount');
  await expect(mount).toBeVisible();
  await expect
    .poll(async () => mount.getAttribute('data-dept-sprites'), { timeout: 15_000 })
    .toMatch(/^[1-9]\d*$/);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('Pixi 部署ビュー @pixi', () => {
  test.skip(!pixiE2e, 'PIXI_E2E=1 のときだけ実行（既定 CI では WebGL を回さない）');

  test('固定 seed で部署 canvas が描画される @pixi', async ({ page }) => {
    await openPixiDept(page, PIXI_SEED);
    await expect(page.getByTestId('dept-screen')).toBeVisible();
    await stabilizeDept(page);
    await page.evaluate(() => {
      const hook = (window as GameWindow).__deptPixiTest;
      if (!hook) throw new Error('__deptPixiTest hook missing');
      hook.freezeForScreenshot();
    });
    await expect(page.getByTestId('dept-pixi-mount')).toBeVisible();
    await expect(page.getByTestId('dept-board')).toHaveAttribute('data-renderer', 'pixi');
  });

  test('プレイヤーチームをタップすると現場へドリルダウンする @pixi', async ({ page }) => {
    await openPixiDept(page, PIXI_SEED);
    await stabilizeDept(page);

    const state = await page.evaluate(() => (window as GameWindow).game!.getState());
    const player = state.orgScale?.departments.flatMap((d) => d.teams).find((t) => t.isPlayer);
    expect(player).toBeTruthy();

    await page.getByTestId(`team-${player!.id}`).click();
    await expect(page.getByTestId('zoom-overlay')).toHaveCount(0);
    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.getByTestId('board')).toHaveAttribute('data-renderer', 'pixi');
  });
});
