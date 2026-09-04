import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine, type AudioEngine } from '../../../src/audio/audioEngine';
import { BGM_URLS, SFX_URLS } from '../../../src/audio/sounds';

function controlledAudio() {
  const instances: AudioElement[] = [];
  const behavior = {
    play: async (): Promise<void> => undefined,
    load: (el: EventTarget) => {
      el.dispatchEvent(new Event('canplaythrough'));
    },
  };

  class AudioElement extends EventTarget {
    src: string;
    loop = false;
    muted = false;
    volume = 1;
    currentTime = 0;
    preload = '';
    paused = true;
    play = vi.fn(async () => {
      await behavior.play();
      this.paused = false;
    });
    pause = vi.fn(() => {
      this.paused = true;
    });
    load = () => behavior.load(this);

    constructor(src = '') {
      super();
      this.src = src;
      instances.push(this);
    }
  }

  return { AudioCtor: AudioElement as unknown as typeof Audio, instances, behavior };
}

let engine: AudioEngine | undefined;

describe('audioEngine の再生失敗とリソース解放', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    engine?.dispose();
    engine = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('Audio が存在しない環境でも API を呼べて、解除済みにはならない', async () => {
    vi.stubGlobal('Audio', undefined);
    engine = createAudioEngine();
    engine.setBgmTone('bright');
    await engine.unlock();
    engine.playSfx('ship');
    engine.setMuted(true);

    expect(engine.isUnlocked()).toBe(false);
    expect(engine.getBgmTone()).toBe('bright');
    expect(engine.isMuted()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('warm-up の完了待ちで破棄されたら preload や予約 BGM を開始しない', async () => {
    const { AudioCtor, instances, behavior } = controlledAudio();
    let finishWarmup!: () => void;
    behavior.play = () => new Promise<void>((resolve) => (finishWarmup = resolve));
    engine = createAudioEngine({ AudioCtor });
    engine.setBgmTone('tense');
    const unlocking = engine.unlock();
    expect(instances).toHaveLength(1);

    engine.dispose();
    finishWarmup();
    await unlocking;

    expect(engine.isDisposed()).toBe(true);
    expect(engine.isUnlocked()).toBe(false);
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({ src: '', paused: true, currentTime: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['error', 'throw'] as const)(
    'preload が %s で失敗しても予約 BGM と後続 SFX を再生する',
    async (failure) => {
      const { AudioCtor, instances, behavior } = controlledAudio();
      behavior.load = (el) => {
        if (failure === 'throw') throw new Error('load unavailable');
        el.dispatchEvent(new Event('error'));
      };
      engine = createAudioEngine({ AudioCtor });
      engine.setBgmTone('tense');
      await engine.unlock();
      await vi.advanceTimersByTimeAsync(1500);
      const bgm = instances.find((el) => el.loop);
      expect(engine.isUnlocked()).toBe(true);
      expect(bgm).toMatchObject({ src: BGM_URLS.tense, paused: false, volume: 0.35 });

      const count = instances.length;
      engine.setBgmTone('tense');
      await engine.unlock();
      expect(instances).toHaveLength(count);
      engine.playSfx('fireSpread');
      await Promise.resolve();
      expect(instances.at(-1)).toMatchObject({ src: SFX_URLS.fireSpread, paused: false });
    },
  );

  it.each(['ended', 'error'])(
    'SFX の %s 後は音源を解放し、ミュートや破棄の対象から外す',
    async (event) => {
      const { AudioCtor, instances } = controlledAudio();
      engine = createAudioEngine({ AudioCtor });
      await engine.unlock();
      engine.playSfx('ship');
      const finished = instances.at(-1)!;
      engine.playSfx('ceremony');
      const playing = instances.at(-1)!;
      await Promise.resolve();

      finished.dispatchEvent(new Event(event));
      expect(finished.src).toBe('');
      expect(playing.src).toBe(SFX_URLS.ceremony);
      engine.setMuted(true);
      expect(finished.muted).toBe(false);
      expect(playing.muted).toBe(true);
      engine.dispose();
      expect(finished.pause).not.toHaveBeenCalled();
      expect(playing).toMatchObject({ src: '', paused: true });
    },
  );

  it('SFX の play 拒否を処理し、失敗した要素を保持しない', async () => {
    const { AudioCtor, instances, behavior } = controlledAudio();
    engine = createAudioEngine({ AudioCtor });
    await engine.unlock();
    behavior.play = async () => {
      throw new Error('NotAllowedError');
    };
    engine.playSfx('ship');
    const failed = instances.at(-1)!;
    await vi.advanceTimersByTimeAsync(0);
    expect(failed).toMatchObject({ src: '', paused: true });

    engine.setMuted(true);
    engine.dispose();
    expect(failed.muted).toBe(false);
    expect(failed.pause).not.toHaveBeenCalled();
  });

  it('BGM の play 拒否ではフェードを止め、ミュート解除で同じ音源を再試行する', async () => {
    const { AudioCtor, instances, behavior } = controlledAudio();
    engine = createAudioEngine({ AudioCtor });
    await engine.unlock();
    await vi.advanceTimersByTimeAsync(1500);
    behavior.play = async () => {
      throw new Error('NotAllowedError');
    };
    engine.setBgmTone('bright');
    const bgm = instances.at(-1)!;
    await vi.advanceTimersByTimeAsync(0);
    expect(bgm).toMatchObject({ src: BGM_URLS.bright, paused: true, volume: 0.35 });
    expect(vi.getTimerCount()).toBe(0);

    engine.setMuted(true);
    engine.setMuted(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(bgm.paused).toBe(true);
    behavior.play = async () => undefined;
    engine.setMuted(true);
    engine.setMuted(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(instances.at(-1)).toBe(bgm);
    expect(bgm).toMatchObject({ src: BGM_URLS.bright, paused: false, muted: false, volume: 0.35 });
    expect(bgm.play).toHaveBeenCalledTimes(3);
  });

  it('破棄で新旧 BGM と再生中 SFX をすべて停止し、その後の操作で再開しない', async () => {
    const { AudioCtor, instances } = controlledAudio();
    engine = createAudioEngine({ AudioCtor });
    await engine.unlock();
    await vi.advanceTimersByTimeAsync(1500);
    engine.setBgmTone('bright');
    const retiring = instances.at(-1)!;
    await vi.advanceTimersByTimeAsync(700);
    engine.setBgmTone('cloudy');
    const current = instances.at(-1)!;
    engine.playSfx('ship');
    const sfx = instances.at(-1)!;
    await vi.advanceTimersByTimeAsync(50);
    expect(retiring.src).toBe(BGM_URLS.bright);
    expect(current.src).toBe(BGM_URLS.cloudy);

    engine.dispose();
    for (const el of [retiring, current, sfx]) {
      expect(el).toMatchObject({ src: '', paused: true });
    }
    expect(engine.isUnlocked()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    const count = instances.length;
    engine.setMuted(true);
    engine.playSfx('ceremony');
    await engine.unlock();
    expect(engine.isMuted()).toBe(false);
    expect(instances).toHaveLength(count);
  });
});
