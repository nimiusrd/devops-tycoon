/**
 * 狭い状態枠で COMBO が出ても盤面がずれない（#967）。
 *
 * コンボ 2 未満はバッジが空で、×2 で中身が入る。560px 以下ではその差分が
 * 行になって盤面を押し下げないこと、見える文字が「×N N.Nx」で切れないこと、
 * 炎上バーの半分以上が残ること、広い幅では従来どおりインラインのままであることを見る。
 */
import type { Page } from '@playwright/test';
import { advanceCurrentSprintToReviewQueue, beginPublicSprint, expect, test } from './fixtures';

const PHONE_VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'phone-412', width: 412, height: 915 },
  { name: 'phone-430', width: 430, height: 932 },
] as const;

const WIDE_VIEWPORTS = [
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

/** コンボ行が増えたときの状態枠（約 145px）より明らかに低い上限。 */
const RESTING_STATUS_MAX_PX = 124;
/**
 * コンボ前の状態枠。空のバッジは行にしないので、課題で見た 118px より
 * 空行の分だけ低い。ここからコンボが出ても動かないこと。
 */
const RESTING_STATUS_PX = 113.4;
const RESTING_STATUS_TOLERANCE_PX = 2;

type Box = { x: number; y: number; width: number; height: number; fontSize: number };

interface LayoutSnapshot {
  scrollY: number;
  layoutScroll: number;
  board: Box;
  status: Box;
  fire: Box;
  speed: Box;
  ticker: Box;
  kind: Box;
  comboPosition: string;
  innerPosition: string | null;
  texts: Array<Box & { text: string; kind: string }>;
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width - 0.5 &&
    a.x + a.width > b.x + 0.5 &&
    a.y < b.y + b.height - 0.5 &&
    a.y + a.height > b.y + 0.5
  );
}

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
  const badge = page.getByTestId('combo');
  if (combo >= 2) await expect(badge).toContainText(`COMBO ×${combo}`);
  else await expect(badge).not.toContainText('COMBO');
}

async function readLayout(page: Page): Promise<LayoutSnapshot> {
  return page.evaluate(() => {
    const boxOf = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        fontSize: Number.parseFloat(style.fontSize),
      };
    };
    const required = (testId: string) => {
      const box = boxOf(document.querySelector(`[data-testid="${testId}"]`));
      if (!box) throw new Error(`${testId} が無い`);
      return box;
    };
    const subbar = document.querySelector('[data-testid="sprint-subbar"]');
    if (!subbar) throw new Error('sprint-subbar が無い');
    const texts = [
      ...subbar.querySelectorAll('.meter-label, .meter-count, .combo-x, .combo-mult'),
    ].map((element) => {
      const box = boxOf(element);
      if (!box) throw new Error('メーター文字の box が無い');
      return {
        ...box,
        text: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
        kind: element.className,
      };
    });
    const combo = document.querySelector('[data-testid="combo"]');
    const inner = document.querySelector('.combo-inner');
    if (!combo) throw new Error('combo が無い');
    return {
      scrollY: window.scrollY,
      layoutScroll:
        document.querySelector<HTMLElement>('[data-testid="sprint-layout"]')?.scrollTop ?? 0,
      board: required('board-stage'),
      status: required('sprint-slot-status'),
      fire: required('fire-meter'),
      speed: required('speed-controls'),
      ticker: required('event-ticker'),
      kind: required('sprint-kind'),
      comboPosition: getComputedStyle(combo).position,
      innerPosition: inner ? getComputedStyle(inner).position : null,
      texts,
    };
  });
}

function badgeTexts(layout: LayoutSnapshot): Array<Box & { text: string }> {
  return layout.texts.filter((item) => item.kind.includes('combo'));
}

function meterTexts(layout: LayoutSnapshot): Array<Box & { text: string }> {
  return layout.texts.filter((item) => !item.kind.includes('combo'));
}

test.describe('電話幅では COMBO が盤面を押し下げない（#967）', () => {
  test.use({ hasTouch: true, reducedMotion: 'reduce' });

  for (const viewport of PHONE_VIEWPORTS) {
    test(`${viewport.name}: 出現・更新・途切れで盤面が 0px`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await beginPublicSprint(page, { seed: `combo-layout-${viewport.width}`, renderer: 'pixi' });
      await page.evaluate(() => document.fonts.ready);

      const initial = await readLayout(page);
      expect(initial.scrollY, '初期 scrollY').toBe(0);
      expect(initial.layoutScroll, '初期の枠内スクロール').toBe(0);
      expect(
        Math.abs(initial.status.height - RESTING_STATUS_PX),
        'コンボ前の状態枠',
      ).toBeLessThanOrEqual(RESTING_STATUS_TOLERANCE_PX);
      expect(initial.status.height).toBeLessThan(RESTING_STATUS_MAX_PX);

      for (const combo of [2, 3, 12, 0]) {
        await setLiveCombo(page, combo);
        const layout = await readLayout(page);
        expect(Math.abs(layout.board.y - initial.board.y), `combo ${combo} の盤面 y`).toBeLessThan(
          0.5,
        );
        expect(
          Math.abs(layout.status.height - initial.status.height),
          `combo ${combo} の状態枠の高さ`,
        ).toBeLessThan(0.5);
        expect(layout.scrollY, `combo ${combo} の scrollY`).toBe(0);
        expect(layout.layoutScroll, `combo ${combo} の枠内スクロール`).toBe(0);
        expect(layout.board.height, `combo ${combo} の盤面の高さ`).toBeCloseTo(
          initial.board.height,
          0,
        );

        const badges = badgeTexts(layout);
        if (combo < 2) {
          expect(badges, '途切れ後のバッジ').toEqual([]);
          continue;
        }

        expect(layout.innerPosition, '電話幅のバッジはバーに重なる').toBe('absolute');
        expect(badges.map((item) => item.text).join(' ')).toContain(`×${combo}`);
        const shortText = (await page.locator('.combo-label-short').allTextContents()).map((text) =>
          text.trim(),
        );
        expect(shortText[0]).toBe(`×${combo}`);
        expect(shortText[1]).toMatch(/^\d+\.\dx$/);
        expect(shortText.join('')).not.toContain('COMBO');
        expect(shortText.join('')).not.toContain('出荷倍率');
        const cover = await page.evaluate(() => {
          const fire = document.querySelector('[data-testid="fire-meter"]');
          const inner = document.querySelector('.combo-inner');
          if (!(fire instanceof HTMLElement) || !(inner instanceof HTMLElement)) {
            throw new Error('炎上バーかバッジが無い');
          }
          const fireBox = fire.getBoundingClientRect();
          const innerBox = inner.getBoundingClientRect();
          const overlap = Math.max(
            0,
            Math.min(innerBox.right, fireBox.right) - Math.max(innerBox.left, fireBox.left),
          );
          return { fire: fireBox.width, visible: fireBox.width - overlap };
        });
        expect(cover.visible, '炎上バーの半分以上が見える').toBeGreaterThanOrEqual(
          cover.fire / 2 - 0.5,
        );
        const badgeTop = Math.min(...badges.map((badge) => badge.y));
        const badgeBottom = Math.max(...badges.map((badge) => badge.y + badge.height));
        expect(badgeBottom, 'バッジが炎上バーより上だけに出る').toBeGreaterThan(layout.fire.y);
        expect(badgeTop, 'バッジが炎上バーより下だけに出る').toBeLessThan(
          layout.fire.y + layout.fire.height,
        );
        for (const badge of badges) {
          expect(badge.fontSize, badge.text).toBeGreaterThanOrEqual(11);
          for (const meter of meterTexts(layout)) {
            expect(overlaps(badge, meter), `${badge.text} が「${meter.text}」に重なる`).toBe(false);
          }
          for (const target of [
            ['速度', layout.speed],
            ['出来事', layout.ticker],
            ['スプリント種別', layout.kind],
          ] as const) {
            expect(overlaps(badge, target[1]), `${badge.text} が${target[0]}に重なる`).toBe(false);
          }
        }
        expect(
          Math.abs(layout.fire.y + layout.fire.height - badgeBottom),
          'バッジの下端が炎上バーの下端',
        ).toBeLessThan(4);
        const clipped = await page
          .locator('.combo-inner')
          .evaluate((element) => element.scrollWidth > element.clientWidth + 1);
        expect(clipped, 'バッジの文字が切れている').toBe(false);

        if (combo === 2) {
          await page.screenshot({
            path: `/opt/cursor/artifacts/combo-${viewport.width}-x2.png`,
            fullPage: true,
          });
        }
      }

      await page.screenshot({
        path: `/opt/cursor/artifacts/combo-${viewport.width}-break.png`,
        fullPage: true,
      });

      await advanceCurrentSprintToReviewQueue(page, 12);
      await page.evaluate(() => {
        const game = (
          window as unknown as {
            game?: {
              pause: () => void;
              step: (ms: number) => void;
              engine: {
                sprint: {
                  tasks: Array<{ lane: string; incident?: boolean; burnTicksLeft?: number }>;
                } | null;
              };
            };
          }
        ).game;
        const sprint = game?.engine.sprint;
        if (!game || !sprint) throw new Error('sprint が無い');
        const task = sprint.tasks.find((item) => item.lane !== 'review') ?? sprint.tasks[0];
        if (!task) throw new Error('task が無い');
        task.lane = 'rework';
        task.incident = true;
        task.burnTicksLeft = 20;
        game.pause();
        game.step(0);
      });
      await setLiveCombo(page, 0);
      await expect(page.getByTestId('jam-alert')).toBeVisible();
      await expect(page.getByTestId('fire-count')).toContainText('炎上');
      const crowded = await readLayout(page);
      await setLiveCombo(page, 4);
      const withCombo = await readLayout(page);
      expect(Math.abs(withCombo.board.y - crowded.board.y), '渋滞中の盤面 y').toBeLessThan(0.5);
      expect(
        Math.abs(withCombo.status.height - crowded.status.height),
        '渋滞中の状態枠',
      ).toBeLessThan(0.5);
      const alert = await page.getByTestId('jam-alert').boundingBox();
      if (!alert) throw new Error('jam-alert の box が無い');
      for (const badge of badgeTexts(withCombo)) {
        expect(
          overlaps(badge, { ...alert, fontSize: 0 }),
          `${badge.text} が Review Hell に重なる`,
        ).toBe(false);
        for (const meter of meterTexts(withCombo)) {
          expect(overlaps(badge, meter), `${badge.text} が「${meter.text}」に重なる`).toBe(false);
        }
        expect(badge.fontSize, badge.text).toBeGreaterThanOrEqual(11);
      }
      const crowdedCover = await page.evaluate(() => {
        const fire = document.querySelector('[data-testid="fire-meter"]');
        const inner = document.querySelector('.combo-inner');
        if (!(fire instanceof HTMLElement) || !(inner instanceof HTMLElement)) {
          throw new Error('炎上バーかバッジが無い');
        }
        const fireBox = fire.getBoundingClientRect();
        const innerBox = inner.getBoundingClientRect();
        const overlap = Math.max(
          0,
          Math.min(innerBox.right, fireBox.right) - Math.max(innerBox.left, fireBox.left),
        );
        return fireBox.width - overlap >= fireBox.width / 2 - 0.5;
      });
      expect(crowdedCover, '渋滞・炎上中も炎上バーの半分以上が見える').toBe(true);
    });
  }
});

test.describe('広い幅の COMBO はインラインのまま（#967）', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const viewport of WIDE_VIEWPORTS) {
    test(`${viewport.name}: 出現と途切れで盤面が動かず、流れに残る`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await beginPublicSprint(page, { seed: `combo-layout-wide-${viewport.width}` });
      const initial = await readLayout(page);
      await setLiveCombo(page, 2);
      const shown = await readLayout(page);
      await setLiveCombo(page, 0);
      const hidden = await readLayout(page);

      expect(Math.abs(shown.board.y - initial.board.y)).toBeLessThan(0.5);
      expect(Math.abs(hidden.board.y - initial.board.y)).toBeLessThan(0.5);
      expect(Math.abs(shown.status.height - initial.status.height)).toBeLessThan(0.5);
      expect(shown.comboPosition).toBe('static');
      expect(shown.innerPosition).toBe('static');
      for (const badge of badgeTexts(shown)) {
        expect(badge.fontSize, badge.text).toBeGreaterThanOrEqual(11);
      }
    });
  }
});
