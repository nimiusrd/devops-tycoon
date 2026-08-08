import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../../../src/audio/audioEngine';
import { BGM_URLS, bgmToneForDiagnosis, SFX_URLS } from '../../../src/audio/sounds';
import { createGame } from '../../../src/game';
import { defaultMeta, normalizeMeta, withSoundMuted } from '../../../src/state/meta';

describe('サウンド定義（RI-59）', () => {
  it('診断を BGM トーンへ束ねる', () => {
    expect(bgmToneForDiagnosis('healthyAcceleration')).toBe('bright');
    expect(bgmToneForDiagnosis('documentationKingdom')).toBe('bright');
    expect(bgmToneForDiagnosis('aiOverproduction')).toBe('cloudy');
    expect(bgmToneForDiagnosis('seniorSacrifice')).toBe('cloudy');
    expect(bgmToneForDiagnosis('reviewHell')).toBe('tense');
    expect(bgmToneForDiagnosis('reworkSpiral')).toBe('tense');
    expect(bgmToneForDiagnosis(null)).toBe('off');
  });

  it('SFX / BGM の音源 URL が揃っている', () => {
    expect(Object.keys(SFX_URLS).sort()).toEqual(
      ['ceremony', 'fireSpread', 'interventionHit', 'ship'].sort(),
    );
    expect(Object.keys(BGM_URLS).sort()).toEqual(['bright', 'cloudy', 'tense'].sort());
    const audioPrefix = `${import.meta.env.BASE_URL}assets/audio/`;
    for (const url of [...Object.values(SFX_URLS), ...Object.values(BGM_URLS)]) {
      expect(url.startsWith(audioPrefix)).toBe(true);
      expect(url.endsWith('.wav')).toBe(true);
    }
  });
});

describe('MetaState.soundMuted（RI-59）', () => {
  it('defaultMeta はミュートオン', () => {
    expect(defaultMeta().soundMuted).toBe(true);
  });

  it('旧セーブに soundMuted が無くても true（既定ミュート）で補完する', () => {
    const meta = normalizeMeta({
      points: 3,
      unlockedDifficulties: ['easy', 'normal'],
    });
    expect(meta.soundMuted).toBe(true);
    expect(meta.points).toBe(3);
  });

  it('不正な soundMuted は true（既定ミュート）へ落とす', () => {
    expect(normalizeMeta({ soundMuted: 'yes' }).soundMuted).toBe(true);
  });

  it('明示 false のセーブは維持する', () => {
    expect(normalizeMeta({ soundMuted: false }).soundMuted).toBe(false);
  });

  it('withSoundMuted は不変更新する', () => {
    const base = defaultMeta();
    const unmuted = withSoundMuted(base, false);
    expect(unmuted.soundMuted).toBe(false);
    expect(base.soundMuted).toBe(true);
    expect(withSoundMuted(unmuted, false)).toBe(unmuted);
  });

  it('GameHandle.setSoundMuted がメタを更新する', () => {
    const game = createGame({ seed: 'sound-mute-unit' });
    expect(game.getMeta().soundMuted).toBe(true);
    game.setSoundMuted(false);
    expect(game.getMeta().soundMuted).toBe(false);
    game.setSoundMuted(true);
    expect(game.getMeta().soundMuted).toBe(true);
  });

  it('applyRunReward 後も soundMuted を保持する', async () => {
    const { applyRunReward } = await import('../../../src/state/meta');
    const base = withSoundMuted(defaultMeta(), true);
    const next = applyRunReward(base, {
      won: true,
      difficulty: 'normal',
      winType: 'normal',
      bossId: 'big-release',
      score: 100,
      scoreMul: 1,
      maxCombo: 1,
    });
    expect(next.soundMuted).toBe(true);
  });
});

describe('audioEngine（RI-59 / ファイル再生）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function mockAudio(options?: { playImpl?: () => Promise<void> }) {
    const play = vi.fn(options?.playImpl ?? (async () => undefined));
    const pause = vi.fn();
    const load = vi.fn();
    const instances: Array<{
      src: string;
      loop: boolean;
      muted: boolean;
      volume: number;
      currentTime: number;
      play: typeof play;
      pause: typeof pause;
      load: typeof load;
      addEventListener: ReturnType<typeof vi.fn>;
    }> = [];

    const AudioCtor = vi.fn(function AudioMock(this: Record<string, unknown>, src?: string) {
      const listeners = new Map<string, Set<() => void>>();
      const el = {
        src: src ?? '',
        loop: false,
        muted: false,
        volume: 1,
        currentTime: 0,
        preload: 'auto',
        play,
        pause,
        load,
        addEventListener: vi.fn((type: string, cb: () => void) => {
          const set = listeners.get(type) ?? new Set();
          set.add(cb);
          listeners.set(type, set);
          if (type === 'canplaythrough') queueMicrotask(cb);
        }),
      };
      instances.push(el);
      return el;
    });

    return { AudioCtor: AudioCtor as unknown as typeof Audio, play, pause, instances };
  }

  it('unlock 前は SFX を鳴らさない', async () => {
    const { AudioCtor, play } = mockAudio();
    const engine = createAudioEngine({ AudioCtor });
    engine.playSfx('ship');
    expect(play).not.toHaveBeenCalled();

    await engine.unlock();
    expect(engine.isUnlocked()).toBe(true);
    play.mockClear();
    engine.playSfx('ship');
    expect(play).toHaveBeenCalled();

    engine.setMuted(true);
    play.mockClear();
    engine.playSfx('ship');
    expect(play).not.toHaveBeenCalled();

    engine.dispose();
    expect(engine.isDisposed()).toBe(true);
  });

  it('dispose 後は再生せず、新しいエンジンは再び使える', async () => {
    const { AudioCtor, play } = mockAudio();
    const first = createAudioEngine({ AudioCtor });
    await first.unlock();
    first.dispose();
    play.mockClear();
    first.playSfx('ship');
    expect(play).not.toHaveBeenCalled();

    const second = createAudioEngine({ AudioCtor });
    await second.unlock();
    play.mockClear();
    second.playSfx('ship');
    expect(play).toHaveBeenCalled();
    second.dispose();
  });

  it('BGM トーン切替はクロスフェードで音源を差し替える（RI-63）', async () => {
    vi.useFakeTimers();
    const { AudioCtor, instances, pause } = mockAudio();
    const engine = createAudioEngine({ AudioCtor });
    await engine.unlock();

    engine.setBgmTone('bright');
    const bright = instances.find((el) => el.src.includes('bgm-bright') && el.loop);
    expect(bright).toBeDefined();
    expect(bright?.volume).toBe(0);
    await vi.advanceTimersByTimeAsync(800);
    expect(bright?.volume).toBeCloseTo(0.35);

    pause.mockClear();
    engine.setBgmTone('tense');
    const tense = instances.find((el) => el.src.includes('bgm-tense') && el.loop);
    expect(tense).toBeDefined();
    // 並行再生期間: 旧 BGM はまだ止まらず、フェードアウト中。
    expect(pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(350);
    expect(bright!.volume).toBeGreaterThan(0);
    expect(bright!.volume).toBeLessThan(0.35);
    expect(tense!.volume).toBeGreaterThan(0);
    expect(tense!.volume).toBeLessThan(0.35);
    // フェード完了: 旧 BGM は停止・解放、新 BGM は既定音量へ。
    await vi.advanceTimersByTimeAsync(500);
    expect(pause).toHaveBeenCalled();
    expect(bright?.src).toBe('');
    expect(tense?.volume).toBeCloseTo(0.35);
    engine.dispose();
  });

  it('off 指定で BGM をフェードアウトして停止する（RI-63）', async () => {
    vi.useFakeTimers();
    const { AudioCtor, instances, pause } = mockAudio();
    const engine = createAudioEngine({ AudioCtor });
    await engine.unlock();
    engine.setBgmTone('bright');
    await vi.advanceTimersByTimeAsync(800);
    const bright = instances.find((el) => el.src.includes('bgm-bright') && el.loop);

    pause.mockClear();
    engine.setBgmTone('off');
    expect(pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(800);
    expect(pause).toHaveBeenCalled();
    expect(bright?.src).toBe('');
    expect(bright?.volume).toBe(0);
    engine.dispose();
  });

  it('フェード中の dispose はタイマーを残さず即停止する（RI-63）', async () => {
    vi.useFakeTimers();
    const { AudioCtor, instances, pause } = mockAudio();
    const engine = createAudioEngine({ AudioCtor });
    await engine.unlock();
    // preload のタイムアウトタイマーを先に消化しておく。
    await vi.advanceTimersByTimeAsync(2000);

    engine.setBgmTone('bright');
    pause.mockClear();
    engine.dispose();
    expect(pause).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const bright = instances.find((el) => el.src === '' && el.loop);
    expect(bright).toBeDefined();
  });

  it('フェード中もミュートが新旧両方の BGM 要素へ反映される（RI-63）', async () => {
    vi.useFakeTimers();
    const { AudioCtor, instances } = mockAudio();
    const engine = createAudioEngine({ AudioCtor });
    await engine.unlock();
    engine.setBgmTone('bright');
    await vi.advanceTimersByTimeAsync(800);
    engine.setBgmTone('tense');
    const bright = instances.find((el) => el.src.includes('bgm-bright') && el.loop);
    const tense = instances.find((el) => el.src.includes('bgm-tense') && el.loop);

    engine.setMuted(true);
    expect(bright?.muted).toBe(true);
    expect(tense?.muted).toBe(true);
    engine.dispose();
  });

  it('warm-up 失敗時は unlocked にせず、次の操作で再試行する', async () => {
    let failOnce = true;
    const { AudioCtor, play } = mockAudio({
      playImpl: async () => {
        if (failOnce) {
          failOnce = false;
          throw new Error('NotAllowedError');
        }
      },
    });
    const engine = createAudioEngine({ AudioCtor });
    await engine.unlock();
    expect(engine.isUnlocked()).toBe(false);

    await engine.unlock();
    expect(engine.isUnlocked()).toBe(true);
    expect(play).toHaveBeenCalled();
    engine.dispose();
  });

  it('unlock では preload 完了前に warm-up play を開始する', async () => {
    const order: string[] = [];
    const play = vi.fn(async () => {
      order.push('play');
    });
    const pause = vi.fn();
    const load = vi.fn(() => {
      order.push('load');
    });
    const AudioCtor = vi.fn(function AudioMock(this: Record<string, unknown>, src?: string) {
      return {
        src: src ?? '',
        loop: false,
        muted: false,
        volume: 1,
        currentTime: 0,
        preload: 'auto',
        play,
        pause,
        load,
        addEventListener: vi.fn((type: string, cb: () => void) => {
          if (type === 'canplaythrough') {
            // preload の完了を play より後にずらす。
            setTimeout(cb, 20);
          }
        }),
      };
    }) as unknown as typeof Audio;

    const engine = createAudioEngine({ AudioCtor });
    await engine.unlock();
    expect(engine.isUnlocked()).toBe(true);
    expect(order[0]).toBe('play');
    engine.dispose();
  });
});
