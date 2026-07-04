/**
 * 全社/部門レバー係数の許容レンジ（RI-16）。
 *
 * `src/data/levers.ts` の暫定値を代表 baseline 上で検証し、
 * 係数変更時の回帰を検知する。
 */
import { DEPARTMENT_DEFS } from '../../../src/data/departments';
import { LEVER_DEFS } from '../../../src/data/levers';
import {
  applyLever,
  emptyAdjustState,
  generateOrgScale,
  type OrgScaleInput,
} from '../../../src/sim/orgscale';
import type { LeverDef, OrgAdjust, OrgScaleState, Team } from '../../../src/sim/orgscale/types';
import { assertWithinRange, summarizeNumeric } from './monteCarlo';

/** 四半期予算コストの許容レンジ（全社 max=45 / 部門 max=18 想定）。 */
export const LEVER_COST_RANGE = { min: 1, max: 50 } as const;

/** レバー 1 回あたりの効果量上限（絶対値）。 */
export const LEVER_EFFECT_RANGES: Record<keyof OrgAdjust, { min: number; max: number }> = {
  aiDependencyDelta: { min: -20, max: 20 },
  reviewQueueDelta: { min: -8, max: 0 },
  incidentDelta: { min: -5, max: 0 },
  moraleDelta: { min: -10, max: 10 },
  techDebtDelta: { min: -25, max: 0 },
  extraTeams: { min: 0, max: 2 },
  infraBoost: { min: 0, max: 15 },
};

/** レバー適用後の全社集約指標の許容レンジ。techDebt は全チーム合算のため上限を広げる。 */
export const ORG_SCALE_AGGREGATE_RANGES = {
  aiDependency: { min: 0, max: 100 },
  morale: { min: 0, max: 100 },
  techDebt: { min: 0, max: 1200 },
  onFire: { min: 0, max: 20 },
  score: { min: 0, max: 10_000 },
} as const;

const ORG_ADJUST_KEYS = Object.keys(LEVER_EFFECT_RANGES) as (keyof OrgAdjust)[];

/** レバー定義のコスト・効果量が許容レンジ内か検証する。 */
export function assertLeverDefInRange(lever: LeverDef): void {
  if (lever.cost < LEVER_COST_RANGE.min || lever.cost > LEVER_COST_RANGE.max) {
    throw new Error(
      `${lever.id}: cost=${lever.cost} が許容レンジ [${LEVER_COST_RANGE.min}, ${LEVER_COST_RANGE.max}] を外れました`,
    );
  }

  for (const key of ORG_ADJUST_KEYS) {
    const value = lever.effect[key];
    if (value === undefined) continue;
    const range = LEVER_EFFECT_RANGES[key];
    if (value < range.min || value > range.max) {
      throw new Error(
        `${lever.id}.${key}=${value} が許容レンジ [${range.min}, ${range.max}] を外れました`,
      );
    }
  }
}

/** 全社集約値が表示・ゲームプレイ可能な範囲内か検証する。 */
export function assertOrgScaleHealthy(state: OrgScaleState, label: string): void {
  for (const [key, range] of Object.entries(ORG_SCALE_AGGREGATE_RANGES)) {
    const value = state[key as keyof typeof ORG_SCALE_AGGREGATE_RANGES];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${label}: ${key} が有限値ではありません (${value})`);
    }
    if (value < range.min || value > range.max) {
      throw new Error(
        `${label}: ${key}=${value} が許容レンジ [${range.min}, ${range.max}] を外れました`,
      );
    }
  }

  for (const infraKey of ['ci', 'docs', 'aiGuideline'] as const) {
    const value = state.infra[infraKey];
    if (value < 0 || value > 100) {
      throw new Error(`${label}: infra.${infraKey}=${value} が [0, 100] を外れました`);
    }
  }

  for (const team of state.departments.flatMap((d) => d.teams)) {
    assertTeamHealthy(team, `${label}/${team.id}`);
  }
}

function assertTeamHealthy(team: Team, label: string): void {
  const bounded: Array<[string, number, number, number]> = [
    ['aiDependency', team.aiDependency, 0, 100],
    ['morale', team.morale, 0, 100],
    ['reviewQueue', team.reviewQueue, 0, 50],
    ['incidents', team.incidents, 0, 20],
    ['techDebt', team.techDebt, 0, 200],
  ];
  for (const [name, value, min, max] of bounded) {
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new Error(`${label}: ${name}=${value} が [${min}, ${max}] を外れました`);
    }
  }
}

/** 代表 baseline でレバーを 1 回適用し、予算・集約値を検証する。 */
export function applyLeverOnBaseline(
  lever: LeverDef,
  baselineInput: OrgScaleInput,
  deptId = DEPARTMENT_DEFS[0].id,
): { budget: number; state: OrgScaleState } {
  const budget = Math.max(lever.cost + 20, baselineInput.budget ?? 100);
  const dept = lever.scope === 'department' ? deptId : undefined;
  const res = applyLever(emptyAdjustState(), budget, lever.id, dept);
  if (!res.changed) {
    throw new Error(`${lever.id}: 代表 baseline で applyLever が失敗しました`);
  }
  if (res.budget < 0) {
    throw new Error(`${lever.id}: 適用後 budget=${res.budget} が負です`);
  }

  const state = generateOrgScale({ ...baselineInput, budget: res.budget, adjust: res.adjust });
  assertOrgScaleHealthy(state, lever.id);
  return { budget: res.budget, state };
}

/** 部門レバーが対象部門以外へ波及しないことを検証する。 */
export function assertDepartmentLeverIsolated(
  lever: LeverDef,
  baselineInput: OrgScaleInput,
  targetDeptId: string,
  otherDeptId: string,
): void {
  if (lever.scope !== 'department') return;

  const baseline = generateOrgScale(baselineInput);
  const { state: after } = applyLeverOnBaseline(lever, baselineInput, targetDeptId);

  const unchangedTeams = (deptId: string) =>
    baseline.departments.find((d) => d.def.id === deptId)!.teams;
  const changedTeams = (deptId: string) =>
    after.departments.find((d) => d.def.id === deptId)!.teams;

  const otherBefore = unchangedTeams(otherDeptId);
  const otherAfter = changedTeams(otherDeptId);
  if (JSON.stringify(otherBefore) !== JSON.stringify(otherAfter)) {
    throw new Error(`${lever.id}: 非対象部門 ${otherDeptId} に副作用があります`);
  }

  const targetBefore = unchangedTeams(targetDeptId);
  const targetAfter = changedTeams(targetDeptId);
  const hasEffect = targetBefore.some((before, i) => {
    const afterTeam = targetAfter[i];
    return (
      before.reviewQueue !== afterTeam.reviewQueue ||
      before.aiDependency !== afterTeam.aiDependency ||
      before.morale !== afterTeam.morale ||
      before.techDebt !== afterTeam.techDebt ||
      before.incidents !== afterTeam.incidents
    );
  });
  if (!hasEffect) {
    throw new Error(`${lever.id}: 対象部門 ${targetDeptId} に効果が見えません`);
  }
}

/** 全レバーを代表 seed 群で走査し、効果の方向性が期待どおりか集計する。 */
export function summarizeLeverImpacts(
  levers: readonly LeverDef[],
  baselineInput: OrgScaleInput,
): Record<string, { aiDependency: number; morale: number; techDebt: number; onFire: number }> {
  const baseline = generateOrgScale(baselineInput);
  const impacts: Record<
    string,
    { aiDependency: number; morale: number; techDebt: number; onFire: number }
  > = {};

  for (const lever of levers) {
    const { state } = applyLeverOnBaseline(lever, baselineInput);
    impacts[lever.id] = {
      aiDependency: state.aiDependency - baseline.aiDependency,
      morale: state.morale - baseline.morale,
      techDebt: state.techDebt - baseline.techDebt,
      onFire: state.onFire - baseline.onFire,
    };
  }
  return impacts;
}

/** 複数 seed のレバー影響を集計し許容レンジ内か検証する。 */
export function assertLeverImpactRanges(
  leverIds: readonly string[],
  seedPrefixes: readonly string[],
  baselineFactory: (seed: string) => OrgScaleInput,
  ranges: Record<
    string,
    Partial<Record<'aiDependency' | 'morale' | 'techDebt' | 'onFire', { min: number; max: number }>>
  >,
): void {
  for (const leverId of leverIds) {
    const lever = LEVER_DEFS.find((l) => l.id === leverId);
    if (!lever) throw new Error(`未知のレバー: ${leverId}`);
    const leverRanges = ranges[leverId];
    if (!leverRanges) continue;

    for (const metric of Object.keys(leverRanges) as Array<
      keyof NonNullable<(typeof ranges)[string]>
    >) {
      const range = leverRanges[metric]!;
      const values = seedPrefixes.map((prefix) => {
        const impacts = summarizeLeverImpacts([lever], baselineFactory(`${prefix}-ri16`));
        return impacts[leverId][metric];
      });
      assertWithinRange(summarizeNumeric(values), range, `${leverId}.${metric}`);
    }
  }
}
