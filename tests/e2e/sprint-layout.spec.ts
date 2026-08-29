/**
 * スプリント画面のレイアウト契約 E2E（RI-69 / RI-70 / RI-94）。
 *
 * RI-94 の状態 fixture は `window.game` の公開メソッドだけで作り、実時間待機や
 * 内部 engine 参照には依存しない。画面操作が契約そのものになる assignTask の武装と
 * 担当選択だけは Playwright のクリックで検証する。
 */
import { expect, test } from './fixtures';
import {
  advanceCurrentSprintToReviewQueue,
  advanceCurrentSprintToBurning,
  advancePublicRun,
  advanceCurrentSprintToResult,
  advanceCurrentResultToDraft,
  beginCurrentSetupSprint,
  beginPublicSprint,
} from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { ACTION_DEFS } from '../../src/data/actions';
import { TRIAL_DEFS } from '../../src/data/difficulties';
import { RELIC_DEFS } from '../../src/data/relics';
import { RESPONSIVE_BREAKPOINTS } from '../../src/ui/responsiveMode';
import { seedMeta } from './seedMeta';

const BOARD_RATIO = 1404 / 573;

/** 展開KPIで省略されやすかった正式ラベル（#354）。 */
const EXPANDED_HUD_FULL_LABELS = [
  ['hud-delivery', '出荷ポイント'],
  ['hud-security', 'セキュリティ'],
  ['hud-reviewCapacity', 'レビュー耐性'],
] as const;

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

type Box = { x: number; y: number; width: number; height: number };

interface LayoutContractOptions {
  glanceCopy?: boolean;
  diagnosis?: string;
  relicCount?: number;
  trialCount?: number;
  armed?: boolean;
  assignee?: boolean;
  hudExpanded?: boolean;
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

async function assertLabelTextNotTruncated(
  locator: Locator,
  label: string,
  viewportLabel: string,
): Promise<void> {
  await expect(locator).toHaveText(label);
  const truncated = await locator.evaluate(
    (element) => element.scrollWidth > element.clientWidth + 1,
  );
  expect(truncated, `${label} が ${viewportLabel} で省略されている`).toBe(false);
}

async function assertExpandedHudLabelsNotTruncated(
  page: Page,
  viewportLabel: string,
): Promise<void> {
  await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'false');
  for (const [testId, label] of EXPANDED_HUD_FULL_LABELS) {
    await assertLabelTextNotTruncated(page.getByTestId(testId).locator('.k'), label, viewportLabel);
  }
}

/** viewport に収まる要素は全体、viewport より背の高い要素は上下端の到達性を検証する。 */
async function assertReachableInViewport(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${label} の bounding box が取得できない`);

  if (box.height <= viewport.height + 1) {
    expect(box.x, `${label} の左端が viewport 外`).toBeGreaterThanOrEqual(-1);
    expect(box.y, `${label} の上端が viewport 外`).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width, `${label} の右端が viewport 外`).toBeLessThanOrEqual(
      viewport.width + 1,
    );
    expect(box.y + box.height, `${label} の下端が viewport 外`).toBeLessThanOrEqual(
      viewport.height + 1,
    );
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
  ).toBeLessThanOrEqual(viewport.height + 1);
  expect(
    bottomBox && bottomBox.y + bottomBox.height,
    `${label} の下端が viewport 境界に揃わない`,
  ).toBeGreaterThanOrEqual(viewport.height - 1);
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
  const runbarDetailsToggle = page.getByTestId('runbar-details-toggle');

  if (
    (await runbarDetailsToggle.count()) > 0 &&
    (await runbarDetailsToggle.getAttribute('aria-expanded')) === 'true'
  ) {
    await runbarDetailsToggle.click();
  }

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

  const hud = page.getByTestId('hud');
  if ((await hud.getAttribute('data-compact')) === 'true') {
    await expect(hud.locator('.hud-compact-chip')).toHaveCount(4);
  } else if (viewport.width > RESPONSIVE_BREAKPOINTS.narrowMaxWidth) {
    await assertExpandedHudLabelsNotTruncated(page, `${viewport.width}x${viewport.height}`);
  }
  await expect(page.getByTestId('runbar')).toHaveAttribute('data-compact', 'true');
  await expect(page.getByTestId('runbar-details')).toHaveCount(0);

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
  const aspectStageBox = await page.getByTestId('aspect-stage-content').boundingBox();
  if (!wrapBox || !stageBox || !aspectStageBox) {
    throw new Error('board-wrap / board-stage / aspect-stage の bounding box が取得できない');
  }
  const aspectRatioError = Math.abs(aspectStageBox.width / aspectStageBox.height / BOARD_RATIO - 1);
  expect(aspectRatioError, 'AspectStageの1404:573比率が崩れている').toBeLessThanOrEqual(0.01);
  expect(
    Math.abs(boardBox.x - aspectStageBox.x),
    '盤面と実ステージのX座標がずれている',
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boardBox.y - aspectStageBox.y),
    '盤面と実ステージのY座標がずれている',
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boardBox.width - aspectStageBox.width),
    '盤面と実ステージの幅がずれている',
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(boardBox.height - aspectStageBox.height),
    '盤面と実ステージの高さがずれている',
  ).toBeLessThanOrEqual(1);
  expect(
    aspectStageBox.x,
    '実ステージがcontainスロットの左側へはみ出している',
  ).toBeGreaterThanOrEqual(stageBox.x - 1);
  expect(
    aspectStageBox.y,
    '実ステージがcontainスロットの上側へはみ出している',
  ).toBeGreaterThanOrEqual(stageBox.y - 1);
  expect(
    aspectStageBox.x + aspectStageBox.width,
    '実ステージがcontainスロットの右側へはみ出している',
  ).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
  expect(
    aspectStageBox.y + aspectStageBox.height,
    '実ステージがcontainスロットの下側へはみ出している',
  ).toBeLessThanOrEqual(stageBox.y + stageBox.height + 1);
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

  if (options.glanceCopy) {
    const summaries = page.locator('[data-testid^="action-summary-"]');
    const tradeoffs = page.locator('[data-testid^="action-tradeoff-"]');
    await expect(summaries.first()).toBeVisible();
    await expect(summaries).toHaveCount(8);
    await expect(tradeoffs).toHaveCount(8);
    await expect(page.getByTestId('action-tradeoff-andon')).toHaveText(
      '士気消費・薄いキューはHP消費',
    );
    await expect(page.getByTestId('action-summary-andon')).toHaveText('流入停止・処理猶予');
    await expect(page.getByTestId('action-tradeoff-pairReview')).toHaveText(
      '集中力消費・再使用待ち',
    );
    for (const id of ['interruptReview', 'assignTask', 'aiThrottle', 'pairReview']) {
      await expect(page.getByTestId(`action-summary-${id}`)).toContainText('運用安定');
    }
    await expect(page.getByTestId('action-summary-firefight')).toContainText('緊急時のみ運用安定');
    for (const action of ACTION_DEFS) {
      await expect(page.getByTestId(`action-gauge-${action.id}`)).toHaveText(
        `連携+${Math.round(action.gauge * 100)}%`,
      );
    }
    if (viewport.width <= RESPONSIVE_BREAKPOINTS.narrowMaxWidth) {
      const glanceCopyFits = await summaries
        .or(tradeoffs)
        .evaluateAll((lines) =>
          lines.every(
            (line) =>
              line.scrollWidth <= line.clientWidth + 1 &&
              line.scrollHeight <= line.clientHeight + 1,
          ),
        );
      expect(
        glanceCopyFits,
        `一目読み文言が表示領域から切り詰められている（${viewport.width}x${viewport.height}）`,
      ).toBe(true);
    }
  }
  if (
    (options.diagnosis || options.relicCount !== undefined) &&
    (await runbarDetailsToggle.count())
  ) {
    await runbarDetailsToggle.click();
    await expect(runbarDetailsToggle).toHaveAttribute('aria-expanded', 'true');
    const runbarDetails = page.getByTestId('runbar-details');
    await expect(runbarDetails).toBeVisible();
    if (viewport.width <= RESPONSIVE_BREAKPOINTS.narrowMaxWidth) {
      const flexWrap = await runbarDetails.evaluate(
        (element) => getComputedStyle(element).flexWrap,
      );
      expect(flexWrap, `ラン詳細が折り返されない（${viewport.width}x${viewport.height}）`).toBe(
        'wrap',
      );
    }
    const detailsOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(
      detailsOverflow,
      `ラン詳細の展開で横スクロールが発生している（${viewport.width}x${viewport.height}）`,
    ).toBe(false);
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
  if (options.trialCount !== undefined) {
    const trials = page.getByTestId('run-trials');
    await expect(trials).toBeVisible();
    await expect(trials.locator('.pill')).toHaveCount(options.trialCount);
    if (viewport.width <= RESPONSIVE_BREAKPOINTS.narrowMaxWidth) {
      const flexWrap = await trials.evaluate((element) => getComputedStyle(element).flexWrap);
      expect(flexWrap, `試練バーが折り返されない（${viewport.width}x${viewport.height}）`).toBe(
        'wrap',
      );
    }
    const trialsFit = await trials.evaluate((element) => {
      const container = element.getBoundingClientRect();
      return Array.from(element.querySelectorAll<HTMLElement>('.pill')).every((chip) => {
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
      trialsFit,
      `試練 pill が表示領域からはみ出している（${viewport.width}x${viewport.height}）`,
    ).toBe(true);
  }
  if (
    (options.diagnosis || options.relicCount !== undefined) &&
    (await runbarDetailsToggle.count())
  ) {
    await runbarDetailsToggle.click();
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
    seed: 'ri94-relics-13',
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

test('AspectStageはゼロサイズから復帰し、連続resizeで例外を出さない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await beginPublicSprint(page, { seed: 'ri96-aspect-stage-resize-0' });

  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const stage = page.getByTestId('board-stage');
  await stage.evaluate((element) => {
    element.style.display = 'none';
  });
  await waitForLayoutFrame(page);
  await stage.evaluate((element) => {
    element.style.display = '';
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await waitForLayoutFrame(page);

  await expect(page.getByTestId('aspect-stage-content')).toBeVisible();
  await expect(page.getByTestId('board')).toBeVisible();
  expect(errors, 'AspectStageのゼロサイズ／再resizeでpage errorが発生している').toEqual([]);
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

test('デスクトップ幅の展開KPIは出荷ポイント・セキュリティ・レビュー耐性を省略しない', async ({
  page,
}) => {
  await beginPublicSprint(page, { seed: 'devops-tycoon' });

  for (const viewport of [
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ] as const) {
    await page.setViewportSize(viewport);
    await waitForLayoutFrame(page);

    const hud = page.getByTestId('hud');
    await expect(hud).toHaveAttribute('data-responsive-width', 'wide');
    if ((await hud.getAttribute('data-compact')) === 'true') {
      await page.getByTestId('hud-toggle').click();
    }
    await waitForLayoutFrame(page);
    await assertExpandedHudLabelsNotTruncated(page, `${viewport.width}x${viewport.height}`);

    const noHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    );
    expect(
      noHorizontalOverflow,
      `${viewport.width}x${viewport.height} で横スクロールが発生している`,
    ).toBe(true);
  }
});

test('狭幅の要約KPIは出荷ポイントを省略せず、展開時も正式名を保持する', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await beginPublicSprint(page, { seed: 'devops-tycoon' });
  await waitForLayoutFrame(page);

  const hud = page.getByTestId('hud');
  await expect(hud).toHaveAttribute('data-responsive-width', 'narrow');
  await expect(hud).toHaveAttribute('data-compact', 'true');
  await assertLabelTextNotTruncated(
    hud.locator('.hud-compact-chip-label').filter({ hasText: '出荷ポイント' }),
    '出荷ポイント',
    '390x844 compact',
  );

  await page.getByTestId('hud-toggle').click();
  await expect(hud).toHaveAttribute('data-compact', 'false');
  for (const [testId, label] of EXPANDED_HUD_FULL_LABELS) {
    const metric = page.getByTestId(testId);
    await expect(metric.locator('.k')).toHaveText(label);
    await expect(metric).toHaveAttribute('aria-label', new RegExp(`^${label}:`));
  }
});

test('要約HUDでも介入によるKPI差分をフィードバックする', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await beginPublicSprint(page, { seed: 'compact-hud-feedback-0' });

  const hud = page.getByTestId('hud');
  const seniorHp = page.getByTestId('hud-seniorHp');
  await expect(hud).toHaveAttribute('data-compact', 'true');
  await page.getByTestId('action-overtime').click();

  await expect(seniorHp).toHaveClass(/flash-negative/);
  await expect(seniorHp.locator('.hud-feedback-pop')).toContainText('-');
});

test('士気チップに炎上リスクを載せない（#356）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await beginPublicSprint(page, { seed: 'devops-tycoon' });

  const hud = page.getByTestId('hud');
  await expect(hud).toHaveAttribute('data-compact', 'true');
  const compactMorale = page.getByTestId('hud-compact-morale');
  if ((await compactMorale.count()) > 0) {
    await expect(compactMorale).not.toContainText('炎上');
  }

  await page.getByTestId('hud-toggle').click();
  const morale = page.getByTestId('hud-morale');
  await expect(morale).toBeVisible();
  await expect(morale).not.toContainText('炎上');
  const fireRisk = page.getByTestId('hud-fireRisk');
  await expect(fireRisk).toBeVisible();
  await expect(fireRisk).toContainText('炎上リスク');
  const fireRiskValue = page.getByTestId('hud-fire-risk-value');
  await expect(fireRiskValue).toBeVisible();
  const fireRiskClasses = await fireRiskValue.evaluate((element) => [...element.classList]);
  expect(
    fireRiskClasses.some((cls) => /^risk-(LOW|MED|HIGH)$/.test(cls)),
    '炎上リスク値に旧チップ用クラス risk-LOW/MED/HIGH が付いている',
  ).toBe(false);
  expect(
    fireRiskClasses.some((cls) => /^fire-risk-(LOW|MED|HIGH)$/.test(cls)),
    '炎上リスク値に衝突しない fire-risk-* が付いていない',
  ).toBe(true);
  const fireRiskPaint = await fireRiskValue.evaluate((element) => {
    const style = getComputedStyle(element);
    return { backgroundColor: style.backgroundColor, animationName: style.animationName };
  });
  expect(fireRiskPaint.backgroundColor, '炎上リスク値に旧チップ背景が付いている').toBe(
    'rgba(0, 0, 0, 0)',
  );
  expect(fireRiskPaint.animationName, '炎上リスク値に旧チップの点滅が付いている').toBe('none');
});

test('レスポンシブ表示モードを859/860/861px境界で共有する', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 844 });
  await beginPublicSprint(page, { seed: 'ri98-responsive-width-0' });

  await page.evaluate(() => {
    const board = document.querySelector('[data-testid="board"]');
    if (!board) throw new Error('board が見つからない');
    (window as Window & { __ri98InitialBoard?: Element }).__ri98InitialBoard = board;
  });

  for (const [width, expected] of [
    [859, 'narrow'],
    [860, 'narrow'],
    [861, 'wide'],
  ] as const) {
    await page.setViewportSize({ width, height: 844 });
    await waitForLayoutFrame(page);

    for (const locator of [
      page.locator(':root'),
      page.locator('.app'),
      page.getByTestId('sprint-layout'),
      page.getByTestId('hud'),
      page.getByTestId('action-bar'),
    ]) {
      await expect(locator).toHaveAttribute('data-responsive-width', expected);
      await expect(locator).toHaveAttribute('data-responsive-height', 'normal');
    }

    await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'true');
    const layoutStyle = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('[data-testid="sprint-layout"]');
      const controls = document.querySelector<HTMLElement>('[data-sprint-slot="controls"]');
      const actionBar = document.querySelector<HTMLElement>('[data-testid="action-bar"]');
      if (!root || !controls || !actionBar) throw new Error('レスポンシブ要素が見つからない');
      return {
        controlsPosition: getComputedStyle(controls).position,
        actionBarFlexWrap: getComputedStyle(actionBar).flexWrap,
      };
    });
    if (expected === 'narrow') {
      expect(layoutStyle.controlsPosition).toBe('sticky');
      expect(layoutStyle.actionBarFlexWrap).toBe('wrap');
    } else {
      expect(layoutStyle.controlsPosition).toBe('static');
      expect(layoutStyle.actionBarFlexWrap).toBe('nowrap');
    }

    const boardRemounted = await page.evaluate(() => {
      const initial = (window as Window & { __ri98InitialBoard?: Element }).__ri98InitialBoard;
      return initial !== document.querySelector('[data-testid="board"]');
    });
    expect(boardRemounted, `${width}px境界で盤面が再マウントされた`).toBe(false);
  }
});

test('短いviewportの高さモードを自動切替する', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 721 });
  await beginPublicSprint(page, { seed: 'ri98-responsive-height-0' });

  for (const [height, expected, expectedOverflow] of [
    [720, 'short', 'auto'],
    [721, 'normal', 'auto'],
  ] as const) {
    await page.setViewportSize({ width: 1024, height });
    await waitForLayoutFrame(page);

    for (const locator of [
      page.locator(':root'),
      page.locator('.app'),
      page.getByTestId('sprint-layout'),
      page.getByTestId('hud'),
      page.getByTestId('action-bar'),
    ]) {
      await expect(locator).toHaveAttribute('data-responsive-width', 'wide');
      await expect(locator).toHaveAttribute('data-responsive-height', expected);
    }

    const rootOverflowY = await page
      .getByTestId('sprint-layout')
      .evaluate((element) => getComputedStyle(element).overflowY);
    expect(rootOverflowY, `${height}pxでshortの高さレイアウトになっていない`).toBe(
      expectedOverflow,
    );
  }
});

test.describe('RI-94 レイアウト契約', () => {
  test('通常スプリントの5 viewport契約と一目読み文言を満たす', async ({ page }) => {
    await beginPublicSprint(page, { seed: 'ri94-normal-0' });
    await assertAcrossViewports(page, { glanceCopy: true });
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
      glanceCopy: true,
      hudExpanded: true,
    });
  });

  test('最長診断警告 seniorSacrifice を5 viewportで表示する', async ({ page }) => {
    await advancePublicRun(page, {
      seed: 'ri94-warning-1',
      target: { phase: 'setup', diagnosis: 'seniorSacrifice' },
    });
    await beginCurrentSetupSprint(page);
    await assertAcrossViewports(page, { diagnosis: 'seniorSacrifice', glanceCopy: true });
  });

  test('全レリック解放メタから6個取得した状態を5 viewportで表示する', async ({ page }) => {
    await openSixRelicSprint(page);
    await assertAcrossViewports(page, {
      relicCount: 6,
      glanceCopy: true,
    });
  });

  test('全試練を有効にした compact HUD を5 viewportで表示する', async ({ page }) => {
    await beginPublicSprint(page, {
      seed: 'ri94-all-trials-0',
      trials: TRIAL_DEFS.map((trial) => trial.id),
    });
    await expect(page.getByTestId('run-trials')).toBeVisible();
    await expect(page.getByTestId('run-trials').locator('.pill')).toHaveCount(TRIAL_DEFS.length);
    await assertAcrossViewports(page, {
      trialCount: TRIAL_DEFS.length,
      glanceCopy: true,
    });
  });

  test('6レリック状態の1024x768盤面最低寸法契約', async ({ page }) => {
    await openSixRelicSprint(page);
    await page.setViewportSize({ width: 1024, height: 768 });
    await waitForLayoutFrame(page);
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    const boardBox = await readBox(page, 'board');
    expect(boardBox.width, '6レリック盤面の最低幅を満たしていない').toBeGreaterThanOrEqual(240);
    expect(boardBox.height, '6レリック盤面の最低高を満たしていない').toBeGreaterThanOrEqual(96);
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
    await expect(
      page.locator('.result-row').filter({ hasText: 'Senior HP' }).locator('dd'),
    ).toHaveText(/^\d+$/);
    await stabilizeDomForScreenshot(page);
    await expect(page).toHaveScreenshot('sprint-layout-result-overlay.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });

    const resultCard = page.getByTestId('sprint-result').locator('.sprint-result-card');
    await assertReachableInViewport(page, page.getByTestId('result-continue'), 'result-continue');
    await page.getByTestId('overlay-scroll').evaluate((element) => element.scrollTo(0, 0));
    await exposeResultCardForScreenshot(page);
    await expect(resultCard).toHaveScreenshot('sprint-layout-result-overlay-card.png', {
      animations: 'disabled',
      maxDiffPixelRatio: 0.02,
    });
  });
});

const SHORT_DESKTOP = { width: 1024, height: 621 } as const;

async function readOverlayScrollMetrics(page: Page, overlayTestId: string) {
  return page.evaluate((testId) => {
    const overlay = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    const scroll = overlay?.querySelector<HTMLElement>('[data-testid="overlay-scroll"]');
    const layout = document.querySelector<HTMLElement>('[data-testid="sprint-layout"]');
    const board = document.querySelector<HTMLElement>('[data-testid="board"]');
    if (!overlay || !scroll || !layout || !board) {
      throw new Error('オーバーレイまたは盤面の計測対象が見つからない');
    }
    const overlayRect = overlay.getBoundingClientRect();
    const boardRect = board.getBoundingClientRect();
    return {
      overlayHeight: overlayRect.height,
      overlayTop: overlayRect.top,
      overlayOverflowY: getComputedStyle(overlay).overflowY,
      scrollTop: scroll.scrollTop,
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
      canScroll: scroll.scrollHeight > scroll.clientHeight + 1,
      layoutScrollTop: layout.scrollTop,
      layoutOverflowY: getComputedStyle(layout).overflowY,
      boardY: boardRect.y,
    };
  }, overlayTestId);
}

test.describe('短いviewportの結果・ドラフトオーバーレイ #366', () => {
  test('結果オーバーレイは枠内スクロールし、主要CTAは初見で届き背面盤面は動かない', async ({
    page,
  }) => {
    await page.setViewportSize(SHORT_DESKTOP);
    await beginPublicSprint(page, { seed: 'ri366-overlay-result-0' });
    await advanceCurrentSprintToResult(page);

    const overlay = page.getByTestId('sprint-result');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveClass(/overlay-contained/);
    await expect(page.getByTestId('overlay-scroll')).toHaveAttribute('tabindex', '0');

    const before = await readOverlayScrollMetrics(page, 'sprint-result');
    expect(before.overlayTop, 'オーバーレイ上端が viewport 外').toBeLessThanOrEqual(1);
    expect(before.overlayHeight, 'オーバーレイが viewport より高い').toBeLessThanOrEqual(
      SHORT_DESKTOP.height + 1,
    );
    expect(before.overlayOverflowY).toBe('hidden');
    expect(before.layoutOverflowY).toBe('hidden');
    expect(before.canScroll, '結果カードが枠内スクロールできない').toBe(true);

    await expect(page.getByTestId('result-continue')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('result-restart')).toBeInViewport({ ratio: 1 });

    await page.getByTestId('overlay-scroll').evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await waitForLayoutFrame(page);

    const after = await readOverlayScrollMetrics(page, 'sprint-result');
    expect(after.scrollTop, 'オーバーレイ内がスクロールしていない').toBeGreaterThan(0);
    expect(after.layoutScrollTop, '背面のスプリントレイアウトがスクロールした').toBe(
      before.layoutScrollTop,
    );
    expect(Math.abs(after.boardY - before.boardY), '背面盤面の位置が動いた').toBeLessThan(1);

    await page.getByTestId('sprint-timeline').evaluate((element) => {
      element.scrollIntoView({ block: 'nearest' });
    });
    await expect(page.getByTestId('sprint-timeline')).toBeInViewport();
    const afterTimeline = await readOverlayScrollMetrics(page, 'sprint-result');
    expect(
      Math.abs(afterTimeline.boardY - before.boardY),
      'タイムライン到達時に背面盤面が動いた',
    ).toBeLessThan(1);
  });

  test('ドラフトオーバーレイは3枚と引き直し・スキップが枠内で届き背面盤面は動かない', async ({
    page,
  }) => {
    await page.setViewportSize(SHORT_DESKTOP);
    await beginPublicSprint(page, { seed: 'ri366-overlay-draft-0' });
    await advanceCurrentSprintToResult(page);
    const draftState = await advanceCurrentResultToDraft(page);

    const overlay = page.getByTestId('draft');
    await expect(overlay).toBeVisible();
    await expect(overlay).toHaveClass(/overlay-contained/);
    await expect(page.getByTestId('overlay-scroll')).toHaveAttribute('tabindex', '0');
    await expect(page.locator('.draft-card-panel > .draft-actions')).toBeVisible();
    await expect(page.locator('.result-overlay > .draft-actions')).toHaveCount(0);

    const before = await readOverlayScrollMetrics(page, 'draft');
    expect(before.overlayTop, 'オーバーレイ上端が viewport 外').toBeLessThanOrEqual(1);
    expect(before.overlayHeight, 'オーバーレイが viewport より高い').toBeLessThanOrEqual(
      SHORT_DESKTOP.height + 1,
    );
    expect(before.overlayOverflowY).toBe('hidden');
    expect(before.layoutOverflowY).toBe('hidden');

    await expect(page.getByTestId('draft-mulligan')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('draft-skip')).toBeInViewport({ ratio: 1 });

    const cardIds = draftState.draft ?? [];
    expect(cardIds.length, 'ドラフト候補が3枚ではない').toBe(3);
    for (const id of cardIds) {
      const card = page.getByTestId(`draft-card-${id}`);
      await card.scrollIntoViewIfNeeded();
      await expect(card).toBeInViewport();
    }

    const afterCards = await readOverlayScrollMetrics(page, 'draft');
    expect(
      Math.abs(afterCards.boardY - before.boardY),
      'カード到達時に背面盤面が動いた',
    ).toBeLessThan(1);
    expect(afterCards.layoutScrollTop, '背面のスプリントレイアウトがスクロールした').toBe(
      before.layoutScrollTop,
    );

    if (before.canScroll) {
      await page.getByTestId('overlay-scroll').evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await waitForLayoutFrame(page);
      const after = await readOverlayScrollMetrics(page, 'draft');
      expect(after.layoutScrollTop, '枠内スクロールで背面レイアウトが動いた').toBe(
        before.layoutScrollTop,
      );
      expect(
        Math.abs(after.boardY - before.boardY),
        '枠内スクロールで背面盤面が動いた',
      ).toBeLessThan(1);
    }
  });
});

test.describe('RI-141 Review渋滞のDOM同等性', () => {
  test('8〜11件の連続ヒートを5 viewportで維持する', async ({ page }) => {
    await beginPublicSprint(page, {
      seed: 'ri141-review-pressure-0',
      difficulty: 'hard',
      renderer: 'dom',
    });
    const queue = await advanceCurrentSprintToReviewQueue(page, 8, 11);
    const board = page.getByTestId('board');
    const heat = Number(await board.getAttribute('data-review-heat'));
    expect(queue).toBeGreaterThanOrEqual(8);
    expect(queue).toBeLessThanOrEqual(11);
    expect(heat).toBeGreaterThan(0);
    expect(heat).toBeLessThan(1);
    await expect(board).toHaveAttribute('data-review-hell', 'false');
    await assertAcrossViewports(page);
  });

  test('12件以上のReview Hellを5 viewportとreduced motionで維持する', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await beginPublicSprint(page, {
      seed: 'ri141-review-pressure-0',
      difficulty: 'hard',
      renderer: 'dom',
    });
    await advanceCurrentSprintToReviewQueue(page, 12);
    const board = page.getByTestId('board');
    await expect(board).toHaveAttribute('data-review-heat', '1');
    await expect(board).toHaveAttribute('data-review-hell', 'true');
    await expect(board.locator('[data-lane="review"] .board-flow-alert')).toHaveText('要対応');
    const animationNames = await board.evaluate((element) => {
      const flow = element.querySelector('.flowdash');
      const dot = element.querySelector('.task-dot');
      return {
        flow: flow ? getComputedStyle(flow).animationName : null,
        dot: dot ? getComputedStyle(dot).animationName : null,
        trail: dot ? getComputedStyle(dot, '::after').animationName : null,
      };
    });
    expect(animationNames).toEqual({ flow: 'none', dot: 'none', trail: 'none' });
    await assertAcrossViewports(page);
  });
});

test.describe('RI-142 炎上・介入演出のDOM同等性とフォールバック', () => {
  test('点火リアクションと炎上情報をDOMの5 viewportで維持する', async ({ page }) => {
    await beginPublicSprint(page, {
      seed: 'ri142-fire-effects',
      difficulty: 'hard',
      renderer: 'dom',
    });
    const burningTaskIds = await advanceCurrentSprintToBurning(page);
    const board = page.getByTestId('board');

    expect(burningTaskIds.length).toBeGreaterThan(0);
    await expect(board).toHaveAttribute('data-effect-kinds', /fire:(ignite|spread)/);
    await expect(page.locator('[data-testid^="fire-effect-"]').first()).toBeVisible();
    await expect(page.getByTestId('fire-count')).not.toHaveText('🔥0');

    await assertAcrossViewports(page);
  });

  test('介入結果と常駐オーラをDOMの5 viewportで維持する', async ({ page }) => {
    await beginPublicSprint(page, { seed: 'ri142-dom-aura', renderer: 'dom' });
    const board = page.getByTestId('board');

    await page.getByTestId('action-overtime').click();
    await expect(board).toHaveAttribute('data-effect-renderer', 'dom');
    await expect(board).toHaveAttribute('data-effect-kinds', 'intervention:boardAura');
    await expect(board).toHaveAttribute('data-effect-sfx-count', '1');
    await expect(page.getByTestId('intervention-effect-aura-overtime')).toBeVisible();
    await expect(page.getByTestId('board-aura-overtime')).toBeVisible();
    await expect(page.getByTestId('event-ticker')).toBeVisible();

    await assertAcrossViewports(page);
  });

  test('reduced motionでは一時装飾を抑制しても介入結果・オーラ・SFX契約を残す', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await beginPublicSprint(page, { seed: 'ri142-reduced-aura', renderer: 'dom' });
    const board = page.getByTestId('board');

    await page.getByTestId('action-overtime').click();
    await expect(board).toHaveAttribute('data-effect-kinds', 'intervention:boardAura');
    await expect(board).toHaveAttribute('data-effect-sfx-count', '1');
    await expect(page.getByTestId('board-aura-overtime')).toBeVisible();
    const motion = await board.evaluate((element) => ({
      transientDisplay: getComputedStyle(element.querySelector('.intervention-effects')!).display,
      auraAnimation: getComputedStyle(element.querySelector('.board-modifier-aura')!).animationName,
    }));
    expect(motion).toEqual({ transientDisplay: 'none', auraAnimation: 'none' });
    await expect(page.locator('[data-testid^="event-ticker-row-"]').first()).toBeVisible();

    await assertAcrossViewports(page);
  });

  test('演出・オーラ再生中のPixi初期化失敗でも同じDOM planへ一度だけ切り替える', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      (
        window as Window & {
          __forceBoardPixiInitFailure?: { delayMs?: number; waitForEffects?: boolean };
        }
      ).__forceBoardPixiInitFailure = { delayMs: 350, waitForEffects: true };
    });
    await beginPublicSprint(page, { seed: 'ri142-pixi-fallback', renderer: 'pixi' });
    const board = page.getByTestId('board');
    await expect(page.getByTestId('board-pixi-mount')).toBeVisible();

    await page.getByTestId('action-overtime').click();
    await expect(board).toHaveAttribute('data-effect-kinds', 'intervention:boardAura');
    await expect(board).toHaveAttribute('data-effect-sfx-count', '1');
    const sequence = await board.getAttribute('data-effect-sequence');
    expect(sequence).not.toBeNull();
    await expect(page.locator('.intervention-effects')).toHaveClass(/dom-fallback-hidden/);

    await expect(board).toHaveAttribute('data-effect-renderer', 'dom', { timeout: 3_000 });
    await expect(board).toHaveAttribute('data-effect-sequence', sequence!);
    await expect(board).toHaveAttribute('data-effect-sfx-count', '1');
    await expect(page.getByTestId('board-aura-overtime')).toBeVisible();
    await expect(page.getByTestId('board-pixi-mount')).toHaveCount(0);
  });
});

type SpreadEngineDebug = {
  sprint?: { events: object[] } | null;
  lastResult?: {
    incidents: number;
    spread: number;
    fireEvents: object[];
  } | null;
};

type SpreadGameWindow = Window & {
  game?: {
    pause(): void;
    step(ms: number): unknown;
    zoomTo(level: string): unknown;
    engine: SpreadEngineDebug;
  };
};

const SPREAD_TICKER_CHAIN = '延焼! 隣の Review 待ち PR に連鎖（負債 +6 / 士気 -5）';
const SPREAD_TICKER_IMPACT = '延焼! 負債 +6 / 士気 -5';
const SPREAD_RESULT_CHAIN =
  't12: PR#3 が Review 落ちで点火 → t18 延焼 → PR#5（負債 +6 / 士気 -5） → t22 緊急対応で鎮火';
const SPREAD_RESULT_IMPACT = 't12: PR#7 が Review 落ちで点火 → t18 延焼（負債 +6 / 士気 -5）';

async function injectSpreadTickerEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as SpreadGameWindow).game;
    const sprint = game?.engine.sprint;
    if (!game || !sprint) throw new Error('sprint が無い');
    sprint.events.push(
      { tick: 6, kind: 'spread', taskId: 1, spreadToTaskId: 3, debtGain: 6, moraleCost: 5 },
      { tick: 7, kind: 'spread', taskId: 2, debtGain: 6, moraleCost: 5 },
      { tick: 8, kind: 'spread', taskId: 4, spreadToTaskId: 5, debtGain: 6, moraleCost: 5 },
      { tick: 9, kind: 'spread', taskId: 6, debtGain: 6, moraleCost: 5 },
      { tick: 10, kind: 'spread', taskId: 8, spreadToTaskId: 9, debtGain: 6, moraleCost: 5 },
    );
    game.step(0);
  });
}

/** 狭い盤面でも5件の延焼行が、スクロール後（またはそのまま）リスト可視領域に入る。 */
async function assertSpreadTickerRowsReachable(page: Page, label: string): Promise<void> {
  const list = page.getByTestId('event-ticker-list');
  const rows = list.locator('.event-ticker-row');
  await expect(rows, `${label}: 延焼行が5件ない`).toHaveCount(5);

  await list.evaluate((element) => element.blur());

  const pointerEvents = await page.evaluate(() => {
    const ticker = document.querySelector('.event-ticker');
    const scrollList = document.querySelector('.event-ticker-list');
    if (!ticker || !scrollList) return null;
    return {
      ticker: getComputedStyle(ticker).pointerEvents,
      list: getComputedStyle(scrollList).pointerEvents,
    };
  });
  expect(pointerEvents?.ticker, `${label}: ティッカー本体が盤面クリックを奪う`).toBe('none');
  expect(pointerEvents?.list, `${label}: 未フォーカスのリストが盤面ドラッグを奪う`).toBe('none');
  await assertTickerPassesBoardPointer(page, label);
  await assertTickerKeyboardReachable(page, label);
  await assertTickerTouchPanClaimsAtStart(page, label);
  await assertTickerPenReversesAtBound(page, label);

  const count = await rows.count();
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    const metrics = await row.evaluate((element) => {
      const scrollList = element.closest('[data-testid="event-ticker-list"]');
      if (!scrollList) return null;
      return {
        rowHeight: element.getBoundingClientRect().height,
        listHeight: scrollList.getBoundingClientRect().height,
      };
    });
    if (!metrics) throw new Error(`${label}: ${i + 1}行目のリストが見つからない`);

    if (metrics.rowHeight <= metrics.listHeight + 1) {
      await row.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
      const visibleInList = await row.evaluate((element) => {
        const scrollList = element.closest('[data-testid="event-ticker-list"]');
        if (!scrollList) return false;
        const listRect = scrollList.getBoundingClientRect();
        const rowRect = element.getBoundingClientRect();
        return rowRect.top >= listRect.top - 1 && rowRect.bottom <= listRect.bottom + 1;
      });
      expect(visibleInList, `${label}: ${i + 1}行目がリスト可視領域に入らない`).toBe(true);
      continue;
    }

    await row.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
    const topReachable = await row.evaluate((element) => {
      const scrollList = element.closest('[data-testid="event-ticker-list"]');
      if (!scrollList) return false;
      const listRect = scrollList.getBoundingClientRect();
      const rowRect = element.getBoundingClientRect();
      const overlap =
        Math.min(rowRect.bottom, listRect.bottom) - Math.max(rowRect.top, listRect.top);
      return overlap > 0 && rowRect.top <= listRect.top + 1;
    });
    expect(topReachable, `${label}: ${i + 1}行目の上端へスクロールできない`).toBe(true);

    await row.evaluate((element) => element.scrollIntoView({ block: 'end', inline: 'nearest' }));
    const bottomReachable = await row.evaluate((element) => {
      const scrollList = element.closest('[data-testid="event-ticker-list"]');
      if (!scrollList) return false;
      const listRect = scrollList.getBoundingClientRect();
      const rowRect = element.getBoundingClientRect();
      const overlap =
        Math.min(rowRect.bottom, listRect.bottom) - Math.max(rowRect.top, listRect.top);
      return overlap > 0 && rowRect.bottom >= listRect.bottom - 1;
    });
    expect(bottomReachable, `${label}: ${i + 1}行目の下端へスクロールできない`).toBe(true);
  }
}

/** リストは名前付きフォーカス領域で、溢れるときは End キーで最終行へ到達できる。 */
async function assertTickerKeyboardReachable(page: Page, label: string): Promise<void> {
  const list = page.getByTestId('event-ticker-list');
  await expect(list, `${label}: リストに tabindex が無い`).toHaveAttribute('tabindex', '0');
  await expect(list, `${label}: リストの名前が無い`).toHaveAccessibleName('出来事');

  await list.focus();
  await expect(list, `${label}: リストにフォーカスできない`).toBeFocused();
  const focusedPointer = await list.evaluate((element) => getComputedStyle(element).pointerEvents);
  expect(focusedPointer, `${label}: フォーカス中のリストが盤面ドラッグを奪う`).toBe('none');

  const overflow = await list.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1,
  );
  if (!overflow) return;

  await list.press('Home');
  const top = await list.evaluate((element) => element.scrollTop);
  await list.press('End');
  const after = await list.evaluate((element) => {
    const rows = element.querySelectorAll<HTMLElement>('.event-ticker-row');
    const last = rows.item(rows.length - 1);
    if (!last) return { scrollTop: element.scrollTop, lastVisible: false };
    const listRect = element.getBoundingClientRect();
    const rowRect = last.getBoundingClientRect();
    const overlap = Math.min(rowRect.bottom, listRect.bottom) - Math.max(rowRect.top, listRect.top);
    return { scrollTop: element.scrollTop, lastVisible: overlap > 0 };
  });
  expect(after.scrollTop, `${label}: End でリストがスクロールしない`).toBeGreaterThan(top);
  expect(after.lastVisible, `${label}: End 後も最終行が見えない`).toBe(true);

  const layout = page.getByTestId('sprint-layout');
  const layoutAtEnd = await layout.evaluate((element) => element.scrollTop);
  await list.press('End');
  await list.press('ArrowDown');
  await list.press('PageDown');
  const layoutAfterEnd = await layout.evaluate((element) => element.scrollTop);
  expect(layoutAfterEnd, `${label}: 末尾キーで外側レイアウトがスクロールする`).toBe(layoutAtEnd);

  await list.press('Home');
  const layoutAtHome = await layout.evaluate((element) => element.scrollTop);
  await list.press('Home');
  await list.press('ArrowUp');
  await list.press('PageUp');
  const layoutAfterHome = await layout.evaluate((element) => element.scrollTop);
  expect(layoutAfterHome, `${label}: 先頭キーで外側レイアウトがスクロールする`).toBe(layoutAtHome);

  await list.evaluate((element) => element.blur());
}

/** 親 overflow:hidden でも 2px 枠が内側に残り、クリップされない（DS-08）。 */
async function assertTickerFocusRingInside(
  page: Page,
  target: Locator,
  label: string,
): Promise<void> {
  const ring = await target.evaluate((el) => {
    const parent = el.closest('.event-ticker');
    const cs = getComputedStyle(el);
    const parentOverflow = parent ? getComputedStyle(parent).overflow : '';
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) {
      return {
        parentOverflow,
        outlineOffset: parseFloat(cs.outlineOffset),
        outlineWidth: parseFloat(cs.outlineWidth),
      };
    }
    const selector = el.classList.contains('event-ticker-label')
      ? '.event-ticker-label:focus-visible'
      : '.event-ticker-list:focus-visible';
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule)) continue;
        const matches = rule.selectorText.split(',').some((part) => part.trim() === selector);
        if (!matches) continue;
        return {
          parentOverflow,
          outlineOffset: parseFloat(rule.style.outlineOffset || '0'),
          outlineWidth: parseFloat(rule.style.outlineWidth || '0'),
        };
      }
    }
    return null;
  });
  expect(ring, `${label} のフォーカス枠規則が無い`).not.toBeNull();
  expect(ring!.parentOverflow, `${label} の親が overflow hidden でない`).toBe('hidden');
  expect(ring!.outlineWidth, `${label} のフォーカス枠が 2px 未満`).toBeGreaterThanOrEqual(2);
  expect(ring!.outlineOffset, `${label} のフォーカス枠が親の外側へはみ出す`).toBeLessThanOrEqual(0);
}

/** ホバーでは盤面へ通し、見出しタップと修飾なしホイールで一覧へ到達する。 */
async function assertTickerPassesBoardPointer(page: Page, label: string): Promise<void> {
  const list = page.getByTestId('event-ticker-list');
  const heading = page.getByTestId('event-ticker-heading');
  await list.evaluate((element) => {
    element.scrollTop = 0;
    element.blur();
  });

  const idleHit = await page.evaluate(() => {
    const scrollList = document.querySelector<HTMLElement>('[data-testid="event-ticker-list"]');
    if (!scrollList) return null;
    const box = scrollList.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + Math.min(12, Math.max(4, box.height / 2));
    const el = document.elementFromPoint(x, y);
    return {
      x,
      y,
      inList: Boolean(el?.closest('[data-testid="event-ticker-list"]')),
    };
  });
  if (!idleHit) throw new Error(`${label}: 延焼行が無い`);
  expect(idleHit.inList, `${label}: 未フォーカスでもリストがヒット対象`).toBe(false);

  await page.mouse.move(idleHit.x, idleHit.y);
  const hovered = await list.evaluate((element) => getComputedStyle(element).pointerEvents);
  expect(hovered, `${label}: ホバー中のリストが盤面ドラッグを奪う`).toBe('none');

  await expect(heading, `${label}: 見出しがキーボードから到達できない`).not.toHaveAttribute(
    'tabindex',
    '-1',
  );
  await heading.click();
  await expect(list, `${label}: 見出し click でリストにフォーカスできない`).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(heading, `${label}: Shift+Tab で見出しへ戻れない`).toBeFocused();
  await assertTickerFocusRingInside(page, heading, `${label}: 見出し`);
  await heading.press('Enter');
  await expect(list, `${label}: Enter でリストにフォーカスできない`).toBeFocused();
  await assertTickerFocusRingInside(page, list, `${label}: リスト`);
  const focused = await list.evaluate((element) => getComputedStyle(element).pointerEvents);
  expect(focused, `${label}: フォーカス中のリストが盤面ドラッグを奪う`).toBe('none');
  const focusedHit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return Boolean(el?.closest('[data-testid="event-ticker-list"]'));
  }, idleHit);
  expect(focusedHit, `${label}: フォーカス中でもリストがヒット対象`).toBe(false);

  const overflow = await list.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1,
  );
  if (!overflow) return;

  const wheelPoint = await page.evaluate(() => {
    const scrollList = document.querySelector<HTMLElement>('[data-testid="event-ticker-list"]');
    if (!scrollList) return null;
    const box = scrollList.getBoundingClientRect();
    return {
      x: box.left + box.width / 2,
      y: box.top + Math.min(12, Math.max(4, box.height / 2)),
    };
  });
  if (!wheelPoint) throw new Error(`${label}: フォーカス後のリスト座標が無い`);

  const dispatchWheel = async (deltaY: number, ctrlKey: boolean, deltaMode = 0, deltaX = 0) => {
    const prevented = await page.evaluate(
      ({ x, y, deltaY: dy, deltaX: dx, ctrlKey: ctrl, deltaMode: mode }) => {
        const target = document.elementFromPoint(x, y) ?? document;
        const event = new WheelEvent('wheel', {
          view: window,
          clientX: x,
          clientY: y,
          deltaX: dx,
          deltaY: dy,
          deltaMode: mode,
          ctrlKey: ctrl,
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      },
      { x: wheelPoint.x, y: wheelPoint.y, deltaY, deltaX, ctrlKey, deltaMode },
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    return prevented;
  };

  const readTickerScroll = () =>
    list.evaluate((element) => element.scrollTop + (element.parentElement?.scrollTop ?? 0));

  await list.evaluate((element) => {
    element.scrollTop = 0;
    if (element.parentElement) element.parentElement.scrollTop = 0;
  });
  const before = await readTickerScroll();
  await dispatchWheel(400, false);
  const afterWheel = await readTickerScroll();
  expect(afterWheel, `${label}: ホイールでリストがスクロールしない`).toBeGreaterThan(before);

  await list.evaluate((element) => {
    element.scrollTop = 0;
    if (element.parentElement) element.parentElement.scrollTop = 0;
  });
  await dispatchWheel(400, true);
  const afterCtrl = await readTickerScroll();
  expect(afterCtrl, `${label}: Ctrl+wheel をリストが奪う`).toBe(0);

  await list.evaluate((element) => {
    element.scrollTop = 0;
    if (element.parentElement) element.parentElement.scrollTop = 0;
  });
  await dispatchWheel(3, false, 1);
  const afterLine = await readTickerScroll();
  expect(afterLine, `${label}: DOM_DELTA_LINE のホイールが 3px しか動かない`).toBeGreaterThan(3);

  await list.evaluate((element) => {
    element.scrollTop = 0;
    if (element.parentElement) element.parentElement.scrollTop = 0;
  });
  const horizontalPrevented = await dispatchWheel(0, false, 0, 80);
  const afterHorizontal = await readTickerScroll();
  expect(afterHorizontal, `${label}: 横ホイールでリストが動く`).toBe(0);
  expect(horizontalPrevented, `${label}: 横ホイールをティッカーが奪う`).toBe(false);
}

/** リスト矩形内で、盤面粒に乗っていないタッチ開始点。 */
async function findTickerTouchPanPoint(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(() => {
    const scrollList = document.querySelector<HTMLElement>('[data-testid="event-ticker-list"]');
    if (!scrollList) return null;
    const box = scrollList.getBoundingClientRect();
    const samples: Array<[number, number]> = [
      [box.left + box.width / 2, box.top + Math.min(10, Math.max(4, box.height / 4))],
      [box.left + 8, box.top + 8],
      [box.right - 8, box.top + 8],
      [box.left + box.width * 0.75, box.top + 12],
      [box.left + box.width / 2, box.top + box.height / 2],
    ];
    for (const [x, y] of samples) {
      const hit = document.elementFromPoint(x, y);
      if (hit?.closest('[data-task-id][data-draggable="true"]')) continue;
      return { x, y };
    }
    return null;
  });
}

/**
 * 溢れたリストは touch の pointerdown 時点でパンを確保し、mouse と粒ヒットは通す。
 */
async function assertTickerTouchPanClaimsAtStart(page: Page, label: string): Promise<void> {
  const list = page.getByTestId('event-ticker-list');
  const overflow = await list.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1,
  );
  if (!overflow) return;

  const point = await findTickerTouchPanPoint(page);
  if (!point) return;

  await list.evaluate((element) => {
    element.scrollTop = 0;
    if (element.parentElement) element.parentElement.scrollTop = 0;
  });
  const layout = page.getByTestId('sprint-layout');
  const layoutBefore = await layout.evaluate((element) => element.scrollTop);

  const prevented = await page.evaluate(({ x, y }) => {
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 77,
      pointerType: 'touch',
      clientX: x,
      clientY: y,
      isPrimary: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, point);
  expect(prevented, `${label}: タッチ開始の pointerdown がピンチを塞ぐ`).toBe(false);

  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 77,
        pointerType: 'touch',
        clientX: x,
        clientY: y - 80,
        isPrimary: true,
      }),
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 77,
        pointerType: 'touch',
        clientX: x,
        clientY: y - 80,
        isPrimary: true,
      }),
    );
  }, point);

  const after = await list.evaluate(
    (element) => element.scrollTop + (element.parentElement?.scrollTop ?? 0),
  );
  expect(after, `${label}: タッチ移動でリストがスクロールしない`).toBeGreaterThan(0);
  const layoutAfter = await layout.evaluate((element) => element.scrollTop);
  expect(layoutAfter, `${label}: タッチパンで外側レイアウトが動く`).toBe(layoutBefore);

  const mousePrevented = await page.evaluate(({ x, y }) => {
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 78,
      pointerType: 'mouse',
      clientX: x,
      clientY: y,
      isPrimary: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }, point);
  expect(mousePrevented, `${label}: mouse の pointerdown をティッカーが奪う`).toBe(false);

  const grainPoint = await page.evaluate(() => {
    const scrollList = document.querySelector<HTMLElement>('[data-testid="event-ticker-list"]');
    const grain = document.querySelector<HTMLElement>('[data-task-id]');
    if (!scrollList || !grain) return null;
    const listBox = scrollList.getBoundingClientRect();
    const grainBox = grain.getBoundingClientRect();
    const x = grainBox.left + grainBox.width / 2;
    const y = grainBox.top + grainBox.height / 2;
    if (x < listBox.left || x > listBox.right || y < listBox.top || y > listBox.bottom) {
      return null;
    }
    return { x, y, draggable: grain.dataset.draggable === 'true' };
  });
  if (!grainPoint) return;

  await list.evaluate((element) => {
    element.scrollTop = 0;
    if (element.parentElement) element.parentElement.scrollTop = 0;
  });
  await page.evaluate(({ x, y }) => {
    window.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 79,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        isPrimary: true,
      }),
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 79,
        pointerType: 'touch',
        clientX: x,
        clientY: y - 80,
        isPrimary: true,
      }),
    );
  }, grainPoint);
  const afterGrain = await list.evaluate(
    (element) => element.scrollTop + (element.parentElement?.scrollTop ?? 0),
  );
  if (grainPoint.draggable) {
    expect(afterGrain, `${label}: ドラッグ可能粒の上でティッカーがパンする`).toBe(0);
  } else {
    expect(afterGrain, `${label}: ドラッグ不能粒の上でティッカーがパンしない`).toBeGreaterThan(0);
  }
}

/**
 * ペンが先頭境界で止まったあと、方向を反転すればデッドゾーンなくパンする。
 */
async function assertTickerPenReversesAtBound(page: Page, label: string): Promise<void> {
  const list = page.getByTestId('event-ticker-list');
  const overflow = await list.evaluate(
    (element) => element.scrollHeight > element.clientHeight + 1,
  );
  if (!overflow) return;

  const point = await findTickerTouchPanPoint(page);
  if (!point) return;

  await list.evaluate((element) => {
    element.scrollTop = 0;
    if (element.parentElement) element.parentElement.scrollTop = 0;
  });

  const prevented = await page.evaluate(({ x, y }) => {
    const down = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 91,
      pointerType: 'pen',
      clientX: x,
      clientY: y,
      isPrimary: true,
    });
    window.dispatchEvent(down);
    const pastBound = new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 91,
      pointerType: 'pen',
      clientX: x,
      clientY: y + 80,
      isPrimary: true,
    });
    window.dispatchEvent(pastBound);
    const reverse = new PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 91,
      pointerType: 'pen',
      clientX: x,
      clientY: y - 80,
      isPrimary: true,
    });
    window.dispatchEvent(reverse);
    window.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 91,
        pointerType: 'pen',
        clientX: x,
        clientY: y - 80,
        isPrimary: true,
      }),
    );
    return reverse.defaultPrevented;
  }, point);

  expect(prevented, `${label}: 境界後のペン移動が preventDefault されない`).toBe(true);
  const after = await list.evaluate(
    (element) => element.scrollTop + (element.parentElement?.scrollTop ?? 0),
  );
  expect(after, `${label}: ペンが境界から反転してもデッドゾーンになる`).toBeGreaterThan(0);
}

/** 結果オーバーレイ表示中は背面ティッカーがホイールを奪わない。 */
async function assertTickerDoesNotStealOverlayWheel(page: Page, label: string): Promise<void> {
  const list = page.getByTestId('event-ticker-list');
  if ((await list.count()) === 0) return;
  const box = await list.boundingBox();
  if (!box) return;
  const point = {
    x: box.x + box.width / 2,
    y: box.y + Math.min(12, Math.max(4, box.height / 2)),
  };
  const before = await list.evaluate(
    (element) => element.scrollTop + (element.parentElement?.scrollTop ?? 0),
  );
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 400);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const after = await list.evaluate(
    (element) => element.scrollTop + (element.parentElement?.scrollTop ?? 0),
  );
  expect(after, `${label}: 背面ティッカーがオーバーレイのホイールを奪う`).toBe(before);
}

async function injectSpreadResultEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as SpreadGameWindow).game;
    const lastResult = game?.engine.lastResult;
    if (!game || !lastResult) throw new Error('lastResult が無い');
    lastResult.incidents = 2;
    lastResult.spread = 2;
    lastResult.fireEvents = [
      { tick: 12, kind: 'ignite', taskId: 3, source: 'review' },
      {
        tick: 18,
        kind: 'spread',
        taskId: 3,
        spreadToTaskId: 5,
        debtGain: 6,
        moraleCost: 5,
      },
      { tick: 18, kind: 'ignite', taskId: 5, source: 'spread' },
      { tick: 22, kind: 'contain', taskId: 5, combo: 2 },
      { tick: 12, kind: 'ignite', taskId: 7, source: 'review' },
      { tick: 18, kind: 'spread', taskId: 7, debtGain: 6, moraleCost: 5 },
    ];
    game.step(0);
  });
}

async function assertSpreadCopyFitsViewport(page: Page, label: string): Promise<void> {
  const noHorizontalOverflow = await page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('.app.app-sprint-layout');
    return (
      document.documentElement.scrollWidth <= window.innerWidth + 1 &&
      (app === null || app.scrollWidth <= app.clientWidth + 1)
    );
  });
  expect(noHorizontalOverflow, `${label} で横スクロールが発生している`).toBe(true);
}

test.describe('延焼文言の DOM レイアウト', () => {
  test('延焼・連鎖延焼のティッカーが5 viewportで盤面契約を崩さない', async ({ page }) => {
    await beginPublicSprint(page, { seed: 'spread-copy-ticker-0' });
    await expect(page.getByTestId('event-ticker-heading')).toBeDisabled();
    await injectSpreadTickerEvents(page);
    await expect(page.getByTestId('event-ticker-heading')).toBeEnabled();

    await expect(page.getByTestId('event-ticker')).toBeVisible();
    await expect(page.getByText(SPREAD_TICKER_CHAIN).first()).toBeVisible();
    await expect(page.getByText(SPREAD_TICKER_IMPACT).first()).toBeVisible();

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await waitForLayoutFrame(page);
      await assertLayoutContract(page, viewport, { glanceCopy: true });
      await expect(page.getByTestId('event-ticker')).toBeVisible();
      await expect(page.getByText(SPREAD_TICKER_CHAIN).first()).toBeVisible();
      await expect(page.getByText(SPREAD_TICKER_IMPACT).first()).toBeVisible();

      const ticker = page.getByTestId('event-ticker');
      const stage = page.getByTestId('board-stage');
      const tickerBox = await ticker.boundingBox();
      const stageBox = await stage.boundingBox();
      if (!tickerBox || !stageBox) throw new Error('ticker / board-stage の box が無い');
      expect(
        tickerBox.x,
        `ticker が stage 左へはみ出す（${viewport.name}）`,
      ).toBeGreaterThanOrEqual(stageBox.x - 1);
      expect(
        tickerBox.x + tickerBox.width,
        `ticker が stage 右へはみ出す（${viewport.name}）`,
      ).toBeLessThanOrEqual(stageBox.x + stageBox.width + 1);
      expect(
        tickerBox.y,
        `ticker が stage 上へはみ出す（${viewport.name}）`,
      ).toBeGreaterThanOrEqual(stageBox.y - 1);
      expect(tickerBox.height, `ticker が盤面全体を覆っている（${viewport.name}）`).toBeLessThan(
        stageBox.height,
      );

      const textFits = await page
        .locator('.event-ticker-text')
        .evaluateAll((lines) => lines.every((line) => line.scrollWidth <= line.clientWidth + 1));
      expect(
        textFits,
        `延焼ティッカーが横に溢れている（${viewport.width}x${viewport.height}）`,
      ).toBe(true);
      await assertSpreadTickerRowsReachable(
        page,
        `延焼ティッカー ${viewport.width}x${viewport.height}`,
      );
      await assertSpreadCopyFitsViewport(
        page,
        `延焼ティッカー ${viewport.width}x${viewport.height}`,
      );
    }
  });

  test('延焼リザルトの因果ログが5 viewportで配置を崩さない', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await beginPublicSprint(page, { seed: 'spread-copy-result-0' });
    await advanceCurrentSprintToResult(page);
    await injectSpreadResultEvents(page);

    await expect(page.getByTestId('sprint-result')).toBeVisible();
    await expect(page.getByTestId('result-burn-cause')).toBeVisible();
    await expect(page.getByText(SPREAD_RESULT_CHAIN)).toBeVisible();
    await expect(page.getByText(SPREAD_RESULT_IMPACT)).toBeVisible();

    await assertAcrossViewports(page, { resultOverlay: true });

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await waitForLayoutFrame(page);
      await expect(page.getByTestId('result-burn-cause')).toBeVisible();
      await expect(page.getByText(SPREAD_RESULT_CHAIN)).toBeVisible();
      await expect(page.getByText(SPREAD_RESULT_IMPACT)).toBeVisible();
      await assertReachableInViewport(page, page.getByTestId('result-continue'), 'result-continue');

      const textFits = await page
        .locator('.result-burn-cause-text')
        .evaluateAll((lines) => lines.every((line) => line.scrollWidth <= line.clientWidth + 1));
      expect(textFits, `延焼因果ログが横に溢れている（${viewport.width}x${viewport.height}）`).toBe(
        true,
      );
      await assertSpreadCopyFitsViewport(page, `延焼リザルト ${viewport.width}x${viewport.height}`);
      await assertTickerDoesNotStealOverlayWheel(
        page,
        `延焼リザルト ${viewport.width}x${viewport.height}`,
      );
    }
  });

  test('スプリント中の全社画面では背面ティッカーがホイールを奪わない', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await beginPublicSprint(page, { seed: 'spread-copy-ticker-zoom-0' });
    await injectSpreadTickerEvents(page);
    await expect(page.getByTestId('event-ticker')).toBeVisible();

    await page.evaluate(() => {
      const game = (window as SpreadGameWindow).game;
      if (!game) throw new Error('window.game が公開されていない');
      game.zoomTo('company');
    });
    const overlay = page.getByTestId('zoom-overlay');
    await expect(overlay).toHaveAttribute('data-level', 'company');
    await assertTickerDoesNotStealOverlayWheel(page, '全社ズーム phone-se');

    const overlayBox = await overlay.boundingBox();
    if (!overlayBox) throw new Error('zoom-overlay の box が無い');
    const overflow = await overlay.evaluate(
      (element) => element.scrollHeight > element.clientHeight + 1,
    );
    if (!overflow) return;

    const before = await overlay.evaluate((element) => element.scrollTop);
    await page.mouse.move(
      overlayBox.x + overlayBox.width / 2,
      overlayBox.y + overlayBox.height / 2,
    );
    await page.mouse.wheel(0, 400);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    const after = await overlay.evaluate((element) => element.scrollTop);
    expect(after, '全社ズームの overflow が背面ティッカーに奪われる').toBeGreaterThan(before);
  });
});

test.describe('タッチ端末のティッカーパン', () => {
  test.use({
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });

  test('溢れたリストは実タッチスワイプでパンし外側を動かさない', async ({ page }) => {
    await beginPublicSprint(page, { seed: 'spread-copy-ticker-touch-0' });
    await injectSpreadTickerEvents(page);
    await expect(page.getByTestId('event-ticker')).toBeVisible();
    await waitForLayoutFrame(page);

    const list = page.getByTestId('event-ticker-list');
    await expect
      .poll(async () => list.evaluate((element) => element.scrollHeight > element.clientHeight + 1))
      .toBe(true);

    const point = await findTickerTouchPanPoint(page);
    if (!point) throw new Error('ティッカー上に粒以外のタッチ点が無い');

    await list.evaluate((element) => {
      element.scrollTop = 0;
      if (element.parentElement) element.parentElement.scrollTop = 0;
    });
    const layout = page.getByTestId('sprint-layout');
    const layoutBefore = await layout.evaluate((element) => element.scrollTop);

    const session = await page.context().newCDPSession(page);
    const start = { x: Math.round(point.x), y: Math.round(point.y) };
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: start.x, y: start.y, id: 1 }],
    });
    for (const step of [15, 30, 45, 60, 75, 90]) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x, y: start.y - step, id: 1 }],
      });
    }
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );

    const after = await list.evaluate(
      (element) => element.scrollTop + (element.parentElement?.scrollTop ?? 0),
    );
    expect(after, '実タッチスワイプでリストが動かない').toBeGreaterThan(0);
    const layoutAfter = await layout.evaluate((element) => element.scrollTop);
    expect(layoutAfter, '実タッチスワイプで外側レイアウトが動く').toBe(layoutBefore);

    const pinch = await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y) ?? document.body;
      const first = new Touch({
        identifier: 1,
        target,
        clientX: x,
        clientY: y,
      });
      const start = new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        touches: [first],
        targetTouches: [first],
        changedTouches: [first],
      });
      window.dispatchEvent(start);
      const second = new Touch({
        identifier: 2,
        target,
        clientX: x + 36,
        clientY: y,
      });
      const pinchStart = new TouchEvent('touchstart', {
        bubbles: true,
        cancelable: true,
        touches: [first, second],
        targetTouches: [first, second],
        changedTouches: [second],
      });
      window.dispatchEvent(pinchStart);
      const pinchMove = new TouchEvent('touchmove', {
        bubbles: true,
        cancelable: true,
        touches: [first, second],
        targetTouches: [first, second],
        changedTouches: [first, second],
      });
      window.dispatchEvent(pinchMove);
      return {
        startPrevented: start.defaultPrevented,
        pinchStartPrevented: pinchStart.defaultPrevented,
        pinchMovePrevented: pinchMove.defaultPrevented,
      };
    }, point);
    expect(pinch.startPrevented, '1本目 touchstart がピンチを塞ぐ').toBe(false);
    expect(pinch.pinchStartPrevented, '2本目 touchstart がピンチを塞ぐ').toBe(false);
    expect(pinch.pinchMovePrevented, 'ピンチの touchmove をティッカーが奪う').toBe(false);

    const layoutBox = await layout.boundingBox();
    if (!layoutBox) throw new Error('sprint-layout の box が無い');
    const outside = { x: layoutBox.x + 24, y: layoutBox.y + layoutBox.height - 12 };
    const outsideMove = await page.evaluate(
      ({ outside: from, inside }) => {
        const target = document.elementFromPoint(from.x, from.y) ?? document.body;
        const finger = new Touch({
          identifier: 8,
          target,
          clientX: from.x,
          clientY: from.y,
        });
        const start = new TouchEvent('touchstart', {
          bubbles: true,
          cancelable: true,
          touches: [finger],
          targetTouches: [finger],
          changedTouches: [finger],
        });
        window.dispatchEvent(start);
        const moved = new Touch({
          identifier: 8,
          target,
          clientX: inside.x,
          clientY: inside.y,
        });
        const move = new TouchEvent('touchmove', {
          bubbles: true,
          cancelable: true,
          touches: [moved],
          targetTouches: [moved],
          changedTouches: [moved],
        });
        window.dispatchEvent(move);
        return { startPrevented: start.defaultPrevented, movePrevented: move.defaultPrevented };
      },
      { outside, inside: point },
    );
    expect(outsideMove.startPrevented, 'リスト外開始の touchstart をティッカーが奪う').toBe(false);
    expect(outsideMove.movePrevented, 'リスト外開始の侵入 touchmove をティッカーが奪う').toBe(
      false,
    );
  });
});
