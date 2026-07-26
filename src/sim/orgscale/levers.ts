/**
 * レバー適用の純関数（SPEC 第4.8 / 第4.9 / RI-64）。
 *
 * レバーの効果を `OrgAdjustState`（全社 + 部門別 + チーム別）へ畳み込み、予算を差し引く。
 * 蓄積された調整は投影時に対象へ波及させる（第4.7）。
 * 予算不足や未知のレバーは「変化なし」を返す（呼び出し側で安全に扱える）。
 */
import { getLever } from '../../data/levers';
import type { OrgAdjust, OrgAdjustState } from './types';

/** 無調整の `OrgAdjust`。 */
export function emptyAdjust(): OrgAdjust {
  return {
    aiDependencyDelta: 0,
    reviewQueueDelta: 0,
    incidentDelta: 0,
    moraleDelta: 0,
    techDebtDelta: 0,
    extraTeams: 0,
    infraBoost: 0,
  };
}

/** 無調整の `OrgAdjustState`。 */
export function emptyAdjustState(): OrgAdjustState {
  return { company: emptyAdjust(), byDept: {}, byTeam: {} };
}

/** 2 つの `OrgAdjust` を加算合成する（部門 = 全社 + 部門スコープ）。 */
export function mergeAdjust(a: OrgAdjust, b: OrgAdjust): OrgAdjust {
  return {
    aiDependencyDelta: a.aiDependencyDelta + b.aiDependencyDelta,
    reviewQueueDelta: a.reviewQueueDelta + b.reviewQueueDelta,
    incidentDelta: a.incidentDelta + b.incidentDelta,
    moraleDelta: a.moraleDelta + b.moraleDelta,
    techDebtDelta: a.techDebtDelta + b.techDebtDelta,
    extraTeams: a.extraTeams + b.extraTeams,
    infraBoost: a.infraBoost + b.infraBoost,
  };
}

/** 効果差分（Partial）を `OrgAdjust` へ加算する。 */
function addEffect(base: OrgAdjust, effect: Partial<OrgAdjust>): OrgAdjust {
  return mergeAdjust(base, { ...emptyAdjust(), ...effect });
}

/** レバー適用の結果。`changed=false` なら予算不足/不正で何も起きていない。 */
export interface LeverResult {
  adjust: OrgAdjustState;
  budget: number;
  changed: boolean;
  cost: number;
  /** 適用したレバー定義の extraTeams（呼び出し側で永続配列へ append）。 */
  extraTeamsAdded: number;
  /** チームスコープで適用した対象 ID。 */
  teamId?: string;
}

/**
 * レバーを適用した新しい調整状態と残予算を返す（不変）。
 * 部門レバーには `deptId`、チームレバーには `teamId` が必須。
 * 予算不足・スコープ不一致は変化なし。
 */
export function applyLever(
  adjust: OrgAdjustState,
  budget: number,
  leverId: string,
  deptId?: string,
  teamId?: string,
): LeverResult {
  const def = getLever(leverId);
  const fail: LeverResult = {
    adjust,
    budget,
    changed: false,
    cost: 0,
    extraTeamsAdded: 0,
  };
  if (!def) return fail;
  if (budget < def.cost) return fail;
  if (def.scope === 'department' && !deptId) return fail;
  if (def.scope === 'team' && !teamId) return fail;
  if (def.scope === 'company' && (deptId || teamId)) return fail;
  if (def.scope === 'department' && teamId) return fail;
  if (def.scope === 'team' && deptId) return fail;

  const byTeam = { ...(adjust.byTeam ?? {}) };
  const extraTeamsAdded = Math.max(0, Math.round(def.effect.extraTeams ?? 0));

  if (def.scope === 'company') {
    return {
      adjust: {
        company: addEffect(adjust.company, def.effect),
        byDept: { ...adjust.byDept },
        byTeam,
      },
      budget: budget - def.cost,
      changed: true,
      cost: def.cost,
      extraTeamsAdded,
    };
  }

  if (def.scope === 'team') {
    const id = teamId as string;
    // チーム効果は呼び出し側が TeamRunState へ直接適用する（投影オーバーレイと二重にしない）。
    return {
      adjust: {
        company: adjust.company,
        byDept: { ...adjust.byDept },
        byTeam: { ...(adjust.byTeam ?? {}) },
      },
      budget: budget - def.cost,
      changed: true,
      cost: def.cost,
      extraTeamsAdded: 0,
      teamId: id,
    };
  }

  const id = deptId as string;
  const prev = adjust.byDept[id] ?? emptyAdjust();
  return {
    adjust: {
      company: adjust.company,
      byDept: { ...adjust.byDept, [id]: addEffect(prev, def.effect) },
      byTeam,
    },
    budget: budget - def.cost,
    changed: true,
    cost: def.cost,
    extraTeamsAdded: 0,
  };
}
