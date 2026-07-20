/**
 * ファイル再生オーディオエンジン（RI-59 / RI-63）。
 *
 * HTMLAudioElement で `public/assets/audio/*.wav` を再生する。
 * autoplay 制約のため初回ユーザ操作まで play しない。
 * BGM のトーン切替は旧トラックのフェードアウトと新トラックの
 * フェードインを並行させるクロスフェードで行う（RI-63）。
 */
import { BGM_URLS, SFX_URLS, type BgmToneId, type SfxId } from './sounds';

const SFX_VOLUME = 0.7;
const BGM_VOLUME = 0.35;
const BGM_FADE_MS = 700;
const BGM_FADE_INTERVAL_MS = 50;

export interface AudioEngine {
  unlock(): Promise<void>;
  isUnlocked(): boolean;
  isDisposed(): boolean;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  playSfx(id: SfxId): void;
  setBgmTone(tone: BgmToneId): void;
  getBgmTone(): BgmToneId;
  dispose(): void;
}

export interface AudioEngineOptions {
  /** テスト用の Audio コンストラクタ差し替え。 */
  AudioCtor?: typeof Audio;
  /** BGM クロスフェード時間（ms）。既定 700。 */
  bgmFadeMs?: number;
}

function allAssetUrls(): string[] {
  return [...Object.values(SFX_URLS), ...Object.values(BGM_URLS)];
}

export function createAudioEngine(options: AudioEngineOptions = {}): AudioEngine {
  const AudioCtor = options.AudioCtor ?? (typeof Audio !== 'undefined' ? Audio : null);
  const fadeMs = options.bgmFadeMs ?? BGM_FADE_MS;
  let unlocked = false;
  let muted = false;
  let bgmTone: BgmToneId = 'off';
  let bgm: HTMLAudioElement | null = null;
  let disposed = false;
  const activeSfx = new Set<HTMLAudioElement>();
  // フェード中の要素（フェードアウト退役中の旧 BGM を含む）とそのタイマー。
  const fadeTimers = new Map<HTMLAudioElement, ReturnType<typeof setInterval>>();

  const applyMuteTo = (el: HTMLAudioElement): void => {
    el.muted = muted;
  };

  const cancelFade = (el: HTMLAudioElement): void => {
    const timer = fadeTimers.get(el);
    if (timer === undefined) return;
    clearInterval(timer);
    fadeTimers.delete(el);
  };

  const rampVolume = (el: HTMLAudioElement, target: number, onDone?: () => void): void => {
    cancelFade(el);
    const steps = Math.max(1, Math.round(fadeMs / BGM_FADE_INTERVAL_MS));
    const delta = (target - el.volume) / steps;
    let remaining = steps;
    const timer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        el.volume = target;
        cancelFade(el);
        onDone?.();
        return;
      }
      el.volume = Math.max(0, Math.min(1, el.volume + delta));
    }, BGM_FADE_INTERVAL_MS);
    fadeTimers.set(el, timer);
  };

  /** 現行 BGM をフェードアウトさせて停止する（クロスフェードの旧トラック側）。 */
  const retireBgm = (): void => {
    if (!bgm) return;
    const el = bgm;
    bgm = null;
    rampVolume(el, 0, () => {
      el.pause();
      el.src = '';
    });
  };

  const stopBgmImmediate = (): void => {
    if (!bgm) return;
    cancelFade(bgm);
    bgm.pause();
    bgm.src = '';
    bgm = null;
  };

  const startBgm = (tone: Exclude<BgmToneId, 'off'>): void => {
    if (!AudioCtor || disposed || !unlocked) return;
    retireBgm();
    const el = new AudioCtor(BGM_URLS[tone]);
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;
    applyMuteTo(el);
    bgm = el;
    void el.play().catch(() => {
      // autoplay / 未ロード失敗時はフェードを止め、後続の再開に備え音量だけ整える。
      cancelFade(el);
      el.volume = BGM_VOLUME;
    });
    rampVolume(el, BGM_VOLUME);
  };

  const preload = async (): Promise<void> => {
    if (!AudioCtor) return;
    await Promise.all(
      allAssetUrls().map(
        (url) =>
          new Promise<void>((resolve) => {
            const el = new AudioCtor();
            el.preload = 'auto';
            const done = () => resolve();
            el.addEventListener('canplaythrough', done, { once: true });
            el.addEventListener('error', done, { once: true });
            el.src = url;
            // 一部環境では load() 明示が必要。
            try {
              el.load();
            } catch {
              done();
            }
            // タイムアウトで無限待ちを避ける。
            setTimeout(done, 1500);
          }),
      ),
    );
  };

  return {
    async unlock() {
      if (disposed || unlocked || !AudioCtor) return;
      // 自動再生制限: preload の await より先に、ユーザ操作タスク内で play を開始する。
      // canplaythrough 待ちで activation が落ちると、以降の play は拒否されたままになる。
      let warmed = false;
      try {
        const warm = new AudioCtor(SFX_URLS.interventionHit);
        warm.volume = 0;
        const playPromise = warm.play();
        await playPromise;
        warm.pause();
        warm.currentTime = 0;
        warm.src = '';
        warmed = true;
      } catch {
        /* 失敗時は unlocked にせず、次のユーザ操作で再試行する */
      }
      if (!warmed || disposed) return;

      unlocked = true;
      void preload();
      if (bgmTone !== 'off') startBgm(bgmTone);
    },
    isUnlocked() {
      return unlocked;
    },
    isDisposed() {
      return disposed;
    },
    setMuted(next) {
      if (disposed) return;
      muted = next;
      if (bgm) {
        applyMuteTo(bgm);
        if (!muted && unlocked && bgm.paused && bgmTone !== 'off') {
          void bgm.play().catch(() => undefined);
        }
      }
      for (const el of fadeTimers.keys()) applyMuteTo(el);
      for (const el of activeSfx) applyMuteTo(el);
    },
    isMuted() {
      return muted;
    },
    playSfx(id) {
      if (disposed || muted || !unlocked || !AudioCtor) return;
      const el = new AudioCtor(SFX_URLS[id]);
      el.preload = 'auto';
      el.volume = SFX_VOLUME;
      applyMuteTo(el);
      activeSfx.add(el);
      const cleanup = () => {
        activeSfx.delete(el);
        el.src = '';
      };
      el.addEventListener('ended', cleanup, { once: true });
      el.addEventListener('error', cleanup, { once: true });
      void el.play().catch(cleanup);
    },
    setBgmTone(tone) {
      if (tone === bgmTone) return;
      bgmTone = tone;
      if (tone === 'off') {
        retireBgm();
        return;
      }
      if (!unlocked) return;
      startBgm(tone);
    },
    getBgmTone() {
      return bgmTone;
    },
    dispose() {
      disposed = true;
      for (const [el, timer] of fadeTimers) {
        clearInterval(timer);
        el.pause();
        el.src = '';
      }
      fadeTimers.clear();
      stopBgmImmediate();
      for (const el of activeSfx) {
        el.pause();
        el.src = '';
      }
      activeSfx.clear();
      unlocked = false;
    },
  };
}
