import { expect, test } from './fixtures';
import type { RunState } from '../../src/sim/run/types';
import { LOD_BADGE_MAX } from '../../src/render/orgIslandView';

const PIXI_SEED = 'zoom-e2e';
/** card LOD スクショ対象（プレイヤーチーム。`zoom-e2e` で DOM E2E でも使用）。 */
const CARD_LOD_TEAM_ID = 'product-t0';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    zoomTo(level: string): RunState;
  };
  __orgPixiTest?: {
    focusTeamCamera(teamId: string): Promise<void>;
    getZoomScale(): number | null;
    freezeForScreenshot(): void;
    isFocusRingActive(): boolean;
  };
};

/** Pixi ticker / 炎上点滅を止めて canvas を決定論的にする。 */
async function freezePixiForScreenshot(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const hook = (window as GameWindow).__orgPixiTest;
    if (!hook) throw new Error('__orgPixiTest hook missing (dev server + renderer=pixi が必要)');
    hook.freezeForScreenshot();
  });
}

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
  await waitForAvatarAssets(page);
  // fitToContent / 初回 render の rAF を 1 フレーム分待つ。
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** card LODで必要になる人物SVGを取得し終えてから固定フレームへ進む。 */
async function waitForAvatarAssets(page: import('@playwright/test').Page) {
  const mount = page.getByTestId('org-pixi-mount');
  await expect
    .poll(async () => mount.getAttribute('data-org-avatar-assets-required'), { timeout: 15_000 })
    .toMatch(/^\d+$/);
  const required = await mount.getAttribute('data-org-avatar-assets-required');
  await expect
    .poll(async () => mount.getAttribute('data-org-avatar-assets-loaded'), { timeout: 15_000 })
    .toBe(required ?? '0');
}

/** 既知チームへカメラを寄せ、card LOD（scale >= 0.7）になるまで待つ。 */
async function focusTeamForCardLod(page: import('@playwright/test').Page, teamId: string) {
  await page.evaluate(async (id) => {
    const hook = (window as GameWindow).__orgPixiTest;
    if (!hook) throw new Error('__orgPixiTest hook missing (dev server + renderer=pixi が必要)');
    await hook.focusTeamCamera(id);
  }, teamId);
  await expect
    .poll(async () =>
      page.evaluate(() => (window as GameWindow).__orgPixiTest?.getZoomScale() ?? 0),
    )
    .toBeGreaterThanOrEqual(LOD_BADGE_MAX);
  await waitForAvatarAssets(page);
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
    await freezePixiForScreenshot(page);

    await expect(page.getByTestId('org-pixi-mount')).toHaveScreenshot('org-pixi-company-fit.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('card LOD: 既知チームへフォーカスした canvas @pixi', async ({ page }) => {
    await openPixiOrgMap(page, PIXI_SEED);
    await stabilizeForScreenshot(page);
    await focusTeamForCardLod(page, CARD_LOD_TEAM_ID);
    await freezePixiForScreenshot(page);

    await expect(page.getByTestId('org-pixi-mount')).toHaveScreenshot('org-pixi-card-lod.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('島タップ→フォーカスリング→カメラ→現場着地（RI-04） @pixi', async ({ page }) => {
    await openPixiOrgMap(page, PIXI_SEED);
    await stabilizeForScreenshot(page);
    // プレイヤーチームを card LOD まで寄せてから canvas 中央（島の位置）をタップする。
    await focusTeamForCardLod(page, CARD_LOD_TEAM_ID);

    const mount = page.getByTestId('org-pixi-mount');
    const box = await mount.boundingBox();
    if (!box) throw new Error('org-pixi-mount bounding box missing');
    // focusTeamCamera は島中心を可視窓中央へスクロールするため、中央タップで島に当たる。
    const field = page.getByTestId('org-field');
    const fieldBox = await field.boundingBox();
    if (!fieldBox) throw new Error('org-field bounding box missing');
    await page.mouse.click(fieldBox.x + fieldBox.width / 2, fieldBox.y + fieldBox.height / 2);

    // タップ直後: フォーカスリング演出が再生され、カメラ完了後に現場へ着地する。
    await expect
      .poll(async () =>
        page.evaluate(() => (window as GameWindow).__orgPixiTest?.isFocusRingActive() ?? false),
      )
      .toBe(true);
    await expect
      .poll(async () => page.evaluate(() => (window as GameWindow).game!.getState().zoom.level), {
        timeout: 10_000,
      })
      .toBe('team');
  });
});
