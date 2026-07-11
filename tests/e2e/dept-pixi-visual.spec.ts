import { expect, test } from '@playwright/test';
import type { RunState } from '../../src/sim/run/types';

const PIXI_SEED = 'dept-pixi-e2e';
/** 3 チーム部門（mockup 準拠レイアウト＋依存フロー 2 本）。 */
const DEPT_ID = 'platform';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    focusDept(id: string): RunState;
  };
  __deptPixiTest?: {
    freezeForScreenshot(): void;
  };
};

/** Pixi 視覚回帰は opt-in のみ（CI 既定 job では WebGL を回さない）。 */
const pixiE2e = !!process.env.PIXI_E2E;

/** 固定 seed で部署ビュー（Pixi）へ遷移する。 */
async function openPixiDeptView(
  page: import('@playwright/test').Page,
  seed: string,
  deptId: string,
) {
  await page.goto(`/?renderer=pixi&seed=${seed}`);
  await page.evaluate(
    ({ s, dept }) => {
      const g = (window as GameWindow).game!;
      g.pause();
      g.startRun('normal', [], s);
      g.focusDept(dept);
    },
    { s: seed, dept: deptId },
  );
}

/** CSS アニメーションを止め、WebGL 描画メトリクスが安定するまで待つ。 */
async function stabilizeForScreenshot(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  const mount = page.getByTestId('dept-pixi-mount');
  await expect(mount).toBeVisible();
  await expect
    .poll(async () => mount.getAttribute('data-dept-teams'), { timeout: 15_000 })
    .toMatch(/^[1-9]\d*$/);
  // 初回 render の rAF を 1 フレーム分待つ。
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Pixi ticker を止めて canvas を決定論的にする。 */
async function freezePixiForScreenshot(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const hook = (window as GameWindow).__deptPixiTest;
    if (!hook) throw new Error('__deptPixiTest hook missing (dev server + renderer=pixi が必要)');
    hook.freezeForScreenshot();
  });
}

test.describe('Pixi 部署ビュー視覚回帰 @pixi', () => {
  test.skip(!pixiE2e, 'PIXI_E2E=1 のときだけ実行（既定 CI では WebGL を回さない）');

  test('固定 seed で部署ビュー canvas が安定する @pixi', async ({ page }) => {
    await openPixiDeptView(page, PIXI_SEED, DEPT_ID);
    await expect(page.getByTestId('dept-screen')).toBeVisible();
    await stabilizeForScreenshot(page);
    await freezePixiForScreenshot(page);

    await expect(page.getByTestId('dept-pixi-mount')).toHaveScreenshot('dept-pixi-board.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('プレイヤーチームのミニ盤面タップで現場へドリルダウンする @pixi', async ({ page }) => {
    // 現場（team）へ着地するのはプレイヤーチームのみ（engine.focusTeam の仕様）。
    // プレイヤーチーム product-t0 は product 部門（4 チーム横一列）の先頭 = 設計 (230,318)。
    await openPixiDeptView(page, PIXI_SEED, 'product');
    await stabilizeForScreenshot(page);

    const mount = page.getByTestId('dept-pixi-mount');
    const box = await mount.boundingBox();
    if (!box) throw new Error('dept-pixi-mount bounding box missing');
    await page.mouse.click(box.x + box.width * (230 / 1404), box.y + box.height * (318 / 573));

    await expect
      .poll(async () => page.evaluate(() => (window as GameWindow).game!.getState().zoom.level))
      .toBe('team');
  });
});
