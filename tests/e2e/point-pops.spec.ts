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
      await beginPublicSprint(page, { seed: 'point-pops-lifetime', renderer: 'pixi' });

      const pops = page.locator('.point-pop');
      await expect(pops).toHaveCount(0);
      await expect(page.locator('.point-pops')).toHaveAttribute('aria-hidden', 'true');

      const firstDelta = await advanceToNextDelivery(page);
      // 公開状態の revision を React が読み、最初のポップを描画したことを待つ。
      await expect(pops).toHaveText([`+${firstDelta}`]);

      if (reducedMotion === 'reduce') {
        // 最終フレームまでリトライせず、最初に描かれた得点が静止・不透明か確認する。
        expect(
          await pops.first().evaluate((element) => {
            const style = getComputedStyle(element);
            const transform = new DOMMatrixReadOnly(style.transform);
            return {
              opacity: style.opacity,
              scaleX: transform.a,
              scaleY: transform.d,
              translateY: transform.f,
            };
          }),
        ).toEqual({ opacity: '1', scaleX: 1, scaleY: 1, translateY: -42 });
      }

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

  test(`${viewport.name}・動きを減らす: 3件の連続出荷を8回繰り返しても数字が隠れずHUDも静止する`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const measurements = [];

    for (let burst = 0; burst < 8; burst++) {
      // 同じ初期状態から3件を出荷し、ラン終盤の出荷不足を測定へ混ぜない。
      await beginPublicSprint(page, { seed: 'point-pops-lifetime', renderer: 'pixi' });
      const pops = page.locator('.point-pop');
      const first = await advanceToNextDelivery(page);
      await expect(pops).toHaveText([`+${first}`]);

      // 出現から消去まで50msごとに測る。DOM要素単位で位置も追い、段の詰め直しを検出する。
      const sampling = page.evaluate(async () => {
        const positions = new Map<Element, { left: string; translateY: number }>();
        const hiddenPairs = new Set<string>();
        let maxVisible = 0;
        let hudSeen = false;
        let moving = false;
        let clipped = false;
        for (let sample = 0; sample < 31; sample++) {
          // 即時退場でDOMから消える直前の完全透明な要素は可視ポップに数えない。
          const elements = [...document.querySelectorAll('.point-pop')].filter(
            (element) => getComputedStyle(element).opacity !== '0',
          );
          maxVisible = Math.max(maxVisible, elements.length);
          const rects = elements.map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            const transform = new DOMMatrixReadOnly(style.transform);
            const original = positions.get(element);
            if (!original) {
              positions.set(element, { left: style.left, translateY: transform.f });
            } else if (original.left !== style.left || original.translateY !== transform.f) {
              moving = true;
            }
            if (style.opacity !== '1' || transform.a !== 1 || transform.d !== 1) moving = true;
            const bounds = element.parentElement!.getBoundingClientRect();
            const visibleWidth = Math.max(
              0,
              Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left),
            );
            const visibleHeight = Math.max(
              0,
              Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top),
            );
            if ((visibleWidth * visibleHeight) / (rect.width * rect.height) <= 0.5) clipped = true;
            return rect;
          });
          for (let a = 0; a < rects.length; a++) {
            for (let b = a + 1; b < rects.length; b++) {
              const firstRect = rects[a]!;
              const secondRect = rects[b]!;
              const width = Math.max(
                0,
                Math.min(firstRect.right, secondRect.right) -
                  Math.max(firstRect.left, secondRect.left),
              );
              const height = Math.max(
                0,
                Math.min(firstRect.bottom, secondRect.bottom) -
                  Math.max(firstRect.top, secondRect.top),
              );
              const smallerArea = Math.min(
                firstRect.width * firstRect.height,
                secondRect.width * secondRect.height,
              );
              if ((width * height) / smallerArea >= 0.5) hiddenPairs.add(`${a}:${b}`);
            }
          }
          for (const pop of document.querySelectorAll('.hud-feedback-pop')) {
            const style = getComputedStyle(pop);
            if (style.opacity === '0') continue;
            hudSeen = true;
            const transform = new DOMMatrixReadOnly(style.transform);
            if (
              style.opacity !== '1' ||
              transform.a !== 1 ||
              transform.d !== 1 ||
              transform.f !== -14
            ) {
              moving = true;
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 50));
        }
        return {
          hiddenPairs: hiddenPairs.size,
          shown: positions.size,
          maxVisible,
          hudSeen,
          moving,
          clipped,
        };
      });
      await page.waitForTimeout(180);
      const second = await advanceToNextDelivery(page);
      await expect(pops).toHaveText([`+${first}`, `+${second}`]);
      await page.waitForTimeout(180);
      const third = await advanceToNextDelivery(page);
      await expect(pops).toHaveText([`+${first}`, `+${second}`, `+${third}`]);
      if (burst === 0) {
        await page.screenshot({ path: testInfo.outputPath('静止した3件の出荷とHUD.png') });
      }
      const measurement = await sampling;
      measurements.push(measurement);
      expect(measurement).toEqual({
        hiddenPairs: 0,
        shown: 3,
        maxVisible: 3,
        hudSeen: true,
        moving: false,
        clipped: false,
      });
      await expect(pops).toHaveCount(0);
    }
    await testInfo.attach('50ms間隔の重なり・静止計測', {
      body: JSON.stringify(measurements, null, 2),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}
