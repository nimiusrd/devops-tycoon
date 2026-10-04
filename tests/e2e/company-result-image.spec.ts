import { expect, test, type Page } from '@playwright/test';
import type { GameHandle } from '../../src/game';
import type { ReplayBlob } from '../../src/state/replay';

async function openResult(page: Page, won = false, empty = false, legacy = false) {
  await page.goto('/?tutorial=off');
  await expect(page.getByTestId('title')).toBeVisible();
  expect(
    await page.evaluate(
      async ({ won, empty, legacy }) => {
        const game = (window as Window & { game: GameHandle }).game;
        game.startRun('easy', [], 'company-image-e2e');
        const frame = game.engine.exportReplayFrame()!;
        frame.phase = won ? 'won' : 'lost';
        frame.status = frame.phase;
        frame.winType = won ? 'healthy' : undefined;
        frame.loseReason = won ? undefined : 'moraleCollapse';
        frame.deck = empty ? [] : [{ defId: 'copilot', level: 3 }];
        frame.relics = [];
        frame.bossRelicReward = undefined;
        frame.totals.delivered = 123;
        const card = {
          id: 'copilot',
          name: '記録時の非常に長い日本語のカード名と経営上の選択'.repeat(5),
          rarity: 'common' as const,
          cost: 1,
          focusCost: 1,
          description: [],
          base: {},
        };
        const blob: ReplayBlob = {
          schemaVersion: 2,
          id: 'company-image-e2e:1',
          seed: frame.seed,
          difficulty: frame.difficulty,
          trials: [],
          finishedAt: 1,
          outcome: {
            status: frame.status,
            diagnosis: frame.diagnosis,
            score: 123,
            winType: frame.winType,
            loseReason: frame.loseReason,
          },
          keyframes: [{ phase: frame.phase, frame }],
          ruleset: { version: 1, fingerprint: 'company-image-e2e' },
          contentSnapshot: {
            cards: empty ? [] : [card],
            relics: [],
            ...(legacy
              ? {}
              : {
                  companyResult: {
                    outcome: won ? '記録時の長い日本語の勝利種別'.repeat(6) : '記録時のチーム崩壊',
                    won,
                    delivered: 123,
                    cost: { label: '士気', remaining: 0 },
                    cards: empty ? [] : [{ name: card.name, level: 3 }],
                  },
                }),
          },
        };
        return game.importReplay(blob);
      },
      { won, empty, legacy },
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByTestId('title')).toBeVisible();
  await page.getByTestId('open-replays').click();
  await page.getByTestId('replay-keyframe-0').click();
  await expect(page.getByTestId('run-result')).toBeVisible();
}

for (const [name, width, height] of [
  ['phone-se', 320, 568],
  ['phone', 390, 844],
  ['tablet', 768, 1024],
  ['desktop-short', 1024, 768],
  ['desktop', 1440, 900],
] as const) {
  test(`${name}: 記録された結果をプレビューしてPNG保存（実WebGL）`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: name === 'desktop' ? 'no-preference' : 'reduce' });
    await openResult(page, name === 'desktop', name === 'phone');
    const before = await page.evaluate(() => {
      const game = (window as Window & { game: GameHandle }).game;
      return { state: game.getState(), meta: game.getMeta() };
    });
    const section = page.getByRole('region', { name: '会社の結果画像' });
    await section.getByRole('button', { name: '結果画像をプレビュー' }).click();
    const img = section.getByRole('img');
    await expect(img).toBeVisible();
    await expect(section.locator('[aria-live="polite"]')).toContainText('画像を生成しました。');
    await expect(img).toHaveAttribute('alt', /累計出荷 123 pt/);
    await expect(img).toHaveAttribute(
      'alt',
      name === 'phone' ? /主要カード: なし/ : /記録時の非常に長い日本語/,
    );
    expect(
      await img.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight]),
    ).toEqual([1200, 900]);
    expect(await img.evaluate((node) => node.getBoundingClientRect().right)).toBeLessThanOrEqual(
      width,
    );
    await img.screenshot({ path: testInfo.outputPath('company-result.png') });
    const downloadPromise = page.waitForEvent('download');
    await section.getByRole('button', { name: 'PNGを保存' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('devops-tycoon-company-result.png');
    expect(await download.failure()).toBeNull();
    await download.saveAs(testInfo.outputPath('download.png'));
    expect(
      await page.evaluate(() => {
        const game = (window as Window & { game: GameHandle }).game;
        return { state: game.getState(), meta: game.getMeta() };
      }),
    ).toEqual(before);
  });
}

test('生成失敗から再試行でき、保存失敗でもプレビューと結果を保持する', async ({ page }) => {
  await openResult(page, false, true, true);
  await page.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) {
      HTMLCanvasElement.prototype.toBlob = original;
      callback(null);
    };
  });
  const section = page.getByRole('region', { name: '会社の結果画像' });
  await section.getByRole('button', { name: '結果画像をプレビュー' }).click();
  await expect(section).toContainText('結果は保持されています');
  await section.getByRole('button', { name: '画像生成を再試行' }).focus();
  await page.keyboard.press('Enter');
  await expect(section.getByRole('img')).toHaveAttribute('alt', /記録: moraleCollapse/);
  await expect(section.locator('[aria-live="polite"]')).toContainText('画像を生成しました。');
  await page.evaluate(() => {
    URL.createObjectURL = () => {
      throw new Error('save failed');
    };
  });
  await section.getByRole('button', { name: 'PNGを保存' }).click();
  await expect(section).toContainText('PNGを保存できませんでした');
  await expect(section.getByRole('img')).toBeVisible();
  await expect(page.getByTestId('run-delivered')).toHaveText('123 pt');
});
