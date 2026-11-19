import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BGM_URLS, SFX_URLS } from '../audio/sounds';
import { RunEngine } from '../sim/run/engine';
import { createReviewMusicPrototype } from './reviewMusic';

type Prototype = ReturnType<typeof createReviewMusicPrototype>;
type Snapshot = Parameters<Prototype['observe']>[0];

function snapshot(count: number, currentSprintId = 'q1-s1'): Snapshot {
  return {
    phase: 'sprint',
    currentSprintId,
    sprint: {
      complete: false,
      tasks: Array.from({ length: 10 }, (_, i) => ({ lane: i < count ? 'review' : 'coding' })),
    },
  };
}

function setup() {
  const elements: AudioElement[] = [];
  const play = vi.fn<(src: string) => Promise<void>>().mockResolvedValue(undefined);

  class AudioElement extends EventTarget {
    loop = false;
    muted = false;
    volume = 1;
    currentTime = 0;
    paused = true;

    constructor(public src = '') {
      super();
      elements.push(this);
    }

    play() {
      this.paused = false;
      return play(this.src);
    }

    pause() {
      this.paused = true;
    }

    load() {
      this.dispatchEvent(new Event('canplaythrough'));
    }

    removeAttribute(name: string) {
      if (name === 'src') this.src = '';
    }
  }

  const audio = createReviewMusicPrototype({ AudioCtor: AudioElement as unknown as typeof Audio });
  audio.setBgmTone('cloudy');
  const layerStarts = () => play.mock.calls.filter(([src]) => src.startsWith('blob:')).length;
  const currentLayer = () => elements.find((element) => element.src.startsWith('blob:'));
  return { audio, elements, play, layerStarts, currentLayer };
}

function observe(audio: Prototype, count: number, from: number, until: number) {
  const state = snapshot(count);
  for (let t = from; t <= until; t += 100) audio.observe(state, t);
}

describe('レビュー滞留に連動する音楽層の試作', () => {
  let audio: Prototype;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    audio.dispose();
    vi.useRealTimers();
  });

  it('短い閾値往復と観測中断では始動せず、継続した滞留で一度だけ始動する', async () => {
    const test = setup();
    audio = test.audio;
    await audio.unlock();

    for (let t = 0; t < 1_000; t += 100) audio.observe(snapshot(t % 200 === 0 ? 6 : 5), t);
    observe(audio, 6, 1_000, 1_800);
    observe(audio, 6, 2_400, 3_200);
    expect(test.layerStarts()).toBe(0);
    observe(audio, 6, 3_300, 4_000);
    expect(test.layerStarts()).toBe(1);

    for (let t = 4_100; t < 5_600; t += 100) audio.observe(snapshot(t % 200 === 0 ? 3 : 4), t);
    observe(audio, 3, 5_600, 6_900);
    expect(test.currentLayer()).toBeDefined();
    audio.observe(snapshot(3), 7_000);
    await vi.advanceTimersByTimeAsync(250);
    expect(test.currentLayer()).toBeUndefined();
    expect(test.layerStarts()).toBe(1);
  });

  it('フェードのタイマーが遅れた場合も再増加で同じ層に戻る', async () => {
    const test = setup();
    audio = test.audio;
    await audio.unlock();
    observe(audio, 8, 0, 900);
    const layer = test.currentLayer();
    await vi.advanceTimersByTimeAsync(250);
    observe(audio, 3, 1_000, 2_400);
    observe(audio, 8, 2_500, 3_400);
    await vi.advanceTimersByTimeAsync(250);
    expect(test.currentLayer()).toBe(layer);
    expect(layer?.volume).toBe(0.09);
    expect(test.layerStarts()).toBe(1);
  });

  it('unlock とミュートを共有し、BGM 切替中も危険 SFX とレイヤーを独立に流す', async () => {
    const test = setup();
    audio = test.audio;
    audio.setMuted(true);
    observe(audio, 8, 0, 900);
    audio.playSfx('fireSpread');
    expect(test.play).not.toHaveBeenCalled();
    test.play.mockRejectedValueOnce(new Error('NotAllowed'));
    await audio.unlock();
    expect(audio.isUnlocked()).toBe(false);
    expect(test.layerStarts()).toBe(0);
    await audio.unlock();
    expect(audio.isUnlocked()).toBe(true);
    const layer = test.currentLayer();
    expect(layer).toMatchObject({ muted: true, loop: true, paused: false });

    audio.setMuted(false);
    audio.setBgmTone('tense');
    audio.playSfx('fireSpread');
    expect(test.elements.find((el) => el.src === BGM_URLS.tense && el.loop)?.paused).toBe(false);
    const sfx = test.elements[test.elements.length - 1];
    expect(sfx).toMatchObject({
      src: SFX_URLS.fireSpread,
      muted: false,
      paused: false,
      volume: 0.7,
    });
    expect(layer?.muted).toBe(false);
    expect(test.layerStarts()).toBe(1);

    audio.setMuted(true);
    expect(sfx.muted).toBe(true);
    expect(layer?.muted).toBe(true);
  });

  it('スプリント終了・BGM off・dispose で層を解放し、破棄後の入力には反応しない', async () => {
    const test = setup();
    audio = test.audio;
    await audio.unlock();
    observe(audio, 8, 0, 900);
    const layer = test.currentLayer();
    audio.observe({ ...snapshot(8), phase: 'result' }, 1_000);
    expect(layer).toMatchObject({ src: '', paused: true });
    observe(audio, 8, 1_100, 2_000);
    const second = test.currentLayer();
    audio.setBgmTone('off');
    expect(second).toMatchObject({ src: '', paused: true });
    observe(audio, 8, 2_100, 3_000);
    expect(test.layerStarts()).toBe(2);
    audio.setBgmTone('bright');
    observe(audio, 8, 3_100, 4_000);
    const third = test.currentLayer();
    audio.playSfx('fireSpread');
    const sfx = test.elements[test.elements.length - 1];
    const count = test.elements.length;
    await vi.advanceTimersByTimeAsync(1_500);
    audio.dispose();
    expect(third).toMatchObject({ src: '', paused: true });
    expect(sfx).toMatchObject({ src: '', paused: true });
    expect(vi.getTimerCount()).toBe(0);

    audio.setBgmTone('cloudy');
    audio.setMuted(false);
    await audio.unlock();
    observe(audio, 8, 4_100, 5_000);
    audio.playSfx('fireSpread');
    expect(test.elements).toHaveLength(count);
  });

  it('スプリント ID の変更は旧レイヤーを止め、新しい盤面で継続時間を判定する', async () => {
    const test = setup();
    audio = test.audio;
    await audio.unlock();
    observe(audio, 8, 0, 900);
    const prior = test.currentLayer();
    const next = snapshot(7, 'q1-s2');
    for (let t = 1_000; t < 1_900; t += 100) audio.observe(next, t);
    expect(prior).toMatchObject({ src: '', paused: true });
    expect(test.layerStarts()).toBe(1);
    audio.observe(next, 1_900);
    expect(test.layerStarts()).toBe(2);
  });

  it('unlock 待ちの dispose で遅れてレイヤーを開始しない', async () => {
    const test = setup();
    audio = test.audio;
    let finish = () => {};
    test.play.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    observe(audio, 8, 0, 900);
    const unlocking = audio.unlock();
    audio.dispose();
    finish();
    await unlocking;
    expect(test.layerStarts()).toBe(0);
    expect(test.elements).toHaveLength(1);
  });

  it('層の再生が拒否されても sim の入力結果と進行が変わらず、観測ごとに再試行しない', async () => {
    const test = setup();
    audio = test.audio;
    await audio.unlock();
    test.play.mockRejectedValueOnce(new Error('layer unavailable'));
    const seed = 'ri-283-audio-isolation';
    const base = new RunEngine({ seed, difficulty: 'normal' });
    const observed = new RunEngine({ seed, difficulty: 'normal' });
    for (const engine of [base, observed]) {
      engine.startRun('normal', [], seed);
      engine.beginSetupSprint();
    }
    for (let t = 0; t <= 2_000; t += 100) {
      base.step(100);
      observed.step(100);
      const state = observed.snapshot();
      expect(state).toEqual(base.snapshot());
      // 拒否経路を確実に踏む固定滞留を、観測用コピーにだけ与える。
      const sample = { ...state, sprint: snapshot(8).sprint };
      const untouched = structuredClone(sample);
      audio.observe(sample, t);
      await vi.advanceTimersByTimeAsync(100);
      expect(sample).toEqual(untouched);
    }
    expect(test.layerStarts()).toBe(1);
    expect(test.currentLayer()).toBeUndefined();
    expect(observed.dispatch('overtime')).toEqual(base.dispatch('overtime'));
    observed.step(1_000);
    base.step(1_000);
    expect(observed.snapshot()).toEqual(base.snapshot());
  });
});
