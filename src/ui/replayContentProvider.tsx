import { useMemo, type ReactNode } from 'react';
import { ReplayContentContext, createReplayContentResolver } from './replayContentCore';
import type { ReplayContentSnapshot } from '../state/replay';

export function ReplayContentProvider({
  contentSnapshot,
  children,
}: {
  contentSnapshot: ReplayContentSnapshot | null;
  children: ReactNode;
}) {
  const value = useMemo(() => createReplayContentResolver(contentSnapshot), [contentSnapshot]);

  return <ReplayContentContext.Provider value={value}>{children}</ReplayContentContext.Provider>;
}
