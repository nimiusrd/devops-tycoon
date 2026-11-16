/**
 * #1023: 1024 幅で qa-seed-1031 スプリント1中、盤面の y / 高さがフレーム間で動かない。
 */
import { beginPublicSprint, expect, test } from './fixtures';
import type { PublicGameWindow } from './fixtures';

test.describe('1024 幅のスプリント中、盤面がフレーム間で動かない（#1023）', () => {
  test.use({ reducedMotion: 'reduce' });

  test('qa-seed-1031 スプリント1: 毎 tick の描画後に盤面 y / 高さが 0.5px 未満', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1024, height: 768 });
    await beginPublicSprint(page, { seed: 'qa-seed-1031', difficulty: 'easy', renderer: 'pixi' });
    // 毎stepのRunState返却とブラウザへの往復を避け、描画と測定は同じ順序で続ける。
    const { baseline, samples } = await page.evaluate(async () => {
      const game = (window as PublicGameWindow).game;
      if (!game) throw new Error('window.game が公開されていない');
      const boardBox = (): { y: number; height: number } => {
        const board = document.querySelector('[data-testid="board-stage"]');
        if (!board) throw new Error('board-stage が無い');
        const rect = board.getBoundingClientRect();
        return { y: rect.y, height: rect.height };
      };
      const awaitPaint = (): Promise<void> =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });

      await document.fonts.ready;
      await awaitPaint();
      const baseline = boardBox();
      const samples: { y: number; height: number }[] = [];
      for (let step = 0; step < 55; step += 1) {
        game.step(100);
        await awaitPaint();
        samples.push(boardBox());
      }
      return { baseline, samples };
    });
    const failures = samples.flatMap((sample, frame) => {
      const dy = Math.abs(sample.y - baseline.y);
      const dh = Math.abs(sample.height - baseline.height);
      return dy >= 0.5 || dh >= 0.5
        ? [
            `frame=${frame} y=${sample.y.toFixed(2)} (Δ${dy.toFixed(2)}) height=${sample.height.toFixed(2)} (Δ${dh.toFixed(2)})`,
          ]
        : [];
    });

    expect(samples).toHaveLength(55);
    expect(failures, failures.join('\n')).toEqual([]);
  });
});
