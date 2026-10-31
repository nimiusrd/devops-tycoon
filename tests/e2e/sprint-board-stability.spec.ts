/**
 * Review Hell・出来事・KPI・炎上ラベルが出ても盤面が動かない（#975）。
 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test } from './fixtures';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-430', width: 430, height: 932 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop-1280', width: 1280, height: 800 },
] as const;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box): boolean {
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

async function publish(page: Page): Promise<void> {
  await page.evaluate(() => {
    const game = (
      window as unknown as {
        game?: { pause: () => void; step: (ms: number) => void };
      }
    ).game;
    if (!game) throw new Error('game が無い');
    game.pause();
    game.step(0);
  });
}

test.describe('スプリント中の表示の出し入れで盤面が動かない（#975）', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: 出来事・炎上・Review Hell・KPI で盤面が 0px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await beginPublicSprint(page, { seed: `board-stable-${viewport.width}` });
      await page.evaluate(() => document.fonts.ready);

      const initial = await boardY(page);
      const initialScroll = await page.evaluate(() => window.scrollY);
      expect(initialScroll).toBe(0);
      await expect(page.getByTestId('jam-alert')).toHaveCount(0);
      await expect(page.getByTestId('review-hell-announcement')).toHaveText('');

      await page.evaluate(() => {
        const game = (
          window as unknown as {
            game?: {
              engine: {
                sprint: {
                  tasks: Array<{ id: number }>;
                  events: Array<{
                    tick: number;
                    kind: 'ignite';
                    taskId: number;
                    source: 'review';
                  }>;
                } | null;
              };
            };
          }
        ).game;
        const sprint = game?.engine.sprint;
        const task = sprint?.tasks[0];
        if (!sprint || !task) throw new Error('sprint が無い');
        sprint.events.push({ tick: 1, kind: 'ignite', taskId: task.id, source: 'review' });
      });
      await publish(page);
      await expect(page.getByTestId('event-ticker-summary')).toContainText('点火');
      expect(Math.abs((await boardY(page)) - initial), '出来事の1件目').toBeLessThan(0.5);

      await page.evaluate(() => {
        const game = (
          window as unknown as {
            game?: {
              engine: {
                sprint: {
                  tasks: Array<{ lane: string; incident?: boolean; burnTicksLeft?: number }>;
                } | null;
              };
            };
          }
        ).game;
        const task = game?.engine.sprint?.tasks[0];
        if (!task) throw new Error('task が無い');
        task.lane = 'rework';
        task.incident = true;
        task.burnTicksLeft = 20;
      });
      await publish(page);
      await expect(page.getByTestId('fire-count')).toContainText('炎上 1');
      expect(Math.abs((await boardY(page)) - initial), '炎上 1').toBeLessThan(0.5);

      const chipsBefore = await page.evaluate(() =>
        [...document.querySelectorAll('.hud-compact-chip')].map((chip) => ({
          id: chip.getAttribute('data-testid'),
          width: chip.getBoundingClientRect().width,
        })),
      );
      await page.evaluate(() => {
        const game = (
          window as unknown as {
            game?: { engine: { org: { deliveryScore: number } } };
          }
        ).game;
        if (!game) throw new Error('game が無い');
        game.engine.org.deliveryScore = 999999;
      });
      await publish(page);
      await expect(page.getByTestId('hud-compact-delivery')).toContainText('999999');
      expect(Math.abs((await boardY(page)) - initial), 'KPI の桁').toBeLessThan(0.5);
      const chipsAfter = await page.evaluate(() =>
        [...document.querySelectorAll('.hud-compact-chip')].map((chip) => {
          const value = chip.querySelector('.hud-compact-chip-value');
          const label = chip.querySelector('.hud-compact-chip-label');
          if (!(value instanceof HTMLElement) || !(label instanceof HTMLElement)) {
            throw new Error('KPI チップの中身が無い');
          }
          const style = getComputedStyle(value);
          return {
            id: chip.getAttribute('data-testid'),
            width: chip.getBoundingClientRect().width,
            fontFamily: style.fontFamily,
            whiteSpace: style.whiteSpace,
            labelLines: label.getClientRects().length,
            valueLines: value.getClientRects().length,
          };
        }),
      );
      expect(chipsAfter.map((chip) => chip.id)).toEqual(chipsBefore.map((chip) => chip.id));
      for (const [index, chip] of chipsAfter.entries()) {
        expect(Math.abs(chip.width - chipsBefore[index].width), `${chip.id} の幅`).toBeLessThan(
          0.5,
        );
        expect(chip.fontFamily.toLowerCase(), `${chip.id} の数字`).toMatch(/mono/);
        expect(chip.whiteSpace, `${chip.id} の折返し`).toBe('nowrap');
        expect(chip.labelLines, `${chip.id} のラベル行`).toBe(1);
        expect(chip.valueLines, `${chip.id} の数字行`).toBe(1);
      }

      await page.evaluate(() => {
        const game = (
          window as unknown as {
            game?: {
              engine: {
                sprint: {
                  tasks: Array<{ id: number; lane: string; incident?: boolean }>;
                } | null;
              };
            };
          }
        ).game;
        const sprint = game?.engine.sprint;
        if (!sprint) throw new Error('sprint が無い');
        let nextId = Math.max(...sprint.tasks.map((task) => task.id)) + 1;
        const sample = sprint.tasks.find((task) => !task.incident) ?? sprint.tasks[0];
        if (!sample) throw new Error('複製元の task が無い');
        while (sprint.tasks.filter((task) => task.lane === 'review').length < 12) {
          sprint.tasks.push({ ...sample, id: nextId, lane: 'review', incident: false });
          nextId += 1;
        }
      });
      await publish(page);
      const alert = page.getByTestId('jam-alert');
      await expect(alert).toBeVisible();
      await expect(alert).toContainText('Review Hell');
      await expect(page.getByTestId('review-hell-announcement')).toHaveText('Review Hell に入った');
      expect(Math.abs((await boardY(page)) - initial), 'Review Hell に入った').toBeLessThan(0.5);

      const presentation = await page.evaluate(() => {
        const alertEl = document.querySelector('[data-testid="jam-alert"]');
        const meter = alertEl?.closest('.meter');
        if (!(alertEl instanceof HTMLElement) || !(meter instanceof HTMLElement)) {
          throw new Error('Review Hell 表示が無い');
        }
        const boxOf = (element: Element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        const style = getComputedStyle(alertEl);
        const jam = document.querySelector('[data-testid="jam-meter"]');
        const label = jam?.querySelector('.meter-label');
        const targets = [
          ['件数', document.querySelector('[data-testid="jam-count"]')],
          ['炎上件数', document.querySelector('[data-testid="fire-count"]')],
          ['ラベル', label],
          ['炎上ラベル', document.querySelector('.meter-wrap-fire .meter-label')],
          ['速度', document.querySelector('[data-testid="speed-controls"]')],
          ['出来事', document.querySelector('[data-testid="event-ticker"]')],
          ['炎上バー', document.querySelector('[data-testid="fire-meter"]')],
        ] as const;
        return {
          fontSize: Number.parseFloat(style.fontSize),
          color: style.color,
          background: style.backgroundColor,
          alert: boxOf(alertEl),
          meter: boxOf(meter),
          clipped: alertEl.scrollWidth > alertEl.clientWidth + 1,
          targets: targets.map(([name, element]) => {
            if (!element) throw new Error(`${name} が無い`);
            return { name, box: boxOf(element) };
          }),
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      });
      expect(presentation.fontSize, 'Review Hell の文字').toBeGreaterThanOrEqual(11);
      expect(presentation.clipped, 'Review Hell の文字が切れている').toBe(false);
      expect(presentation.alert.x).toBeGreaterThanOrEqual(presentation.meter.x - 0.5);
      expect(presentation.alert.x + presentation.alert.width).toBeLessThanOrEqual(
        presentation.meter.x + presentation.meter.width + 0.5,
      );
      expect(presentation.alert.y).toBeGreaterThanOrEqual(presentation.meter.y - 0.5);
      expect(presentation.alert.y + presentation.alert.height).toBeLessThanOrEqual(
        presentation.meter.y + presentation.meter.height + 0.5,
      );
      expect(
        contrast(presentation.color, presentation.background),
        'Review Hell のコントラスト',
      ).toBeGreaterThanOrEqual(3);
      for (const target of presentation.targets) {
        expect(
          overlaps(presentation.alert, target.box),
          `Review Hell が${target.name}に重なる`,
        ).toBe(false);
      }
      expect(presentation.scrollWidth, 'ページの横スクロール').toBeLessThanOrEqual(
        presentation.clientWidth + 1,
      );

      await page.evaluate(() => {
        const game = (
          window as unknown as {
            game?: { engine: { sprint: { tasks: Array<{ lane: string }> } | null } };
          }
        ).game;
        const tasks = game?.engine.sprint?.tasks;
        if (!tasks) throw new Error('sprint が無い');
        for (const task of tasks) {
          if (task.lane === 'review') task.lane = 'coding';
        }
      });
      await publish(page);
      await expect(page.getByTestId('jam-alert')).toHaveCount(0);
      await expect(page.getByTestId('review-hell-announcement')).toHaveText('Review Hell を出た');
      expect(Math.abs((await boardY(page)) - initial), 'Review Hell を出た').toBeLessThan(0.5);
      await publish(page);
      await expect(page.getByTestId('review-hell-announcement')).toHaveText('Review Hell を出た');

      if (viewport.width === 390) {
        await page.screenshot({
          path: '/opt/cursor/artifacts/board-stable-390-exit.png',
          fullPage: true,
        });
      }
    });
  }
});

test.describe('ボススプリントのラベル折り返しで盤面が動かない（#975）', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const viewport of VIEWPORTS) {
    test(`${viewport.name}: ボス条件が複数行でも Review Hell で盤面が 0px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await beginPublicSprint(page, { seed: `board-stable-boss-${viewport.width}` });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => {
        const game = (
          window as unknown as {
            game?: { engine: { currentSprintKind: string } };
          }
        ).game;
        if (!game) throw new Error('game が無い');
        game.engine.currentSprintKind = 'boss';
      });
      await publish(page);
      await expect(page.getByTestId('sprint-kind')).toContainText('ボス');
      await expect(page.locator('.boss-goal')).toBeVisible();
      const resting = await boardY(page);
      const goalBefore = await page.locator('.boss-goal').boundingBox();

      await page.evaluate(() => {
        const game = (
          window as unknown as {
            game?: {
              engine: {
                sprint: {
                  tasks: Array<{ id: number; lane: string; incident?: boolean }>;
                } | null;
              };
            };
          }
        ).game;
        const sprint = game?.engine.sprint;
        if (!sprint) throw new Error('sprint が無い');
        let nextId = Math.max(...sprint.tasks.map((task) => task.id)) + 1;
        const sample = sprint.tasks[0];
        if (!sample) throw new Error('task が無い');
        while (sprint.tasks.filter((task) => task.lane === 'review').length < 12) {
          sprint.tasks.push({ ...sample, id: nextId, lane: 'review', incident: false });
          nextId += 1;
        }
      });
      await publish(page);
      await expect(page.getByTestId('jam-alert')).toBeVisible();
      expect(Math.abs((await boardY(page)) - resting), 'ボス中の Review Hell').toBeLessThan(0.5);
      const goalAfter = await page.locator('.boss-goal').boundingBox();
      expect(goalBefore && goalAfter, 'ボス条件の箱').toBeTruthy();
      if (goalBefore && goalAfter) {
        expect(Math.abs(goalAfter.height - goalBefore.height), 'ボス条件の高さ').toBeLessThan(0.5);
        expect(Math.abs(goalAfter.y - goalBefore.y), 'ボス条件の位置').toBeLessThan(0.5);
      }

      if (viewport.width === 390) {
        const lines = await page.locator('.boss-goal').evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getClientRects().length;
        });
        expect(lines, '390 のボス条件').toBeGreaterThanOrEqual(1);
        await page.screenshot({
          path: '/opt/cursor/artifacts/board-stable-390-boss-hell.png',
          fullPage: true,
        });
      }
    });
  }
});
