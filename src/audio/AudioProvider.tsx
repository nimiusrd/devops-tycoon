/**
 * React 向けオーディオ Provider（RI-59）。
 *
 * エンジン寿命と unlock リスナを担い、各 Juicy コンポーネントは `useAudio()` から呼ぶ。
 * StrictMode の cleanup→setup では dispose 済みエンジンを捨てて再生成する。
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createAudioEngine, type AudioEngine } from './audioEngine';
import { bgmToneForDiagnosis } from './sounds';
import { AudioContextReact, type AudioApi } from './useAudio';

export interface AudioProviderProps {
  children: ReactNode;
}

function getOrCreateEngine(ref: { current: AudioEngine | null }): AudioEngine {
  if (ref.current == null || ref.current.isDisposed()) {
    ref.current = createAudioEngine();
  }
  return ref.current;
}

export function AudioProvider({ children }: AudioProviderProps) {
  const engineRef = useRef<AudioEngine | null>(null);

  useEffect(() => {
    const active = getOrCreateEngine(engineRef);
    const unlock = () => {
      void active.unlock();
    };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener('pointerdown', unlock, opts);
    document.addEventListener('keydown', unlock, opts);
    return () => {
      document.removeEventListener('pointerdown', unlock, opts);
      document.removeEventListener('keydown', unlock, opts);
      active.dispose();
      if (engineRef.current === active) {
        engineRef.current = null;
      }
    };
  }, []);

  const api = useMemo<AudioApi>(
    () => ({
      playSfx(id) {
        getOrCreateEngine(engineRef).playSfx(id);
      },
      setBgmFromDiagnosis(diagnosis) {
        getOrCreateEngine(engineRef).setBgmTone(bgmToneForDiagnosis(diagnosis));
      },
      setBgmOff() {
        getOrCreateEngine(engineRef).setBgmTone('off');
      },
      setMuted(muted) {
        getOrCreateEngine(engineRef).setMuted(muted);
      },
      unlock() {
        void getOrCreateEngine(engineRef).unlock();
      },
    }),
    [],
  );

  return <AudioContextReact.Provider value={api}>{children}</AudioContextReact.Provider>;
}
