/**
 * RI-148: ラン中のメニューから遊び方と音切替へ到達する。
 * ヘルプ中は進行を止め、閉じたあとは手動停止 / 1x / 2x を維持する。
 * 既に pause されている進行と WebGL 準備状態は解除しない。
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

type MenuGame = {
  pause(): void;
  resume(): void;
  isPaused(): boolean;
  getPauseEpoch(): number;
  getState(): { sprintTick: number; phase: string };
  getMeta(): { soundMuted: boolean };
};

async function tick(page: Page): Promise<number> {
  return page.evaluate(() => {
    const game = (window as Window & { game?: MenuGame }).game;
    if (!game) throw new Error('window.game が公開されていない');
    return game.getState().sprintTick;
  });
}

async function startRun(page: Page, seed: string): Promise<void> {
  await page.goto(`/?seed=${seed}`);
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('start-run').click();
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('run-menu')).toBeVisible();
}

async function openMenu(page: Page): Promise<void> {
  await page.getByTestId('run-menu').click();
  await expect(page.getByTestId('run-session-menu-panel')).toBeVisible();
  await expect(page.getByTestId('run-open-help')).toBeFocused();
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test('編成とスプリントから遊び方へ戻り、速度と別の停止理由を維持する', async ({ page }) => {
  test.setTimeout(60_000);
  await startRun(page, 'ri-148-menu');

  await openMenu(page);
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('run-sound-mute')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('run-open-help')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('run-session-menu-panel')).toHaveCount(0);
  await expect(page.getByTestId('run-menu')).toBeFocused();

  await openMenu(page);
  await page.getByTestId('run-open-help').click();
  await expect(page.getByTestId('how-to-play')).toBeVisible();
  await expect(page.getByTestId('setup')).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('how-to-play')).toHaveCount(0);
  await expect(page.getByTestId('setup')).toBeVisible();
  await expect(page.getByTestId('run-menu')).toBeFocused();

  await page.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('board')).toBeVisible();
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  await page.evaluate(() => {
    const game = (window as Window & { game?: MenuGame }).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.resume();
  });

  const started = await tick(page);
  await expect.poll(() => tick(page), { timeout: 5_000 }).toBeGreaterThan(started);

  await openMenu(page);
  await page.getByTestId('run-open-help').click();
  await expect(page.getByTestId('how-to-play')).toBeVisible();
  await expect(page.getByTestId('speed-1x')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  const held = await tick(page);
  await page.waitForTimeout(1_600);
  expect(await tick(page)).toBe(held);
  await page.getByTestId('how-to-play-close').click();
  await expect(page.getByTestId('how-to-play')).toHaveCount(0);
  await expect(page.getByTestId('speed-1x')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('board')).toBeVisible();
  await expect.poll(() => tick(page), { timeout: 5_000 }).toBeGreaterThan(held);

  await page.getByTestId('speed-2x').click();
  await expect(page.getByTestId('speed-2x')).toHaveAttribute('aria-pressed', 'true');
  await openMenu(page);
  await page.getByTestId('run-open-help').click();
  await expect(page.getByTestId('speed-2x')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('speed-2x')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('run-menu')).toBeFocused();

  await page.getByTestId('speed-pause').click();
  await expect(page.getByTestId('speed-pause')).toHaveAttribute('aria-pressed', 'true');
  const pausedTick = await tick(page);
  await openMenu(page);
  await page.getByTestId('run-open-help').click();
  await page.waitForTimeout(1_200);
  expect(await tick(page)).toBe(pausedTick);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('speed-pause')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1_200);
  expect(await tick(page)).toBe(pausedTick);

  await page.getByTestId('speed-1x').click();
  await expect(page.getByTestId('speed-1x')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => {
    const game = (window as Window & { game?: MenuGame }).game;
    if (!game) throw new Error('window.game が公開されていない');
    game.pause();
  });
  const externalTick = await tick(page);
  await openMenu(page);
  await page.getByTestId('run-open-help').click();
  await page.getByTestId('how-to-play-close').click();
  await expect(page.getByTestId('speed-1x')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('webgl-status')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const game = (window as Window & { game?: MenuGame }).game;
      if (!game) throw new Error('window.game が公開されていない');
      return game.isPaused();
    }),
  ).toBe(true);
  await page.waitForTimeout(1_200);
  expect(await tick(page)).toBe(externalTick);
});

test('ラン中のミュートはBGMへ反映され、再読込後もメタ設定として残る', async ({ page }) => {
  await page.addInitScript(() => {
    const created: HTMLAudioElement[] = [];
    const NativeAudio = window.Audio;
    const PatchedAudio = function PatchedAudio(src?: string) {
      const audio = new NativeAudio(src);
      created.push(audio);
      return audio;
    } as unknown as typeof Audio;
    PatchedAudio.prototype = NativeAudio.prototype;
    window.Audio = PatchedAudio;
    (window as Window & { __createdAudio?: HTMLAudioElement[] }).__createdAudio = created;
  });
  await startRun(page, 'ri-148-sound');
  await openMenu(page);
  await expect(page.getByTestId('run-sound-mute')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('run-sound-mute')).toHaveText('ミュート中');

  const bgmMuted = () =>
    page.evaluate(() => {
      const game = (window as Window & { game?: MenuGame }).game;
      const created =
        (window as Window & { __createdAudio?: HTMLAudioElement[] }).__createdAudio ?? [];
      const tracks = created.filter((audio) => audio.loop);
      return {
        metaMuted: game?.getMeta().soundMuted ?? null,
        bgmMuted: tracks.length === 0 ? null : tracks.every((audio) => audio.muted),
      };
    });

  await page.getByTestId('run-sound-mute').click();
  await expect(page.getByTestId('run-sound-mute')).toHaveText('音あり');
  await expect.poll(bgmMuted).toEqual({ metaMuted: false, bgmMuted: false });

  await page.getByTestId('run-sound-mute').click();
  await expect(page.getByTestId('run-sound-mute')).toHaveText('ミュート中');
  await expect.poll(bgmMuted).toEqual({ metaMuted: true, bgmMuted: true });

  await page.getByTestId('run-sound-mute').click();
  await expect.poll(bgmMuted).toEqual({ metaMuted: false, bgmMuted: false });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('devops-tycoon');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        });
        try {
          const stored = await new Promise<unknown>((resolve, reject) => {
            const tx = db.transaction('meta', 'readonly');
            const request = tx.objectStore('meta').get('current');
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
          });
          return (stored as { soundMuted?: boolean } | undefined)?.soundMuted ?? null;
        } finally {
          db.close();
        }
      }),
    )
    .toBe(false);
  await page.reload();
  await expect(page.getByTestId('sound-mute')).toHaveText('音あり');
  await expect(page.getByTestId('open-help')).toBeVisible();
});

test('5 viewport でメニューと閉じる操作へ到達でき、介入バーを覆わない', async ({ page }) => {
  test.setTimeout(60_000);
  await startRun(page, 'ri-148-layout');
  await page.getByTestId('begin-sprint').click();
  await expect(page.getByTestId('action-bar')).toBeVisible();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const menu = page.getByTestId('run-menu');
    await menu.scrollIntoViewIfNeeded();
    await expect(menu).toBeInViewport();
    await menu.click();
    const panel = page.getByTestId('run-session-menu-panel');
    await expect(panel).toBeVisible();
    await expect(page.getByTestId('run-open-help')).toBeInViewport();
    await expect(page.getByTestId('run-sound-mute')).toBeInViewport();
    const panelBox = await panel.boundingBox();
    const action = page.getByTestId('action-bar');
    await action.scrollIntoViewIfNeeded();
    const actionBox = await action.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(actionBox).not.toBeNull();
    if (panelBox && actionBox) expect(boxesOverlap(panelBox, actionBox)).toBe(false);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('action-bar')).toBeVisible();
  }
});
