/**
 * Web Audio シンセエンジン（RI-59）。
 *
 * autoplay 制約のため初回ユーザ操作まで resume しない。
 * ミュート時は出力ゲインを 0 にし、BGM スケジュールは維持する。
 */
import {
  BGM_TONES,
  SFX_PATCHES,
  type BgmToneId,
  type BgmTonePatch,
  type SfxId,
  type SfxPatch,
} from './sounds';

const MASTER_GAIN = 1;
const BGM_FADE_SEC = 0.35;
const SFX_MASTER = 0.85;

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

type AudioContextCtor = typeof AudioContext;

function resolveAudioContextCtor(): AudioContextCtor | null {
  const g = globalThis as typeof globalThis & {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function playTone(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  when: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  freqEnd?: number,
): void {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  if (freqEnd !== undefined && freqEnd !== freq) {
    osc.frequency.linearRampToValueAtTime(freqEnd, when + duration);
  }
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), when + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
  osc.connect(g);
  g.connect(dest);
  osc.start(when);
  osc.stop(when + duration + 0.02);
}

function playSfxPatch(ctx: AudioContext, dest: AudioNode, patch: SfxPatch): void {
  const now = ctx.currentTime;
  const harmonics = patch.harmonics ?? [1];
  for (const h of harmonics) {
    playTone(
      ctx,
      dest,
      patch.freq * h,
      now,
      patch.duration,
      patch.type,
      (patch.gain * SFX_MASTER) / harmonics.length,
      patch.freqEnd !== undefined ? patch.freqEnd * h : undefined,
    );
  }
}

interface BgmVoice {
  timer: number | null;
  step: number;
  tone: Exclude<BgmToneId, 'off'>;
  gain: GainNode;
}

export function createAudioEngine(): AudioEngine {
  const Ctor = resolveAudioContextCtor();
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let unlocked = false;
  let muted = false;
  let bgmTone: BgmToneId = 'off';
  let voice: BgmVoice | null = null;
  let disposed = false;

  const ensureGraph = (): { ctx: AudioContext; master: GainNode; sfxBus: GainNode } | null => {
    if (disposed || !Ctor) return null;
    if (!ctx) {
      ctx = new Ctor();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);
      sfxBus = ctx.createGain();
      sfxBus.gain.value = 1;
      sfxBus.connect(master);
    }
    return { ctx, master: master!, sfxBus: sfxBus! };
  };

  const applyMute = (): void => {
    if (!master || !ctx) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, now + 0.05);
  };

  const stopBgmVoice = (fade: boolean): void => {
    if (!voice || !ctx) {
      voice = null;
      return;
    }
    if (voice.timer !== null) {
      clearInterval(voice.timer);
      voice.timer = null;
    }
    const g = voice.gain;
    const now = ctx.currentTime;
    if (fade) {
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
      g.gain.linearRampToValueAtTime(0.0001, now + BGM_FADE_SEC);
      setTimeout(
        () => {
          try {
            g.disconnect();
          } catch {
            /* already disconnected */
          }
        },
        BGM_FADE_SEC * 1000 + 30,
      );
    } else {
      try {
        g.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    voice = null;
  };

  const scheduleBgmNote = (
    graph: { ctx: AudioContext },
    v: BgmVoice,
    patch: BgmTonePatch,
  ): void => {
    if (disposed || muted || graph.ctx.state !== 'running') return;
    const note = patch.notes[v.step % patch.notes.length]!;
    const when = graph.ctx.currentTime;
    playTone(graph.ctx, v.gain, note, when, patch.noteDuration * 0.9, patch.type, patch.gain);
    v.step += 1;
  };

  const startBgm = (tone: Exclude<BgmToneId, 'off'>): void => {
    const graph = ensureGraph();
    if (!graph || !unlocked) return;
    const patch = BGM_TONES[tone];
    stopBgmVoice(true);
    const gain = graph.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(graph.master);
    const now = graph.ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + BGM_FADE_SEC);
    const v: BgmVoice = { timer: null, step: 0, tone, gain };
    voice = v;
    scheduleBgmNote(graph, v, patch);
    const intervalMs = Math.max(80, patch.noteDuration * patch.stepMul * 1000);
    v.timer = setInterval(() => {
      if (voice !== v) return;
      scheduleBgmNote(graph, v, patch);
    }, intervalMs);
  };

  return {
    async unlock() {
      if (disposed || unlocked) return;
      const graph = ensureGraph();
      if (!graph) return;
      if (graph.ctx.state === 'suspended') {
        try {
          await graph.ctx.resume();
        } catch {
          return;
        }
      }
      unlocked = graph.ctx.state === 'running';
      if (unlocked && bgmTone !== 'off') startBgm(bgmTone);
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
      applyMute();
    },
    isMuted() {
      return muted;
    },
    playSfx(id) {
      if (disposed || muted || !unlocked) return;
      const graph = ensureGraph();
      if (!graph || graph.ctx.state !== 'running') return;
      const patch = SFX_PATCHES[id];
      playSfxPatch(graph.ctx, graph.sfxBus, patch);
    },
    setBgmTone(tone) {
      if (tone === bgmTone) return;
      bgmTone = tone;
      if (tone === 'off') {
        stopBgmVoice(true);
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
      stopBgmVoice(false);
      if (ctx) {
        void ctx.close();
      }
      ctx = null;
      master = null;
      sfxBus = null;
      unlocked = false;
    },
  };
}
