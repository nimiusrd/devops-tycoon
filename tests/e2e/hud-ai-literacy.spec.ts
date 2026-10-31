import { beginPublicSprint, expect, test, type PublicGameWindow } from './fixtures';
import type { Locator } from '@playwright/test';
import { OUTCOME_BALANCE } from '../../src/data/balance/outcome';

/**
 * 901 は wide になった直後で、KPI カードが最小幅になる。
 * 320 は1列なので、説明欄はこの幅の方が狭い。
 */
const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'desktop-short', width: 1024, height: 768 },
  { name: 'wide-min-card', width: 901, height: 768 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function assertUnbrokenPhrases(detail: Locator, label: string): Promise<void> {
  const phrases = await detail.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('.text-phrase')].map((phrase) => {
      const range = document.createRange();
      range.selectNodeContents(phrase);
      const lines = [...range.getClientRects()].filter((line) => line.width > 0 && line.height > 0);
      return {
        text: phrase.textContent,
        lineCount: new Set(lines.map((line) => Math.round(line.top * 100))).size,
        contained: lines.every(
          (line) =>
            line.left >= bounds.left - 1 &&
            line.right <= bounds.right + 1 &&
            line.top >= bounds.top - 1 &&
            line.bottom <= bounds.bottom + 1,
        ),
      };
    });
  });
  expect(phrases.length, `${label} の敗北条件を句に分ける`).toBeGreaterThan(0);
  for (const phrase of phrases) {
    expect(phrase.lineCount, `${label} の「${phrase.text}」を語中で改行しない`).toBe(1);
    expect(phrase.contained, `${label} の「${phrase.text}」をカード内に収める`).toBe(true);
  }
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}x${viewport.height} でAI依存KPIの敗北条件が語中で切れない（#959）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await beginPublicSprint(page, { seed: `hud-ai-literacy-${viewport.width}` });
    await page.getByTestId('hud-toggle').click();
    await expect(page.getByTestId('hud')).toHaveAttribute('data-compact', 'false');

    const card = page.getByTestId('hud-aiDependency');
    await card.scrollIntoViewIfNeeded();
    const detail = card.locator('.stat-detail');
    const literacyCap = OUTCOME_BALANCE.loseAiLiteracyUnsafeMax.value;
    const dependencyCap = OUTCOME_BALANCE.loseAiDependencyCap.value;
    const shown = await page.evaluate(() => {
      const game = (window as PublicGameWindow).game;
      const org = game?.getState().org;
      if (!org) throw new Error('window.game が公開されていない');
      return {
        literacy: Math.round(org.aiLiteracy),
        dependency: Math.round(org.aiDependency),
      };
    });
    const overconfident = shown.dependency >= 75 && shown.literacy > literacyCap;
    const text = [
      `AIリテラシー${shown.literacy}・`,
      `依存${dependencyCap}%以上かつ`,
      `AIリテラシー${literacyCap}以下で敗北`,
      ...(overconfident ? ['・過信域'] : []),
    ].join('');

    await expect(detail).toHaveText(text);
    await expect(detail).not.toContainText('Literacy');
    await expect(detail).toContainText(`AIリテラシー${literacyCap}以下`);
    await expect(detail).toContainText(`依存${dependencyCap}%以上`);

    await assertUnbrokenPhrases(detail, viewport.name);

    const overflow = await page.evaluate(() => {
      const detailEl = document.querySelector('[data-testid="hud-aiDependency"] .stat-detail');
      const cardEl = document.querySelector('[data-testid="hud-aiDependency"]');
      return {
        html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        detail:
          detailEl instanceof HTMLElement
            ? detailEl.scrollWidth - detailEl.clientWidth
            : Number.NaN,
        card: cardEl instanceof HTMLElement ? cardEl.scrollWidth - cardEl.clientWidth : Number.NaN,
      };
    });
    expect(overflow.html, `${viewport.name} でページが横にはみ出す`).toBeLessThanOrEqual(1);
    expect(overflow.detail, `${viewport.name} でKPI説明が横に切れる`).toBeLessThanOrEqual(1);
    expect(overflow.card, `${viewport.name} でKPIカードが横に切れる`).toBeLessThanOrEqual(1);

    await card.screenshot({
      path: test.info().outputPath(`hud-ai-literacy-${viewport.width}.png`),
    });
  });
}
