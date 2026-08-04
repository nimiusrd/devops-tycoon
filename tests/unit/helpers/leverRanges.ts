/**
 * 全社/部門レバー係数の許容レンジ（RI-16）。
 *
 * `src/data/levers.ts` の暫定値を代表 baseline 上で検証し、
 * 係数変更時の回帰を検知する。
 */
import { DEPARTMENT_DEFS } from '../../../src/data/departments';
import { LEVER_DEFS } from '../../../src/data/levers';
import {
  applyEffectToTeam,
  applyLever,
  emptyAdjustState,
  generateOrgScale,
  HOME_TEAM_ID,
  initTeamRunStates,
  type OrgScaleInput,
} from '../../../src/sim/orgscale';
import type { LeverDef, OrgAdjust, OrgScaleState, Team } from '../../../src/sim/orgscale/types';
import { assertWithinRange, summarizeNumeric } from './monteCarlo';

/** 四半期予算コストの許容レンジ（スコープ別）。 */
export const LEVER_COST_RANGE_BY_SCOPE = {
  company: { min: 1, max: 45 },
  department: { min: 1, max: 18 },
  team: { min: 1, max: 12 },
} as const;

/** レバー 1 回あたりの効果量上限（絶対値）。 */
export const LEVER_EFFECT_RANGES: Record<keyof OrgAdjust, { min: number; max: number }> = {
  aiDependencyDelta: { min: -20, max: 20 },
  reviewQueueDelta: { min: -8, max: -1 },
  incidentDelta: { min: -5, max: -1 },
  moraleDelta: { min: -10, max: 10 },
  techDebtDelta: { min: -25, max: -1 },
  extraTeams: { min: 1, max: 2 },
  infraBoost: { min: 1, max: 15 },
};

/** レバー適用後の全社集約指標の許容レンジ。techDebt は全チーム合算のため上限を広げる。 */
export const ORG_SCALE_AGGREGATE_RANGES = {
  aiDependency: { min: 0, max: 100 },
  morale: { min: 0, max: 100 },
  techDebt: { min: 0, max: 1200 },
  onFire: { min: 0, max: 20 },
  score: { min: 0, max: 10_000 },
} as const;

export type LeverImpactMetric =
  | 'aiDependency'
  | 'morale'
  | 'techDebt'
  | 'onFire'
  | 'playerReviewQueue'
  | 'playerAiDependency'
  | 'playerMorale'
  | 'teamCount'
  | 'infraCi';

export type LeverImpactSnapshot = Record<LeverImpactMetric, number>;

const ORG_ADJUST_KEYS = Object.keys(LEVER_EFFECT_RANGES) as (keyof OrgAdjust)[];

/** 明示された効果フィールドがゼロになっていないか検証する。 */
function assertNonZeroEffect(lever: LeverDef, key: keyof OrgAdjust, value: number): void {
  if (value === 0) {
    throw new Error(`${lever.id}.${key}=0 はゼロ効果のため許容されません`);
  }
}

/** レバー定義のコスト・効果量が許容レンジ内か検証する。 */
export function assertLeverDefInRange(lever: LeverDef): void {
  const costRange = LEVER_COST_RANGE_BY_SCOPE[lever.scope];
  if (lever.cost < costRange.min || lever.cost > costRange.max) {
    throw new Error(
      `${lever.id}: cost=${lever.cost} が ${lever.scope} の許容レンジ ` +
        `[${costRange.min}, ${costRange.max}] を外れました`,
    );
  }

  for (const key of ORG_ADJUST_KEYS) {
    const value = lever.effect[key];
    if (value === undefined) continue;
    assertNonZeroEffect(lever, key, value);
    const range = LEVER_EFFECT_RANGES[key];
    if (value < range.min || value > range.max) {
      throw new Error(
        `${lever.id}.${key}=${value} が許容レンジ [${range.min}, ${range.max}] を外れました`,
      );
    }
  }
}

function playerTeam(state: OrgScaleState): Team {
  const team = state.departments.flatMap((d) => d.teams).find((t) => t.isPlayer);
  if (!team) throw new Error('プレイヤーチームが見つかりません');
  return team;
}

/** 適用前後の差分を impact メトリクスとして取り出す。 */
export function diffLeverImpact(
  baseline: OrgScaleState,
  after: OrgScaleState,
): LeverImpactSnapshot {
  const beforePlayer = playerTeam(baseline);
  const afterPlayer = playerTeam(after);
  return {
    aiDependency: after.aiDependency - baseline.aiDependency,
    morale: after.morale - baseline.morale,
    techDebt: after.techDebt - baseline.techDebt,
    onFire: after.onFire - baseline.onFire,
    playerReviewQueue: afterPlayer.reviewQueue - beforePlayer.reviewQueue,
    playerAiDependency: afterPlayer.aiDependency - beforePlayer.aiDependency,
    playerMorale: afterPlayer.morale - beforePlayer.morale,
    teamCount: after.teamCount - baseline.teamCount,
    infraCi: after.infra.ci - baseline.infra.ci,
  };
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

function teamMetricsDiffer(before: Team, after: Team): boolean {
  return (
    before.reviewQueue !== after.reviewQueue ||
    before.aiDependency !== after.aiDependency ||
    before.morale !== after.morale ||
    before.techDebt !== after.techDebt ||
    before.incidents !== after.incidents
  );
}

/** 代表 baseline でレバーを 1 回適用し、予算・集約値を検証する。 */
export function applyLeverOnBaseline(
  lever: LeverDef,
  baselineInput: OrgScaleInput,
  deptId = DEPARTMENT_DEFS[0].id,
  teamId = 'product-t1',
): { budget: number; state: OrgScaleState } {
  const budget = Math.max(lever.cost + 20, baselineInput.budget ?? 100);
  const dept = lever.scope === 'department' ? deptId : undefined;
  const team = lever.scope === 'team' ? teamId : undefined;
  const priorAdjust = baselineInput.adjust ?? emptyAdjustState();
  const res = applyLever(priorAdjust, budget, lever.id, dept, team);
  if (!res.changed) {
    throw new Error(`${lever.id}: 代表 baseline で applyLever が失敗しました`);
  }
  if (res.budget < 0) {
    throw new Error(`${lever.id}: 適用後 budget=${res.budget} が負です`);
  }

  let input: OrgScaleInput = { ...baselineInput, budget: res.budget, adjust: res.adjust };
  // チームレバーは永続状態へ直接適用する経路を単発生成で再現する。
  if (lever.scope === 'team' && res.teamId) {
    let teams =
      baselineInput.teams ??
      initTeamRunStates({
        seed: baselineInput.seed,
        org: baselineInput.org,
        homeEngineers: baselineInput.playerEngineers ?? 5,
      });
    teams = teams.map((t) => (t.id === res.teamId ? applyEffectToTeam(t, lever.effect) : t));
    input = {
      ...input,
      teams,
      homeTeamId: baselineInput.homeTeamId ?? HOME_TEAM_ID,
      activeTeamId: baselineInput.activeTeamId ?? HOME_TEAM_ID,
    };
  }

  const state = generateOrgScale(input);
  assertOrgScaleHealthy(state, lever.id);
  return { budget: res.budget, state };
}

/** 部門レバーが対象部門以外へ波及しないことを検証する。 */
export function assertDepartmentLeverIsolated(
  lever: LeverDef,
  baselineInput: OrgScaleInput,
  targetDeptId: string,
): void {
  if (lever.scope !== 'department') return;

  const baseline = generateOrgScale(baselineInput);
  const { state: after } = applyLeverOnBaseline(lever, baselineInput, targetDeptId);

  const teamsIn = (state: OrgScaleState, deptId: string) =>
    state.departments.find((d) => d.def.id === deptId)!.teams;

  for (const dept of DEPARTMENT_DEFS) {
    if (dept.id === targetDeptId) continue;
    const before = teamsIn(baseline, dept.id);
    const changed = teamsIn(after, dept.id);
    if (JSON.stringify(before) !== JSON.stringify(changed)) {
      throw new Error(`${lever.id}: 非対象部門 ${dept.id} に副作用があります`);
    }
  }

  const targetBefore = teamsIn(baseline, targetDeptId);
  const targetAfter = teamsIn(after, targetDeptId);
  const allTeamsAffected = targetBefore.every((before, i) =>
    teamMetricsDiffer(before, targetAfter[i]),
  );
  if (!allTeamsAffected) {
    throw new Error(`${lever.id}: 対象部門 ${targetDeptId} の全チームに効果が波及していません`);
  }
}

/** 全レバーを代表 seed 群で走査し、効果の方向性が期待どおりか集計する。 */
export function summarizeLeverImpacts(
  levers: readonly LeverDef[],
  baselineInput: OrgScaleInput,
  deptId = DEPARTMENT_DEFS[0].id,
): Record<string, LeverImpactSnapshot> {
  const baseline = generateOrgScale(baselineInput);
  const impacts: Record<string, LeverImpactSnapshot> = {};

  for (const lever of levers) {
    const { state } = applyLeverOnBaseline(lever, baselineInput, deptId);
    impacts[lever.id] = diffLeverImpact(baseline, state);
  }
  return impacts;
}

/** 複数 seed のレバー影響を集計し許容レンジ内か検証する。 */
export function assertLeverImpactRanges(
  leverIds: readonly string[],
  seedPrefixes: readonly string[],
  baselineFactory: (seed: string) => OrgScaleInput,
  ranges: Record<string, Partial<Record<LeverImpactMetric, { min: number; max: number }>>>,
  opts?: { deptId?: string; requireAllRanges?: boolean },
): void {
  const deptId = opts?.deptId ?? DEPARTMENT_DEFS[0].id;
  const requireAllRanges = opts?.requireAllRanges ?? false;

  for (const leverId of leverIds) {
    const lever = LEVER_DEFS.find((l) => l.id === leverId);
    if (!lever) throw new Error(`未知のレバー: ${leverId}`);
    const leverRanges = ranges[leverId];
    if (!leverRanges) {
      if (requireAllRanges) {
        throw new Error(`RI16_LEVER_IMPACT_RANGES に ${leverId} の定義がありません`);
      }
      continue;
    }

    for (const metric of Object.keys(leverRanges) as LeverImpactMetric[]) {
      const range = leverRanges[metric]!;
      const values = seedPrefixes.map((prefix) => {
        const impacts = summarizeLeverImpacts([lever], baselineFactory(`${prefix}-ri16`), deptId);
        return impacts[leverId][metric];
      });
      assertWithinRange(summarizeNumeric(values), range, `${leverId}.${metric}`);
    }
  }
}

/** 全社・部門レバー（従来 12 種）の主効果を代表 seed 群で一括検証する。 */
export const RI16_LEVER_IMPACT_RANGES: Record<
  string,
  Partial<Record<LeverImpactMetric, { min: number; max: number }>>
> = {
  recruitDraft: { teamCount: { min: 1, max: 1 }, morale: { min: -5, max: -1 } },
  aiGuideline: { aiDependency: { min: -20, max: -12 }, infraCi: { min: 4, max: 8 } },
  infraInvest: { playerReviewQueue: { min: -5, max: -1 }, infraCi: { min: 10, max: 14 } },
  standardize: { techDebt: { min: -220, max: -150 }, infraCi: { min: 8, max: 12 } },
  firefighters: { morale: { min: 1, max: 8 }, onFire: { min: -10, max: -1 } },
  reorg: {
    teamCount: { min: 1, max: 1 },
    playerReviewQueue: { min: -4, max: -1 },
    morale: { min: -8, max: -4 },
  },
  reviewReinforce: { playerReviewQueue: { min: -6, max: -2 } },
  prSizeLimit: { playerReviewQueue: { min: -4, max: -1 }, techDebt: { min: -80, max: -10 } },
  aiThrottleDept: { playerAiDependency: { min: -14, max: -10 } },
  seniorHiring: { playerReviewQueue: { min: -5, max: -1 }, playerMorale: { min: 2, max: 4 } },
  dependencyCleanup: { techDebt: { min: -60, max: -5 }, onFire: { min: -4, max: -1 } },
  deptFreeze: { onFire: { min: -4, max: -1 }, playerMorale: { min: -6, max: -2 } },
};

export function assertAllLeverImpactRanges(
  seedPrefixes: readonly string[],
  baselineFactory: (seed: string) => OrgScaleInput,
): void {
  // チームレバー（RI-64）は対象が単一チームのため別テストで検証する。
  const legacy = LEVER_DEFS.filter((l) => l.scope !== 'team');
  assertLeverImpactRanges(
    legacy.map((l) => l.id),
    seedPrefixes,
    baselineFactory,
    RI16_LEVER_IMPACT_RANGES,
    { requireAllRanges: true },
  );
}
