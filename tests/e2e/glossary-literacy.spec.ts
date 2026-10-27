import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { OUTCOME_BALANCE } from '../../src/data/balance/outcome';
import { GLOSSARY } from '../../src/data/glossary';
import { SETUP_TERM_PANEL_RESERVE } from '../../src/ui/termTipLayout';

const VIEWPORTS = [
  { name: 'phone-se', width: 320, height: 568 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

const NARROW_MAX_WIDTH = 900;

interface SummaryOffset {
  id: string | null;
  x: number;
  y: number;
}

async function summaryOffsets(page: Page): Promise<SummaryOffset[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-testid="setup-term-tips"]');
    if (!(host instanceof HTMLElement)) return [];
    const hostBox = host.getBoundingClientRect();
    return [...host.querySelectorAll('summary')].map((summary) => {
      const box = summary.getBoundingClientRect();
      return {
        id: summary.parentElement?.getAttribute('data-testid') ?? null,
        x: box.x - hostBox.x,
        y: box.y - hostBox.y,
      };
    });
  });
}

function expectOffsetsStable(before: SummaryOffset[], after: SummaryOffset[], label: string): void {
  expect(
    after.map((item) => item.id),
    `${label} のチップ構成`,
  ).toEqual(before.map((item) => item.id));
  for (const next of after) {
    const previous = before.find((item) => item.id === next.id);
    expect(previous, `${label} の ${next.id}`).toBeTruthy();
    expect(Math.abs(next.x - previous!.x), `${label} で ${next.id} の x`).toBeLessThanOrEqual(1);
    expect(Math.abs(next.y - previous!.y), `${label} で ${next.id} の y`).toBeLessThanOrEqual(1);
  }
}

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
    await page.evaluate(() => document.fonts.ready);

    const narrow = viewport.width <= NARROW_MAX_WIDTH;
    const closedOffsets = await summaryOffsets(page);
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

    const layout = await page.evaluate((reserveName) => {
      const host = document.querySelector('[data-testid="setup-term-tips"]');
      const panelEl = document.querySelector('[data-testid="term-tip-aiLiteracy-panel"]');
      const open = document.querySelector('[data-testid="term-tip-aiLiteracy"]');
      const scroller = document.querySelector('.formation-panel');
      const observation = document.querySelector('[data-testid="setup-observation-slot"]');
      const begin = document.querySelector('[data-testid="begin-sprint"]');
      if (
        !(host instanceof HTMLElement) ||
        !(panelEl instanceof HTMLElement) ||
        !(open instanceof HTMLElement) ||
        !(scroller instanceof HTMLElement) ||
        !(observation instanceof HTMLElement) ||
        !(begin instanceof HTMLElement)
      ) {
        return null;
      }
      const panelBox = panelEl.getBoundingClientRect();
      const hostBox = host.getBoundingClientRect();
      const scrollerBox = scroller.getBoundingClientRect();
      const observationBox = observation.getBoundingClientRect();
      const beginBox = begin.getBoundingClientRect();
      const summaryBottoms = [...host.querySelectorAll('summary')].map(
        (summary) => summary.getBoundingClientRect().bottom,
      );
      const slack = 1;
      return {
        inViewport:
          panelBox.top >= -slack &&
          panelBox.left >= -slack &&
          panelBox.bottom <= window.innerHeight + slack &&
          panelBox.right <= window.innerWidth + slack,
        inScroller:
          panelBox.top >= scrollerBox.top - slack &&
          panelBox.left >= scrollerBox.left - slack &&
          panelBox.bottom <= scrollerBox.bottom + slack &&
          panelBox.right <= scrollerBox.right + slack,
        reserve: host.style.getPropertyValue(reserveName),
        panelPosition: getComputedStyle(panelEl).position,
        widthRatio: open.getBoundingClientRect().width / hostBox.width,
        alignedToHost: Math.abs(panelBox.left - hostBox.left) <= slack,
        withinHost: panelBox.right <= hostBox.right + slack,
        gapAbovePanel: panelBox.top - Math.max(...summaryBottoms),
        aboveObservation: panelBox.bottom <= observationBox.top + slack,
        aboveBegin: panelBox.bottom <= beginBox.top + slack,
        panelBottom: panelBox.bottom,
        hostBottom: hostBox.bottom,
      };
    }, SETUP_TERM_PANEL_RESERVE);
    expect(layout, `${viewport.name} の用語レイアウト`).not.toBeNull();
    expect(layout!.inViewport, `${viewport.name} で用語パネルが画面外`).toBe(true);
    expect(layout!.inScroller, `${viewport.name} で用語パネルが編成パネルに隠れる`).toBe(true);

    if (narrow) {
      expectOffsetsStable(
        closedOffsets,
        await summaryOffsets(page),
        `${viewport.name} で開いた直後`,
      );
      expect(layout!.panelPosition, `${viewport.name} のパネル配置`).toBe('absolute');
      expect(layout!.reserve, `${viewport.name} の余白`).not.toBe('');
      expect(layout!.widthRatio, `${viewport.name} で開いたチップが行を占有する`).toBeLessThan(0.9);
      expect(layout!.alignedToHost, `${viewport.name} でパネルが行の左端から始まる`).toBe(true);
      expect(layout!.withinHost, `${viewport.name} でパネルが行の右へはみ出す`).toBe(true);
      expect(
        layout!.gapAbovePanel,
        `${viewport.name} でパネルがチップに重なる`,
      ).toBeGreaterThanOrEqual(2);
      expect(
        layout!.gapAbovePanel,
        `${viewport.name} でパネルがチップから離れすぎる`,
      ).toBeLessThanOrEqual(16);
      expect(
        Math.abs(layout!.panelBottom - layout!.hostBottom),
        `${viewport.name} の余白`,
      ).toBeLessThanOrEqual(1);
      expect(layout!.aboveObservation, `${viewport.name} でパネルが案内に重なる`).toBe(true);
      expect(layout!.aboveBegin, `${viewport.name} でパネルが開始ボタンに重なる`).toBe(true);
    } else {
      expect(layout!.panelPosition, `${viewport.name} のパネル配置`).toBe('static');
      expect(layout!.reserve, `${viewport.name} の余白`).toBe('');
      expect(layout!.widthRatio, `${viewport.name} で開いたチップが全幅にならない`).toBeGreaterThan(
        0.9,
      );
    }

    await page.locator('.formation-head').screenshot({
      path: test.info().outputPath(`ai-literacy-setup-${viewport.width}.png`),
    });
    await panel.screenshot({
      path: test.info().outputPath(`ai-literacy-term-${viewport.width}.png`),
    });

    await page.getByTestId('term-tip-pr').locator('summary').click();
    await expect(page.getByTestId('term-tip-pr-panel')).toBeVisible();
    await expect(panel).toBeHidden();
    if (narrow) {
      expectOffsetsStable(
        closedOffsets,
        await summaryOffsets(page),
        `${viewport.name} で別の用語へ切り替えた直後`,
      );
    }
    const prVisible = await page.evaluate(() => {
      const pr = document.querySelector('[data-testid="term-tip-pr-panel"]');
      const scroller = document.querySelector('.formation-panel');
      if (!(pr instanceof HTMLElement) || !(scroller instanceof HTMLElement)) return false;
      const box = pr.getBoundingClientRect();
      const host = scroller.getBoundingClientRect();
      const slack = 1;
      return (
        box.top >= -slack &&
        box.bottom <= window.innerHeight + slack &&
        box.top >= host.top - slack &&
        box.bottom <= host.bottom + slack
      );
    });
    expect(prVisible, `${viewport.name} で切り替えた用語パネルが画面外`).toBe(true);

    await page.getByTestId('term-tip-pr').locator('summary').focus();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('term-tip-pr-panel')).toBeHidden();
    await expect(page.getByTestId('term-tip-pr').locator('summary')).toBeFocused();
    expectOffsetsStable(closedOffsets, await summaryOffsets(page), `${viewport.name} で閉じた直後`);
    const reserve = await page
      .getByTestId('setup-term-tips')
      .evaluate(
        (element, name) => (element as HTMLElement).style.getPropertyValue(name),
        SETUP_TERM_PANEL_RESERVE,
      );
    expect(reserve, `${viewport.name} で閉じたあとの余白`).toBe('');
  });
}
