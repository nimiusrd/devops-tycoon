/**
 * React 向けオーディオ Provider（RI-59）。
 *
 * エンジン寿命と unlock リスナを担い、各 Juicy コンポーネントは `useAudio()` から呼ぶ。
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createAudioEngine } from './audioEngine';
import { bgmToneForDiagnosis } from './sounds';
import { AudioContextReact, type AudioApi } from './useAudio';

export interface AudioProviderProps {
  children: ReactNode;
}

export function AudioProvider({ children }: AudioProviderProps) {
  const [engine] = useState(() => createAudioEngine());

  useEffect(() => {
    const unlock = () => {
      void engine.unlock();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener('pointerdown', unlock, opts);
    document.addEventListener('keydown', unlock, opts);
    return () => {
      document.removeEventListener('pointerdown', unlock, opts);
      document.removeEventListener('keydown', unlock, opts);
    };
  }, [engine]);

  useEffect(() => {
    return () => {
      engine.dispose();
    };
  }, [engine]);

  const api = useMemo<AudioApi>(
    () => ({
      playSfx(id) {
        engine.playSfx(id);
      },
      setBgmFromDiagnosis(diagnosis) {
        engine.setBgmTone(bgmToneForDiagnosis(diagnosis));
      },
      setBgmOff() {
        engine.setBgmTone('off');
      },
      setMuted(muted) {
        engine.setMuted(muted);
      },
      unlock() {
        void engine.unlock();
      },
    }),
    [engine],
  );

  return <AudioContextReact.Provider value={api}>{children}</AudioContextReact.Provider>;
}
