import { useEffect, useState } from 'react';
import {
  hypothesisNoteStore,
  type HypothesisNoteSnapshot,
  type HypothesisNoteStore,
} from '../state/hypothesisNotePersistence';

export const HYPOTHESIS_NOTE_SAVE_FAILED =
  'メモを端末に保存できませんでした。このタブを閉じるまでは表示されます。';

/** 仮説メモの現在値を購読し、初回表示時に端末から読み込む。 */
export function useHypothesisNote(
  store: HypothesisNoteStore = hypothesisNoteStore,
): HypothesisNoteSnapshot {
  const [snapshot, setSnapshot] = useState(() => store.getSnapshot());
  useEffect(() => {
    const unsubscribe = store.subscribe(() => setSnapshot(store.getSnapshot()));
    setSnapshot(store.getSnapshot());
    void store.load();
    return unsubscribe;
  }, [store]);
  return snapshot;
}
