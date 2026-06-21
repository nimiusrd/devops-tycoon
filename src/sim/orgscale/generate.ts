/**
 * 組織スケール状態の決定論生成（SPEC 第4.8 / 第22.3）。
 *
 * 実ランの現場（`OrgState` + 集計）を「プレイヤーチーム」として写し取り、
 * 同じ seed から他チーム・他部門を派生させて全社マップを組み立てる。
 * 全社/部門レバーの蓄積（`OrgAdjustState`）を全チーム／対象部門へ波及させてから
 * 集約する（規模効果。第4.7）。乱数はチーム単位で派生 seed から引く。
 */
import { DEPARTMENT_DEFS } from '../../data/departments';
import { createRng } from '../rng';
import type { DiagnosisType, RunTotals } from '../run/types';
import type { OrgState } from '../types';
import { aggregateCompany, aggregateDepartment, teamHealth } from './aggregate';
import { emptyAdjust, mergeAdjust } from './levers';
import type { DepartmentDef, OrgAdjust, OrgAdjustState, OrgScaleState, Team } from './types';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** 全社生成の入力。実ランの現場状態と予算・調整を渡す。 */
export interface OrgScaleInput {
  seed: string;
  org: OrgState;
  totals: RunTotals;
  diagnosis: DiagnosisType;
  budget: number;
  /** これまでに発動したレバーの蓄積（無指定は無調整）。 */
  adjust?: OrgAdjustState;
  /** プレイヤーチームの規模（エンジニア数。編成サイズ等から。既定 5）。 */
  playerEngineers?: number;
  /**
   * 進行中スプリントの現在のレビュー待ち行列（`totals` は resolveSprint 後に更新される
   * ため、スプリント中に俯瞰すると行列が古くなる。現在値を畳み込んで現場を映す）。
   */
  liveReviewQueue?: number;
  /** 進行中スプリントで盤面に残る未鎮火インシデント数（同上）。 */
  liveIncidents?: number;
}

/** チーム名（A,B,C... 26 を超えたら番号）。 */
function teamName(index: number): string {
  return index < 26 ? `チーム${String.fromCharCode(0x41 + index)}` : `チーム${index + 1}`;
}

/** OrgAdjust を 1 チームの素の指標へ適用する（規模効果の波及）。 */
function applyAdjustToTeam(
  raw: {
    aiDependency: number;
    reviewQueue: number;
    incidents: number;
    morale: number;
    techDebt: number;
  },
  adj: OrgAdjust,
) {
  return {
    aiDependency: clamp(raw.aiDependency + adj.aiDependencyDelta, 0, 100),
    reviewQueue: Math.max(0, raw.reviewQueue + adj.reviewQueueDelta),
    incidents: Math.max(0, raw.incidents + adj.incidentDelta),
    morale: clamp(raw.morale + adj.moraleDelta, 0, 100),
    techDebt: Math.max(0, raw.techDebt + adj.techDebtDelta),
  };
}

/** プレイヤーチームの素の指標を実ランから写し取る。 */
function playerRaw(input: OrgScaleInput) {
  const { org, totals } = input;
  return {
    aiDependency: Math.round(org.aiDependency),
    // スプリント中は現在の行列/インシデントを優先し、停止中は累積ピーク/未鎮火数を使う。
    reviewQueue: Math.max(totals.reviewQueuePeak, input.liveReviewQueue ?? 0),
    incidents: Math.max(Math.max(0, totals.incidents - totals.contained), input.liveIncidents ?? 0),
    morale: Math.round(org.morale),
    techDebt: Math.round(org.techDebt),
    shipping: Math.round(org.deliveryScore),
    engineers: input.playerEngineers ?? 5,
  };
}

/** 他チームの素の指標を派生 seed から作る（プレイヤー現場をベースに分散）。 */
function rivalTeamRaw(rng: () => number, base: ReturnType<typeof playerRaw>) {
  const jitter = (center: number, spread: number) => center + Math.round((rng() * 2 - 1) * spread);
  return {
    aiDependency: clamp(jitter(base.aiDependency, 25), 0, 100),
    reviewQueue: Math.max(0, jitter(Math.max(2, base.reviewQueue), 4)),
    incidents: Math.max(0, Math.round(rng() * 2.4 - 0.6)),
    morale: clamp(jitter(base.morale, 20), 10, 100),
    techDebt: Math.max(0, jitter(Math.max(20, base.techDebt), 40)),
    shipping: Math.max(0, jitter(Math.max(40, base.shipping), Math.max(40, base.shipping * 0.6))),
    engineers: 3 + Math.floor(rng() * 6),
  };
}

/** 1 チームを組み立てる（素の指標 → 調整適用 → 健全度導出）。 */
function buildTeam(args: {
  id: string;
  deptId: string;
  name: string;
  gridX: number;
  gridY: number;
  isPlayer: boolean;
  raw: {
    aiDependency: number;
    reviewQueue: number;
    incidents: number;
    morale: number;
    techDebt: number;
    shipping: number;
    engineers: number;
  };
  adj: OrgAdjust;
}): Team {
  const adjusted = applyAdjustToTeam(args.raw, args.adj);
  const health = teamHealth(adjusted);
  return {
    id: args.id,
    deptId: args.deptId,
    name: args.name,
    gridX: args.gridX,
    gridY: args.gridY,
    shipping: args.raw.shipping,
    aiDependency: adjusted.aiDependency,
    reviewQueue: adjusted.reviewQueue,
    incidents: adjusted.incidents,
    morale: adjusted.morale,
    techDebt: adjusted.techDebt,
    engineers: args.raw.engineers,
    health,
    isPlayer: args.isPlayer,
  };
}

/**
 * 全社マップ状態を生成する。プレイヤーチームは先頭部門の先頭チームに置く。
 * 採用ドラフト/組織再編による `extraTeams` は先頭部門へ加える。
 */
export function generateOrgScale(input: OrgScaleInput): OrgScaleState {
  const adjust = input.adjust ?? { company: emptyAdjust(), byDept: {} };
  const pRaw = playerRaw(input);

  const departments = DEPARTMENT_DEFS.map((def: DepartmentDef, d: number) => {
    const deptAdj = mergeAdjust(adjust.company, adjust.byDept[def.id] ?? emptyAdjust());
    const extra = d === 0 ? Math.max(0, Math.round(adjust.company.extraTeams)) : 0;
    const count = Math.max(1, def.teamCount + extra);
    const teams: Team[] = [];
    for (let t = 0; t < count; t += 1) {
      const isPlayer = d === 0 && t === 0;
      const rng = createRng(`${input.seed}:team:${def.id}:${t}`);
      const raw = isPlayer ? pRaw : rivalTeamRaw(rng, pRaw);
      teams.push(
        buildTeam({
          id: `${def.id}-t${t}`,
          deptId: def.id,
          name: teamName(t),
          gridX: t,
          gridY: d,
          isPlayer,
          raw,
          adj: deptAdj,
        }),
      );
    }
    return aggregateDepartment(def, teams);
  });

  const infra = {
    ci: clamp(Math.round(input.org.testCoverage + adjust.company.infraBoost), 0, 100),
    docs: clamp(Math.round(input.org.documentation + adjust.company.infraBoost), 0, 100),
    aiGuideline: clamp(Math.round(input.org.aiLiteracy + adjust.company.infraBoost), 0, 100),
  };

  return aggregateCompany(departments, {
    seed: input.seed,
    budget: input.budget,
    diagnosis: input.diagnosis,
    infra,
  });
}
