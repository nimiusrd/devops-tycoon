/**
 * #1005: シニア体力案内の「×」が文から離れて浮かない。
 */
import { expect, test } from './fixtures';
import type { RunSave } from '../../src/state/runPersistence';

type GameWindow = Window & {
  game?: {
    pause(): void;
    exportRunSaveText(): string | null;
    importRunSaveText(raw: string): Promise<{ ok: boolean }>;
    resumeRun(): { phase: string } | null;
  };
};

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
] as const;

async function showSeniorHpObservation(page: import('@playwright/test').Page, hp: number) {
  await page.goto('/?renderer=pixi&tutorial=off&seed=setup-dismiss-1005');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  const raw = await page.evaluate(() => {
    const text = (window as GameWindow).game!.exportRunSaveText();
    if (!text) throw new Error('準備画面のセーブを取得できない');
    return text;
  });
  await page.evaluate(
    async ({ saved, hp }) => {
      const game = (window as GameWindow).game!;
      const save = JSON.parse(saved) as RunSave;
      save.state.org.seniorHp = hp;
      const activeTeam = save.state.extras.teams?.find(
        (team) => team.id === save.state.extras.activeTeamId,
      );
      if (activeTeam) activeTeam.seniorHp = hp;
      const result = await game.importRunSaveText(JSON.stringify(save));
      if (!result.ok || game.resumeRun()?.phase !== 'setup') {
        throw new Error('シニア体力案内がある準備画面を再開できない');
      }
      game.pause();
    },
    { saved: raw, hp },
  );
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByTestId('setup-observation-senior-hp')).toBeVisible();
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px: シニア体力案内の×が文の右上に一体で置かれる（#1005）`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({
      reducedMotion: viewport.width === 320 ? 'reduce' : 'no-preference',
    });
    await showSeniorHpObservation(page, 24);
    const dismiss = page.getByTestId('setup-observation-dismiss');
    await expect(dismiss).toHaveAttribute('aria-label', '案内を閉じる');

    const layout = await page.evaluate(() => {
      const content = document.querySelector('[data-testid="setup-observation"]');
      const dismissEl = document.querySelector('[data-testid="setup-observation-dismiss"]');
      const text = document.querySelector('[data-testid="setup-observation-senior-hp"]');
      if (!(
        content instanceof HTMLElement &&
        dismissEl instanceof HTMLElement &&
        text instanceof HTMLElement
      )) {
        throw new Error('案内要素が見つからない');
      }
      const contentBox = content.getBoundingClientRect();
      const dismissBox = dismissEl.getBoundingClientRect();
      const textBox = text.getBoundingClientRect();
      const dismissStyle = getComputedStyle(dismissEl);
      const firstPhrase = text.querySelector('.setup-text-phrase');
      const firstLineTop = firstPhrase?.getBoundingClientRect().top ?? textBox.top;
      return {
        content: contentBox,
        dismiss: dismissBox,
        text: textBox,
        minWidth: parseFloat(dismissStyle.minWidth),
        minHeight: parseFloat(dismissStyle.minHeight),
        width: dismissBox.width,
        height: dismissBox.height,
        gapToText: dismissBox.left - textBox.right,
        firstLineTop,
        dismissTop: dismissBox.top,
      };
    });

    expect(layout.minWidth, 'タップ領域の最小幅').toBeGreaterThanOrEqual(44);
    expect(layout.minHeight, 'タップ領域の最小高さ').toBeGreaterThanOrEqual(44);
    expect(layout.width, '実タップ幅').toBeGreaterThanOrEqual(44);
    expect(layout.height, '実タップ高さ').toBeGreaterThanOrEqual(44);
    expect(layout.gapToText, '×が本文から離れすぎない').toBeLessThanOrEqual(12);
    expect(layout.dismiss.left, '×が案内枠の内側左端').toBeGreaterThanOrEqual(
      layout.content.left - 1,
    );
    expect(layout.dismiss.right, '×が案内枠の内側右端').toBeLessThanOrEqual(
      layout.content.right + 1,
    );
    expect(layout.dismiss.top, '×が案内枠の外に上へ飛び出さない').toBeGreaterThanOrEqual(
      layout.content.top - 1,
    );
    expect(layout.dismiss.bottom, '×が案内枠の外に下へ飛び出さない').toBeLessThanOrEqual(
      layout.content.bottom + 1,
    );
    expect(
      Math.abs(layout.firstLineTop - layout.dismissTop),
      '1行目と×の上端をそろえる',
    ).toBeLessThanOrEqual(6);

    await page.screenshot({
      path: testInfo.outputPath(`setup-observation-dismiss-${viewport.width}.png`),
    });
  });
}
