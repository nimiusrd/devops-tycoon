import { useMemo, type ReactNode } from 'react';
import { ReplayContentContext, createReplayContentResolver } from './replayContentCore';
import type { ReplayContentSnapshot } from '../state/replay';

export function ReplayContentProvider({
  contentSnapshot,
  annotationText,
  children,
}: {
  contentSnapshot: ReplayContentSnapshot | null;
  annotationText?: string;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({ ...createReplayContentResolver(contentSnapshot), annotationText }),
    [contentSnapshot, annotationText],
  );

  return <ReplayContentContext.Provider value={value}>{children}</ReplayContentContext.Provider>;
}
