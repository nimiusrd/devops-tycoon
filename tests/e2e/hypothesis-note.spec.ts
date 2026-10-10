import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';

type GameWindow = Window & {
  game?: {
    pause(): void;
    playCard(index: number): unknown;
    getState(): { seed: string; status: string };
  };
};

async function loseCurrentRun(page: Page) {
  await page.evaluate(() => {
    const g = (window as GameWindow).game!;
    g.pause();
    const engine = (g as unknown as { engine: unknown }).engine as {
      totals: { consecutiveIncidentSprints?: number };
      applyImmediateLose(): boolean;
    };
    engine.totals.consecutiveIncidentSprints = 6;
    engine.applyImmediateLose();
    g.playCard(-1);
  });
  await expect(page.getByTestId('run-result')).toBeVisible({ timeout: 5000 });
}

async function storedDraft(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('devops-tycoon');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (![...db.objectStoreNames].includes('hypothesisNote')) {
      db.close();
      return null;
    }
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db
        .transaction('hypothesisNote', 'readonly')
        .objectStore('hypothesisNote')
        .get('current');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return (value as { draft?: { text?: string } } | undefined)?.draft?.text ?? null;
  });
}

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`開始前の仮説を決着画面で見返し、振り返りを分けて残せる（${viewport.name}）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?seed=hypothesis-note-e2e&tutorial=off');
    await expect(page.getByTestId('title')).toBeVisible();
    const seedBefore = await page.getByTestId('seed').textContent();

    const input = page.getByTestId('hypothesis-note-input');
    await input.scrollIntoViewIfNeeded();
    await input.fill('採用より育成を優先し、<b>士気</b>を保って突破する');
    await expect(page.getByTestId('hypothesis-note-count')).toContainText('/120');
    await expect(page.getByTestId('seed')).toHaveText(seedBefore ?? '');

    await expect
      .poll(() => storedDraft(page))
      .toBe('採用より育成を優先し、<b>士気</b>を保って突破する');
    await page.reload();
    await expect(page.getByTestId('hypothesis-note-input')).toHaveValue(
      '採用より育成を優先し、<b>士気</b>を保って突破する',
    );

    await page
      .getByTestId('hypothesis-note')
      .screenshot({ path: test.info().outputPath(`hypothesis-title-${viewport.name}.png`) });
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('title')).not.toBeVisible();
    await loseCurrentRun(page);

    const review = page.getByTestId('hypothesis-review');
    await review.scrollIntoViewIfNeeded();
    await expect(page.getByTestId('hypothesis-before-start')).toHaveText(
      '採用より育成を優先し、<b>士気</b>を保って突破する',
    );
    await expect(review.locator('b')).toHaveCount(0);
    await expect(page.getByTestId('hypothesis-before-start-time')).toContainText(
      'ラン開始前に記入',
    );

    const reflection = page.getByTestId('hypothesis-reflection-input');
    await reflection.fill('育成は効いたが障害対応が遅れた');
    await expect(page.getByTestId('hypothesis-reflection-meta')).toContainText('更新');
    await expect(page.getByTestId('hypothesis-before-start')).toHaveText(
      '採用より育成を優先し、<b>士気</b>を保って突破する',
    );

    const docOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(docOverflow).toBeLessThanOrEqual(0);
    if (viewport.width !== 320) {
      await review.screenshot({
        path: test.info().outputPath(`hypothesis-review-${viewport.name}.png`),
      });
    }

    const json = page.getByTestId('diagnostic-json');
    expect(JSON.parse(await json.inputValue())).not.toHaveProperty('hypothesisNote');
    await page.getByTestId('diagnostic-include-note').check();
    const withNote = JSON.parse(await json.inputValue());
    expect(withNote.seed).toBe('hypothesis-note-e2e');
    expect(withNote.hypothesisNote.beforeStart.text).toBe(
      '採用より育成を優先し、<b>士気</b>を保って突破する',
    );
    expect(withNote.hypothesisNote.reflection.text).toBe('育成は効いたが障害対応が遅れた');

    if (viewport.width === 320) {
      const longNote = 'あ'.repeat(120);
      await reflection.fill(longNote);
      const block = await review.boundingBox();
      expect(block!.width).toBeGreaterThan(240);
      const field = await reflection.evaluate((el) => ({
        overflow: getComputedStyle(el).overflowY,
        hidden: el.scrollHeight - el.clientHeight,
      }));
      expect(field.overflow).toBe('hidden');
      expect(field.hidden).toBeLessThanOrEqual(1);
      const includeBox = await page.locator('.result-hypothesis-include').boundingBox();
      expect(includeBox!.height).toBeGreaterThanOrEqual(44);
      expect(block!.height).toBeLessThan(420);
      await review.screenshot({
        path: test.info().outputPath(`hypothesis-review-${viewport.name}.png`),
      });
    }

    await page.getByTestId('new-run').click();
    await expect(page.getByTestId('title')).toBeVisible();
    await expect(page.getByTestId('hypothesis-note-input')).toHaveValue('');
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('title')).not.toBeVisible();
    await loseCurrentRun(page);
    await expect(page.getByTestId('hypothesis-review')).toHaveCount(0);
    await expect(page.getByTestId('diagnostic-include-note')).toHaveCount(0);
  });
}

for (const [name, startId] of [
  ['通常ラン', 'start-run'],
  ['デイリーラン', 'start-daily-run'],
] as const) {
  test(`仮説メモを保存できなくても${name}を開始し、320幅で案内が見える`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(() => {
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args) {
        if (this.name === 'hypothesisNote') {
          throw new DOMException('quota', 'QuotaExceededError');
        }
        return put.apply(this, args);
      };
    });
    await page.goto('/?seed=hypothesis-save-fail&tutorial=off');
    await expect(page.getByTestId('title')).toBeVisible();
    await page.getByTestId('hypothesis-note-input').fill('保存できない仮説');
    await page.getByTestId(startId).click();
    const notice = page.getByTestId('hypothesis-start-unrecorded');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText('仮説メモを保存できなかったので、今回は記録しません');
    await expect(page.getByTestId('title')).not.toBeVisible();
    const box = await notice.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
    await expect(page.getByTestId('hypothesis-review')).toHaveCount(0);
  });
}
