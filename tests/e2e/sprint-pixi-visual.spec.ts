/**
 * スプリント盤面（現場）の Pixi 視覚回帰＋操作 E2E（RI-11 残務 / RI-07 / RI-30）。
 *
 * PIXI_E2E=1 のときだけ実行する（既定 CI では WebGL を回さない。architecture §4.2）。
 * 実行: `npm run test:e2e:pixi`
 */
import {
  advanceCurrentSprintToBurning,
  advanceCurrentSprintToReviewQueue,
  advanceCurrentSprintToResult,
  advancePublicRun,
  beginPublicSprint,
  expect,
  type PublicGameWindow,
  test,
} from './fixtures';
import { planBoardScene } from '../../src/render/boardScene';
import { assignableTasks } from '../../src/sim/assignTask';
import type { SprintState } from '../../src/sim/types';

const PIXI_SEED = 'sprint-pixi-e2e';

type BoardPixiTestHook = {
  freezeForScreenshot(): void;
};

type PixiTestWindow = PublicGameWindow & {
  __boardPixiTest?: BoardPixiTestHook;
  __ri98InitialBoardPixiTest?: BoardPixiTestHook;
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
      html, body, .app {
        overflow: visible !important;
        max-height: none !important;
      }
      .result-overlay {
        position: absolute !important;
        inset: 0 auto auto 0 !important;
        width: 100% !important;
        height: auto !important;
        min-height: 0 !important;
        max-height: none !important;
        overflow: visible !important;
        align-items: flex-start !important;
      }
      .result-overlay > * {
        margin-block: 0 !important;
        max-height: none !important;
        height: auto !important;
        min-height: 0 !important;
        overflow: visible !important;
        flex: none !important;
      }
      .overlay-scroll {
        overflow: visible !important;
        max-height: none !important;
        min-height: 0 !important;
        flex: none !important;
      }
      .result-overlay::before,
      .result-overlay::after {
        content: none !important;
        flex: 0 0 auto !important;
        display: none !important;
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
    await expect
      .poll(async () =>
        page.getByTestId('board-pixi-mount').getAttribute('data-board-review-trails'),
      )
      .toMatch(/^[1-9]\d*$/);
    await freezePixiForScreenshot(page);

    // 盤面全体（DOM ラベル・凡例＋Pixi canvas の合成）で回帰を見る。
    await expect(page.getByTestId('board')).toHaveScreenshot('sprint-pixi-board.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('Review Hellの局所ヒートをPixi合成で固定する @pixi（RI-141）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await beginPublicSprint(page, {
      seed: 'ri141-review-pressure-0',
      difficulty: 'hard',
      renderer: 'pixi',
    });
    await advanceCurrentSprintToReviewQueue(page, 12);
    await stabilizeForScreenshot(page);
    const mount = page.getByTestId('board-pixi-mount');
    await expect(mount).toHaveAttribute('data-board-review-heat', '1');
    await expect(page.getByTestId('board')).toHaveAttribute('data-review-hell', 'true');
    await freezePixiForScreenshot(page);

    await expect(page.getByTestId('board')).toHaveScreenshot('sprint-pixi-review-hell.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('reduced motionでもPixiの渋滞情報を静止表示する @pixi（RI-141）', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await beginPublicSprint(page, {
      seed: 'ri141-review-pressure-0',
      difficulty: 'hard',
      renderer: 'pixi',
    });
    await advanceCurrentSprintToReviewQueue(page, 12);
    await stabilizeForScreenshot(page);
    const mount = page.getByTestId('board-pixi-mount');
    await expect(mount).toHaveAttribute('data-board-review-heat', '1');
    await expect(page.getByTestId('count-review')).not.toHaveText('0');
    await freezePixiForScreenshot(page);
  });

  test('介入リアクションと常駐オーラをPixi合成で固定する @pixi（RI-142）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await beginPublicSprint(page, { seed: 'ri142-pixi-aura', renderer: 'pixi' });
    await stabilizeForScreenshot(page);

    await page.getByTestId('action-overtime').click();
    const board = page.getByTestId('board');
    const mount = page.getByTestId('board-pixi-mount');
    await expect(board).toHaveAttribute('data-effect-renderer', 'pixi');
    await expect(board).toHaveAttribute('data-effect-kinds', 'intervention:boardAura');
    await expect(page.getByTestId('board-pixi-effects-mount')).toHaveAttribute(
      'data-board-effects',
      '1',
    );
    await expect(mount).toHaveAttribute('data-board-effects', '1');
    await expect(mount).toHaveAttribute('data-board-auras', '1');
    await expect(page.getByTestId('intervention-effect-aura-overtime')).not.toBeVisible();
    await freezePixiForScreenshot(page);

    await expect(board).toHaveScreenshot('sprint-pixi-intervention-aura.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('点火リアクションをPixi合成で固定する @pixi（RI-142）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await beginPublicSprint(page, {
      seed: 'ri142-fire-effects',
      difficulty: 'hard',
      renderer: 'pixi',
    });
    await stabilizeForScreenshot(page);
    await advanceCurrentSprintToBurning(page);

    const board = page.getByTestId('board');
    const mount = page.getByTestId('board-pixi-mount');
    await expect(board).toHaveAttribute('data-effect-kinds', /fire:(ignite|spread)/);
    await expect(mount).toHaveAttribute('data-board-effects', /^[1-9]\d*$/);
    const layerOrder = await page.evaluate(() => ({
      base: Number(getComputedStyle(document.querySelector('.board-pixi-mount')!).zIndex),
      bubble: Number(getComputedStyle(document.querySelector('.bubble')!).zIndex),
      summary: Number(getComputedStyle(document.querySelector('.board-flow-summary')!).zIndex),
      effects: Number(
        getComputedStyle(document.querySelector('.board-pixi-effects-mount')!).zIndex,
      ),
    }));
    expect(layerOrder.base).toBeLessThan(layerOrder.bubble);
    expect(layerOrder.effects).toBeGreaterThan(layerOrder.bubble);
    expect(layerOrder.effects).toBeGreaterThan(layerOrder.summary);
    await freezePixiForScreenshot(page);

    await expect(board).toHaveScreenshot('sprint-pixi-fire-effect.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('レビュー掃引と緊急鎮火を上限付きPixi演出へ渡す @pixi（RI-142）', async ({ page }) => {
    await beginPublicSprint(page, { seed: 'ops', renderer: 'pixi' });
    await stabilizeForScreenshot(page);
    await advanceCurrentSprintToReviewQueue(page, 4);
    await page.getByTestId('action-interruptReview').click();
    const board = page.getByTestId('board');
    const mount = page.getByTestId('board-pixi-mount');
    await expect(board).toHaveAttribute('data-effect-kinds', /intervention:reviewSweep/);
    await expect(mount).toHaveAttribute('data-board-effects', /^[1-9]\d*$/);
    await expect(page.locator('.intervention-effects')).toHaveClass(/dom-fallback-hidden/);

    await beginPublicSprint(page, {
      seed: 'ri142-fire-effects',
      difficulty: 'hard',
      renderer: 'pixi',
    });
    await stabilizeForScreenshot(page);
    await advanceCurrentSprintToBurning(page);
    await page.getByTestId('action-firefight').click();
    await expect(page.getByTestId('board')).toHaveAttribute(
      'data-effect-kinds',
      'intervention:firefight',
    );
    await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-effects', '1');
  });

  test('reduced motionではPixi一時装飾を抑制して介入情報と常駐オーラを残す @pixi（RI-142）', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await beginPublicSprint(page, { seed: 'ri142-pixi-reduced', renderer: 'pixi' });
    await stabilizeForScreenshot(page);

    await page.getByTestId('action-overtime').click();
    const board = page.getByTestId('board');
    const mount = page.getByTestId('board-pixi-mount');
    await expect(board).toHaveAttribute('data-effect-sfx-count', '1');
    await expect(mount).toHaveAttribute('data-board-effects', '0');
    await expect(mount).toHaveAttribute('data-board-auras', '1');
    await expect(page.locator('[data-testid^="event-ticker-row-"]').first()).toBeVisible();
    await freezePixiForScreenshot(page);
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

  test('859/860/861pxのリサイズでPixiコンテキストを再生成しない @pixi', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await beginPublicSprint(page, { seed: 'ri98-responsive-pixi-0', renderer: 'pixi' });
    const mount = page.getByTestId('board-pixi-mount');
    await expect(mount).toBeVisible();
    await expect
      .poll(async () => mount.getAttribute('data-board-dots'), { timeout: 15_000 })
      .toMatch(/^\d+$/);

    await page.evaluate(() => {
      const win = window as PixiTestWindow;
      if (!win.__boardPixiTest) throw new Error('__boardPixiTest hook missing');
      win.__ri98InitialBoardPixiTest = win.__boardPixiTest;
    });

    for (const [width, expected] of [
      [859, 'narrow'],
      [860, 'narrow'],
      [861, 'wide'],
    ] as const) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(async () => page.getByTestId('sprint-layout').getAttribute('data-responsive-width'), {
          timeout: 5_000,
        })
        .toBe(expected);
      await page.evaluate(
        ({ expectedWidth }) => {
          const win = window as PixiTestWindow;
          const layout = document.querySelector('[data-testid="sprint-layout"]');
          if (!layout) throw new Error('sprint-layout が見つからない');
          if (layout.getAttribute('data-responsive-width') !== expectedWidth) {
            throw new Error(`responsive width が ${expectedWidth} ではない`);
          }
          if (win.__ri98InitialBoardPixiTest !== win.__boardPixiTest) {
            throw new Error('Pixiテストフックが再生成された');
          }
        },
        { expectedWidth: expected },
      );
    }
  });

  test('390x844 HUD展開後の結果オーバーレイPixi合成を固定する @pixi', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await beginPublicSprint(page, { seed: 'ri94-result-0', renderer: 'pixi' });
    await page.getByTestId('hud-toggle').click();
    await advanceCurrentSprintToResult(page);
    await stabilizeForScreenshot(page);
    await freezePixiForScreenshot(page);

    await expect(page).toHaveScreenshot('sprint-pixi-layout-result-overlay.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });

    const resultCard = page.getByTestId('sprint-result').locator('.sprint-result-card');
    const resultContinue = page.getByTestId('result-continue');
    await resultContinue.scrollIntoViewIfNeeded();
    await expect(resultContinue).toBeInViewport({ ratio: 1 });
    await page.getByTestId('overlay-scroll').evaluate((element) => element.scrollTo(0, 0));
    await exposeResultCardForScreenshot(page);
    await expect(resultCard).toHaveScreenshot('sprint-pixi-layout-result-overlay-card.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('進化オーバーレイ中もPixi盤面の静止フレームが残る @pixi', async ({ page }) => {
    // freezeForScreenshot は使わない。進化中の setAnimationsPaused → app.render() 経路を固定する。
    await page.setViewportSize({ width: 1440, height: 900 });
    await advancePublicRun(page, {
      seed: 'evo-overlay-pause',
      difficulty: 'easy',
      renderer: 'pixi',
      target: { phase: 'evolution' },
    });
    await expect(page.getByTestId('evolution')).toBeVisible();
    await expect(page.locator('.app')).toHaveAttribute('data-phase', 'evolution');
    await expect(page.getByTestId('board')).toHaveAttribute('data-animations-paused', 'true');
    await stabilizeForScreenshot(page);

    // オーバーレイは背面 canvas を覆う。静止フレーム自体を回帰するため一時的に隠す。
    await page.getByTestId('evolution').evaluate((element) => {
      (element as HTMLElement).style.visibility = 'hidden';
    });
    await expect(page.getByTestId('board-pixi-mount')).toHaveScreenshot(
      'sprint-pixi-evolution-paused-board.png',
      {
        animations: 'disabled',
        maxDiffPixelRatio: 0.02,
      },
    );
  });

  test('武装→canvas 上の粒ドラッグでタスク差配とGPUリアクションが確定する @pixi（RI-30 / RI-142）', async ({
    page,
  }) => {
    // 序盤（coding/backlog に差配候補が残っている状態）で武装する。
    await page.setViewportSize({ width: 1440, height: 900 });
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
    const to = toPage(620, 260); // Coding ステーションのドロップゾーン中心。
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
    await expect(board).toHaveAttribute('data-effect-kinds', 'intervention:assignDash');
    await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-effects', '1');
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
