/** 連続出荷でも各数字ポップが寿命を終え、古い増分が盤面に残らない。 */
import type { Page } from '@playwright/test';
import { beginPublicSprint, expect, test } from './fixtures';
import type { PublicGameWindow } from './fixtures';

const VIEWPORTS = [
  { name: 'デスクトップ', width: 1440, height: 900 },
  { name: 'スマートフォン', width: 390, height: 844 },
] as const;

const HUD_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
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

for (const viewport of HUD_VIEWPORTS) {
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    const motionLabel = reducedMotion === 'reduce' ? '動きを減らす' : '通常の動き';
    test(`${viewport.width}px・${motionLabel}: HUD増減はチップ内に収まり文字と重ならない`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion });
      await beginPublicSprint(page, { seed: 'point-pops-lifetime', renderer: 'pixi' });
      const hud = page.getByTestId('hud');
      await expect(hud).toHaveAttribute('data-compact', 'true');
      const initialHeight = await hud.evaluate((element) => element.getBoundingClientRect().height);

      await advanceToNextDelivery(page);
      await expect(hud.locator('.feedback-positive')).not.toHaveCount(0);
      // 介入バーへスクロールせず、HUDが画面上端にある状態で負の増減も同時に出す。
      const outcome = await page.evaluate(() =>
        (window as PublicGameWindow).game!.dispatch('overtime'),
      );
      expect(outcome.ok).toBe(true);
      await expect(hud.locator('.feedback-negative')).not.toHaveCount(0);

      const sampling = page.evaluate(async (initialHudHeight) => {
        const failures = new Set<string>();
        let visibleSamples = 0;
        const intersects = (first: DOMRect, second: DOMRect) =>
          first.left < second.right - 0.5 &&
          first.right > second.left + 0.5 &&
          first.top < second.bottom - 0.5 &&
          first.bottom > second.top + 0.5;
        for (let sample = 0; sample < 51; sample++) {
          const hudElement = document.querySelector('[data-testid="hud"]')!;
          if (Math.abs(hudElement.getBoundingClientRect().height - initialHudHeight) > 0.5) {
            failures.add('増減表示でHUDの高さが変わる');
          }
          const textRects = [
            ...hudElement.querySelectorAll(
              '.hud-compact-chip-label, .hud-compact-chip-value, .hud-compact-chip-warn, .hud-toggle',
            ),
          ].map((element) => element.getBoundingClientRect());
          for (const pop of hudElement.querySelectorAll('.hud-feedback-pop')) {
            if (Number(getComputedStyle(pop).opacity) === 0) continue;
            visibleSamples++;
            const rect = pop.getBoundingClientRect();
            const chip = pop.closest('.hud-compact-chip')!.getBoundingClientRect();
            if (
              rect.top < chip.top - 0.5 ||
              rect.bottom > chip.bottom + 0.5 ||
              rect.left < chip.left - 0.5 ||
              rect.right > chip.right + 0.5
            ) {
              failures.add('チップの外へ増減がはみ出す');
            }
            if (rect.top < 0 || rect.left < 0 || rect.right > window.innerWidth) {
              failures.add('画面端へ増減がはみ出す');
            }
            if (textRects.some((text) => intersects(rect, text))) {
              failures.add('KPIのラベル・現在値・警告・展開操作と増減が重なる');
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 25));
        }
        return { failures: [...failures], visibleSamples };
      }, initialHeight);
      await expect
        .poll(() =>
          hud
            .locator('.hud-feedback-pop')
            .evaluateAll((elements) =>
              Math.max(0, ...elements.map((element) => Number(getComputedStyle(element).opacity))),
            ),
        )
        .toBeGreaterThan(0.5);
      await page.screenshot({ path: testInfo.outputPath('チップ内のHUD増減.png') });
      const measurement = await sampling;
      await testInfo.attach('HUD増減の25ms間隔計測', {
        body: JSON.stringify(measurement),
        contentType: 'application/json',
      });
      expect(measurement.visibleSamples).toBeGreaterThan(0);
      expect(measurement.failures).toEqual([]);
      await expect(hud.locator('.hud-feedback-pop')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        viewport.width,
      );
    });
  }
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`${viewport.width}px・動きを減らす: 6回出荷しても全段が盤面内に収まり古い得点から消える`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await beginPublicSprint(page, { seed: 'point-pops-lifetime', renderer: 'pixi' });
    await page.evaluate(() => (window as PublicGameWindow).game!.pause());
    const clockStart = new Date('2026-01-01T00:00:00Z');
    await page.clock.install({ time: clockStart });
    await page.clock.pauseAt(new Date(clockStart.getTime() + 60_000));
    const pops = page.locator('.point-pop');
    const measurements = [];
    for (let delivery = 0; delivery < 6; delivery++) {
      await advanceToNextDelivery(page);
      // 仮想時計を少し進めて React と ResizeObserver を反映し、1100ms の寿命内で測る。
      await page.clock.runFor(32);
      await expect(pops.last()).toHaveAttribute('data-pop-id', String(delivery));
      const visible = await pops.evaluateAll((elements) =>
        elements
          .filter((element) => getComputedStyle(element).opacity !== '0')
          .map((element) => {
            const rect = element.getBoundingClientRect();
            const bounds = element.parentElement!.getBoundingClientRect();
            const summary = document
              .querySelector('[data-testid="board-flow-summary"]')!
              .getBoundingClientRect();
            return {
              id: Number(element.getAttribute('data-pop-id')),
              inside:
                rect.top >= bounds.top - 0.5 &&
                rect.bottom <= bounds.bottom + 0.5 &&
                rect.left >= bounds.left - 0.5 &&
                rect.right <= bounds.right + 0.5,
              belowSummary: rect.top >= summary.bottom,
            };
          }),
      );
      expect(visible.length).toBeGreaterThan(0);
      expect(visible.every((pop) => pop.inside)).toBe(true);
      expect(visible.every((pop) => pop.belowSummary)).toBe(true);
      expect(visible.map((pop) => pop.id)).toEqual(
        Array.from({ length: visible.length }, (_, i) => delivery - visible.length + 1 + i),
      );
      measurements.push(visible);
    }
    if (viewport.width < 400) expect(await pops.count()).toBeLessThan(6);
    else await expect(pops).toHaveCount(6);
    await page.screenshot({ path: testInfo.outputPath('盤面内に収まる得点ポップ.png') });
    if (viewport.width === 1280) {
      await page.setViewportSize({ width: 320, height: 568 });
      await page.clock.runFor(64);
      expect(await pops.count()).toBeGreaterThan(0);
      expect(await pops.count()).toBeLessThanOrEqual(2);
      await expect(pops.last()).toHaveAttribute('data-pop-id', '5');
      expect(
        await pops.evaluateAll((elements) =>
          elements.every((element) => {
            const bounds = element.parentElement!.getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            return rect.top >= bounds.top && rect.bottom <= bounds.bottom;
          }),
        ),
      ).toBe(true);
    }
    await testInfo.attach('可視段と古い順の消去', {
      body: JSON.stringify(measurements),
      contentType: 'application/json',
    });
    await page.clock.runFor(1200);
    await expect(pops).toHaveCount(0);
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
        ).toEqual({ opacity: '1', scaleX: 1, scaleY: 1, translateY: 0 });
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

  for (let burst = 0; burst < 8; burst++) {
    test(`${viewport.name}・動きを減らす: 3件の連続出荷でも数字が隠れずHUDも静止する（${burst + 1}/8）`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const measurements = [];

      // 同じ初期状態から3件を出荷し、ラン終盤の出荷不足を測定へ混ぜない。
      await beginPublicSprint(page, { seed: 'point-pops-lifetime', renderer: 'pixi' });
      await page.evaluate(() => (window as PublicGameWindow).game!.pause());
      // 多数回の測定は仮想時計で間隔を固定する。実時間の寿命は上のテストで確認する。
      await page.clock.install();
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60_000));
      const pops = page.locator('.point-pop');
      const first = await advanceToNextDelivery(page);
      await page.clock.runFor(32);
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
              transform.f !== 0
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
      await page.clock.runFor(180);
      const second = await advanceToNextDelivery(page);
      await page.clock.runFor(32);
      await expect(pops).toHaveText([`+${first}`, `+${second}`]);
      await page.clock.runFor(180);
      const third = await advanceToNextDelivery(page);
      await page.clock.runFor(32);
      await expect(pops).toHaveText([`+${first}`, `+${second}`, `+${third}`]);
      if (burst === 0) {
        await page.screenshot({ path: testInfo.outputPath('静止した3件の出荷とHUD.png') });
      }
      await page.clock.runFor(1600);
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
      await testInfo.attach('50ms間隔の重なり・静止計測', {
        body: JSON.stringify(measurements, null, 2),
        contentType: 'application/json',
      });
      expect(errors).toEqual([]);
    });
  }
}
