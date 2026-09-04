/** 連続出荷でも各数字ポップが寿命を終え、古い増分が盤面に残らない。 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test } from './fixtures';
import type { PublicGameWindow } from './fixtures';

const VIEWPORTS = [
  { name: 'デスクトップ', width: 1440, height: 900 },
  { name: 'スマートフォン', width: 390, height: 844 },
] as const;

/** 公開 step() だけで次の出荷まで進め、今回のポイント増分を返す。 */
async function advanceToNextDelivery(page: Page): Promise<number> {
  return page.evaluate(() => {
    const game = (window as PublicGameWindow).game;
    if (!game) throw new Error('window.game が公開されていない');
    let state = game.getState();
    const before = state.org.deliveryScore;
    let guard = 0;
    while (state.phase === 'sprint' && guard < 4_000) {
      game.step(100);
      state = game.getState();
      const delta = state.org.deliveryScore - before;
      if (delta > 0) return delta;
      guard += 1;
    }
    throw new Error(`次の出荷へ到達しない: phase=${state.phase} guard=${guard}`);
  });
}

for (const viewport of VIEWPORTS) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    const motionLabel = reducedMotion === 'reduce' ? '動きを減らす' : '通常の動き';
    test(`${viewport.name}・${motionLabel}: 連続出荷のポップが演出後に一つも残らない`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await beginPublicSprint(page, { seed: 'point-pops-lifetime', renderer: 'dom' });

      const pops = page.locator('.point-pop');
      await expect(pops).toHaveCount(0);
      await expect(page.locator('.point-pops')).toHaveAttribute('aria-hidden', 'true');

      const firstDelta = await advanceToNextDelivery(page);
      // 公開状態の revision を React が読み、最初のポップを描画したことを待つ。
      await expect(pops).toHaveText([`+${firstDelta}`]);

      // 最初の 1100 ms の寿命内に次の出荷を描画する。
      const secondDelta = await advanceToNextDelivery(page);
      await expect(pops).toHaveText([`+${firstDelta}`, `+${secondDelta}`]);
      await expect
        .poll(() =>
          pops.evaluateAll((elements) =>
            elements.length === 2
              ? Math.min(...elements.map((element) => Number(getComputedStyle(element).opacity)))
              : 0,
          ),
        )
        .toBeGreaterThan(0.5);
      await page.screenshot({ path: testInfo.outputPath('連続出荷のポップ表示中.png') });

      // タイマーや WAAPI を mock / 強制完了せず、実際の exit 演出完了を待つ。
      // AnimatePresence が保持している透明な要素も含め、DOM からの消去を確認する。
      await expect(pops).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath('連続出荷のポップ消去後.png') });
    });
  }
}
