/**
 * BGM / SFX の WAV 音源を public/assets/audio/ に生成する（RI-59 / RI-63）。
 *
 * 依存なし。PCM 16-bit mono。再生成: `node scripts/generate-audio-assets.mjs`
 *
 * BGM は bass / pad / lead の 3 レイヤをコード進行に沿ってレンダリングし、
 * 末尾を先頭へ等パワークロスフェードで折り込むことで HTMLAudioElement の
 * loop=true でも継ぎ目のクリックノイズが出ないループ素材にする（RI-63）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SAMPLE_RATE = 22050;

/** MIDI ノート番号 → 周波数(Hz)。A4(69)=440Hz。 */
export function noteHz(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function writeWav(path, samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const s = clamp(Math.round(samples[i] * 32767), -32768, 32767);
    buffer.writeInt16LE(s, 44 + i * 2);
  }
  writeFileSync(path, buffer);
}

function envelope(t, attack, release, duration) {
  if (t < attack) return t / attack;
  if (t > duration - release) return Math.max(0, (duration - t) / release);
  return 1;
}

function oscillator(type, freq, t) {
  const phase = 2 * Math.PI * freq * t;
  if (type === 'triangle') return (2 / Math.PI) * Math.asin(Math.sin(phase));
  if (type === 'square') return Math.sign(Math.sin(phase)) * 0.45;
  if (type === 'sawtooth') return (2 * ((freq * t) % 1) - 1) * 0.45;
  return Math.sin(phase);
}

function renderTone({
  duration,
  freq,
  freqEnd = freq,
  type = 'sine',
  gain = 0.25,
  harmonics = [1],
}) {
  const n = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = envelope(t, 0.01, Math.min(0.08, duration * 0.35), duration);
    const f = freq + (freqEnd - freq) * (t / duration);
    let v = 0;
    for (const h of harmonics) {
      const phase = 2 * Math.PI * f * h * t;
      if (type === 'triangle') {
        v += ((2 / Math.PI) * Math.asin(Math.sin(phase))) / harmonics.length;
      } else if (type === 'square') {
        v += (Math.sign(Math.sin(phase)) * 0.55) / harmonics.length;
      } else if (type === 'sawtooth') {
        v += ((2 * ((f * h * t) % 1) - 1) * 0.45) / harmonics.length;
      } else {
        v += Math.sin(phase) / harmonics.length;
      }
    }
    samples[i] = v * gain * env;
  }
  return samples;
}

/**
 * 1 音を samples へ加算する。detuneCents 指定時は ±cents の 2 声で厚みを出す。
 * harmonics は [倍音次数, 振幅] の配列。
 */
function addNote(
  samples,
  { startSec, durSec, freq, type, gain, attack, release, detuneCents = 0, harmonics = [[1, 1]] },
) {
  const start = Math.max(0, Math.round(startSec * SAMPLE_RATE));
  const end = Math.min(samples.length, Math.round((startSec + durSec) * SAMPLE_RATE));
  const freqs =
    detuneCents > 0
      ? [freq * 2 ** (-detuneCents / 1200), freq * 2 ** (detuneCents / 1200)]
      : [freq];
  const voiceGain = gain / freqs.length;
  for (let i = start; i < end; i += 1) {
    const local = i / SAMPLE_RATE - startSec;
    const env = envelope(local, attack, release, durSec);
    let v = 0;
    for (const f of freqs) {
      for (const [mult, amp] of harmonics) {
        v += amp * oscillator(type, f * mult, local);
      }
    }
    samples[i] += v * voiceGain * env;
  }
}

/**
 * 末尾 fadeN サンプルを先頭 fadeN サンプルへ等パワー(sin/cos)クロスフェードで
 * 折り込み、長さ loopN のシームレスループ素材を返す。
 */
export function bakeLoopCrossfade(samples, loopN, fadeN) {
  const out = new Float64Array(loopN);
  out.set(samples.subarray(0, loopN));
  for (let i = 0; i < fadeN; i += 1) {
    const w = (i / fadeN) * (Math.PI / 2);
    out[i] = out[i] * Math.sin(w) + samples[loopN + i] * Math.cos(w);
  }
  return out;
}

/** コードトーン参照。index がコード構成音数を超えたらオクターブ上へ折り返す。 */
function chordTone(chord, index) {
  return chord[index % chord.length] + 12 * Math.floor(index / chord.length);
}

/**
 * 楽曲を 1 ループ分レンダリングする。
 * ループ端クロスフェード焼き込み・ピーク正規化済みの Float64Array を返す。
 */
export function renderSong({
  bpm,
  bars,
  beatsPerBar = 4,
  chords,
  layers,
  loopFadeSec = 0.25,
  targetPeak = 0.55,
}) {
  const beatDur = 60 / bpm;
  const barDur = beatsPerBar * beatDur;
  const loopN = Math.round(bars * barDur * SAMPLE_RATE);
  const fadeN = Math.round(loopFadeSec * SAMPLE_RATE);
  const samples = new Float64Array(loopN + fadeN);
  // フェード分は 1 小節余分にレンダリングし、小節/パターン参照はループ先頭へ巻き戻す。
  const totalBars = Math.ceil((loopN + fadeN) / (barDur * SAMPLE_RATE));
  for (const layer of layers) {
    for (let barIndex = 0; barIndex < totalBars; barIndex += 1) {
      const loopBar = barIndex % bars;
      const chord = chords[loopBar % chords.length];
      const barStart = barIndex * barDur;
      if (layer.kind === 'pad') {
        for (const midi of chord) {
          addNote(samples, {
            startSec: barStart,
            durSec: barDur,
            freq: noteHz(midi + (layer.oct ?? 0)),
            type: layer.wave ?? 'sine',
            gain: layer.gain / chord.length,
            attack: 0.5 * beatDur,
            release: 0.5 * beatDur,
            detuneCents: layer.detuneCents ?? 4,
          });
        }
      } else if (layer.kind === 'bass') {
        for (const beat of layer.beats) {
          addNote(samples, {
            startSec: barStart + beat * beatDur,
            durSec: (layer.noteBeats ?? 0.9) * beatDur,
            freq: noteHz(chord[0] + (layer.oct ?? -12)),
            type: layer.wave ?? 'sine',
            gain: layer.gain,
            attack: 0.012,
            release: 0.3 * (layer.noteBeats ?? 0.9) * beatDur,
            harmonics: layer.harmonics ?? [
              [1, 1],
              [2, 0.3],
            ],
          });
        }
      } else if (layer.kind === 'lead') {
        const pattern = layer.patterns[layer.barPatterns[loopBar]];
        const stepDur = beatDur / layer.stepsPerBeat;
        for (let step = 0; step < pattern.length; step += 1) {
          const toneIndex = pattern[step];
          if (toneIndex === null) continue;
          const durSec = stepDur * (layer.legato ?? 0.85);
          addNote(samples, {
            startSec: barStart + step * stepDur,
            durSec,
            freq: noteHz(chordTone(chord, toneIndex) + (layer.oct ?? 12)),
            type: layer.wave ?? 'triangle',
            gain: layer.gain,
            attack: 0.012,
            release: 0.35 * durSec,
          });
        }
      }
    }
  }
  const looped = bakeLoopCrossfade(samples, loopN, fadeN);
  let peak = 0;
  for (let i = 0; i < looped.length; i += 1) peak = Math.max(peak, Math.abs(looped[i]));
  if (peak > 0) {
    const scale = targetPeak / peak;
    for (let i = 0; i < looped.length; i += 1) looped[i] *= scale;
  }
  return looped;
}

// --- BGM 楽曲定義（診断トーン別ムード、RI-63） ---

// bright: C メジャー、C–G–Am–F を 3 巡（3 巡目はメロディ変化）。明快・軽快。
const C = [60, 64, 67];
const G = [55, 59, 62];
const Am = [57, 60, 64];
const F = [53, 57, 60];

// cloudy: A マイナー 7th 系の浮遊感あるパッド主体。疎なペンタトニックのリード。
const Am7 = [57, 60, 64, 67];
const Fmaj7 = [53, 57, 60, 64];
const Cmaj7 = [60, 64, 67, 71];
const Em7 = [52, 55, 59, 62];

// tense: G フリジアン。G ペダルの低音オスティナートに ♭II(A♭)・減5度スタブ。
const G5th = [43, 50];
const AbStab = [44, 51];
const TriStab = [49, 55];

export const BGM_DEFS = {
  bright: {
    bpm: 112,
    bars: 12,
    chords: [C, G, Am, F],
    layers: [
      { kind: 'pad', wave: 'sine', gain: 0.3, detuneCents: 4 },
      { kind: 'bass', wave: 'sine', gain: 0.5, beats: [0, 2], noteBeats: 0.9 },
      {
        kind: 'lead',
        wave: 'triangle',
        gain: 0.38,
        stepsPerBeat: 2,
        oct: 12,
        patterns: [
          [0, 1, 2, 3, 2, 1, 0, 2],
          [3, 2, 4, 3, 5, 4, 3, 2],
        ],
        barPatterns: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
      },
    ],
  },
  cloudy: {
    bpm: 88,
    bars: 8,
    chords: [Am7, Fmaj7, Cmaj7, Em7],
    layers: [
      { kind: 'pad', wave: 'sine', gain: 0.5, detuneCents: 6 },
      { kind: 'bass', wave: 'sine', gain: 0.4, beats: [0], noteBeats: 3.5 },
      {
        kind: 'lead',
        wave: 'sine',
        gain: 0.24,
        stepsPerBeat: 0.5,
        oct: 12,
        legato: 0.9,
        patterns: [
          [2, null],
          [1, 3],
          [3, null],
          [2, 1],
        ],
        barPatterns: [0, 1, 0, 3, 0, 1, 2, 3],
      },
    ],
  },
  tense: {
    bpm: 126,
    bars: 12,
    chords: [G5th, G5th, G5th, AbStab, G5th, G5th, G5th, AbStab, G5th, G5th, TriStab, AbStab],
    layers: [
      { kind: 'pad', wave: 'sine', gain: 0.38, detuneCents: 5 },
      {
        kind: 'bass',
        wave: 'square',
        gain: 0.32,
        beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
        noteBeats: 0.4,
        oct: 0,
        harmonics: [[1, 1]],
      },
      {
        kind: 'lead',
        wave: 'square',
        gain: 0.2,
        stepsPerBeat: 2,
        oct: 24,
        patterns: [
          [0, null, null, null, null, null, 1, null],
          [0, null, 0, null, null, 1, null, null],
        ],
        barPatterns: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0],
      },
    ],
  },
};

function main() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = join(__dirname, '../public/assets/audio');
  mkdirSync(outDir, { recursive: true });

  const assets = [
    [
      'sfx-intervention-hit.wav',
      renderTone({
        duration: 0.14,
        freq: 520,
        freqEnd: 820,
        type: 'triangle',
        gain: 0.28,
        harmonics: [1, 1.5],
      }),
    ],
    [
      'sfx-ship.wav',
      renderTone({
        duration: 0.2,
        freq: 440,
        freqEnd: 880,
        type: 'sine',
        gain: 0.24,
        harmonics: [1, 2],
      }),
    ],
    [
      'sfx-fire-spread.wav',
      renderTone({
        duration: 0.32,
        freq: 190,
        freqEnd: 85,
        type: 'sawtooth',
        gain: 0.18,
        harmonics: [1, 0.5],
      }),
    ],
    [
      'sfx-ceremony.wav',
      renderTone({
        duration: 0.55,
        freq: 523.25,
        freqEnd: 784,
        type: 'sine',
        gain: 0.26,
        harmonics: [1, 1.25, 1.5],
      }),
    ],
    ['bgm-bright.wav', renderSong(BGM_DEFS.bright)],
    ['bgm-cloudy.wav', renderSong(BGM_DEFS.cloudy)],
    ['bgm-tense.wav', renderSong(BGM_DEFS.tense)],
  ];

  for (const [name, samples] of assets) {
    const path = join(outDir, name);
    writeWav(path, samples);
    console.log('wrote', path, `(${(samples.length / SAMPLE_RATE).toFixed(1)}s)`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
