/** PR 分割後の粒強調と読み上げが同じ ID を指す（#1020）。 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test } from './fixtures';
import {
  formatSplitPrConfirmAnnouncement,
  splitPrConfirmDurationMs,
} from '../../src/render/splitPrConfirmView';

type GameWindow = Window & {
  splitPrConfirmationObserved?: boolean;
  game?: {
    getState(): {
      sprint?: {
        focus: number;
        tasks: { id: number; split: boolean; lane: string }[];
        events: { kind: string; effect?: { affectedTaskIds?: number[] } }[];
      };
    };
    step(n: number): void;
  };
};

async function waitForBoardReady(page: Page): Promise<void> {
  await expect(page.getByTestId('board')).toHaveAttribute('data-effect-renderer', 'pixi');
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
}

async function advanceUntil(page: Page, mode: 'split'): Promise<number> {
  for (let step = 0; step < 400; step += 1) {
    await page.evaluate((n) => (window as GameWindow).game!.step(n), 5);
    const found = await page.evaluate((target) => {
      const sprint = (window as GameWindow).game!.getState().sprint;
      if (!sprint) return null;
      if (target === 'split') {
        const task = sprint.tasks.find(
          (t) => !t.split && (t.lane === 'review' || t.lane === 'coding'),
        );
        if (task && sprint.focus >= 2) return task.id;
      }
      return null;
    }, mode);
    if (found != null) return found;
  }
  throw new Error(`advanceUntil(${mode}) がタイムアウト`);
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`390px・${reducedMotion}: 分割した粒 ID と読み上げ文が一致する（#1020） @pixi`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion });
    await beginPublicSprint(page, { seed: 'ri146-split-keyboard', renderer: 'pixi' });
    await waitForBoardReady(page);
    const taskId = await advanceUntil(page, 'split');

    await page.getByTestId('action-splitPr').click();
    await expect(page.getByTestId('action-target-picker')).toBeVisible();
    const option = page.getByTestId(`action-target-option-${taskId}`);
    await expect(option).toBeEnabled();

    const announce = formatSplitPrConfirmAnnouncement(taskId);
    // 通常の強調は175msだけなので、通信を挟まず同じDOM更新で3値を観測する。
    // 操作後のpollだけではCI負荷で演出の寿命を過ぎ、表示済みの一致を見逃す。
    await page.evaluate(
      ({ expectedId, announcement }) => {
        (window as GameWindow).splitPrConfirmationObserved = false;
        const observer = new MutationObserver(() => {
          const boardId = document
            .querySelector('[data-testid="board"]')
            ?.getAttribute('data-split-confirm-task-id');
          const pixiId = document
            .querySelector('[data-testid="board-pixi-mount"]')
            ?.getAttribute('data-split-confirm-task-id');
          const spoken = document
            .querySelector('[data-testid="split-pr-confirm-announce"]')
            ?.textContent?.trim();
          if (boardId === expectedId && pixiId === expectedId && spoken === announcement) {
            (window as GameWindow).splitPrConfirmationObserved = true;
            observer.disconnect();
          }
        });
        observer.observe(document.body, {
          attributes: true,
          childList: true,
          characterData: true,
          subtree: true,
        });
      },
      { expectedId: String(taskId), announcement: announce },
    );
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('action-target-picker')).toHaveCount(0);

    // 通信が演出より遅くても、寿命内に観測した一致をあとから確認できる。
    await page.waitForTimeout(splitPrConfirmDurationMs() + 40);
    await expect
      .poll(() => page.evaluate(() => (window as GameWindow).splitPrConfirmationObserved), {
        timeout: splitPrConfirmDurationMs() + 3_000,
        intervals: [16, 32, 48, 64, 96],
      })
      .toBe(true);

    const event = await page.evaluate(() => {
      const sprint = (window as GameWindow).game!.getState().sprint;
      const entry = sprint?.events.findLast((e) => e.kind === 'intervention');
      return entry?.kind === 'intervention' ? entry.effect?.affectedTaskIds?.[0] : null;
    });
    expect(event).toBe(taskId);

    await expect(page.getByTestId('board')).not.toHaveAttribute('data-split-confirm-task-id');
    await expect(page.getByTestId('board-pixi-mount')).not.toHaveAttribute(
      'data-split-confirm-task-id',
    );
    await expect(page.getByTestId('split-pr-confirm-announce')).toHaveText(announce);
  });
}
