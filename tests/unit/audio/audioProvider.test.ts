import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  effect: undefined as (() => void | (() => void)) | undefined,
  contextValue: null as unknown,
}));

// DOM を必要としない Provider の effect 登録と Context の受け渡しを検証する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (initial: unknown) => ({ current: initial }),
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (effect: () => void | (() => void)) => {
    hooks.effect = effect;
  },
  useContext: () => hooks.contextValue,
}));

import { AudioProvider } from '../../../src/audio/AudioProvider';
import { BGM_URLS, SFX_URLS } from '../../../src/audio/sounds';
import {
  AudioContextReact,
  NOOP_AUDIO,
  useAudio,
  type AudioApi,
} from '../../../src/audio/useAudio';

class ProviderAudio extends EventTarget {
  static instances: ProviderAudio[] = [];
  src: string;
  loop = false;
  muted = false;
  volume = 1;
  currentTime = 0;
  preload = '';
  paused = true;

  constructor(src = '') {
    super();
    this.src = src;
    ProviderAudio.instances.push(this);
  }

  async play() {
    this.paused = false;
  }

  pause() {
    this.paused = true;
  }

  load() {
    this.dispatchEvent(new Event('canplaythrough'));
  }
}

let cleanup: (() => void) | undefined;

function setupEffect() {
  if (!hooks.effect) throw new Error('AudioProvider の effect が登録されていません');
  cleanup = hooks.effect() ?? undefined;
}

function renderProvider() {
  const element = AudioProvider({ children: 'audio consumer' });
  expect(element.type).toBe(AudioContextReact.Provider);
  expect(element.props.children).toBe('audio consumer');
  hooks.contextValue = element.props.value;
  return useAudio();
}

describe('AudioProvider / useAudio のライフサイクル', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    ProviderAudio.instances = [];
    hooks.effect = undefined;
    hooks.contextValue = null;
    vi.stubGlobal('Audio', ProviderAudio);
    vi.stubGlobal('document', new EventTarget());
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('Provider 外の API はすべて安全な no-op になる', () => {
    const audio = useAudio();
    expect(audio).toBe(NOOP_AUDIO);
    expect(audio.playSfx('ship')).toBeUndefined();
    expect(audio.setBgmFromDiagnosis('reviewHell')).toBeUndefined();
    expect(audio.setBgmOff()).toBeUndefined();
    expect(audio.setMuted(true)).toBeUndefined();
    expect(audio.unlock()).toBeUndefined();
    expect(ProviderAudio.instances).toHaveLength(0);
  });

  it('Provider の Context API をそのまま返し、診断・SFX・ミュート・停止を再生へ反映する', async () => {
    const audio = renderProvider();
    expect(audio).toBe(hooks.contextValue as AudioApi);
    setupEffect();

    audio.setBgmFromDiagnosis('seniorSacrifice');
    expect(ProviderAudio.instances).toHaveLength(0);
    audio.unlock();
    await vi.advanceTimersByTimeAsync(700);
    const bgm = ProviderAudio.instances.find((el) => el.loop);
    expect(bgm).toMatchObject({ src: BGM_URLS.cloudy, paused: false, volume: 0.35 });

    audio.playSfx('ceremony');
    const sfx = ProviderAudio.instances.at(-1);
    expect(sfx).toMatchObject({ src: SFX_URLS.ceremony, paused: false, volume: 0.7 });
    audio.setMuted(true);
    expect(bgm?.muted).toBe(true);
    expect(sfx?.muted).toBe(true);

    audio.setBgmOff();
    await vi.advanceTimersByTimeAsync(700);
    expect(bgm).toMatchObject({ src: '', paused: true, volume: 0 });
  });

  it.each(['pointerdown', 'keydown'])(
    '%s で解除し、アンマウント時に両方のリスナと音源を解放する',
    async (event) => {
      const add = vi.spyOn(document, 'addEventListener');
      const remove = vi.spyOn(document, 'removeEventListener');
      const audio = renderProvider();
      setupEffect();
      expect(add.mock.calls.map(([type]) => type)).toEqual(['pointerdown', 'keydown']);
      for (const [, , options] of add.mock.calls) {
        expect(options).toEqual({ capture: true, passive: true });
      }

      audio.playSfx('ship');
      expect(ProviderAudio.instances).toHaveLength(0);
      document.dispatchEvent(new Event(event));
      await Promise.resolve();
      audio.playSfx('ship');
      const sfx = ProviderAudio.instances.at(-1);
      expect(sfx).toMatchObject({ src: SFX_URLS.ship, paused: false });

      cleanup?.();
      cleanup = undefined;
      expect(remove.mock.calls).toEqual(add.mock.calls);
      expect(sfx).toMatchObject({ src: '', paused: true });
    },
  );

  it('StrictMode の cleanup→setup 後も同じ API が新しいエンジンを操作する', async () => {
    const audio = renderProvider();
    setupEffect();
    audio.unlock();
    await Promise.resolve();
    audio.playSfx('ship');
    const first = ProviderAudio.instances.at(-1);
    expect(first?.src).toBe(SFX_URLS.ship);

    cleanup?.();
    expect(first).toMatchObject({ src: '', paused: true });
    setupEffect();
    const countBeforeUnlock = ProviderAudio.instances.length;
    audio.playSfx('ship');
    expect(ProviderAudio.instances).toHaveLength(countBeforeUnlock);

    document.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    audio.playSfx('ship');
    const second = ProviderAudio.instances.at(-1);
    expect(second).not.toBe(first);
    expect(second).toMatchObject({ src: SFX_URLS.ship, paused: false });
    expect(first).toMatchObject({ src: '', paused: true });
  });

  it('effect より前に API で作ったエンジンの解除状態とミュートを setup 後も維持する', async () => {
    const audio = renderProvider();
    audio.setMuted(true);
    audio.unlock();
    await Promise.resolve();
    const countBeforeSetup = ProviderAudio.instances.length;

    setupEffect();
    document.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    expect(ProviderAudio.instances).toHaveLength(countBeforeSetup);
    audio.setBgmFromDiagnosis('healthyAcceleration');
    expect(ProviderAudio.instances.at(-1)).toMatchObject({
      src: BGM_URLS.bright,
      paused: false,
      muted: true,
    });
  });
});
