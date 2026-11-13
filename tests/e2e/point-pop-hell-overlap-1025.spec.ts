/**
 * #1025: Review Hell 中も得点ポップが盤面ラベル（工程要約・注意オーバーレイ）と矩形重ならない。
 */
import { advanceCurrentSprintToReviewQueue, beginPublicSprint, expect, test } from './fixtures';
import type { PublicGameWindow } from './fixtures';

const VIEWPORTS = [
  { name: '320', width: 320, height: 568 },
  { name: '390', width: 390, height: 844 },
  { name: '1024', width: 1024, height: 768 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}px: Review Hell 中に得点ポップと盤面ラベルが重ならない（#1025）`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await beginPublicSprint(page, { seed: 'qa-seed-1031', difficulty: 'easy', renderer: 'pixi' });
    await page.evaluate(() => document.fonts.ready);

    await advanceCurrentSprintToReviewQueue(page, 12);
    await expect(page.getByTestId('jam-alert')).toContainText('Review Hell');
    await expect(page.getByTestId('board')).toHaveAttribute('data-review-hell', 'true');

    const result = await page.evaluate(() => {
      const game = (window as PublicGameWindow).game;
      if (!game) throw new Error('game が無い');
      const failures = new Set<string>();
      const boardStage = document.querySelector('[data-testid="board-stage"]');
      if (!boardStage) throw new Error('board-stage が無い');
      const initialBoardY = boardStage.getBoundingClientRect().y;
      const intersects = (first: DOMRect, second: DOMRect) =>
        first.left < second.right - 0.5 &&
        first.right > second.left + 0.5 &&
        first.top < second.bottom - 0.5 &&
        first.bottom > second.top + 0.5;
      const sampleOverlap = (): string | null => {
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
      };
      let sawPop = false;
      let popSamples = 0;
      for (let tick = 0; tick < 2_000; tick += 1) {
        game.step(100);
        const board = document.querySelector('[data-testid="board"]');
        if (board?.getAttribute('data-review-hell') !== 'true') break;
        const overlap = sampleOverlap();
        if (overlap) failures.add(overlap);
        const boardY = boardStage.getBoundingClientRect().y;
        if (Math.abs(boardY - initialBoardY) > 0.5) {
          failures.add(`盤面が ${Math.abs(boardY - initialBoardY)}px 動いた`);
        }
        if (document.querySelectorAll('.point-pop').length > 0) {
          sawPop = true;
          popSamples += 1;
        }
        if (popSamples >= 12) break;
      }
      return { failures: [...failures], sawPop };
    });

    expect(result.sawPop, 'Review Hell 中に得点ポップを観測できなかった').toBe(true);
    expect(result.failures).toEqual([]);
  });
}
