/**
 * 武装しても盤面を縮めず、タスク粒を見分けられる大きさに保つ（#918）。
 *
 * 広幅では対象ピッカーをアクションバーの上に重ね、盤面のレイアウト寸法を変えない。
 * 320 幅は幅いっぱいで contain-fit が約 0.21 になり、縮めなくても小さい粒が 3px 台に
 * なる。そこは設計上の山間隔が画面上 3px 以上開く最小直径まで粒と間隔を広げる。
 */
import type { Page } from '@playwright/test';
import { BOARD_STATION_CENTERS, BOARD_VIEW, planBoardScene } from '../../src/render/boardScene';
import {
  boardDotCssDiameter,
  boardDotPreviewRing,
  boardDotReadabilityMagnification,
  presentBoardDot,
  presentBoardDots,
  presentedDotHitsOtherStation,
  presentedDotLeavesBoard,
  presentedDotRadius,
} from '../../src/render/boardPixiView';
import { containFitTransform } from '../../src/render/deptPixiView';
import { TASK_DIAMETER, type TaskSize } from '../../src/render/taskView';
import { VISUAL_TOKENS } from '../../src/render/visualTokens';
import type { Lane } from '../../src/sim/types';
import { designToClient, readBoardCanvasFrame } from './boardCanvasPoint';
import { beginPublicSprint, expect, test, type PublicGameWindow } from './fixtures';

const STATIONS = (Object.keys(BOARD_STATION_CENTERS) as Lane[]).map((lane) => ({
  lane,
  x: BOARD_STATION_CENTERS[lane].x,
  y: BOARD_STATION_CENTERS[lane].y,
}));

const MIN_DIAMETER = VISUAL_TOKENS.dimensions.sprint.taskDotMinCssDiameter;
const SIZES = ['small', 'medium', 'large'] as const satisfies readonly TaskSize[];

async function advanceToSplitCandidateCount(page: Page, target: number): Promise<void> {
  const reached = await page.evaluate((wanted) => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    const count = () => {
      const sprint = game.getState().sprint;
      if (!sprint) return 0;
      return sprint.tasks.filter(
        (task) => (task.lane === 'review' || task.lane === 'coding') && !task.split,
      ).length;
    };
    let guard = 0;
    let best = count();
    let stepMs = 80;
    while (game.getState().phase === 'sprint' && guard < 8000) {
      const current = count();
      best = Math.max(best, current);
      if (current === wanted) {
        game.pause();
        return current;
      }
      if (current > wanted) {
        game.pause();
        throw new Error(`PR分割候補が ${current} 件で ${wanted} 件を飛び越した`);
      }
      if (wanted - current <= 3) stepMs = 10;
      guard += 1;
      game.step(stepMs);
    }
    game.pause();
    throw new Error(
      `PR分割候補が ${wanted} 件に到達しない (max ${best}, phase ${game.getState().phase})`,
    );
  }, target);
  expect(reached).toBe(target);
}

async function readBoardBox(page: Page) {
  const board = page.getByTestId('board');
  await board.scrollIntoViewIfNeeded();
  const box = await board.boundingBox();
  if (!box) throw new Error('盤面の位置を取得できない');
  return box;
}

async function readDotReadability(page: Page) {
  await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute('data-board-assets', '5');
  await page.evaluate(() => {
    const hook = window.__boardPixiTest;
    if (!hook) throw new Error('Pixi のテストフックがない');
    hook.freezeForScreenshot();
  });
  return page.evaluate(() => {
    const hook = window.__boardPixiTest;
    if (!hook?.getDotReadability) throw new Error('粒の縮尺を取得できない');
    return hook.getDotReadability();
  });
}

function assertDiameters(
  readability: { scale: number; magnification: number },
  label: string,
): void {
  expect(readability.magnification, label).toBeCloseTo(
    boardDotReadabilityMagnification(readability.scale),
    5,
  );
  for (const size of SIZES) {
    const css = TASK_DIAMETER[size] * readability.scale * readability.magnification;
    expect(css, `${label} の ${size} 粒`).toBeGreaterThanOrEqual(MIN_DIAMETER);
    expect(css).toBeCloseTo(boardDotCssDiameter(size, readability.scale), 5);
  }
}

async function presentedStationaryDots(page: Page) {
  const sprint = await page.evaluate(() => (window as PublicGameWindow).game?.getState().sprint);
  const frame = await readBoardCanvasFrame(page);
  if (!sprint) throw new Error('スプリントがない');
  const planned = planBoardScene(sprint.tasks).dots;
  const stationary = presentBoardDots(planned, frame.fit.scale).filter((dot) => !dot.motion);
  const review = stationary.filter((dot) => dot.lane === 'review');
  return { frame, dots: review.length > 0 ? review : stationary };
}

async function assertPileRowSpacing(page: Page): Promise<void> {
  const sprint = await page.evaluate(() => (window as PublicGameWindow).game?.getState().sprint);
  const frame = await readBoardCanvasFrame(page);
  if (!sprint) throw new Error('スプリントがない');
  const cssScale = frame.fit.scale;
  const planned = planBoardScene(sprint.tasks).dots.filter((dot) => !dot.motion);
  const review = planned.filter((dot) => dot.lane === 'review');
  const dots = review.length > 0 ? review : planned;
  expect(dots.length, '盤面の静止した粒').toBeGreaterThan(1);
  const magnification = boardDotReadabilityMagnification(cssScale);
  let unconstrainedNearest = Infinity;
  let unconstrainedPairs = 0;
  let pairs = 0;
  for (let i = 0; i < dots.length; i += 1) {
    for (let j = i + 1; j < dots.length; j += 1) {
      const presentedI = presentBoardDot(dots[i], cssScale);
      const presentedJ = presentBoardDot(dots[j], cssScale);
      // 同じ段（山の横間隔）。縦は設計上、小さい粒が接する。
      if (Math.abs(presentedI.y - presentedJ.y) > 0.5) continue;
      pairs += 1;
      const presentedGap = Math.abs(presentedI.x - presentedJ.x);
      const anchorI = dots[i].clusterX ?? dots[i].x;
      const anchorJ = dots[j].clusterX ?? dots[j].x;
      const fullGap = Math.abs(
        anchorI +
          (dots[i].x - anchorI) * magnification -
          (anchorJ + (dots[j].x - anchorJ) * magnification),
      );
      // 別工程へ入る粒は基準点側へ戻すので、その組の隙間は 3px より狭くてよい。
      if (presentedGap >= fullGap - 0.5) {
        unconstrainedPairs += 1;
        unconstrainedNearest = Math.min(unconstrainedNearest, presentedGap * cssScale);
      }
    }
  }
  expect(pairs, '同じ段に並ぶ粒').toBeGreaterThan(0);
  if (unconstrainedPairs > 0) {
    // 小さい粒の直径を最小値まで広げたとき、戻していない横の隙間は約 3px。
    expect(unconstrainedNearest - MIN_DIAMETER).toBeGreaterThanOrEqual(2.5);
  }
}

/** 拡大した粒が盤面の端で切れず、静止粒が別工程のキャラに入らない。 */
async function assertPresentedDotsContained(page: Page): Promise<void> {
  const sprint = await page.evaluate(() => (window as PublicGameWindow).game?.getState().sprint);
  if (!sprint) throw new Error('スプリントがない');
  const readability = await readDotReadability(page);
  const planned = planBoardScene(sprint.tasks).dots;
  expect(planned.length).toBeGreaterThan(0);
  for (const dot of planned) {
    expect(presentedDotLeavesBoard(dot, readability.scale), `粒 ${dot.id} が盤面の端で切れる`).toBe(
      false,
    );
    if (!dot.motion) {
      expect(
        presentedDotHitsOtherStation(dot, readability.scale, STATIONS),
        `粒 ${dot.id} が別の工程にはみ出す`,
      ).toBe(false);
    }
  }
}

function circleMeetsRect(
  cx: number,
  cy: number,
  radius: number,
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  const nearestX = Math.max(rect.x + 0.5, Math.min(cx, rect.x + rect.width - 0.5));
  const nearestY = Math.max(rect.y + 0.5, Math.min(cy, rect.y + rect.height - 0.5));
  const dx = cx - nearestX;
  const dy = cy - nearestY;
  return dx * dx + dy * dy < radius * radius;
}

/** 候補 16 件の粒と、プレビュー輪の外縁が対象ピッカーに重ならない。 */
async function assertCandidateDotsAndRingsUncovered(page: Page): Promise<void> {
  const pickerBox = await page.getByTestId('action-target-picker').boundingBox();
  if (!pickerBox) throw new Error('対象ピッカーの位置を取得できない');
  const mount = await page.getByTestId('board-pixi-mount').boundingBox();
  if (!mount) throw new Error('盤面キャンバスの位置を取得できない');
  const fit = containFitTransform(mount.width, mount.height, BOARD_VIEW.w, BOARD_VIEW.h);
  const scrolls = await page.locator('.action-target-picker-list').evaluate((element) => {
    return element.scrollHeight > element.clientHeight + 1;
  });
  expect(scrolls, 'あふれた候補は一覧の中でスクロールする').toBe(true);

  const taskIds = await page
    .locator('[data-action-target-option]')
    .evaluateAll((nodes) => nodes.map((node) => Number((node as HTMLElement).dataset.taskId)));
  expect(taskIds).toHaveLength(16);
  const sprint = await page.evaluate(() => (window as PublicGameWindow).game?.getState().sprint);
  if (!sprint) throw new Error('スプリントがない');
  const planned = planBoardScene(sprint.tasks).dots;
  for (const taskId of taskIds) {
    const dot = planned.find((entry) => entry.id === taskId);
    expect(dot, `候補 ${taskId} の粒`).toBeDefined();
    const presented = presentBoardDot(dot!, fit.scale);
    const centerX = mount.x + fit.x + presented.x * fit.scale;
    const centerY = mount.y + fit.y + presented.y * fit.scale;
    const dotRadius = presentedDotRadius(dot!.size, fit.scale) * fit.scale;
    const ring = boardDotPreviewRing(dot!.size, fit.scale);
    const ringRadius = (ring.radius + ring.outlineWidth / 2) * fit.scale;
    expect(
      circleMeetsRect(centerX, centerY, dotRadius, pickerBox),
      `候補 ${taskId} の粒が対象ピッカーに重なる`,
    ).toBe(false);
    expect(
      circleMeetsRect(centerX, centerY, ringRadius, pickerBox),
      `候補 ${taskId} のプレビュー輪が対象ピッカーに重なる`,
    ).toBe(false);
  }
}

async function assertControlsUncovered(page: Page): Promise<void> {
  for (const testId of ['hud', 'action-splitPr', 'action-target-cancel'] as const) {
    const locator = page.getByTestId(testId);
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    if (!box) throw new Error(`${testId} の位置を取得できない`);
    const covered = await page.evaluate(
      ({ x, y, id }) => {
        const element = document.elementFromPoint(x, y);
        return element?.closest(`[data-testid="${id}"]`) == null;
      },
      { x: box.x + box.width / 2, y: box.y + Math.min(box.height / 2, 16), id: testId },
    );
    expect(covered, `${testId} が別の要素に隠れている`).toBe(false);
  }
}

async function assertReviewDotUncovered(page: Page): Promise<void> {
  const { frame, dots } = await presentedStationaryDots(page);
  const sample = dots[Math.floor(dots.length / 2)];
  if (!sample) throw new Error('盤面の粒がない');
  const onBoard = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return (
        !!element?.closest('[data-testid="board"]') &&
        element.closest('[data-testid="action-target-picker"]') == null
      );
    },
    designToClient(frame, sample),
  );
  expect(onBoard, 'レビューの粒が対象ピッカーに隠れている').toBe(true);
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
] as const) {
  for (const candidates of [7, 16] as const) {
    test(`${viewport.width}px・候補 ${candidates} 件でも武装後の粒が見分けられる（#918） @pixi`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await beginPublicSprint(page, { seed: 'devops-tycoon', renderer: 'pixi' });
      await advanceToSplitCandidateCount(page, candidates);

      const beforeBox = await readBoardBox(page);
      const before = await readDotReadability(page);
      assertDiameters(before, `${viewport.width}px 構える前`);
      if (viewport.width === 1280) expect(before.magnification).toBe(1);

      await page.getByTestId('action-splitPr').click();
      await expect(page.getByTestId('board')).toHaveAttribute('data-armed', 'splitPr');
      await expect(page.getByTestId('action-target-picker')).toBeVisible();
      await expect(page.locator('[data-action-target-option]')).toHaveCount(candidates);

      const afterBox = await readBoardBox(page);
      expect(
        Math.abs(afterBox.width - beforeBox.width),
        '武装で盤面幅が変わる',
      ).toBeLessThanOrEqual(4);
      expect(
        Math.abs(afterBox.height - beforeBox.height),
        '武装で盤面高が変わる',
      ).toBeLessThanOrEqual(4);

      const after = await readDotReadability(page);
      assertDiameters(after, `${viewport.width}px 候補 ${candidates} 件`);
      if (viewport.width === 1280) expect(after.magnification).toBe(1);
      if (viewport.width === 320) {
        expect(after.magnification).toBeGreaterThan(1);
        await assertPresentedDotsContained(page);
      }
      if (viewport.width === 1280 && candidates === 16) {
        await assertCandidateDotsAndRingsUncovered(page);
      }
      await assertPileRowSpacing(page);
      await assertReviewDotUncovered(page);
      await assertControlsUncovered(page);

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByTestId('board').screenshot({
        path: `/opt/cursor/artifacts/armed-board-${viewport.width}-candidates-${candidates}.png`,
      });
    });
  }
}

test('短い広幅でも武装後に状態要約と主操作が見える（#918） @pixi', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await beginPublicSprint(page, { seed: 'devops-tycoon', renderer: 'pixi' });
  await advanceToSplitCandidateCount(page, 16);
  const before = await readBoardBox(page);
  await page.getByTestId('action-splitPr').click();
  await expect(page.getByTestId('action-target-picker')).toBeVisible();
  await expect(page.locator('[data-action-target-option]')).toHaveCount(16);
  const after = await readBoardBox(page);
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(4);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(4);
  const readability = await readDotReadability(page);
  assertDiameters(readability, '1024x720');
  await assertCandidateDotsAndRingsUncovered(page);
  await assertReviewDotUncovered(page);
  await assertControlsUncovered(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByTestId('board').screenshot({
    path: '/opt/cursor/artifacts/armed-board-1024x720-candidates-16.png',
  });
});
