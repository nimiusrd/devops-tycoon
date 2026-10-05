/**
 * 介入パネルの判断・操作契約（#536 / RI-149）。
 * 平常・渋滞・炎上は公開fixtureで再現し、全不可・同時Ready・競合結果だけ
 * 既存E2Eと同じ engine injector を使う。探索時間や人間の理解度は測定しない。
 */
import type { Locator, Page } from '@playwright/test';
import { ACTION_DEFS } from '../../src/data/actions';
import type { ActionId, OrgState, SprintEvent, SprintState } from '../../src/sim/types';
import {
  advanceCurrentSprintToBurning,
  advanceCurrentSprintToReviewQueue,
  beginPublicSprint,
  expect,
  test,
  type PublicGameHandle,
  type PublicGameWindow,
} from './fixtures';

const ACTION_ORDER = [
  'interruptReview',
  'splitPr',
  'firefight',
  'assignTask',
  'aiThrottle',
  'pairReview',
  'overtime',
  'andon',
] as const satisfies readonly ActionId[];
const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

type InjectedGameWindow = Window & {
  game: PublicGameHandle & { engine: { sprint: SprintState; org: OrgState } };
};

async function readResources(page: Page) {
  return page.evaluate(() => {
    const state = (window as PublicGameWindow).game!.getState();
    const sprint = state.sprint!;
    return {
      focus: sprint.focus,
      focusSpent: sprint.metrics.focusSpent,
      interventions: sprint.metrics.interventionsUsed,
      actionCounts: sprint.metrics.actionCounts,
      cooldowns: sprint.cooldowns,
      modifiers: sprint.modifiers,
      tasks: sprint.tasks,
      org: state.org,
    };
  });
}

/** CSSの見かけの可視性だけでなく、スクロール後の中央が操作対象へ届くか確認する。 */
async function assertReachable(locator: Locator, label: string) {
  // 全体が数pxだけ境界外に残る場合も、実際に中央へスクロールして到達性を測る。
  const geometry = await locator.evaluate(async (element) => {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return {
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hit: hit === element || (hit != null && element.contains(hit)),
    };
  });
  expect(geometry.left, `${label}: 左端`).toBeGreaterThanOrEqual(-1);
  expect(geometry.right, `${label}: 右端`).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.top, `${label}: 上端`).toBeGreaterThanOrEqual(-1);
  expect(geometry.bottom, `${label}: 下端`).toBeLessThanOrEqual(geometry.viewportHeight + 1);
  expect(geometry.width, `${label}: 最小クリック幅`).toBeGreaterThanOrEqual(24);
  expect(geometry.height, `${label}: 最小クリック高さ`).toBeGreaterThanOrEqual(
    geometry.viewportWidth <= 390 ? 44 : 24,
  );
  expect(geometry.hit, `${label}: 別の要素がクリックを遮る`).toBe(true);
  return { width: geometry.width, height: geometry.height, reachable: geometry.hit };
}

async function assertNotClipped(locator: Locator, label: string) {
  await expect(locator).toBeVisible();
  const sizes = await locator.evaluate((element) => ({
    width: element.clientWidth,
    height: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
  }));
  expect(sizes.scrollWidth, `${label}: 横方向に文言が切れる`).toBeLessThanOrEqual(sizes.width + 1);
  expect(sizes.scrollHeight, `${label}: 縦方向に文言が切れる`).toBeLessThanOrEqual(
    sizes.height + 1,
  );
}

async function assertPanelContract(page: Page, state: string) {
  const actions = page.getByTestId('action-bar').locator('button.action');
  const ids = await actions.evaluateAll((buttons) =>
    buttons.map((button) => button.getAttribute('data-testid')?.replace('action-', '')),
  );
  expect(ids, `${state}: 8介入が固定順`).toEqual(ACTION_ORDER);
  const measurements = [];
  for (const id of ACTION_ORDER) {
    const button = page.getByTestId(`action-${id}`);
    await expect(button).toBeVisible();
    measurements.push({ id, ...(await assertReachable(button, `${state}/${id}`)) });
    // 主効果3行は同じDOM状態を一度で計測し、WebGL環境のブラウザ往復を減らす。
    const readings = await button.evaluate(
      (element, actionId) =>
        ['target', 'summary', 'tradeoff'].map((suffix) => {
          const span = element.querySelector<HTMLElement>(
            `[data-testid="action-${suffix}-${actionId}"]`,
          );
          if (!span)
            return {
              suffix,
              present: false,
              visible: false,
              width: 0,
              height: 0,
              scrollWidth: 0,
              scrollHeight: 0,
            };
          const style = getComputedStyle(span);
          return {
            suffix,
            present: true,
            visible: style.display !== 'none' && style.visibility !== 'hidden',
            width: span.clientWidth,
            height: span.clientHeight,
            scrollWidth: span.scrollWidth,
            scrollHeight: span.scrollHeight,
          };
        }),
      id,
    );
    for (const reading of readings) {
      const label = `${state}/${id}/${reading.suffix}`;
      expect(reading.present, `${label}: 文言が存在する`).toBe(true);
      expect(reading.visible, `${label}: 文言が可視状態`).toBe(true);
      expect(reading.width, `${label}: 表示幅がある`).toBeGreaterThan(0);
      expect(reading.height, `${label}: 表示高さがある`).toBeGreaterThan(0);
      expect(reading.scrollWidth, `${label}: 横方向に文言が切れる`).toBeLessThanOrEqual(
        reading.width + 1,
      );
      expect(reading.scrollHeight, `${label}: 縦方向に文言が切れる`).toBeLessThanOrEqual(
        reading.height + 1,
      );
    }
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, `${state}: ページ全体の横スクロール`).toBeLessThanOrEqual(1);
  return { state, order: ids, measurements, horizontalOverflow: overflow };
}

async function openInspection(page: Page, id: string) {
  const details = page.getByTestId('action-inspect');
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await page.getByTestId('action-inspect-toggle').click();
  }
  await expect(details).toHaveAttribute('open', '');
  await page.getByTestId('action-inspect-select').selectOption(id);
  return page.getByTestId('action-inspect-detail');
}

async function assertTargetLanes(page: Page, lanes: string[]) {
  const targets = page
    .getByTestId('board')
    .locator('.board-flow-list > [data-action-target="true"]');
  const actual = await targets.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-lane')),
  );
  expect(actual).toEqual(lanes);
  for (let index = 0; index < (await targets.count()); index += 1) {
    await expect(targets.nth(index)).toContainText('作用先');
  }
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: 介入の対象・効果・代償と8操作が各状態で読める（#536）`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await beginPublicSprint(page, { seed: 'issue-536-panel-normal', difficulty: 'normal' });
    const measurements = [await assertPanelContract(page, '平常')];

    const beforeArm = await readResources(page);
    await page.getByTestId('action-assignTask').click();
    await expect(page.getByTestId('action-assignTask')).toHaveAttribute('data-armed', 'true');
    await expect(page.getByTestId('action-target-picker')).toBeVisible();
    await assertReachable(page.getByTestId('action-target-cancel'), '武装/取消');
    await page.getByTestId('action-target-cancel').click();
    expect(await readResources(page), '武装と取消だけでは資源を消費しない').toEqual(beforeArm);
    measurements.push(await assertPanelContract(page, '武装解除'));

    const beforeExecution = await readResources(page);
    await page.getByTestId('action-overtime').click();
    const afterExecution = await readResources(page);
    const executionCost = ACTION_DEFS.find((action) => action.id === 'overtime')!.cost;
    expect(afterExecution.actionCounts.overtime).toBe(1);
    expect(afterExecution.focusSpent - beforeExecution.focusSpent).toBe(executionCost);
    await expect(page.getByTestId('action-overtime')).toBeDisabled();
    await expect(page.getByTestId('action-overtime')).toHaveAttribute(
      'data-block-reason',
      'cooldown',
    );
    await expect(page.getByTestId('action-mod-ring-overtime')).toBeVisible();
    measurements.push(await assertPanelContract(page, 'CD・効果中'));

    // 最長の宣言文言を、hoverなしの詳細で読む。選択しても発動しない。
    const beforeInspection = await readResources(page);
    const longDetail = await openInspection(page, 'andon');
    await expect(longDetail).toContainText(
      ACTION_DEFS.find((action) => action.id === 'andon')!.sideEffect,
    );
    await assertNotClipped(longDetail, '長い日本語の詳細');
    await assertTargetLanes(page, ['backlog']);
    await openInspection(page, 'overtime');
    await assertTargetLanes(page, ['coding', 'review']);
    expect(await readResources(page), '詳細確認では発動・武装しない').toEqual(beforeInspection);
    await page.getByTestId('action-inspect-toggle').click();

    await beginPublicSprint(page, { seed: 'ops', difficulty: 'normal' });
    const reviewCount = await advanceCurrentSprintToReviewQueue(page, 4);
    await expect(page.getByTestId('action-target-interruptReview')).toContainText(
      `${reviewCount}件`,
    );
    measurements.push(await assertPanelContract(page, 'Review渋滞'));
    const reviewBeforeInspect = await readResources(page);
    await openInspection(page, 'interruptReview');
    await assertTargetLanes(page, ['review']);
    expect(await readResources(page)).toEqual(reviewBeforeInspect);
    await page.getByTestId('action-inspect-toggle').click();

    await beginPublicSprint(page, { seed: 'ri34-burn', difficulty: 'hard' });
    const burning = await advanceCurrentSprintToBurning(page);
    await expect(page.getByTestId('action-target-firefight')).toContainText(
      `炎上 ${burning.length}件`,
    );
    measurements.push(await assertPanelContract(page, '炎上'));

    await page.evaluate(() => {
      const game = (window as InjectedGameWindow).game;
      game.engine.sprint.focus = 0;
      game.step(0);
    });
    for (const id of ACTION_ORDER) await expect(page.getByTestId(`action-${id}`)).toBeDisabled();
    measurements.push(await assertPanelContract(page, '全介入不可'));
    const unavailableBeforeInspect = await readResources(page);
    const detail = await openInspection(page, 'firefight');
    await expect(detail).toContainText('集中力不足');
    await assertTargetLanes(page, ['rework']);
    expect(await readResources(page)).toEqual(unavailableBeforeInspect);

    await testInfo.attach(`intervention-panel-${viewport.name}.json`, {
      body: JSON.stringify(
        {
          viewport,
          measurements,
          execution: {
            action: 'overtime',
            clicks: 1,
            actionCount: afterExecution.actionCounts.overtime,
            focusSpent: afterExecution.focusSpent - beforeExecution.focusSpent,
          },
          measurementScope:
            'DOM到達性・固定順・横溢れ・実行クリック数・実際の消費。人間の探索時間は未測定',
        },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });
}

test('8介入のTab順を固定し、Enter/Spaceは即時実行、詳細確認は非発火（#536）', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await beginPublicSprint(page, { seed: 'issue-536-keyboard' });
  await page.evaluate(() => {
    const game = (window as InjectedGameWindow).game;
    const sprint = game.engine.sprint;
    const template = sprint.tasks[0];
    sprint.tasks.push(
      { ...template, id: 9001, kind: 'complex', lane: 'coding', incident: false, split: false },
      { ...template, id: 9002, kind: 'complex', lane: 'review', incident: false, split: false },
      { ...template, id: 9003, lane: 'rework', incident: true, burnTicksLeft: 10 },
    );
    sprint.nextTaskId = 9004;
    sprint.focus = 20;
    sprint.config.focusMax = 20;
    game.engine.org.aiEnabled = true;
    game.step(0);
  });
  for (const id of ACTION_ORDER) await expect(page.getByTestId(`action-${id}`)).toBeEnabled();
  await page.getByTestId(`action-${ACTION_ORDER[0]}`).focus();
  for (const id of ACTION_ORDER) {
    await expect(page.getByTestId(`action-${id}`)).toBeFocused();
    await page.keyboard.press('Tab');
  }
  await expect(page.getByTestId('action-inspect-toggle')).toBeFocused();
  const beforeInspection = await readResources(page);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('action-inspect-select')).toBeFocused();
  await page.getByTestId('action-inspect-select').selectOption('andon');
  await assertTargetLanes(page, ['backlog']);
  expect(await readResources(page)).toEqual(beforeInspection);
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByTestId('action-inspect-toggle')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('action-inspect')).not.toHaveAttribute('open', '');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('action-inspect-select')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('action-inspect')).not.toHaveAttribute('open', '');
  await expect(page.getByTestId('action-inspect-toggle')).toBeFocused();
  expect(await readResources(page)).toEqual(beforeInspection);

  for (const [id, key] of [
    ['overtime', 'Enter'],
    ['aiThrottle', 'Space'],
  ] as const) {
    const before = await readResources(page);
    await page.getByTestId(`action-${id}`).focus();
    await page.keyboard.press(key);
    const after = await readResources(page);
    const cost = ACTION_DEFS.find((action) => action.id === id)!.cost;
    expect(after.focus).toBe(before.focus - cost);
    expect(after.focusSpent).toBe(before.focusSpent + cost);
    expect(after.actionCounts[id] ?? 0).toBe((before.actionCounts[id] ?? 0) + 1);
  }
});

test('touchとreduced motionでも詳細確認と1tapの結果が保持される（#536）', async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: 'reduce',
  });
  try {
    const page = await context.newPage();
    // 共通page fixture外でも初回ガイドを明示的に止める。
    await page.addInitScript(() => {
      const url = new URL(window.location.href);
      if (!url.searchParams.has('tutorial')) {
        url.searchParams.set('tutorial', 'off');
        window.history.replaceState(null, '', url);
      }
    });
    await beginPublicSprint(page, { seed: 'issue-536-touch' });
    const before = await readResources(page);
    await page.getByTestId('action-inspect-toggle').tap();
    await expect(page.getByTestId('action-inspect')).toHaveAttribute('open', '');
    await page.getByTestId('action-inspect-select').selectOption('andon');
    await assertTargetLanes(page, ['backlog']);
    expect(await readResources(page)).toEqual(before);
    await page.getByTestId('action-inspect-toggle').tap();
    await page.clock.install();
    await page.getByTestId('action-overtime').tap();
    await expect(page.getByTestId('event-ticker')).toHaveAttribute('data-feedback-held', 'true');
    await expect(page.getByTestId('event-ticker-summary')).toContainText('残業開始');
    const after = await readResources(page);
    expect(after.actionCounts.overtime).toBe(1);
    expect(after.focusSpent - before.focusSpent).toBe(
      ACTION_DEFS.find((action) => action.id === 'overtime')!.cost,
    );
    await page.clock.runFor(2000);
    await expect(page.getByTestId('event-ticker-summary')).toContainText('残業開始');
  } finally {
    await context.close();
  }
});

/** 戻り値を変えず、自然進行で起きる次イベントの表示だけを合成する。 */
async function appendTickerEvent(page: Page, event: SprintEvent) {
  await page.evaluate((next) => {
    const game = (window as InjectedGameWindow).game;
    game.engine.sprint.events.push(next);
    game.step(0);
  }, event);
}

test('連続する成功・失敗で結果の2.5秒保持を更新し、期限後に履歴へ戻す（#536）', async ({
  page,
}) => {
  await beginPublicSprint(page, { seed: 'issue-536-feedback' });
  // 操作・描画待ちの実時間を保持期限に加算せず、runForだけで時間を進める。
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  await page.getByTestId('action-overtime').click();
  const ticker = page.getByTestId('event-ticker');
  const summary = page.getByTestId('event-ticker-summary');
  await expect(ticker).toHaveAttribute('data-feedback-held', 'true');
  await expect(summary).toContainText('残業開始');
  await appendTickerEvent(page, { kind: 'contain', tick: 1, taskId: 9999, combo: 2 });
  await page.clock.runFor(2000);
  await expect(summary).toContainText('残業開始');

  // UI描画後に状態が変わる競合を再現。表示上Readyでも実行時判定は失敗を返す。
  const beforeFailure = await readResources(page);
  await page.evaluate(() => {
    (window as InjectedGameWindow).game.engine.sprint.cooldowns.aiThrottle = 10;
  });
  await page.getByTestId('action-aiThrottle').click();
  await expect(summary).toContainText('AIスロットル: クールダウン中');
  const afterFailure = await readResources(page);
  expect(afterFailure.focus).toBe(beforeFailure.focus);
  expect(afterFailure.interventions).toBe(beforeFailure.interventions);
  await page.clock.runFor(600);
  await expect(ticker).toHaveAttribute('data-feedback-held', 'true');
  await expect(summary).toContainText('AIスロットル: クールダウン中');
  await page.clock.runFor(1400);
  await expect(summary).toContainText('AIスロットル: クールダウン中');
  await page.clock.runFor(600);
  await expect(ticker).toHaveAttribute('data-feedback-held', 'false');
  await expect(summary).toContainText('鎮火成功');
  await expect(summary).not.toContainText('クールダウン中');

  // stage/status間の再マウントでも、期限切れの失敗結果を復活させない。
  for (const viewport of [
    { width: 390, height: 844, dock: 'status' },
    { width: 1440, height: 900, dock: 'stage' },
  ]) {
    await page.setViewportSize(viewport);
    await page.clock.runFor(100);
    await expect(ticker).toHaveAttribute('data-dock', viewport.dock);
    await expect(ticker).toHaveAttribute('data-feedback-held', 'false');
    await expect(summary).toContainText('鎮火成功');
    await expect(summary).not.toContainText('クールダウン中');
  }
});

for (const event of [
  { kind: 'ignite', tick: 1, taskId: 9100, source: 'review' },
  { kind: 'spread', tick: 1, taskId: 9100, spreadToTaskId: 9101, debtGain: 3, moraleCost: 2 },
] as const satisfies readonly SprintEvent[]) {
  test(`結果保持中でも${event.kind}が即座に最前面へ出る（#536）`, async ({ page }) => {
    await beginPublicSprint(page, { seed: `issue-536-priority-${event.kind}` });
    await page.clock.install();
    await page.getByTestId('action-overtime').click();
    await expect(page.getByTestId('event-ticker-summary')).toContainText('残業開始');
    await appendTickerEvent(page, event);
    await expect(page.getByTestId('event-ticker-summary')).toContainText(
      event.kind === 'ignite' ? '点火!' : '延焼!',
    );
    await expect(page.getByTestId('event-ticker')).toHaveAttribute('data-feedback-held', 'true');
    await page.getByTestId('event-ticker-heading').click();
    await expect(page.getByTestId('event-ticker-list')).toContainText('残業開始');
  });
}
