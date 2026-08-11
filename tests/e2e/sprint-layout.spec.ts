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
import type { Locator, Page } from '@playwright/test';
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
type ViewportName = (typeof VIEWPORTS)[number]['name'];

type Box = { x: number; y: number; width: number; height: number };

interface LayoutContractOptions {
  effectTags?: boolean;
  diagnosis?: string;
  relicCount?: number;
  armed?: boolean;
  assignee?: boolean;
  hudExpanded?: boolean;
  resultOverlay?: boolean;
  skipBoardMinimumDimensionsAt?: ViewportName;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function readBox(page: Page, testId: string): Promise<Box> {
  const box = await page.getByTestId(testId).boundingBox();
  if (!box) throw new Error(`${testId} の bounding box が取得できない`);
  return box;
}

/** viewport に収まる要素は全体、viewport より背の高い要素は上下端の到達性を検証する。 */
async function assertReachableInViewport(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} の bounding box が取得できない`);

  if (box.height <= viewportHeight + 1) {
    await expect(locator, label).toBeInViewport({ ratio: 1 });
    return;
  }

  await locator.evaluate((element) =>
    element.scrollIntoView({ block: 'start', inline: 'nearest' }),
  );
  const topBox = await locator.boundingBox();
  expect(topBox?.y, `${label} の上端へスクロールできない`).toBeGreaterThanOrEqual(-1);
  expect(topBox?.y, `${label} の上端が viewport 境界に揃わない`).toBeLessThanOrEqual(1);

  await locator.evaluate((element) => element.scrollIntoView({ block: 'end', inline: 'nearest' }));
  const bottomBox = await locator.boundingBox();
  expect(
    bottomBox && bottomBox.y + bottomBox.height,
    `${label} の下端へスクロールできない`,
  ).toBeLessThanOrEqual(viewportHeight + 1);
  expect(
    bottomBox && bottomBox.y + bottomBox.height,
    `${label} の下端が viewport 境界に揃わない`,
  ).toBeGreaterThanOrEqual(viewportHeight - 1);
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
    const controlsSlot = actionBar?.closest<HTMLElement>('[data-sprint-slot="controls"]');
    const previousPosition = actionBar?.style.position;
    const previousBottom = actionBar?.style.bottom;
    const previousControlsPosition = controlsSlot?.style.position;
    const previousControlsBottom = controlsSlot?.style.bottom;
    if (actionBar && getComputedStyle(actionBar).position === 'sticky') {
      actionBar.style.position = 'static';
      actionBar.style.bottom = 'auto';
    }
    if (controlsSlot && getComputedStyle(controlsSlot).position === 'sticky') {
      controlsSlot.style.position = 'static';
      controlsSlot.style.bottom = 'auto';
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
    if (controlsSlot) {
      controlsSlot.style.position = previousControlsPosition ?? '';
      controlsSlot.style.bottom = previousControlsBottom ?? '';
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

  if (options.hudExpanded !== undefined) {
    await expect(page.getByTestId('hud')).toHaveAttribute(
      'data-compact',
      options.hudExpanded ? 'false' : 'true',
    );
    const hudToggle = page.getByTestId('hud-toggle');
    if ((await hudToggle.count()) > 0) {
      await expect(hudToggle).toHaveAttribute(
        'aria-expanded',
        options.hudExpanded ? 'true' : 'false',
      );
    }
  }

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

  const noHorizontalOverflow = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('.app.app-sprint-layout');
    return (
      document.documentElement.scrollWidth <= window.innerWidth + 1 &&
      (app === null || app.scrollWidth <= app.clientWidth + 1)
    );
  });
  expect(
    noHorizontalOverflow,
    `${viewport.width}x${viewport.height} で横スクロールが発生している`,
  ).toBe(true);

  const boardRatioError = Math.abs(boardBox.width / boardBox.height / BOARD_RATIO - 1);
  expect(boardRatioError, '盤面の 1404:573 比率が崩れている').toBeLessThanOrEqual(0.01);
  if (options.skipBoardMinimumDimensionsAt !== viewport.name) {
    expect(
      boardBox.width,
      `盤面の最低幅を満たしていない（${viewport.width}x${viewport.height}）`,
    ).toBeGreaterThanOrEqual(240);
    expect(
      boardBox.height,
      `盤面の最低高を満たしていない（${viewport.width}x${viewport.height}）`,
    ).toBeGreaterThanOrEqual(96);
  }

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
  expect(boardBox.width, '盤面が contain スロットの幅を超えている').toBeLessThanOrEqual(
    stageBox.width + 1,
  );
  expect(boardBox.height, '盤面が contain スロットの高さを超えている').toBeLessThanOrEqual(
    stageBox.height + 1,
  );

  await assertReachableInViewport(page, actionBar, 'action-bar');

  if (options.assignee) {
    const assignee = page.getByTestId('assign-assignee');
    const senior = page.getByTestId('assign-assignee-senior');
    await assertReachableInViewport(page, assignee, '担当選択領域');
    await assertReachableInViewport(page, senior, 'senior担当ボタン');
  }

  if (options.effectTags) {
    const effectTags = page.locator('[data-testid^="action-tags-"]').first();
    await expect(effectTags).toBeVisible();
    const firstEffectTag = effectTags.locator('.effect-tag').first();
    await expect(firstEffectTag).toBeVisible();
    await expect(firstEffectTag).not.toBeEmpty();
    if (viewport.width <= 860) {
      const effectTagsFit = await effectTags
        .locator('.effect-tag')
        .evaluateAll((tags) =>
          tags.every(
            (tag) =>
              tag.scrollWidth <= tag.clientWidth + 1 && tag.scrollHeight <= tag.clientHeight + 1,
          ),
        );
      expect(
        effectTagsFit,
        `効果タグが表示領域から切り詰められている（${viewport.width}x${viewport.height}）`,
      ).toBe(true);
    }
  }
  if (options.diagnosis) {
    const diagnosis = page.getByTestId('runbar-diagnosis');
    await expect(diagnosis).toHaveAttribute('data-diagnosis', options.diagnosis);
    await expect(diagnosis.locator('.diagnosis-warning')).toBeVisible();
    await expect(diagnosis.locator('.diagnosis-warning')).not.toBeEmpty();
  }
  if (options.relicCount !== undefined) {
    const relics = page.getByTestId('relics');
    const chips = relics.locator('.relic-chip');
    await expect(relics).toBeVisible();
    await expect(chips).toHaveCount(options.relicCount);
    for (let index = 0; index < options.relicCount; index += 1) {
      await expect(chips.nth(index)).toBeVisible();
    }
    const relicsFit = await relics.evaluate((element) => {
      const container = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll<HTMLElement>('.relic-chip')).every((chip) => {
        const rect = chip.getBoundingClientRect();
        return (
          rect.left >= container.left - 1 &&
          rect.right <= container.right + 1 &&
          rect.top >= container.top - 1 &&
          rect.bottom <= container.bottom + 1
        );
      });
    });
    expect(
      relicsFit,
      `レリックチップが表示領域からはみ出している（${viewport.width}x${viewport.height}）`,
    ).toBe(true);
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
    await assertReachableInViewport(page, page.getByTestId('result-continue'), 'result-continue');
  }
}

async function stabilizeDomForScreenshot(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      /* CI と Dev Container の共通フォントで、フォールバックによる高さ差をなくす。 */
      html, body, .app, .app * {
        font-family: 'WenQuanYi Zen Hei', sans-serif !important;
      }
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
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

async function waitForLayoutFrame(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/** 固定スクロール領域に隠れないよう、結果カード全体をテスト用の通常フローへ出す。 */
async function exposeResultCardForScreenshot(page: Page): Promise<void> {
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
  await waitForLayoutFrame(page);
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

async function openSixRelicSprint(page: Page): Promise<void> {
  await seedMeta(page, { unlockedRelics: RELIC_DEFS.map((relic) => relic.id) });
  await advancePublicRun(page, {
    seed: 'ri94-relics-1',
    target: { phase: 'setup', relicCount: 6 },
  });
  await beginCurrentSetupSprint(page);
}

test('スプリント画面は5つの名前付きスロットへ領域を配置する', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await beginPublicSprint(page, { seed: 'ri95-named-slots-0' });

  const layout = page.getByTestId('sprint-layout');
  await expect(layout).toBeVisible();

  const slotOrder = await layout
    .locator(':scope > [data-sprint-slot]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-sprint-slot')));
  expect(slotOrder).toEqual(['header', 'status', 'stage', 'deck', 'controls']);

  const slotContents: Record<string, string> = {
    header: 'hud',
    status: 'sprint-subbar',
    stage: 'board',
    deck: 'deck',
    controls: 'action-bar',
  };
  for (const [slot, testId] of Object.entries(slotContents)) {
    const slotLocator = layout.getByTestId(`sprint-slot-${slot}`);
    await expect(slotLocator).toHaveCount(1);
    await expect(slotLocator.getByTestId(testId)).toBeVisible();
  }

  await expect(layout.getByTestId('sprint-slot-header').getByTestId('runbar')).toBeVisible();
  await expect(layout.locator('[data-testid="sprint-result"]')).toHaveCount(0);
});

test('狭幅で展開したKPIをsetupからsprintへ維持する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await advancePublicRun(page, {
    seed: 'ri95-hud-expanded-0',
    target: { phase: 'setup' },
  });

  const hud = page.getByTestId('hud');
  const toggle = page.getByTestId('hud-toggle');
  await expect(hud).toHaveAttribute('data-compact', 'true');
  await toggle.click();
  await expect(hud).toHaveAttribute('data-compact', 'false');

  await beginCurrentSetupSprint(page);

  await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'false');
  await expect(page.getByTestId('hud-toggle')).toHaveAttribute('aria-expanded', 'true');
});

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

    await assertAcrossViewports(page, {
      armed: true,
      assignee: true,
      effectTags: true,
      hudExpanded: true,
    });
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
    await openSixRelicSprint(page);
    await assertAcrossViewports(page, {
      relicCount: 6,
      effectTags: true,
      skipBoardMinimumDimensionsAt: 'desktop-short',
    });
  });

  test('既知: 6レリック状態の1024x768盤面最低寸法契約', async ({ page }) => {
    await openSixRelicSprint(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await waitForLayoutFrame(page);
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    const boardBox = await readBox(page, 'board');
    test.fail(
      true,
      '現行UIは1024x768の6レリック状態で盤面最低寸法240x96pxを満たさない（RI-95〜100で解消予定）',
    );
    expect(boardBox.width, '既知の6レリック盤面最低幅違反').toBeGreaterThanOrEqual(240);
    expect(boardBox.height, '既知の6レリック盤面最低高違反').toBeGreaterThanOrEqual(96);
  });

  test('初期スプリントを公開stepで結果オーバーレイへ進める', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await beginPublicSprint(page, { seed: 'ri94-result-0' });
    await page.getByTestId('hud-toggle').click();
    await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'false');
    await advanceCurrentSprintToResult(page);
    await assertAcrossViewports(page, { resultOverlay: true, hudExpanded: true });
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

    const resultCard = page.getByTestId('sprint-result').locator('.sprint-result-card');
    const resultOverlay = page.getByTestId('sprint-result');
    await assertReachableInViewport(page, page.getByTestId('result-continue'), 'result-continue');
    await resultOverlay.evaluate((element) => element.scrollTo(0, 0));
    await exposeResultCardForScreenshot(page);
    await expect(resultCard).toHaveScreenshot('sprint-layout-result-overlay-card.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });
});
