/**
 * オーディオ React API（RI-59）。
 *
 * Provider 外では no-op を返し、ユニットテストでも安全に呼べる。
 */
import { createContext, useContext } from 'react';
import type { DiagnosisType } from '../sim/run/types';
import type { SfxId } from './sounds';

export interface AudioApi {
  playSfx: (id: SfxId) => void;
  setBgmFromDiagnosis: (diagnosis: DiagnosisType | null | undefined) => void;
  setBgmOff: () => void;
  setMuted: (muted: boolean) => void;
  unlock: () => void;
}

export const AudioContextReact = createContext<AudioApi | null>(null);

/** Provider 外では no-op（テストやストーリーでも安全）。 */
export const NOOP_AUDIO: AudioApi = {
  playSfx: () => undefined,
  setBgmFromDiagnosis: () => undefined,
  setBgmOff: () => undefined,
  setMuted: () => undefined,
  unlock: () => undefined,
};

export function useAudio(): AudioApi {
  return useContext(AudioContextReact) ?? NOOP_AUDIO;
}
