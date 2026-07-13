/**
 * スプリント盤面（現場）の Pixi 視覚回帰＋操作 E2E（RI-11 残務 / RI-07 / RI-30）。
 *
 * PIXI_E2E=1 のときだけ実行する（既定 CI では WebGL を回さない。architecture §4.2）。
 * 実行: `npm run test:e2e:pixi`
 */
import { expect, test } from '@playwright/test';
import { planBoardScene } from '../../src/render/boardScene';
import { assignableTasks } from '../../src/sim/assignTask';
import type { RunState } from '../../src/sim/run/types';
import type { SprintState } from '../../src/sim/types';

const PIXI_SEED = 'sprint-pixi-e2e';

type GameWindow = Window & {
  game?: {
    pause(): void;
    getState(): RunState;
    startRun(difficulty?: string, trials?: string[], seed?: string): RunState;
    beginSetupSprint(): RunState;
    step(ms: number): RunState;
    zoomTo(level: string): RunState;
    focusDept(id: string): RunState;
    focusTeam(id: string): RunState;
  };
  __boardPixiTest?: {
    freezeForScreenshot(): void;
  };
};

/** Pixi 視覚回帰は opt-in のみ（CI 既定 job では WebGL を回さない）。 */
const pixiE2e = !!process.env.PIXI_E2E;

/**
 * 固定 seed でスプリント盤面（Pixi）を開き、決定論の固定ステップで進める。
 * steps は目的別: 視覚回帰は 40（Review/Done の山＋フロー粒）、ドラッグは 5
 * （coding/backlog に差配候補が残っている序盤）。
 */
async function openPixiSprintBoard(
  page: import('@playwright/test').Page,
  seed: string,
  steps = 40,
) {
  await page.goto(`/?renderer=pixi&seed=${seed}`);
  await page.evaluate(
    ({ s, n }) => {
      const g = (window as GameWindow).game!;
      g.pause();
      g.startRun('normal', [], s);
      g.beginSetupSprint();
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
    const hook = (window as GameWindow).__boardPixiTest;
    if (!hook) throw new Error('__boardPixiTest hook missing (dev server + renderer=pixi が必要)');
    hook.freezeForScreenshot();
  });
}

test.describe('Pixi スプリント盤面視覚回帰 @pixi', () => {
  test.skip(!pixiE2e, 'PIXI_E2E=1 のときだけ実行（既定 CI では WebGL を回さない）');

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

  test('武装→canvas 上の粒ドラッグでタスク差配が確定する @pixi（RI-30）', async ({ page }) => {
    // 序盤（coding/backlog に差配候補が残っている状態）で武装する。
    await openPixiSprintBoard(page, PIXI_SEED, 5);
    await stabilizeForScreenshot(page);

    const assign = page.getByTestId('action-assignTask');
    await expect(assign).toBeEnabled();
    await assign.click();
    await expect(page.getByTestId('board')).toHaveAttribute('data-armed', 'assignTask');

    // 掴む粒の設計座標は、ページの sprint 状態から Node 側で純関数により再計算する
    // （盤面計画は決定論なので、canvas に描かれた粒と同じ座標になる）。
    const sprint = (await page.evaluate(
      () => (window as GameWindow).game!.getState().sprint,
    )) as SprintState;
    const scene = planBoardScene(sprint.tasks);
    const candidateIds = new Set(assignableTasks(sprint).map((t) => t.id));
    const dot = scene.dots.find((d) => candidateIds.has(d.id) && !d.motion);
    if (!dot) throw new Error('draggable dot not found on board');

    const board = page.getByTestId('board');
    const box = await board.boundingBox();
    if (!box) throw new Error('board bounding box missing');
    const toPage = (x: number, y: number) => ({
      x: box.x + box.width * (x / 1404),
      y: box.y + box.height * (y / 573),
    });

    const from = toPage(dot.x, dot.y);
    const to = toPage(622, 251); // Coding ステーションのドロップゾーン中心。
    const before = await page.evaluate(
      () => (window as GameWindow).game!.getState().sprint?.metrics.actionCounts.assignTask ?? 0,
    );
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as GameWindow).game!.getState().sprint?.metrics.actionCounts.assignTask ?? 0,
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

    await page.evaluate(() => (window as GameWindow).game!.zoomTo('company'));
    await expect(page.getByTestId('org-pixi-mount')).toBeVisible();
    await page.evaluate(() => (window as GameWindow).game!.focusDept('product'));
    await expect(page.getByTestId('dept-pixi-mount')).toBeVisible();
    await page.evaluate(() => (window as GameWindow).game!.focusTeam('product-t0'));
    await expect
      .poll(async () => page.evaluate(() => (window as GameWindow).game!.getState().zoom.level))
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
