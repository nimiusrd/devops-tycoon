/**
 * #953: シニア体力チップが桁変化で横にずれない。
 */
import { beginPublicSprint, expect, test } from './fixtures';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px: シニア体力が100%→2桁→1桁でもチップ位置が動かない（#953）`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await beginPublicSprint(page, { seed: 'hud-senior-hp-shift-953', renderer: 'pixi' });
    await page.evaluate(() => document.fonts.ready);

    const readLayout = () =>
      page.evaluate(() => {
        const senior = document.querySelector('[data-testid="hud-seniorHp"]');
        const compact = document.querySelector('[data-testid="hud-compact"]');
        if (!(senior instanceof HTMLElement) || !(compact instanceof HTMLElement)) {
          throw new Error('HUD チップが無い');
        }
        const chips = [...compact.querySelectorAll('.hud-compact-chip')].map((chip) => ({
          id: chip.getAttribute('data-testid'),
          x: chip.getBoundingClientRect().x,
        }));
        const value = senior.querySelector('.hud-compact-chip-value');
        const valueStyle =
          value instanceof HTMLElement
            ? getComputedStyle(value)
            : (null as unknown as CSSStyleDeclaration);
        const valueRect =
          value instanceof HTMLElement ? value.getBoundingClientRect() : { width: Number.NaN };
        return {
          seniorX: senior.getBoundingClientRect().x,
          valueWidth: valueRect.width,
          valueFontVariant: valueStyle?.fontVariantNumeric ?? '',
          chips,
        };
      });

    const setSeniorHp = (hp: number) =>
      page.evaluate((nextHp) => {
        const game = (
          window as {
            game?: {
              engine: { org: { seniorHp: number } };
              pause: () => void;
              step: (ms: number) => void;
            };
          }
        ).game;
        if (!game) throw new Error('game が無い');
        game.engine.org.seniorHp = nextHp;
        game.pause();
        game.step(0);
      }, hp);

    await setSeniorHp(100);
    await expect(page.getByTestId('hud-seniorHp')).toContainText('100%');
    const at100 = await readLayout();

    await setSeniorHp(93);
    await expect(page.getByTestId('hud-seniorHp')).toContainText('93%');
    const at93 = await readLayout();

    await setSeniorHp(8);
    await expect(page.getByTestId('hud-seniorHp')).toContainText('8%');
    const at8 = await readLayout();

    for (const layout of [at100, at93, at8]) {
      expect(layout.valueFontVariant).toContain('tabular-nums');
    }

    expect(Math.abs(at93.valueWidth - at100.valueWidth)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(at8.valueWidth - at100.valueWidth)).toBeLessThanOrEqual(0.5);

    const chipIds = at100.chips.map((chip) => chip.id);
    expect(at93.chips.map((chip) => chip.id)).toEqual(chipIds);

    expect(Math.abs(at93.seniorX - at100.seniorX)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(at8.seniorX - at100.seniorX)).toBeLessThanOrEqual(0.5);

    for (let i = 0; i < chipIds.length; i += 1) {
      expect(
        Math.abs(at93.chips[i].x - at100.chips[i].x),
        `${chipIds[i]} の x（93%）`,
      ).toBeLessThanOrEqual(0.5);
    }
  });
}

test('1280px: シニア体力の固定幅がコンパクトHUDを崩さない（#953）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await beginPublicSprint(page, { seed: 'hud-senior-hp-shift-953-desktop', renderer: 'pixi' });
  await page.evaluate(() => document.fonts.ready);
  const hud = page.getByTestId('hud');
  await expect(hud).toHaveAttribute('data-compact', 'true');
  await expect(page.getByTestId('hud-seniorHp')).toBeVisible();
  const layout = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="hud-compact"]');
    if (!(row instanceof HTMLElement)) throw new Error('KPI 行が無い');
    const rowRect = row.getBoundingClientRect();
    return {
      rowRight: rowRect.right,
      viewport: window.innerWidth,
      htmlScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(layout.rowRight).toBeLessThanOrEqual(layout.viewport + 1);
  expect(layout.htmlScroll).toBeLessThanOrEqual(1);
});
