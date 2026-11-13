/**
 * 速度ボタン（⏸ / 1x / 2x）のタップ領域を 44×44px 以上に保つ（#1004）。
 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test } from './fixtures';
import { VISUAL_TOKENS } from '../../src/render/visualTokens';
import { speedControlButtonHitRect, type CssRect } from '../../src/ui/speedControlHitTarget';

const WIDTHS = [320, 390, 1024] as const;
const SPEED_BUTTONS = ['speed-pause', 'speed-1x', 'speed-2x'] as const;
const MIN_TOUCH = VISUAL_TOKENS.dimensions.interaction.minTouchTargetCss;

function overlaps(a: CssRect, b: CssRect): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    a.x + a.width > b.x + 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    a.y + a.height > b.y + 0.5
  );
}

function channel(value: number): number {
  const unit = value / 255;
  return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
}

function contrast(foreground: string, background: string): number {
  const parse = (color: string) => {
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) throw new Error(`色を読めない: ${color}`);
    return [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  };
  const luminance = (rgb: readonly [number, number, number]) =>
    0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  const lighter = Math.max(luminance(parse(foreground)), luminance(parse(background)));
  const darker = Math.min(luminance(parse(foreground)), luminance(parse(background)));
  return (lighter + 0.05) / (darker + 0.05);
}

async function boardY(page: Page): Promise<number> {
  return page.evaluate(() => {
    const board = document.querySelector('[data-testid="board-stage"]');
    if (!board) throw new Error('board-stage が無い');
    return board.getBoundingClientRect().y;
  });
}

async function readSpeedButtonHits(page: Page): Promise<CssRect[]> {
  return page.evaluate(
    (ids) => {
      return ids.map((id) => {
        const button = document.querySelector(`[data-testid="${id}"]`);
        if (!(button instanceof HTMLButtonElement)) throw new Error(`${id} が無い`);
        const layout = button.getBoundingClientRect();
        const touch = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            '--visual-interaction-min-touch-target',
          ),
        );
        const size = Number.isFinite(touch) && touch > 0 ? touch : 44;
        const width = Math.max(layout.width, size);
        const height = Math.max(layout.height, size);
        return {
          x: layout.left + layout.width / 2 - width / 2,
          y: layout.top + layout.height / 2 - height / 2,
          width,
          height,
        };
      });
    },
    [...SPEED_BUTTONS],
  );
}

test.describe('速度ボタンのタップ領域（#1004）', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const width of WIDTHS) {
    test(`幅 ${width}: 各ボタンが ${MIN_TOUCH}px 以上で隣と重ならない`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1024 ? 768 : 844 });
      await beginPublicSprint(page, { seed: `speed-hit-${width}` });
      await page.evaluate(() => document.fonts.ready);

      const initialBoardY = await boardY(page);
      const speedControlsHeight = await page
        .getByTestId('speed-controls')
        .evaluate((el) => el.getBoundingClientRect().height);

      const hits = await readSpeedButtonHits(page);
      for (const hit of hits) {
        expect(hit.width, 'ヒット幅').toBeGreaterThanOrEqual(MIN_TOUCH);
        expect(hit.height, 'ヒット高さ').toBeGreaterThanOrEqual(MIN_TOUCH);
      }
      for (let i = 0; i < hits.length; i += 1) {
        for (let j = i + 1; j < hits.length; j += 1) {
          expect(overlaps(hits[i]!, hits[j]!), `${i} と ${j} のヒット重なり`).toBe(false);
        }
      }

      const presentation = await page.evaluate(() => {
        const controls = document.querySelector('[data-testid="speed-controls"]');
        const active = document.querySelector('[data-testid="speed-controls"] .speed-btn.active');
        if (!(controls instanceof HTMLElement) || !(active instanceof HTMLButtonElement)) {
          throw new Error('速度コントロールが無い');
        }
        const controlBg = getComputedStyle(controls).backgroundColor;
        const activeBg = getComputedStyle(active).backgroundColor;
        const fontSize = Number.parseFloat(getComputedStyle(active).fontSize);
        return {
          controlBg,
          activeBg,
          fontSize,
          ariaPressed: active.getAttribute('aria-pressed'),
        };
      });
      expect(presentation.ariaPressed, 'aria-pressed').toBe('true');
      expect(presentation.fontSize, 'フォントサイズ').toBeGreaterThanOrEqual(11);
      expect(
        contrast(presentation.activeBg, presentation.controlBg),
        '選択中とグループ背景',
      ).toBeGreaterThanOrEqual(3);

      for (let i = 0; i < SPEED_BUTTONS.length; i += 1) {
        const layout = await page.getByTestId(SPEED_BUTTONS[i]!).boundingBox();
        if (!layout) throw new Error(`${SPEED_BUTTONS[i]} の箱が無い`);
        const expected = speedControlButtonHitRect(layout as DOMRect);
        expect(Math.abs(expected.width - hits[i]!.width)).toBeLessThan(0.5);
        expect(Math.abs(expected.height - hits[i]!.height)).toBeLessThan(0.5);
        expect(Math.abs(expected.x - hits[i]!.x)).toBeLessThan(0.5);
        expect(Math.abs(expected.y - hits[i]!.y)).toBeLessThan(0.5);
      }

      expect(speedControlsHeight, '速度コントロールの見た目の高さ').toBeLessThanOrEqual(34);
      expect(Math.abs((await boardY(page)) - initialBoardY), '盤面 Y').toBeLessThan(0.5);
    });
  }

  test('WebKit 320: 中心から 20px 外側をタップして速度が切り替わる', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'webkit', 'WebKit 専用');
    await page.setViewportSize({ width: 320, height: 568 });
    await beginPublicSprint(page, { seed: 'speed-hit-webkit-320' });
    await page.evaluate(() => document.fonts.ready);

    const tapOffset = async (testId: (typeof SPEED_BUTTONS)[number], dx: number, dy: number) => {
      const box = await page.getByTestId(testId).boundingBox();
      if (!box) throw new Error(`${testId} の箱が無い`);
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      await page.mouse.click(centerX + dx, centerY + dy);
    };

    await expect(page.getByTestId('speed-1x')).toHaveAttribute('aria-pressed', 'true');
    await tapOffset('speed-pause', 20, 0);
    await expect(page.getByTestId('speed-pause')).toHaveAttribute('aria-pressed', 'true');
    await tapOffset('speed-2x', 0, 20);
    await expect(page.getByTestId('speed-2x')).toHaveAttribute('aria-pressed', 'true');
    await tapOffset('speed-1x', -20, 0);
    await expect(page.getByTestId('speed-1x')).toHaveAttribute('aria-pressed', 'true');
  });
});
