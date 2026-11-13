/**
 * #1025: Review Hell 中も得点ポップが盤面ラベル（工程要約・注意オーバーレイ）と矩形重ならない。
 */
import type { Page } from '@playwright/test';
import { advanceCurrentSprintToReviewQueue, beginPublicSprint, expect, test } from './fixtures';
import type { PublicGameWindow } from './fixtures';

const VIEWPORTS = [
  { name: '320', width: 320, height: 568 },
  { name: '390', width: 390, height: 844 },
  { name: '1024', width: 1024, height: 768 },
] as const;

async function boardY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const board = document.querySelector('[data-testid="board-stage"]');
    if (!board) throw new Error('board-stage が無い');
    return board.getBoundingClientRect().y;
  });
}

async function awaitPaint(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function sampleOverlap(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const intersects = (first: DOMRect, second: DOMRect) =>
      first.left < second.right - 0.5 &&
      first.right > second.left + 0.5 &&
      first.top < second.bottom - 0.5 &&
      first.bottom > second.top + 0.5;
    const labels: DOMRect[] = [];
    const summary = document.querySelector('[data-testid="board-flow-summary"]');
    if (summary) labels.push(summary.getBoundingClientRect());
    const reviewLane = summary?.querySelector('[data-lane="review"]');
    if (reviewLane) labels.push(reviewLane.getBoundingClientRect());
    const attention = document.querySelector('[data-testid="attention-pause"]');
    if (attention && Number(getComputedStyle(attention).opacity) > 0.08) {
      for (const part of attention.querySelectorAll('.juicy-attention-label, strong, small')) {
        labels.push(part.getBoundingClientRect());
      }
    }
    for (const pop of [...document.querySelectorAll('.point-pop')].filter(
      (element) => Number(getComputedStyle(element).opacity) > 0.08,
    )) {
      const rect = pop.getBoundingClientRect();
      for (let index = 0; index < labels.length; index += 1) {
        if (intersects(rect, labels[index]!)) {
          return `pop ${pop.textContent} がラベル帯 index=${index} と重なる`;
        }
      }
    }
    return null;
  });
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}px: Review Hell 中に得点ポップと盤面ラベルが重ならない（#1025）`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await beginPublicSprint(page, { seed: 'qa-seed-1031', difficulty: 'easy', renderer: 'pixi' });
    await page.evaluate(() => document.fonts.ready);

    await advanceCurrentSprintToReviewQueue(page, 12);
    await expect(page.getByTestId('jam-alert')).toContainText('Review Hell');
    await expect(page.getByTestId('board')).toHaveAttribute('data-review-hell', 'true');

    const initialBoardY = await boardY(page);
    const failures = new Set<string>();
    let sawPop = false;
    let popSamples = 0;

    for (let tick = 0; tick < 600; tick += 1) {
      await page.evaluate(() => (window as PublicGameWindow).game!.step(100));
      await awaitPaint(page);
      const stillHell = await page.getByTestId('board').getAttribute('data-review-hell');
      if (stillHell !== 'true') break;
      const overlap = await sampleOverlap(page);
      if (overlap) failures.add(overlap);
      if (Math.abs((await boardY(page)) - initialBoardY) > 0.5) {
        failures.add('盤面が動いた');
      }
      const visiblePops = await page.locator('.point-pop').count();
      if (visiblePops > 0) {
        sawPop = true;
        popSamples += 1;
      }
      if (popSamples >= 12) break;
    }

    expect(sawPop, 'Review Hell 中に得点ポップを観測できなかった').toBe(true);
    expect([...failures]).toEqual([]);
  });
}
