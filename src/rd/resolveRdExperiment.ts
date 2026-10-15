/**
 * 通常ランから切り離した R&D 試作の入口（`?rd=`）。
 * 未知の値は無視し、本番 UI へフォールバックする。
 */

export type RdArm = 'none' | 'reserve';

export interface RdExperimentRef {
  id: '735';
  arm: RdArm;
  seed: string;
}

export const RD_735_ID = '735';
export const RD_735_DEFAULT_SEED = 'RI-735';

const RD_735_ALIASES = new Set(['735', 'issue-735', 'queue-moves']);

export function resolveRdExperiment(search: string): RdExperimentRef | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const rd = params.get('rd');
  if (!rd || !RD_735_ALIASES.has(rd)) return null;
  const arm: RdArm = params.get('arm') === 'reserve' ? 'reserve' : 'none';
  const seed = params.get('seed');
  return {
    id: RD_735_ID,
    arm,
    seed: seed && seed.length > 0 ? seed : RD_735_DEFAULT_SEED,
  };
}

export function rdExperimentPath(arm: RdArm, seed: string = RD_735_DEFAULT_SEED): string {
  const params = new URLSearchParams({ rd: RD_735_ID, arm, seed });
  return `/?${params.toString()}`;
}
