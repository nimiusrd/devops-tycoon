/**
 * ドラフトの取得ボタン配置 (#1009)。
 * 主要 viewport で取得 CTA が二次操作と重ならず、スクロールなしで画面内に収まることを矩形で固定する。
 */
import { expect, test } from './fixtures';
import {
  advanceCurrentResultToDraft,
  advanceCurrentSprintToResult,
  beginPublicSprint,
} from './fixtures';
import type { Page } from '@playwright/test';

const DRAFT_VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop-1280', width: 1280, height: 800 },
] as const;

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

async function readBoxes(page: Page, testIds: string[]): Promise<Record<string, Box>> {
  return page.evaluate((ids) => {
    const out: Record<string, Box> = {};
    for (const id of ids) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) throw new Error(`${id} が見つからない`);
      const rect = el.getBoundingClientRect();
      out[id] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return out;
  }, testIds);
}

for (const viewport of DRAFT_VIEWPORTS) {
  test(`ドラフト取得CTAは重ならず初見で画面内（${viewport.name}）`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await beginPublicSprint(page, { seed: 'qa-993' });
    await advanceCurrentSprintToResult(page);
    const state = await advanceCurrentResultToDraft(page);
    const cardIds = state.draft ?? [];
    expect(cardIds.length).toBe(3);

    await page.getByTestId('overlay-scroll').evaluate((el) => {
      el.scrollTop = 0;
    });

    const scrollMetrics = await page.evaluate(() => {
      const scroll = document.querySelector('[data-testid="overlay-scroll"]')!;
      return {
        scrollTop: (scroll as HTMLElement).scrollTop,
        canScroll: scroll.scrollHeight > scroll.clientHeight + 1,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      };
    });
    expect(scrollMetrics.scrollTop).toBe(0);
    expect(scrollMetrics.canScroll, `${viewport.name} で枠内スクロールが必要`).toBe(false);

    const pickIds = cardIds.map((id) => `draft-card-${id}`);
    const footerIds = ['draft-mulligan', 'draft-skip'];
    const boxes = await readBoxes(page, [...pickIds, ...footerIds]);

    for (const id of footerIds) {
      expect(boxes[id]!.height, `${id} のタップ領域`).toBeGreaterThanOrEqual(44);
    }
    for (const id of pickIds) {
      expect(boxes[id]!.height, `${id} のタップ領域`).toBeGreaterThanOrEqual(44);
    }

    for (const pick of pickIds) {
      const box = boxes[pick]!;
      expect(box.y, `${pick} の上端`).toBeGreaterThanOrEqual(-1);
      expect(box.y + box.height, `${pick} の下端`).toBeLessThanOrEqual(
        scrollMetrics.viewport.height + 1,
      );
      for (const footer of footerIds) {
        expect(overlaps(box, boxes[footer]!), `${pick} と ${footer} が重なる`).toBe(false);
      }
    }

    for (let i = 0; i < footerIds.length; i += 1) {
      for (let j = i + 1; j < footerIds.length; j += 1) {
        expect(
          overlaps(boxes[footerIds[i]!]!, boxes[footerIds[j]!]!),
          `${footerIds[i]} と ${footerIds[j]} が重なる`,
        ).toBe(false);
      }
    }
  });
}
