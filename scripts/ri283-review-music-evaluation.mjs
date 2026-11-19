/**
 * ブラウザ上で現行 BGM/SFX とレビュー音楽層の再生・負荷を比較する。
 * node scripts/ri283-review-music-evaluation.mjs
 */
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const browserOptions = {
  args: ['--autoplay-policy=document-user-activation-required'],
  ignoreDefaultArgs: ['--mute-audio'],
};

async function openProbePage(browser, origin) {
  const page = await browser.newPage();
  await page.route(`${origin}/probe`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ja"></html>' }),
  );
  await page.goto(`${origin}/probe`);
  return page;
}

async function measurePlayback(browser, cdp, origin, withLayer) {
  const page = await openProbePage(browser, origin);
  try {
    await page.evaluate(async (withLayer) => {
      const { createAudioEngine } = await import('/src/audio/audioEngine.ts');
      const { createReviewMusicPrototype } = await import('/src/prototypes/reviewMusic.ts');
      const tracks = [];
      const AudioCtor = function (src) {
        const element = new Audio(src);
        const track = { src: src ?? '', element, playCalls: 0, played: false, ended: false };
        const play = element.play.bind(element);
        element.play = () => {
          track.playCalls += 1;
          return play();
        };
        element.addEventListener('playing', () => (track.played = true));
        element.addEventListener('ended', () => (track.ended = true));
        tracks.push(track);
        return element;
      };
      const engine = (withLayer ? createReviewMusicPrototype : createAudioEngine)({ AudioCtor });
      engine.setBgmTone('cloudy');

      window.probe = {
        engine,
        tracks,
        unlocking: new Promise((resolve) => {
          document.addEventListener('pointerdown', () => resolve(engine.unlock()), { once: true });
        }),
      };
    }, withLayer);
    assert.equal(await page.evaluate(() => window.probe.tracks.length), 0);
    await page.mouse.click(10, 10);
    assert.equal(
      await page.evaluate(async () => {
        await window.probe.unlocking;
        return window.probe.engine.isUnlocked();
      }),
      true,
    );
    await page.waitForFunction(() =>
      window.probe.tracks.some((track) => track.src.endsWith('bgm-cloudy.wav') && track.played),
    );
    await delay(1_500); // unlock 時の preload と既存 BGM のフェードを測定窓から除く。

    const start = await cdp.send('SystemInfo.getProcessInfo');
    const wallStart = performance.now();
    const playback = await page.evaluate(async () => {
      const { engine, tracks } = window.probe;
      const overlap = [];
      for (let slot = 0; slot < 50; slot += 1) {
        let count = 3;
        if (slot < 6) count = slot % 2 ? 5 : 6;
        else if (slot < 28 || slot >= 46) count = 8;
        engine.observe?.(
          {
            phase: 'sprint',
            currentSprintId: 'q1-s1',
            sprint: {
              complete: false,
              tasks: Array.from({ length: 10 }, (_, i) => ({
                lane: i < count ? 'review' : 'coding',
              })),
            },
          },
          slot * 100,
        );
        if ([1, 20, 26].includes(slot)) {
          const layer = tracks.find(({ src }) => src.startsWith('blob:'));
          const bgm = tracks.find(({ src }) => src.endsWith('bgm-cloudy.wav'));
          overlap.push({
            cloudyTime: bgm.element.currentTime,
            layerTime: layer?.element.currentTime ?? null,
          });
          engine.playSfx('fireSpread');
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const layer = tracks.filter(({ src }) => src.startsWith('blob:'));
      const fire = tracks.filter(({ src }) => src.endsWith('sfx-fire-spread.wav'));
      const result = {
        layerElements: layer.length,
        layerPlayCalls: layer.reduce((sum, track) => sum + track.playCalls, 0),
        layerPlaying: layer.filter(({ played }) => played).length,
        layerReleased: layer.every(({ element }) => element.paused && !element.hasAttribute('src')),
        firePlaying: fire.filter(({ played }) => played).length,
        fireEnded: fire.filter(({ ended }) => ended).length,
        fireOverlapped: overlap.filter(({ layerTime }) => layerTime > 0).length,
        bgmAdvanced: overlap.at(-1).cloudyTime > overlap[0].cloudyTime,
      };
      return result;
    });
    const wallMs = Math.round(performance.now() - wallStart);
    const end = await cdp.send('SystemInfo.getProcessInfo');
    await page.evaluate(() => window.probe.engine.dispose());

    assert.deepEqual(playback, {
      layerElements: withLayer ? 1 : 0,
      layerPlayCalls: withLayer ? 1 : 0,
      layerPlaying: withLayer ? 1 : 0,
      layerReleased: true,
      firePlaying: 3,
      fireEnded: 3,
      fireOverlapped: withLayer ? 2 : 0,
      bgmAdvanced: true,
    });

    const shared = end.processInfo.filter(({ id }) => start.processInfo.some((p) => p.id === id));
    const seconds = shared.reduce(
      (sum, process) =>
        sum + process.cpuTime - start.processInfo.find((p) => p.id === process.id).cpuTime,
      0,
    );
    return {
      chromium: browser.version(),
      withLayer,
      wallMs,
      browserCpuMs: Math.round(seconds * 1_000),
      processTypes: shared.map(({ type }) => type).sort(),
      changedProcesses: start.processInfo.length + end.processInfo.length - 2 * shared.length,
      ...playback,
    };
  } finally {
    await page.close();
  }
}

async function measureSignal(browser, origin) {
  const page = await openProbePage(browser, origin);
  try {
    return await page.evaluate(async () => {
      const { BGM_URLS, SFX_URLS } = await import('/src/audio/sounds.ts');
      const { createReviewLayerWav, REVIEW_LAYER_VOLUME } =
        await import('/src/prototypes/reviewMusic.ts');
      const context = new OfflineAudioContext(1, 1, 22_050);
      const urlSamples = async (url) =>
        (await context.decodeAudioData(await (await fetch(url)).arrayBuffer())).getChannelData(0);
      const fire = await urlSamples(SFX_URLS.fireSpread);
      const wav = createReviewLayerWav();
      const layer = (await context.decodeAudioData(await wav.arrayBuffer())).getChannelData(0);
      const firePower = fire.reduce((sum, sample) => sum + (sample * 0.7) ** 2, 0);
      const volume = (amplitude) => Math.round(20 * Math.log10(amplitude) * 100) / 100;
      const results = [];
      for (const [tone, url] of Object.entries(BGM_URLS)) {
        const bgm = await urlSamples(url);
        for (const withLayer of [false, true]) {
          let peak = 0;
          let loudestMusic = 0;
          // BGM の全尺を 0.25 秒刻み、層の周期 2 秒を 0.5 秒刻みで重ねる。
          for (let b = 0; b < bgm.length; b += Math.round(context.sampleRate / 4)) {
            for (let l = 0; l < layer.length; l += context.sampleRate / 2) {
              let musicPower = 0;
              for (let i = 0; i < fire.length; i += 1) {
                const base = bgm[(b + i) % bgm.length] * 0.35;
                const overlay = withLayer ? layer[(l + i) % layer.length] * REVIEW_LAYER_VOLUME : 0;
                const music = base + overlay;
                peak = Math.max(peak, Math.abs(music + fire[i] * 0.7));
                musicPower += music ** 2;
              }
              loudestMusic = Math.max(loudestMusic, musicPower);
              if (!withLayer) break;
            }
          }
          results.push({
            tone,
            withLayer,
            peakDbFS: volume(peak),
            minFireToMusicRmsDb: volume(Math.sqrt(firePower / loudestMusic)),
          });
        }
      }
      return { wavBytes: wav.size, sampleRate: context.sampleRate, results };
    });
  } finally {
    await page.close();
  }
}

const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  server: { host: '127.0.0.1', port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch(browserOptions);
  const cdp = await browser.newBrowserCDPSession();
  const { address, port } = server.httpServer.address();
  const origin = `http://${address}:${port}`;
  const playback = [];
  for (const withLayer of [false, true, true, false, false, true]) {
    playback.push(await measurePlayback(browser, cdp, origin, withLayer));
  }
  const signal = await measureSignal(browser, origin);
  console.log(JSON.stringify({ playback, signal }, null, 2));
} finally {
  await browser?.close();
  await server.close();
}
