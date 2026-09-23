/**
 * `?rd=intervene` の解釈。本番の seed / tutorial クエリとは独立した純関数。
 */
export const RD_INTERVENE = 'intervene';

export type RdFlag = typeof RD_INTERVENE | null;

/** クエリ文字列から R&D 入口を解決する。未知値・空は null。 */
export function resolveRdFlag(search: string): RdFlag {
  const value = new URLSearchParams(search).get('rd');
  return value === RD_INTERVENE ? RD_INTERVENE : null;
}

export function resolveRdFlagFromLocation(): RdFlag {
  if (typeof window === 'undefined') return null;
  return resolveRdFlag(window.location.search);
}

export function resolveRdScenario(search: string): 'crisis' | 'stable' {
  const value = new URLSearchParams(search).get('scenario');
  return value === 'stable' ? 'stable' : 'crisis';
}
