/**
 * 320 幅で武装しても sprint-layout が飛ばず、盤面と対象ピッカーが同時に見える（#980）。
 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test, type PublicGameWindow } from './fixtures';
import { designToClient, readBoardCanvasFrame } from './boardCanvasPoint';
import { planBoardScene } from '../../src/render/boardScene';
import { presentBoardDots } from '../../src/render/boardPixiView';

async function armWithoutPlaywrightScroll(
  page: Page,
  action: 'assignTask' | 'splitPr',
): Promise<void> {
  await page.evaluate((id) => {
    document.querySelector<HTMLButtonElement>(`[data-testid="action-${id}"]`)?.click();
  }, action);
}

async function readScroll(page: Page) {
  return page.evaluate(() => {
    const layout = document.querySelector('[data-testid="sprint-layout"]') as HTMLElement | null;
    return {
      winY: window.scrollY,
      layoutY: layout?.scrollTop ?? 0,
    };
  });
}

async function assertBoardAndPickerVisible(page: Page): Promise<void> {
  const visibility = await page.evaluate(() => {
    const vh = window.innerHeight;
    const visible = (rect: DOMRect | undefined) =>
      rect == null ? 0 : Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
    const board = document.querySelector('[data-testid="board"]')?.getBoundingClientRect();
    const picker = document
      .querySelector('[data-testid="action-target-picker"]')
      ?.getBoundingClientRect();
    return {
      boardVisible: visible(board),
      boardHeight: board?.height ?? 0,
      pickerVisible: visible(picker),
    };
  });
  expect(visibility.boardVisible, '盤面が viewport に見えない').toBeGreaterThan(
    visibility.boardHeight * 0.85,
  );
  expect(visibility.pickerVisible, '対象ピッカーが viewport に見えない').toBeGreaterThan(44);
}

async function assertControlsReachable(page: Page, armed: 'assignTask' | 'splitPr'): Promise<void> {
  await expect(page.getByTestId('hud')).toBeVisible();
  const action = page.getByTestId(`action-${armed}`);
  await expect(action).toBeVisible();
  await expect(action).toHaveAttribute('data-armed', 'true');
  const cancel = page.getByTestId('action-target-cancel');
  await expect(cancel).toBeVisible();
  await expect(cancel).toBeInViewport();
}

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
    while (game.getState().phase === 'sprint' && guard < 8000) {
      const current = count();
      if (current === wanted) {
        game.pause();
        return current;
      }
      if (current > wanted) {
        game.pause();
        throw new Error(`PR分割候補が ${current} 件で ${wanted} 件を飛び越した`);
      }
      guard += 1;
      game.step(80);
    }
    game.pause();
    throw new Error(`PR分割候補が ${wanted} 件に到達しない`);
  }, target);
  expect(reached).toBe(target);
}

test.describe('320 幅の武装スクロール（#980）', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  for (const action of ['assignTask', 'splitPr'] as const) {
    test(`${action} を構えても sprint-layout は 0px のまま`, async ({ page }) => {
      await beginPublicSprint(page, { seed: 'devops-tycoon', renderer: 'pixi' });
      if (action === 'splitPr') {
        await advanceToSplitCandidateCount(page, 7);
        await expect(page.getByTestId('action-splitPr')).toBeEnabled();
      }
      await page.evaluate(() => {
        const layout = document.querySelector(
          '[data-testid="sprint-layout"]',
        ) as HTMLElement | null;
        if (layout) layout.scrollTop = 0;
        window.scrollTo(0, 0);
      });
      const before = await readScroll(page);
      expect(before.layoutY).toBe(0);
      expect(before.winY).toBe(0);

      await armWithoutPlaywrightScroll(page, action);
      await expect(page.getByTestId('board')).toHaveAttribute('data-armed', action);
      await expect(page.getByTestId('action-target-picker')).toBeVisible();

      const after = await readScroll(page);
      expect(after.layoutY, 'sprint-layout が縦スクロールした').toBe(0);
      expect(after.winY, 'ページが縦スクロールした').toBe(0);
      await assertBoardAndPickerVisible(page);
      await assertControlsReachable(page, action);
    });
  }

  test('構えたまま盤面の粒をタップできる', async ({ page }) => {
    await beginPublicSprint(page, { seed: 'devops-tycoon', renderer: 'pixi' });
    await page.evaluate(() => window.game!.step(300));
    await expect(page.getByTestId('action-splitPr')).toBeEnabled();
    await page.evaluate(() => {
      const layout = document.querySelector('[data-testid="sprint-layout"]') as HTMLElement | null;
      if (layout) layout.scrollTop = 0;
    });
    await armWithoutPlaywrightScroll(page, 'splitPr');
    await expect(page.getByTestId('action-target-picker')).toBeVisible();

    const sprint = await page.evaluate(() => (window as PublicGameWindow).game?.getState().sprint);
    if (!sprint) throw new Error('スプリントがない');
    const frame = await readBoardCanvasFrame(page);
    const dots = presentBoardDots(planBoardScene(sprint.tasks).dots, frame.fit.scale).filter(
      (dot) => !dot.motion,
    );
    await expect(page.getByTestId('action-splitPr')).toBeEnabled();
    let hitBoard = false;
    for (const dot of dots) {
      const candidate = designToClient(frame, dot);
      if (candidate.y > 410) continue;
      hitBoard = await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-testid="board"]') != null,
        candidate,
      );
      if (hitBoard) break;
    }
    expect(hitBoard, '武装中でも盤面へヒットできる').toBe(true);
    const scroll = await readScroll(page);
    expect(scroll.layoutY, '盤面操作前に sprint-layout が動いた').toBe(0);
    expect(scroll.winY, '盤面操作前にページがスクロールした').toBe(0);
  });
});
