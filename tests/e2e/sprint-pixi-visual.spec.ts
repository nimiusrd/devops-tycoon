/**
 * スプリント盤面（現場）の Pixi 視覚回帰＋操作 E2E（RI-11 残務 / RI-07 / RI-30）。
 *
 * PIXI_E2E=1 のときだけ実行する（既定 CI では WebGL を回さない。architecture §4.2）。
 * 実行: `npm run test:e2e:pixi`
 */
import {
  advanceCurrentSprintToResult,
  beginPublicSprint,
  expect,
  type PublicGameWindow,
  test,
} from './fixtures';
import { planBoardScene } from '../../src/render/boardScene';
import { assignableTasks } from '../../src/sim/assignTask';
import type { SprintState } from '../../src/sim/types';

const PIXI_SEED = 'sprint-pixi-e2e';

type PixiTestWindow = PublicGameWindow & {
  __boardPixiTest?: {
    freezeForScreenshot(): void;
  };
};

/** Pixi 視覚回帰は opt-in のみ（CI 既定 job では WebGL を回さない）。 */
const pixiE2e = !!process.env.PIXI_E2E;

/**
 * 固定 seed でスプリント盤面（Pixi）を開き、決定論の固定ステップで進める。
 * steps は目的別: 視覚回帰は 40（Review/Done の山＋フロー粒）、ドラッグは 0
 * （coding/backlog に差配候補が残っている開始直後）。
 */
async function openPixiSprintBoard(
  page: import('@playwright/test').Page,
  seed: string,
  steps = 40,
) {
  await page.goto(`/?renderer=pixi&seed=${seed}`);
  await page.evaluate(
    ({ s, n }) => {
      const g = (window as PixiTestWindow).game!;
      g.startRun('normal', [], s);
      g.pause();
      g.beginSetupSprint();
      g.pause();
      for (let i = 0; i < n; i += 1) g.step(100);
    },
    { s: seed, n: steps },
  );
  await expect(page.getByTestId('board')).toBeVisible();
}

/** CSS アニメーションを止め、WebGL 描画メトリクスが安定するまで待つ。 */
async function stabilizeForScreenshot(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  const mount = page.getByTestId('board-pixi-mount');
  await expect(mount).toBeVisible();
  await expect
    .poll(async () => mount.getAttribute('data-board-dots'), { timeout: 15_000 })
    .toMatch(/^\d+$/);
  // 人物SVGの取得完了後にtickerを止め、旧人物フレームをベースラインへ保存しない。
  await expect
    .poll(async () => mount.getAttribute('data-board-assets'), { timeout: 15_000 })
    .toBe('5');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** Pixi ticker を止め、アニメ位相 0 の決定論フレームへ固定する。 */
async function freezePixiForScreenshot(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const hook = (window as PixiTestWindow).__boardPixiTest;
    if (!hook) throw new Error('__boardPixiTest hook missing (dev server + renderer=pixi が必要)');
    hook.freezeForScreenshot();
  });
}

/** 固定スクロール領域に隠れないよう、結果カード全体をテスト用の通常フローへ出す。 */
async function exposeResultCardForScreenshot(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: `
      .result-overlay {
        position: absolute !important;
        inset: 0 auto auto 0 !important;
        width: 100% !important;
        height: auto !important;
        min-height: 100vh !important;
        overflow: visible !important;
        align-items: flex-start !important;
      }
      .result-overlay > * {
        margin-block: 0 !important;
      }
    `,
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('Pixi スプリント盤面視覚回帰 @pixi', () => {
  test.skip(!pixiE2e, 'PIXI_E2E=1 のときだけ実行（既定 CI では WebGL を回さない）');

  test('renderer 未指定の既定 URL で Pixi 盤面が起動する @pixi', async ({ page }) => {
    // 既定レンダラは Pixi（`?renderer=dom` が opt-out。selectRenderer）。
    await page.goto(`/?seed=${PIXI_SEED}`);
    await page.evaluate((s) => {
      const g = (window as PixiTestWindow).game!;
      g.startRun('normal', [], s);
      g.pause();
      g.beginSetupSprint();
      g.pause();
      g.step(100);
    }, PIXI_SEED);
    await expect(page.getByTestId('board-pixi-mount')).toBeVisible();
    await expect
      .poll(async () => page.getByTestId('board-pixi-mount').getAttribute('data-board-dots'))
      .toMatch(/^\d+$/);
  });

  test('固定 seed でスプリント盤面 canvas が安定する @pixi', async ({ page }) => {
    await openPixiSprintBoard(page, PIXI_SEED);
    await stabilizeForScreenshot(page);
    await freezePixiForScreenshot(page);

    // 盤面全体（DOM ラベル・凡例＋Pixi canvas の合成）で回帰を見る。
    await expect(page.getByTestId('board')).toHaveScreenshot('sprint-pixi-board.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('1440x900通常スプリントのPixi合成を固定する @pixi', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await beginPublicSprint(page, { seed: 'ri94-normal-0', renderer: 'pixi' });
    await stabilizeForScreenshot(page);
    await freezePixiForScreenshot(page);

    await expect(page.locator('.app')).toHaveScreenshot('sprint-pixi-layout-normal.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('390x844 HUD展開後の結果オーバーレイPixi合成を固定する @pixi', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await beginPublicSprint(page, { seed: 'ri94-result-0', renderer: 'pixi' });
    await page.getByTestId('hud-toggle').click();
    await advanceCurrentSprintToResult(page);
    await stabilizeForScreenshot(page);
    await freezePixiForScreenshot(page);

    await expect(page.locator('.app')).toHaveScreenshot('sprint-pixi-layout-result-overlay.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });

    const resultCard = page.getByTestId('sprint-result').locator('.sprint-result-card');
    const resultContinue = page.getByTestId('result-continue');
    await resultContinue.scrollIntoViewIfNeeded();
    await expect(resultContinue).toBeInViewport({ ratio: 1 });
    await page.getByTestId('sprint-result').evaluate((element) => element.scrollTo(0, 0));
    await exposeResultCardForScreenshot(page);
    await expect(resultCard).toHaveScreenshot('sprint-pixi-layout-result-overlay-card.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('武装→canvas 上の粒ドラッグでタスク差配が確定する @pixi（RI-30）', async ({ page }) => {
    // 序盤（coding/backlog に差配候補が残っている状態）で武装する。
    await openPixiSprintBoard(page, PIXI_SEED, 0);
    await stabilizeForScreenshot(page);

    const assign = page.getByTestId('action-assignTask');
    await expect(assign).toBeEnabled();
    await assign.click();
    await expect(page.getByTestId('board')).toHaveAttribute('data-armed', 'assignTask');

    // 掴む粒の設計座標は、ページの sprint 状態から Node 側で純関数により再計算する
    // （盤面計画は決定論なので、canvas に描かれた粒と同じ座標になる）。
    const sprint = (await page.evaluate(
      () => (window as PixiTestWindow).game!.getState().sprint,
    )) as SprintState;
    const scene = planBoardScene(sprint.tasks);
    const candidateIds = new Set(assignableTasks(sprint).map((t) => t.id));
    const candidates = scene.dots.filter((d) => candidateIds.has(d.id));
    if (candidates.length === 0) throw new Error('draggable dot not found on board');

    const board = page.getByTestId('board');
    const box = await board.boundingBox();
    if (!box) throw new Error('board bounding box missing');
    const toPage = (x: number, y: number) => ({
      x: box.x + box.width * (x / 1404),
      y: box.y + box.height * (y / 573),
    });

    // ラベル・吹き出し等の DOM オーバーレイに覆われた粒は掴めない仕様
    // （DOM モードと同じ）なので、覆われていない粒を選ぶ。
    let from: { x: number; y: number } | null = null;
    for (const dot of candidates) {
      const pt = toPage(dot.x, dot.y);
      const covered = await page.evaluate(
        ([x, y]) =>
          !!document
            .elementFromPoint(x, y)
            ?.closest('.st-label, .bubble, .board-legend, .pile-overflow'),
        [pt.x, pt.y] as const,
      );
      if (!covered) {
        from = pt;
        break;
      }
    }
    if (!from) throw new Error('all draggable dots are covered by overlays');
    const to = toPage(622, 251); // Coding ステーションのドロップゾーン中心。
    const before = await page.evaluate(
      () =>
        (window as PixiTestWindow).game!.getState().sprint?.metrics.actionCounts.assignTask ?? 0,
    );
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as PixiTestWindow).game!.getState().sprint?.metrics.actionCounts.assignTask ??
            0,
        ),
      )
      .toBe(before + 1);
  });

  test('現場⇄全社⇄部署の行き来で WebGL 破棄エラーが出ない @pixi', async ({ page }) => {
    // 盤面・全社・部署の 3 レンダラが同居/破棄を繰り返しても、共有 TexturePool の
    // 返却クラッシュ（pixiTexturePoolGuard）が出ないことを確認する。
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await openPixiSprintBoard(page, PIXI_SEED);
    await stabilizeForScreenshot(page);

    await page.evaluate(() => (window as PixiTestWindow).game!.zoomTo('company'));
    await expect(page.getByTestId('org-pixi-mount')).toBeVisible();
    await page.evaluate(() => (window as PixiTestWindow).game!.focusDept('product'));
    await expect(page.getByTestId('dept-pixi-mount')).toBeVisible();
    await page.evaluate(() => (window as PixiTestWindow).game!.focusTeam('product-t0'));
    await expect
      .poll(async () => page.evaluate(() => (window as PixiTestWindow).game!.getState().zoom.level))
      .toBe('team');
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );

    expect(errors).toEqual([]);
  });
});
