/** PR 分割後の粒強調と読み上げが同じ ID を指す（#1020）。 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test } from './fixtures';
import {
  formatSplitPrConfirmAnnouncement,
  splitPrConfirmDurationMs,
} from '../../src/render/splitPrConfirmView';

type GameWindow = Window & {
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
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('action-target-picker')).toHaveCount(0);

    const announce = formatSplitPrConfirmAnnouncement(taskId);
    await expect
      .poll(() => page.getByTestId('board').getAttribute('data-split-confirm-task-id'))
      .toBe(String(taskId));
    await expect(page.getByTestId('split-pr-confirm-announce')).toHaveText(announce, {
      timeout: 3_000,
    });
    await expect(page.getByTestId('board')).toHaveAttribute(
      'data-split-confirm-task-id',
      String(taskId),
    );
    await expect(page.getByTestId('board-pixi-mount')).toHaveAttribute(
      'data-split-confirm-task-id',
      String(taskId),
    );

    const event = await page.evaluate(() => {
      const sprint = (window as GameWindow).game!.getState().sprint;
      const entry = sprint?.events.findLast((e) => e.kind === 'intervention');
      return entry?.kind === 'intervention' ? entry.effect?.affectedTaskIds?.[0] : null;
    });
    expect(event).toBe(taskId);

    await page.waitForTimeout(splitPrConfirmDurationMs() + 40);
    await expect(page.getByTestId('board')).not.toHaveAttribute('data-split-confirm-task-id');
    await expect(page.getByTestId('board-pixi-mount')).not.toHaveAttribute(
      'data-split-confirm-task-id',
    );
    await expect(page.getByTestId('split-pr-confirm-announce')).toHaveText(announce);
  });
}
