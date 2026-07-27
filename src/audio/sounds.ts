/**
 * サウンド定義（RI-59 / SPEC §18.3）。
 *
 * 音源は `public/assets/audio/*.wav`。再生成は `node scripts/generate-audio-assets.mjs`。
 * sim 層には触れない（描画・演出専用）。
 */
import type { DiagnosisType } from '../sim/run/types';
import { publicUrl } from '../utils/publicUrl';

export type SfxId = 'interventionHit' | 'ship' | 'fireSpread' | 'ceremony';

/** BGM の空気感トーン（診断 6 種を 3 系統に束ねる）。 */
export type BgmToneId = 'bright' | 'cloudy' | 'tense' | 'off';

const AUDIO_BASE = publicUrl('assets/audio');

/** SFX ID → 音源 URL。 */
export const SFX_URLS: Record<SfxId, string> = {
  interventionHit: `${AUDIO_BASE}/sfx-intervention-hit.wav`,
  ship: `${AUDIO_BASE}/sfx-ship.wav`,
  fireSpread: `${AUDIO_BASE}/sfx-fire-spread.wav`,
  ceremony: `${AUDIO_BASE}/sfx-ceremony.wav`,
};

/** BGM トーン → ループ音源 URL。 */
export const BGM_URLS: Record<Exclude<BgmToneId, 'off'>, string> = {
  bright: `${AUDIO_BASE}/bgm-bright.wav`,
  cloudy: `${AUDIO_BASE}/bgm-cloudy.wav`,
  tense: `${AUDIO_BASE}/bgm-tense.wav`,
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
