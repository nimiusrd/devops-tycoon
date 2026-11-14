/**
 * #1011: 残り12件で HUD 文言が切り替わり、チップ幅と盤面が動かない。
 */
import type { Page } from '@playwright/test';
import { REVIEW_FREEZE_PEAK } from '../../src/sim/outcome';
import { beginPublicSprint, expect, test, type PublicGameWindow } from './fixtures';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'desktop-short', width: 1024, height: 768 },
] as const;

async function boardY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const board = document.querySelector('[data-testid="board-stage"]');
    if (!board) throw new Error('board-stage が無い');
    return board.getBoundingClientRect().y;
  });
}

async function publish(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('game が無い');
    game.pause();
    game.step(0);
  });
}

async function setLiveReviewQueue(page: Page, count: number): Promise<void> {
  await page.evaluate((target) => {
    const game = (
      window as PublicGameWindow & {
        game?: {
          engine: {
            sprint: {
              tasks: Array<{ id: number; lane: string; incident?: boolean; split?: boolean }>;
            } | null;
          };
        };
      }
    ).game;
    const sprint = game?.engine.sprint;
    if (!sprint) throw new Error('sprint が無い');
    const sample = sprint.tasks.find((task) => !task.incident && !task.split) ?? sprint.tasks[0];
    if (!sample) throw new Error('複製元の task が無い');
    const nextId = Math.max(...sprint.tasks.map((task) => task.id)) + 1;
    const kept = sprint.tasks.filter((task) => task.lane !== 'review');
    const reviewTasks = Array.from({ length: target }, (_, index) => ({
      ...sample,
      id: nextId + index,
      lane: 'review' as const,
      incident: false,
      split: false,
    }));
    sprint.tasks = [...kept, ...reviewTasks];
  }, count);
  await publish(page);
}

interface ReviewMetricLayout {
  width: number;
  detailMinHeight: number;
  detailFontVariant: string;
  tone: string | null;
}

async function readReviewMetric(page: Page): Promise<ReviewMetricLayout> {
  return page.evaluate(() => {
    const stat = document.querySelector('[data-testid="hud-reviewCapacity"]');
    if (!(stat instanceof HTMLElement)) throw new Error('レビュー耐性 KPI が無い');
    const detail = stat.querySelector('.stat-detail');
    const detailStyle =
      detail instanceof HTMLElement
        ? getComputedStyle(detail)
        : (null as CSSStyleDeclaration | null);
    return {
      width: stat.getBoundingClientRect().width,
      detailMinHeight: Number.parseFloat(detailStyle?.minHeight ?? '0'),
      detailFontVariant: detailStyle?.fontVariantNumeric ?? '',
      tone: stat.getAttribute('data-tone'),
    };
  });
}

interface CompactChipLayout {
  width: number;
  fontVariant: string;
}

async function readCompactReviewChip(page: Page): Promise<CompactChipLayout> {
  return page.evaluate(() => {
    const chip = document.querySelector('[data-testid="hud-compact-reviewCapacity"]');
    if (!(chip instanceof HTMLElement)) throw new Error('レビュー耐性チップが無い');
    const value = chip.querySelector('.hud-compact-chip-value');
    const valueStyle =
      value instanceof HTMLElement ? getComputedStyle(value) : (null as CSSStyleDeclaration | null);
    return {
      width: chip.getBoundingClientRect().width,
      fontVariant: valueStyle?.fontVariantNumeric ?? '',
    };
  });
}

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.width}px: レビュー待ち HUD（#1011）`, () => {
    test.use({ reducedMotion: 'reduce' });

    test('残り12件で表示が切り替わり、チップ幅と盤面が動かない', async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await beginPublicSprint(page, { seed: `review-queue-hud-1011-${viewport.width}` });
      await page.evaluate(() => document.fonts.ready);
      await page.getByTestId('hud-toggle').click();
      await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'false');

      const baselineBoardY = await boardY(page);

      await setLiveReviewQueue(page, 35);
      await expect(page.getByTestId('count-review')).toHaveText('35');
      await expect(page.getByTestId('review-freeze-warning')).toHaveCount(0);
      await expect(page.getByTestId('hud-reviewCapacity')).toContainText(
        `レビュー待ち 35 / ${REVIEW_FREEZE_PEAK}`,
      );
      const at35 = await readReviewMetric(page);
      expect(at35.detailMinHeight).toBeGreaterThanOrEqual(13);

      await setLiveReviewQueue(page, 36);
      await expect(page.getByTestId('count-review')).toHaveText('36');
      await expect(page.getByTestId('review-freeze-warning')).toBeVisible();
      await expect(page.getByTestId('review-freeze-warning')).toContainText('レビュー凍結注意');
      await expect(page.getByTestId('hud-reviewCapacity')).toContainText(
        'あと 12 件でレビュー凍結',
      );
      await expect(page.getByTestId('hud-reviewCapacity')).toHaveAttribute('data-tone', 'danger');
      const at36 = await readReviewMetric(page);
      expect(Math.abs(at36.width - at35.width)).toBeLessThanOrEqual(0.5);
      expect(Math.abs((await boardY(page)) - baselineBoardY)).toBeLessThan(0.5);

      await page.getByTestId('hud-toggle').click();
      await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'true');
      const compactAt36 = await readCompactReviewChip(page);
      expect(compactAt36.fontVariant).toContain('tabular-nums');

      await setLiveReviewQueue(page, 47);
      await expect(page.getByTestId('hud-reviewCapacity')).toHaveCount(0);
      const compactAt47 = await readCompactReviewChip(page);
      expect(Math.abs(compactAt47.width - compactAt36.width)).toBeLessThanOrEqual(0.5);
    });
  });
}
