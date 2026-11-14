/**
 * #1023: 1024 幅で qa-seed-1031 スプリント1中、盤面の y / 高さがフレーム間で動かない。
 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test } from './fixtures';
import type { PublicGameWindow } from './fixtures';

async function boardBox(page: Page): Promise<{ y: number; height: number }> {
  return page.evaluate(() => {
    const board = document.querySelector('[data-testid="board-stage"]');
    if (!board) throw new Error('board-stage が無い');
    const rect = board.getBoundingClientRect();
    return { y: rect.y, height: rect.height };
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

async function assertStableFrames(
  page: Page,
  baseline: { y: number; height: number },
  frames: number,
): Promise<string[]> {
  const failures: string[] = [];
  for (let frame = 0; frame < frames; frame += 1) {
    await awaitPaint(page);
    const sample = await boardBox(page);
    const dy = Math.abs(sample.y - baseline.y);
    const dh = Math.abs(sample.height - baseline.height);
    if (dy >= 0.5 || dh >= 0.5) {
      failures.push(
        `frame=${frame} y=${sample.y.toFixed(2)} (Δ${dy.toFixed(2)}) height=${sample.height.toFixed(2)} (Δ${dh.toFixed(2)})`,
      );
    }
  }
  return failures;
}

test.describe('1024 幅のスプリント中、盤面がフレーム間で動かない（#1023）', () => {
  test.use({ reducedMotion: 'reduce' });

  test('qa-seed-1031 スプリント1: 毎 tick の描画後に盤面 y / 高さが 0.5px 未満', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1024, height: 768 });
    await beginPublicSprint(page, { seed: 'qa-seed-1031', difficulty: 'easy', renderer: 'pixi' });
    await page.evaluate(() => document.fonts.ready);
    await awaitPaint(page);
    const baseline = await boardBox(page);
    const failures: string[] = [];

    for (let step = 0; step < 60; step += 1) {
      await page.evaluate(() => (window as PublicGameWindow).game!.step(100));
      failures.push(...(await assertStableFrames(page, baseline, 2)));
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
