import { createAudioEngine, type AudioEngine, type AudioEngineOptions } from '../audio/audioEngine';
import type { RunState } from '../sim/run/types';
import type { SprintState, Task } from '../sim/types';

const START_COUNT = 6;
const STOP_COUNT = 3;
const START_AFTER_MS = 900;
const STOP_AFTER_MS = 1_400;
const MAX_SAMPLE_GAP_MS = 500;
const FADE_STEP_MS = 50;
const FADE_STEPS = 5;
export const REVIEW_LAYER_VOLUME = 0.09;

type ReviewMusicSnapshot = Readonly<
  Pick<RunState, 'phase' | 'currentSprintId'> & {
    sprint:
      | (Readonly<Pick<SprintState, 'complete'>> & {
          tasks: readonly Readonly<Pick<Task, 'lane'>>[];
        })
      | null;
  }
>;

interface ReviewMusicPrototype extends AudioEngine {
  /** 同じ単調時計で、進行中の盤面を 500ms 以下の間隔で観測する。 */
  observe(snapshot: ReviewMusicSnapshot, nowMs: number): void;
}

/** 診断別 BGM のテンポから独立した、周期 2 秒の低域の揺らぎ。PCM 16-bit mono。 */
export function createReviewLayerWav(): Blob {
  const rate = 12_000;
  const sampleCount = rate * 2;
  const dataBytes = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(buffer);
  bytes.set(encoder.encode('RIFF'), 0);
  view.setUint32(4, 36 + dataBytes, true);
  bytes.set(encoder.encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(encoder.encode('data'), 36);
  view.setUint32(40, dataBytes, true);

  const frequencies = [67, 83, 101, 127, 139, 163, 173, 211];
  for (let i = 0; i < sampleCount; i += 1) {
    const t = (i / rate) * 2 * Math.PI;
    const voices = frequencies.reduce((sum, hz) => sum + Math.sin(hz * t), 0);
    const envelope = 0.55 - 0.25 * Math.cos(t / 2) - 0.2 * Math.cos((3 * t) / 2);
    view.setInt16(44 + i * 2, Math.round((envelope * voices * 32767) / frequencies.length), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export function createReviewMusicPrototype(options: AudioEngineOptions = {}): ReviewMusicPrototype {
  const base = createAudioEngine(options);
  const AudioCtor = options.AudioCtor ?? (typeof Audio === 'undefined' ? null : Audio);
  let sprintId: string | null = null;
  let active = false;
  let lastSample: number | null = null;
  let conditionSince: number | null = null;
  let layer: HTMLAudioElement | null = null;
  let url: string | null = null;
  let fade: ReturnType<typeof setInterval> | null = null;
  let unlocking: Promise<void> | null = null;

  function cancelFade(): void {
    if (fade !== null) clearInterval(fade);
    fade = null;
  }

  function stopLayer(): void {
    cancelFade();
    const el = layer;
    layer = null;
    if (!el) return;
    el.pause();
    el.removeAttribute('src');
    try {
      el.load();
    } catch {
      // 音源を解除済みのため、明示ロードは再試行しない。
    }
  }

  function fadeLayer(el: HTMLAudioElement, target: number): void {
    cancelFade();
    const from = el.volume;
    let step = 0;
    fade = setInterval(() => {
      step += 1;
      el.volume = from + ((target - from) * step) / FADE_STEPS;
      if (step < FADE_STEPS) return;
      cancelFade();
      if (target === 0) stopLayer();
    }, FADE_STEP_MS);
  }

  function startLayer(): void {
    if (!AudioCtor || !active || !base.isUnlocked() || base.getBgmTone() === 'off' || layer) return;
    let el: HTMLAudioElement;
    try {
      url ??= URL.createObjectURL(createReviewLayerWav());
      el = new AudioCtor(url);
    } catch {
      return;
    }
    layer = el;
    el.loop = true;
    el.volume = 0;
    el.muted = base.isMuted();
    const releaseFailedLayer = () => {
      if (layer === el) stopLayer();
    };
    el.addEventListener('error', releaseFailedLayer, { once: true });
    fadeLayer(el, REVIEW_LAYER_VOLUME);
    try {
      void el.play().catch(releaseFailedLayer);
    } catch {
      releaseFailedLayer();
    }
  }

  function resetObservation(): void {
    sprintId = null;
    active = false;
    lastSample = null;
    conditionSince = null;
    stopLayer();
  }

  return {
    ...base,
    unlock() {
      unlocking ??= base
        .unlock()
        .then(startLayer)
        .finally(() => {
          unlocking = null;
        });
      return unlocking;
    },
    setBgmTone(tone) {
      if (base.isDisposed()) return;
      base.setBgmTone(tone);
      if (tone === 'off') resetObservation();
    },
    setMuted(muted) {
      const wasMuted = base.isMuted();
      base.setMuted(muted);
      if (layer) layer.muted = base.isMuted();
      if (wasMuted && !muted) startLayer();
    },
    observe(snapshot, nowMs) {
      if (base.isDisposed() || base.getBgmTone() === 'off') return;
      const sprint = snapshot.sprint;
      const nextSprintId =
        snapshot.phase === 'sprint' && sprint && !sprint.complete ? snapshot.currentSprintId : null;
      if (nextSprintId !== sprintId) {
        resetObservation();
        sprintId = nextSprintId;
      }
      if (!sprintId || !sprint || !Number.isFinite(nowMs)) return;
      if (lastSample !== null && (nowMs < lastSample || nowMs - lastSample > MAX_SAMPLE_GAP_MS)) {
        conditionSince = null;
      }
      lastSample = nowMs;

      const count = sprint.tasks.reduce((total, task) => total + Number(task.lane === 'review'), 0);
      const changing = active ? count <= STOP_COUNT : count >= START_COUNT;
      if (!changing) {
        conditionSince = null;
        return;
      }
      conditionSince ??= nowMs;
      if (nowMs - conditionSince < (active ? STOP_AFTER_MS : START_AFTER_MS)) return;
      active = !active;
      conditionSince = null;
      if (layer) fadeLayer(layer, active ? REVIEW_LAYER_VOLUME : 0);
      else if (active) startLayer();
    },
    dispose() {
      resetObservation();
      base.dispose();
      if (url) URL.revokeObjectURL(url);
      url = null;
    },
  };
}
