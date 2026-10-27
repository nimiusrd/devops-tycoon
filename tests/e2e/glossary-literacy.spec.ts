import { expect, test } from './fixtures';
import type { Locator } from '@playwright/test';
import { OUTCOME_BALANCE } from '../../src/data/balance/outcome';
import { GLOSSARY } from '../../src/data/glossary';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

async function assertUnbrokenPhrases(panel: Locator, label: string): Promise<void> {
  const phrases = await panel.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll('.setup-text-phrase')].map((phrase) => {
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
  expect(phrases.length, `${label} の定義を句に分ける`).toBe(GLOSSARY.aiLiteracy.phrases?.length);
  for (const phrase of phrases) {
    expect(phrase.lineCount, `${label} の「${phrase.text}」を語中で改行しない`).toBe(1);
    expect(phrase.contained, `${label} の「${phrase.text}」をパネル内に収める`).toBe(true);
  }
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} ${viewport.width}x${viewport.height} でAIリテラシーの用語が両方の敗北条件を語中で切らずに示す（#941）`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?seed=glossary-literacy');
    await page.getByTestId('difficulty-normal').click();
    await page.getByTestId('start-run').click();
    await expect(page.getByTestId('setup')).toBeVisible();

    const tip = page.getByTestId('term-tip-aiLiteracy');
    await tip.locator('summary').click();
    const panel = page.getByTestId('term-tip-aiLiteracy-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveText(GLOSSARY.aiLiteracy.definition);

    const literacy = OUTCOME_BALANCE.loseAiLiteracyUnsafeMax.value;
    const dependency = OUTCOME_BALANCE.loseAiDependencyCap.value;
    await expect(panel).toContainText(`${literacy}以下`);
    await expect(panel).toContainText(`依存${dependency}%`);
    await expect(panel).toContainText('かつ');
    await expect(panel).not.toContainText('依存が高いと敗北');

    await assertUnbrokenPhrases(panel, viewport.name);

    const overflow = await page.evaluate(() => {
      const panelEl = document.querySelector('[data-testid="term-tip-aiLiteracy-panel"]');
      const setup = document.querySelector('[data-testid="setup"]');
      return {
        html: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        panel:
          panelEl instanceof HTMLElement ? panelEl.scrollWidth - panelEl.clientWidth : Number.NaN,
        setup: setup instanceof HTMLElement ? setup.scrollWidth - setup.clientWidth : Number.NaN,
      };
    });
    expect(overflow.html, `${viewport.name} でページが横にはみ出す`).toBeLessThanOrEqual(1);
    expect(overflow.panel, `${viewport.name} で用語パネルの文言が切れる`).toBeLessThanOrEqual(1);
    expect(overflow.setup, `${viewport.name} で編成画面が横にはみ出す`).toBeLessThanOrEqual(1);

    await page.locator('.formation-head').screenshot({
      path: test.info().outputPath(`ai-literacy-setup-${viewport.width}.png`),
    });
    await panel.screenshot({
      path: test.info().outputPath(`ai-literacy-term-${viewport.width}.png`),
    });
  });
}
