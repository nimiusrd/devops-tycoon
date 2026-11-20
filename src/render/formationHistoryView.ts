import { rankLabel } from '../sim/member';
import type { MemberHistory } from '../sim/member/types';

type HistoryEvent = MemberHistory['events'][number];

export interface FormationHistoryEntry {
  key: string;
  sprintNumber: number;
  name: string;
  description: string;
}

function describeEvent(event: HistoryEvent): string {
  switch (event.kind) {
    case 'promotion':
      return `初昇格（${rankLabel(event.to)}）`;
    case 'leave':
      return `休職（${event.reason === 'exhaustion' ? 'スタミナ枯渇' : '組織再編'}）`;
    case 'return':
      return '復帰';
  }
}

export function formationHistoryView(history: MemberHistory | undefined, activeTeamId: string) {
  const byMemberId = new Map<string, FormationHistoryEntry[]>();
  for (const event of history?.events ?? []) {
    if (event.teamId !== activeTeamId) continue;
    const entries = byMemberId.get(event.id) ?? [];
    entries.push({
      key: `${event.sprintNumber}-${event.kind}`,
      sprintNumber: event.sprintNumber,
      name: event.name,
      description: describeEvent(event),
    });
    byMemberId.set(event.id, entries);
  }
  return { byMemberId, startedAfterSprint: history?.startedAfterSprint ?? 0 };
}
