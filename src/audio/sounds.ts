/**
 * サウンド定義（RI-59 / SPEC §18.3）。
 *
 * 音源ファイルは使わず、Web Audio シンセ用のパラメータだけを持つ。
 * sim 層には触れない（描画・演出専用）。
 */
import type { DiagnosisType } from '../sim/run/types';

export type SfxId = 'interventionHit' | 'ship' | 'fireSpread' | 'ceremony';

/** BGM の空気感トーン（診断 6 種を 3 系統に束ねる）。 */
export type BgmToneId = 'bright' | 'cloudy' | 'tense' | 'off';

export interface SfxPatch {
  /** 基音周波数 (Hz)。 */
  freq: number;
  /** 終端周波数 (Hz)。無い場合は基音のまま。 */
  freqEnd?: number;
  /** 長さ (秒)。 */
  duration: number;
  type: OscillatorType;
  /** ピークゲイン。 */
  gain: number;
  /** 同時に鳴らす倍音比（省略可）。 */
  harmonics?: readonly number[];
}

export interface BgmTonePatch {
  /** アルペジオの基音列 (Hz)。 */
  notes: readonly number[];
  /** 1 ノート長 (秒)。 */
  noteDuration: number;
  type: OscillatorType;
  gain: number;
  /** テンポ感を出す間隔倍率（大きいほど疎）。 */
  stepMul: number;
}

export const SFX_PATCHES: Record<SfxId, SfxPatch> = {
  interventionHit: {
    freq: 520,
    freqEnd: 780,
    duration: 0.12,
    type: 'triangle',
    gain: 0.12,
    harmonics: [1, 1.5],
  },
  ship: {
    freq: 440,
    freqEnd: 880,
    duration: 0.18,
    type: 'sine',
    gain: 0.1,
    harmonics: [1, 2],
  },
  fireSpread: {
    freq: 180,
    freqEnd: 90,
    duration: 0.28,
    type: 'sawtooth',
    gain: 0.07,
  },
  ceremony: {
    freq: 523.25,
    duration: 0.45,
    type: 'sine',
    gain: 0.11,
    harmonics: [1, 1.25, 1.5],
  },
};

export const BGM_TONES: Record<Exclude<BgmToneId, 'off'>, BgmTonePatch> = {
  bright: {
    notes: [261.63, 329.63, 392.0, 523.25],
    noteDuration: 0.22,
    type: 'triangle',
    gain: 0.035,
    stepMul: 1,
  },
  cloudy: {
    notes: [220.0, 261.63, 293.66, 349.23],
    noteDuration: 0.32,
    type: 'sine',
    gain: 0.028,
    stepMul: 1.15,
  },
  tense: {
    notes: [196.0, 233.08, 246.94, 293.66],
    noteDuration: 0.18,
    type: 'square',
    gain: 0.018,
    stepMul: 0.85,
  },
};

/** 診断種別 → BGM トーン。 */
export function bgmToneForDiagnosis(diagnosis: DiagnosisType | null | undefined): BgmToneId {
  if (!diagnosis) return 'off';
  switch (diagnosis) {
    case 'healthyAcceleration':
    case 'documentationKingdom':
      return 'bright';
    case 'aiOverproduction':
    case 'seniorSacrifice':
      return 'cloudy';
    case 'reviewHell':
    case 'reworkSpiral':
      return 'tense';
    default:
      return 'off';
  }
}
