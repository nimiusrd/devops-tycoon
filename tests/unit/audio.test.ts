import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioEngine } from '../../src/audio/audioEngine';
import { bgmToneForDiagnosis, SFX_PATCHES } from '../../src/audio/sounds';
import { createGame } from '../../src/game';
import { defaultMeta, normalizeMeta, withSoundMuted } from '../../src/state/meta';

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

  it('主要 SFX パッチが揃っている', () => {
    expect(Object.keys(SFX_PATCHES).sort()).toEqual(
      ['ceremony', 'fireSpread', 'interventionHit', 'ship'].sort(),
    );
  });
});

describe('MetaState.soundMuted（RI-59）', () => {
  it('defaultMeta はミュートオフ', () => {
    expect(defaultMeta().soundMuted).toBe(false);
  });

  it('旧セーブに soundMuted が無くても false で補完する', () => {
    const meta = normalizeMeta({
      points: 3,
      unlockedDifficulties: ['easy', 'normal'],
    });
    expect(meta.soundMuted).toBe(false);
    expect(meta.points).toBe(3);
  });

  it('不正な soundMuted は false へ落とす', () => {
    expect(normalizeMeta({ soundMuted: 'yes' }).soundMuted).toBe(false);
  });

  it('withSoundMuted は不変更新する', () => {
    const base = defaultMeta();
    const muted = withSoundMuted(base, true);
    expect(muted.soundMuted).toBe(true);
    expect(base.soundMuted).toBe(false);
    expect(withSoundMuted(muted, true)).toBe(muted);
  });

  it('GameHandle.setSoundMuted がメタを更新する', () => {
    const game = createGame({ seed: 'sound-mute-unit' });
    expect(game.getMeta().soundMuted).toBe(false);
    game.setSoundMuted(true);
    expect(game.getMeta().soundMuted).toBe(true);
    game.setSoundMuted(false);
    expect(game.getMeta().soundMuted).toBe(false);
  });

  it('applyRunReward 後も soundMuted を保持する', async () => {
    const { applyRunReward } = await import('../../src/state/meta');
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

describe('audioEngine（RI-59）', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('unlock 前は SFX を鳴らさない', async () => {
    const start = vi.fn();
    const stop = vi.fn();
    const connect = vi.fn();
    const makeGain = () => ({
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect,
      disconnect: vi.fn(),
    });
    const osc = {
      type: 'sine',
      frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect,
      start,
      stop,
    };
    const ctx = {
      state: 'suspended' as AudioContextState,
      currentTime: 0,
      destination: {},
      createOscillator: vi.fn(() => osc),
      createGain: vi.fn(() => makeGain()),
      resume: vi.fn(async () => {
        ctx.state = 'running';
      }),
      close: vi.fn(async () => undefined),
    };
    const AudioContextMock = vi.fn(function AudioContextMock(this: unknown) {
      return ctx;
    });
    vi.stubGlobal('AudioContext', AudioContextMock);

    const engine = createAudioEngine();
    engine.playSfx('ship');
    expect(start).not.toHaveBeenCalled();

    await engine.unlock();
    expect(engine.isUnlocked()).toBe(true);
    engine.playSfx('ship');
    expect(start).toHaveBeenCalled();

    engine.setMuted(true);
    start.mockClear();
    engine.playSfx('ship');
    expect(start).not.toHaveBeenCalled();

    engine.dispose();
    expect(engine.isDisposed()).toBe(true);
  });

  it('dispose 後は再生せず、新しいエンジンは再び使える', async () => {
    const start = vi.fn();
    const connect = vi.fn();
    const makeGain = () => ({
      gain: {
        value: 1,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect,
      disconnect: vi.fn(),
    });
    const makeCtx = () => {
      const ctx = {
        state: 'running' as AudioContextState,
        currentTime: 0,
        destination: {},
        createOscillator: vi.fn(() => ({
          type: 'sine',
          frequency: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
          connect,
          start,
          stop: vi.fn(),
        })),
        createGain: vi.fn(() => makeGain()),
        resume: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      };
      return ctx;
    };
    const AudioContextMock = vi.fn(function AudioContextMock() {
      return makeCtx();
    });
    vi.stubGlobal('AudioContext', AudioContextMock);

    const first = createAudioEngine();
    await first.unlock();
    first.dispose();
    first.playSfx('ship');
    expect(start).not.toHaveBeenCalled();

    const second = createAudioEngine();
    await second.unlock();
    second.playSfx('ship');
    expect(start).toHaveBeenCalled();
    second.dispose();
  });
});
