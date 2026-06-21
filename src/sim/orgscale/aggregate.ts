/**
 * 下位 → 上位の集約ルール（SPEC 第4.7）。
 *
 * チームの事象（レビュー渋滞・炎上）を部署 → 全社へ集約し、健全度・スコアへ
 * 落とす純関数群。描画も乱数も知らない（第22.2 / 22.3）。
 */
import type { DepartmentState, OrgScaleState, Team, TeamHealth } from './types';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** チームの状態から健全度を決める（渋滞・炎上・AI過依存の優先順）。 */
export function teamHealth(
  team: Pick<Team, 'reviewQueue' | 'incidents' | 'aiDependency'>,
): TeamHealth {
  if (team.incidents >= 2 || team.reviewQueue >= 12) return 'reviewHell';
  if (team.reviewQueue >= 6 || team.aiDependency >= 70) return 'congested';
  return 'healthy';
}

/**
 * チームが「炎上中」か（炎上チーム数の母数）。
 * Review Hell（渋滞崩壊）に加え、未鎮火のインシデントを抱えるチームも炎上と数える。
 * UI のチーム島が `incidents > 0` で 🔥 を出すのと一致させ、全社スコアの炎上ペナルティも
 * 取りこぼさないようにする（health ラベルだけで判定しない）。
 */
export function isOnFire(team: Pick<Team, 'health' | 'incidents'>): boolean {
  return team.health === 'reviewHell' || team.incidents > 0;
}

/** 健全度の悪さ順位（集約時に最悪寄りを採るための重み）。 */
const HEALTH_RANK: Record<TeamHealth, number> = { healthy: 0, congested: 1, reviewHell: 2 };

/** 複数チームの健全度を集約する（過半が悪ければ部門全体を悪く見せる）。 */
export function aggregateHealth(teams: Pick<Team, 'health'>[]): TeamHealth {
  if (teams.length === 0) return 'healthy';
  const worst = teams.reduce((m, t) => Math.max(m, HEALTH_RANK[t.health]), 0);
  const fireRatio = teams.filter((t) => t.health === 'reviewHell').length / teams.length;
  if (fireRatio >= 1 / 3) return 'reviewHell';
  if (worst >= 2) return 'congested';
  return (['healthy', 'congested', 'reviewHell'] as TeamHealth[])[worst];
}

/** チーム群を部門状態へ集約する（部門HUD。第4.9）。 */
export function aggregateDepartment(def: DepartmentState['def'], teams: Team[]): DepartmentState {
  const shipping = teams.reduce((a, t) => a + t.shipping, 0);
  const aiDependency = Math.round(avg(teams.map((t) => t.aiDependency)));
  const techDebt = teams.reduce((a, t) => a + t.techDebt, 0);
  const morale = Math.round(avg(teams.map((t) => t.morale)));
  const onFire = teams.filter(isOnFire).length;
  // レビュー耐性: 行列が短いほど高い（0..100）。
  const queue = avg(teams.map((t) => t.reviewQueue));
  const reviewResilience = clamp(Math.round(100 - queue * 6), 0, 100);
  return {
    def,
    teams,
    shipping,
    aiDependency,
    reviewResilience,
    techDebt,
    morale,
    onFire,
    health: aggregateHealth(teams),
  };
}

/** 出荷スコアと健全度から S/A/B/C/D を導出する。 */
export function healthRank(input: {
  morale: number;
  techDebt: number;
  aiDependency: number;
}): string {
  // 士気が高く、負債とAI過依存が低いほど健全。
  const index =
    input.morale * 0.6 -
    Math.min(100, input.techDebt) * 0.25 -
    Math.max(0, input.aiDependency - 50) * 0.5;
  if (index >= 55) return 'S';
  if (index >= 40) return 'A';
  if (index >= 25) return 'B';
  if (index >= 10) return 'C';
  return 'D';
}

/** 全社の出荷スコア（業界比較の基準）。 */
export function companyScore(input: {
  shipping: number;
  onFire: number;
  techDebt: number;
}): number {
  // 出荷を主軸に、炎上・負債でペナルティ。
  return Math.max(
    0,
    Math.round(input.shipping - input.onFire * 40 - Math.min(300, input.techDebt) * 0.5),
  );
}

/** 部門群を全社状態へ集約する（全社HUD。第4.8）。`base` は seed・予算・診断・基盤など。 */
export function aggregateCompany(
  departments: DepartmentState[],
  base: Pick<OrgScaleState, 'seed' | 'budget' | 'diagnosis' | 'infra'>,
): OrgScaleState {
  const teams = departments.flatMap((d) => d.teams);
  const shipping = departments.reduce((a, d) => a + d.shipping, 0);
  const techDebt = departments.reduce((a, d) => a + d.techDebt, 0);
  const morale = Math.round(avg(teams.map((t) => t.morale)));
  const aiDependency = Math.round(avg(teams.map((t) => t.aiDependency)));
  const onFire = teams.filter(isOnFire).length;
  const engineers = teams.reduce((a, t) => a + t.engineers, 0);
  return {
    ...base,
    departments,
    shipping,
    teamCount: teams.length,
    deptCount: departments.length,
    engineers,
    aiDependency,
    techDebt,
    morale,
    onFire,
    score: companyScore({ shipping, onFire, techDebt }),
    healthRank: healthRank({ morale, techDebt, aiDependency }),
  };
}
