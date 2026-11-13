/**
 * #1012: 320 / 390 で COMBO と出荷倍率のラベルが切れない。
 *
 * 短い日本語ラベル（コンボ・倍率）と値を省略せず表示し、
 * 各ラベル行の scrollWidth が clientWidth 以下であることを確認する。
 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test } from './fixtures';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

async function setLiveCombo(page: Page, combo: number): Promise<void> {
  await page.evaluate((next) => {
    const game = (
      window as unknown as {
        game?: {
          pause: () => void;
          step: (ms: number) => void;
          engine: { sprint: { metrics: { combo: number } } | null };
        };
      }
    ).game;
    if (!game?.engine.sprint) throw new Error('sprint が無い');
    game.pause();
    game.engine.sprint.metrics.combo = next;
    game.step(0);
  }, combo);
}

async function readBoardFrame(page: Page) {
  return page.evaluate(() => {
    const status = document.querySelector('[data-testid="sprint-slot-status"]');
    const board = document.querySelector('[data-testid="board-stage"]');
    if (!(status instanceof HTMLElement) || !(board instanceof HTMLElement)) {
      throw new Error('status か board が無い');
    }
    return {
      statusHeight: status.getBoundingClientRect().height,
      boardY: board.getBoundingClientRect().y,
    };
  });
}

async function readComboLabels(page: Page) {
  return page.evaluate(() => {
    const read = (selector: string, name: string) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLElement)) throw new Error(`${name} が無い`);
      const style = getComputedStyle(el);
      return {
        name,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        fontSize: Number.parseFloat(style.fontSize),
        fontVariantNumeric: style.fontVariantNumeric,
        text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
      };
    };
    return [
      read('.combo-x .combo-label-short', 'combo-x'),
      read('.combo-mult .combo-label-short', 'combo-mult'),
    ];
  });
}

test.describe('#1012 COMBO ラベル', () => {
  test.use({ hasTouch: true, reducedMotion: 'reduce' });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.width}px: ラベルと値が切れない`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await beginPublicSprint(page, { seed: 'qa-993', difficulty: 'easy', renderer: 'pixi' });
      await page.evaluate(() => document.fonts.ready);

      const baseline = await readBoardFrame(page);
      await setLiveCombo(page, 12);
      await expect(page.locator('.combo-x .combo-label-short')).toHaveText('コンボ×12');

      const frame = await readBoardFrame(page);
      const labels = await readComboLabels(page);
      expect(Math.abs(frame.boardY - baseline.boardY), '盤面の y ずれ').toBeLessThan(0.5);
      expect(Math.abs(frame.statusHeight - baseline.statusHeight), '状態枠の高さ').toBeLessThan(
        0.5,
      );

      const comboX = labels.find((item) => item.name === 'combo-x');
      const comboMult = labels.find((item) => item.name === 'combo-mult');
      expect(comboX?.text).toBe('コンボ×12');
      expect(comboMult?.text).toMatch(/^倍率\d+\.\dx$/);

      for (const label of labels) {
        expect(label.fontSize, label.name).toBeGreaterThanOrEqual(11);
        expect(label.fontVariantNumeric, label.name).toContain('tabular-nums');
        expect(label.scrollWidth, `${label.name} の scrollWidth`).toBeLessThanOrEqual(
          label.clientWidth + 1,
        );
      }

      await page.screenshot({
        path: `/opt/cursor/artifacts/combo-label-fit-${viewport.width}-1012.png`,
        fullPage: true,
      });
    });
  }
});
