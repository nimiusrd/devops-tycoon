/**
 * RI-59 用の短い WAV 音源を public/assets/audio/ に生成する。
 *
 * 依存なし。PCM 16-bit mono。再生成: `node scripts/generate-audio-assets.mjs`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../public/assets/audio');
const SAMPLE_RATE = 22050;

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

function renderLoop({ duration, notes, noteDuration, type, gain, stepMul = 1 }) {
  const n = Math.floor(SAMPLE_RATE * duration);
  const samples = new Float64Array(n);
  const step = noteDuration * stepMul;
  let noteIndex = 0;
  let noteStart = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    while (t >= noteStart + step) {
      noteStart += step;
      noteIndex += 1;
    }
    const local = t - noteStart;
    if (local > noteDuration) continue;
    const freq = notes[noteIndex % notes.length];
    const env = envelope(local, 0.012, noteDuration * 0.35, noteDuration);
    const phase = 2 * Math.PI * freq * local;
    const lead =
      type === 'triangle'
        ? (2 / Math.PI) * Math.asin(Math.sin(phase))
        : type === 'square'
          ? Math.sign(Math.sin(phase)) * 0.45
          : Math.sin(phase);
    // soft pad under the arpeggio
    const pad = 0.35 * Math.sin(2 * Math.PI * (freq / 2) * t);
    samples[i] = (lead + pad) * gain * env;
  }
  return samples;
}

mkdirSync(OUT_DIR, { recursive: true });

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
  [
    'bgm-bright.wav',
    renderLoop({
      duration: 6.4,
      notes: [261.63, 329.63, 392.0, 523.25],
      noteDuration: 0.28,
      type: 'triangle',
      gain: 0.09,
      stepMul: 1,
    }),
  ],
  [
    'bgm-cloudy.wav',
    renderLoop({
      duration: 7.2,
      notes: [220.0, 261.63, 293.66, 349.23],
      noteDuration: 0.38,
      type: 'sine',
      gain: 0.08,
      stepMul: 1.1,
    }),
  ],
  [
    'bgm-tense.wav',
    renderLoop({
      duration: 5.6,
      notes: [196.0, 233.08, 246.94, 293.66],
      noteDuration: 0.2,
      type: 'square',
      gain: 0.055,
      stepMul: 0.9,
    }),
  ],
];

for (const [name, samples] of assets) {
  const path = join(OUT_DIR, name);
  writeWav(path, samples);
  console.log('wrote', path, `(${samples.length} samples)`);
}
