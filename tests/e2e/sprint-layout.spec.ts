/**
 * スプリント画面のレイアウト契約 E2E（RI-69 / RI-70 / RI-94）。
 *
 * RI-94 の状態 fixture は `window.game` の公開メソッドだけで作り、実時間待機や
 * 内部 engine 参照には依存しない。画面操作が契約そのものになる assignTask の武装と
 * 担当選択だけは Playwright のクリックで検証する。
 */
import { expect, test } from './fixtures';
import {
  advancePublicRun,
  advanceCurrentSprintToResult,
  beginCurrentSetupSprint,
  beginPublicSprint,
} from './fixtures';
import type { Page } from '@playwright/test';
import { RELIC_DEFS } from '../../src/data/relics';
import { seedMeta } from './seedMeta';

const BOARD_RATIO = 1404 / 573;

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

type Box = { x: number; y: number; width: number; height: number };

interface LayoutContractOptions {
  effectTags?: boolean;
  diagnosis?: string;
  relicCount?: number;
  armed?: boolean;
  assignee?: boolean;
  resultOverlay?: boolean;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function readBox(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} の bounding box が取得できない`);
  return box;
}

/** sticky actionbar の塗りつぶし位置ではなく、兄弟フロー上の配置を測る。 */
async function readFlowBoxes(page: Page, testIds: readonly string[]): Promise<Box[]> {
  return page.evaluate((ids) => {
    const elements = ids.map((id) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
      if (!element) throw new Error(`${id} が見つからない`);
      return element;
    });
    const actionBar = elements.find((element) => element.dataset.testid === 'action-bar');
    const previousPosition = actionBar?.style.position;
    const previousBottom = actionBar?.style.bottom;
    if (actionBar && getComputedStyle(actionBar).position === 'sticky') {
      actionBar.style.position = 'static';
      actionBar.style.bottom = 'auto';
    }
    const scrollY = window.scrollY;
    const boxes = elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y + scrollY, width: rect.width, height: rect.height };
    });
    if (actionBar) {
      actionBar.style.position = previousPosition ?? '';
      actionBar.style.bottom = previousBottom ?? '';
    }
    return boxes;
  }, testIds);
}

async function assertLayoutContract(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  options: LayoutContractOptions = {},
) {
  const subbar = page.getByTestId('sprint-subbar');
  const board = page.getByTestId('board');
  const deck = page.getByTestId('deck');
  const actionBar = page.getByTestId('action-bar');

  await expect(subbar).toBeVisible();
  await expect(board).toBeVisible();
  await expect(deck).toBeVisible();
  await expect(actionBar).toBeVisible();

  // 直前の viewport での到達性検証によるスクロール位置を契約計測から切り離す。
  await page.evaluate(() => window.scrollTo(0, 0));
  const boxes = await readFlowBoxes(page, ['sprint-subbar', 'board', 'deck', 'action-bar']);
  const [subbarBox, boardBox, deckBox, actionBox] = boxes;
  if (!subbarBox || !boardBox || !deckBox || !actionBox) {
    throw new Error('スプリント主要領域の bounding box が不足している');
  }

  const namedBoxes: [string, Box][] = [
    ['sprint-subbar', subbarBox],
    ['board', boardBox],
    ['deck', deckBox],
    ['action-bar', actionBox],
  ];
  for (let i = 0; i < namedBoxes.length; i += 1) {
    for (let j = i + 1; j < namedBoxes.length; j += 1) {
      const [leftName, leftBox] = namedBoxes[i];
      const [rightName, rightBox] = namedBoxes[j];
      expect(
        overlaps(leftBox, rightBox),
        `${leftName} と ${rightName} が ${viewport.width}x${viewport.height} で重なっている`,
      ).toBe(false);
    }
  }

  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(
    noHorizontalOverflow,
    `${viewport.width}x${viewport.height} で横スクロールが発生している`,
  ).toBe(true);

  const boardRatioError = Math.abs(boardBox.width / boardBox.height / BOARD_RATIO - 1);
  expect(boardRatioError, '盤面の 1404:573 比率が崩れている').toBeLessThanOrEqual(0.01);
  expect(
    boardBox.width,
    `盤面の最低幅を満たしていない（${viewport.width}x${viewport.height}）`,
  ).toBeGreaterThanOrEqual(240);
  expect(
    boardBox.height,
    `盤面の最低高を満たしていない（${viewport.width}x${viewport.height}）`,
  ).toBeGreaterThanOrEqual(96);

  const boardWrap = page.locator('.board-wrap');
  const wrapBox = await boardWrap.boundingBox();
  const stageBox = await page.locator('.board-stage').boundingBox();
  if (!wrapBox || !stageBox)
    throw new Error('board-wrap / board-stage の bounding box が取得できない');
  // board-stage が contain の実効スロット。横長盤面は幅、縦に制約される場合は高さを
  // 使い切るため、どちらかの軸で 75% 以上を占めることを契約にする。
  const widthFill = boardBox.width / stageBox.width;
  const heightFill = boardBox.height / stageBox.height;
  expect(
    Math.max(widthFill, heightFill),
    `盤面が board-wrap の contain スロットを十分に使用していない（${viewport.width}x${viewport.height}）`,
  ).toBeGreaterThan(0.75);

  await actionBar.scrollIntoViewIfNeeded();
  await expect(actionBar).toBeInViewport();

  if (options.assignee) {
    const assignee = page.getByTestId('assign-assignee');
    const senior = page.getByTestId('assign-assignee-senior');
    await assignee.scrollIntoViewIfNeeded();
    await senior.scrollIntoViewIfNeeded();
    await expect(assignee).toBeInViewport();
    await expect(senior).toBeInViewport();
  }

  if (options.effectTags) {
    const effectTags = page.locator('[data-testid^="action-tags-"]').first();
    await expect(effectTags).toBeVisible();
    await expect(effectTags.locator('.effect-tag').first()).not.toBeEmpty();
  }
  if (options.diagnosis) {
    const diagnosis = page.getByTestId('runbar-diagnosis');
    await expect(diagnosis).toHaveAttribute('data-diagnosis', options.diagnosis);
    await expect(diagnosis.locator('.diagnosis-warning')).not.toBeEmpty();
  }
  if (options.relicCount !== undefined) {
    await expect(page.getByTestId('relics').locator('.relic-chip')).toHaveCount(options.relicCount);
  }
  if (options.armed) {
    await expect(board).toHaveAttribute('data-armed', 'assignTask');
    await expect(page.getByTestId('action-assignTask')).toHaveAttribute('data-armed', 'true');
  }
  if (options.assignee) {
    await expect(page.getByTestId('assign-assignee-senior')).toHaveClass(/on/);
  }
  if (options.resultOverlay) {
    await expect(page.getByTestId('sprint-result')).toBeVisible();
  }
}

async function stabilizeDomForScreenshot(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '*, *::before, *::after { animation: none !important; transition: none !important; }',
  });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function waitForLayoutFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function assertAcrossViewports(
  page: Page,
  options: LayoutContractOptions = {},
): Promise<void> {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await waitForLayoutFrame(page);
    await assertLayoutContract(page, viewport, options);
  }
}

test('デスクトップ幅で sprint-subbar と board が重ならない', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await beginPublicSprint(page, { seed: 'sprint-layout-ri69' });

  const subbar = page.getByTestId('sprint-subbar');
  const board = page.getByTestId('board');
  const actionBar = page.getByTestId('action-bar');

  await expect(subbar).toBeVisible();
  await expect(board).toBeVisible();
  await expect(actionBar).toBeVisible();

  const subbarBox = await readBox(page, 'sprint-subbar');
  const boardBox = await readBox(page, 'board');
  const actionBox = await readBox(page, 'action-bar');

  expect(overlaps(subbarBox, boardBox), 'sprint-subbar と board が重なっている').toBe(false);
  expect(subbarBox.y + subbarBox.height).toBeLessThanOrEqual(boardBox.y);

  expect(overlaps(boardBox, actionBox), 'board と action-bar が重なっている').toBe(false);
  expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(actionBox.y);

  const wrap = page.locator('.board-wrap');
  const wrapBox = await wrap.boundingBox();
  if (!wrapBox) throw new Error('board-wrap の bounding box が取得できない');
  expect(boardBox.width / wrapBox.width).toBeGreaterThan(0.75);
  expect(actionBox.height).toBeLessThan(180);
});

test('狭幅390pxでKPI折り畳み後に介入バーへ到達できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await beginPublicSprint(page, { seed: 'sprint-layout-ri70' });

  const hud = page.getByTestId('hud');
  const compact = page.getByTestId('hud-compact');
  const toggle = page.getByTestId('hud-toggle');
  const board = page.getByTestId('board');
  const actionBar = page.getByTestId('action-bar');

  await expect(hud).toHaveAttribute('data-compact', 'true');
  await expect(compact).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(board).toBeVisible();
  await expect(actionBar).toBeVisible();

  const boardBox = await board.boundingBox();
  const actionBox = await actionBar.boundingBox();
  if (!boardBox || !actionBox) {
    throw new Error('board / action-bar の bounding box が取得できない');
  }

  const viewportHeight = 844;
  expect(boardBox.y).toBeGreaterThanOrEqual(0);
  expect(boardBox.y + boardBox.height).toBeLessThanOrEqual(viewportHeight);
  expect(actionBox.y).toBeGreaterThanOrEqual(0);
  expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(viewportHeight);

  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(noHorizontalOverflow, '横スクロールが発生している').toBe(true);

  await toggle.click();
  await expect(hud).toHaveAttribute('data-compact', 'false');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(actionBar).toBeVisible();
  await actionBar.scrollIntoViewIfNeeded();
  await expect(actionBar).toBeInViewport();
});

test.describe('RI-94 レイアウト契約', () => {
  test('通常スプリントの5 viewport契約と長い効果タグを満たす', async ({ page }) => {
    await beginPublicSprint(page, { seed: 'ri94-normal-0' });
    await assertAcrossViewports(page, { effectTags: true });
  });

  test('HUD展開・シニア担当の武装状態を5 viewportで維持する', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await beginPublicSprint(page, { seed: 'ri94-assignTask-0' });

    await page.getByTestId('hud-toggle').click();
    await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'false');
    const assign = page.getByTestId('action-assignTask');
    await expect(assign).toBeEnabled();
    await assign.click();
    await page.getByTestId('assign-assignee-senior').click();
    await expect(page.getByTestId('assign-assignee-senior')).toHaveClass(/on/);

    await assertAcrossViewports(page, { armed: true, assignee: true, effectTags: true });
  });

  test('最長診断警告 seniorSacrifice を5 viewportで表示する', async ({ page }) => {
    await advancePublicRun(page, {
      seed: 'ri94-warning-0',
      target: { phase: 'setup', diagnosis: 'seniorSacrifice' },
    });
    await beginCurrentSetupSprint(page);
    await assertAcrossViewports(page, { diagnosis: 'seniorSacrifice', effectTags: true });
  });

  test('全レリック解放メタから6個取得した状態を5 viewportで表示する', async ({ page }) => {
    test.fail(
      true,
      '現行UIは1024x768の6レリック状態で盤面最低幅240pxを満たさない（RI-95〜100で解消予定）',
    );
    await seedMeta(page, { unlockedRelics: RELIC_DEFS.map((relic) => relic.id) });
    await advancePublicRun(page, {
      seed: 'ri94-relics-1',
      target: { phase: 'setup', relicCount: 6 },
    });
    await beginCurrentSetupSprint(page);
    await assertAcrossViewports(page, { relicCount: 6, effectTags: true });
  });

  test('初期スプリントを公開stepで結果オーバーレイへ進める', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await beginPublicSprint(page, { seed: 'ri94-result-0' });
    await page.getByTestId('hud-toggle').click();
    await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'false');
    await advanceCurrentSprintToResult(page);
    await assertAcrossViewports(page, { resultOverlay: true });
  });

  test('1440x900通常スプリントのDOM合成を固定する', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await beginPublicSprint(page, { seed: 'ri94-normal-0' });
    await stabilizeDomForScreenshot(page);
    await expect(page.locator('.app')).toHaveScreenshot('sprint-layout-normal.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });

  test('390x844 HUD展開後の結果オーバーレイDOM合成を固定する', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await beginPublicSprint(page, { seed: 'ri94-result-0' });
    await page.getByTestId('hud-toggle').click();
    await advanceCurrentSprintToResult(page);
    await expect(page.getByTestId('sprint-result')).toBeVisible();
    await stabilizeDomForScreenshot(page);
    await expect(page.locator('.app')).toHaveScreenshot('sprint-layout-result-overlay.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });
});
