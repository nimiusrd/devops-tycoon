/**
 * 独立チーム状態の初期化・投影・粗粒度進行・同期（RI-64 / SPEC 第4.7）。
 *
 * `TeamRunState` がラン中の正本。表示用 `OrgScaleState` はここから投影する。
 * 乱数は seed 派生のみ（第22.3）。
 */
import { DEPARTMENT_DEFS } from '../../data/departments';
import {
  MEMBER_NAMES,
  RECRUIT_ARCHETYPES,
  STARTER_ARCHETYPES,
  type MemberArchetype,
} from '../../data/members';
import { createMember, type RosterState } from '../member';
import { createRng } from '../rng';
import type { DiagnosisType } from '../run/types';
import type { OrgState } from '../types';
import { aggregateCompany, aggregateDepartment, teamHealth } from './aggregate';
import { emptyAdjust, mergeAdjust } from './levers';
import type {
  DepartmentDef,
  OrgAdjust,
  OrgAdjustState,
  OrgScaleState,
  Team,
  TeamRunState,
} from './types';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** ホームチーム ID（先頭部門の先頭）。 */
export const HOME_TEAM_ID = 'product-t0';

/** チームへ入り込むときの次スプリント集中力ペナルティ（RI-64）。 */
export const ENTER_TEAM_FOCUS_PENALTY = -2;

/** 入り込み後、他チームへ切り替えできないスプリント数。 */
export const ENTER_TEAM_LOCK_SPRINTS = 1;

/** チーム名（A,B,C... 26 を超えたら番号）。 */
export function teamName(index: number): string {
  return index < 26 ? `チーム${String.fromCharCode(0x41 + index)}` : `チーム${index + 1}`;
}

/** ライバル島の AI 配布人数を engineers×aiDependency から推定する。 */
export function estimateRivalAiAssigned(engineers: number, aiDependency: number): number {
  return Math.max(0, Math.round((engineers * clamp(aiDependency, 0, 100)) / 100));
}

/** OrgAdjust を 1 チームの表示指標へ適用する。 */
export function applyAdjustToRaw(
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

/**
 * チーム指標へ焼き込んだあと、投影と二重にならないよう指標差分を落とす。
 * `infraBoost` / `extraTeams` だけ残す（基盤ハブ表示・採用履歴用）。
 */
export function retainNonMetricAdjust(adj: OrgAdjust): OrgAdjust {
  return {
    ...emptyAdjust(),
    infraBoost: adj.infraBoost,
    extraTeams: adj.extraTeams,
  };
}

/** 全社・部門レバー適用後に、指標差分を焼き込み済みとして OrgAdjustState から除く。 */
export function stripMetricAdjustments(adjust: OrgAdjustState): OrgAdjustState {
  const byDept: Record<string, OrgAdjust> = {};
  for (const [id, adj] of Object.entries(adjust.byDept)) {
    byDept[id] = retainNonMetricAdjust(adj);
  }
  return {
    company: retainNonMetricAdjust(adjust.company),
    byDept,
    byTeam: { ...(adjust.byTeam ?? {}) },
  };
}

/** 初期生成時のホーム素指標（ライバル派生のベース。旧 playerRaw 互換）。 */
function homeSeedRaw(
  org: OrgState,
  engineers: number,
  extras?: { reviewQueue?: number; incidents?: number },
) {
  return {
    aiDependency: Math.round(org.aiDependency),
    // 初期ホームは空盤面。蓄積分は beginSprint で詳細盤面へ投入する。
    reviewQueue: Math.max(0, extras?.reviewQueue ?? 0),
    incidents: Math.max(0, extras?.incidents ?? 0),
    morale: Math.round(org.morale),
    techDebt: Math.round(org.techDebt),
    shipping: Math.round(org.deliveryScore),
    engineers,
    aiLiteracy: Math.round(org.aiLiteracy),
    seniorHp: Math.round(org.seniorHp),
    aiEnabled: org.aiEnabled,
    testCoverage: Math.round(org.testCoverage),
    documentation: Math.round(org.documentation),
    quality: Math.round(org.quality),
  };
}

/** 他チームの素の指標を派生 seed から作る（ホームをベースに分散。初期化専用）。 */
function rivalTeamRaw(rng: () => number, base: ReturnType<typeof homeSeedRaw>) {
  const jitter = (center: number, spread: number) => center + Math.round((rng() * 2 - 1) * spread);
  // 乱数消費順は従来どおり（ai→…→shipping→engineers）。順序を変えると固定 seed の
  // ライバル指標がすべてずれるため、追加フィールドは末尾の派生に留める。
  const aiDependency = clamp(jitter(base.aiDependency, 25), 0, 100);
  const reviewQueue = Math.max(0, jitter(Math.max(2, base.reviewQueue), 4));
  const incidents = Math.max(0, Math.round(rng() * 2.4 - 0.6));
  const morale = clamp(jitter(base.morale, 20), 10, 100);
  const techDebt = Math.max(0, jitter(Math.max(20, base.techDebt), 40));
  const shipping = Math.max(
    0,
    jitter(Math.max(40, base.shipping), Math.max(40, base.shipping * 0.6)),
  );
  const engineers = 3 + Math.floor(rng() * 6);
  const aiLiteracy = clamp(jitter(base.aiLiteracy, 20), 10, 100);
  const seniorHp = clamp(jitter(base.seniorHp, 15), 40, 100);
  const testCoverage = clamp(jitter(base.testCoverage, 15), 20, 100);
  const documentation = clamp(jitter(base.documentation, 15), 20, 100);
  const quality = clamp(jitter(base.quality, 15), 20, 100);
  return {
    aiDependency,
    reviewQueue,
    incidents,
    morale,
    techDebt,
    shipping,
    engineers,
    aiLiteracy,
    seniorHp,
    aiEnabled: true,
    testCoverage,
    documentation,
    quality,
  };
}

function toTeamRunState(args: {
  id: string;
  deptId: string;
  name: string;
  raw: ReturnType<typeof rivalTeamRaw> | ReturnType<typeof homeSeedRaw>;
}): TeamRunState {
  const { raw } = args;
  const reviewCapacity = clamp(55 + raw.engineers * 4 - raw.reviewQueue * 2, 10, 100);
  const incidentBias = clamp(0.08 + raw.incidents * 0.05 + (100 - raw.quality) * 0.002, 0.02, 0.45);
  return {
    id: args.id,
    deptId: args.deptId,
    name: args.name,
    engineers: raw.engineers,
    aiLiteracy: raw.aiLiteracy,
    aiDependency: raw.aiDependency,
    morale: raw.morale,
    techDebt: raw.techDebt,
    shipping: raw.shipping,
    reviewQueue: raw.reviewQueue,
    incidents: raw.incidents,
    reviewCapacity,
    incidentBias,
    seniorHp: raw.seniorHp,
    aiEnabled: raw.aiEnabled,
    testCoverage: raw.testCoverage,
    documentation: raw.documentation,
    quality: raw.quality,
  };
}

/** ラン開始時に全チームを一度だけ初期化する（決定論）。 */
export function initTeamRunStates(args: {
  seed: string;
  org: OrgState;
  homeEngineers: number;
  /** ライバル派生ベースの行列（旧 generate の playerRaw 互換）。 */
  homeReviewQueue?: number;
  homeIncidents?: number;
}): TeamRunState[] {
  const base = homeSeedRaw(args.org, args.homeEngineers, {
    reviewQueue: args.homeReviewQueue,
    incidents: args.homeIncidents,
  });
  const teams: TeamRunState[] = [];
  for (let d = 0; d < DEPARTMENT_DEFS.length; d += 1) {
    const def = DEPARTMENT_DEFS[d];
    for (let t = 0; t < def.teamCount; t += 1) {
      const isHome = d === 0 && t === 0;
      const rng = createRng(`${args.seed}:team:${def.id}:${t}`);
      const raw = isHome ? base : rivalTeamRaw(rng, base);
      teams.push(
        toTeamRunState({
          id: `${def.id}-t${t}`,
          deptId: def.id,
          name: teamName(t),
          raw,
        }),
      );
    }
  }
  return teams;
}

/**
 * 選択中チームの `OrgState` から永続指標へ書き戻す。
 * `engineers` は詳細ロスター人数で縮めない（チーム総人数の下限を維持）。
 * `reviewQueue` / `incidents` 未指定時は既存値を保つ（全ラン累計で上書きしない）。
 */
export function syncTeamFromOrg(
  team: TeamRunState,
  org: OrgState,
  extras: {
    engineers: number;
    reviewQueue?: number;
    incidents?: number;
  },
): TeamRunState {
  const engineers = Math.max(1, team.engineers, extras.engineers);
  const reviewQueue = Math.max(0, extras.reviewQueue ?? team.reviewQueue);
  const incidents = Math.max(0, extras.incidents ?? team.incidents);
  return {
    ...team,
    engineers,
    aiLiteracy: Math.round(org.aiLiteracy),
    aiDependency: Math.round(org.aiDependency),
    morale: Math.round(org.morale),
    techDebt: Math.round(org.techDebt),
    shipping: Math.round(org.deliveryScore),
    reviewQueue,
    incidents,
    seniorHp: Math.round(org.seniorHp),
    aiEnabled: org.aiEnabled,
    testCoverage: Math.round(org.testCoverage),
    documentation: Math.round(org.documentation),
    quality: Math.round(org.quality),
    reviewCapacity: clamp(55 + engineers * 4 - reviewQueue * 2, 10, 100),
    incidentBias: clamp(0.08 + incidents * 0.05 + (100 - org.quality) * 0.002, 0.02, 0.45),
  };
}

/** 永続チームから詳細 sim 用 `OrgState` を構築する。 */
export function orgFromTeam(team: TeamRunState): OrgState {
  return {
    aiEnabled: team.aiEnabled,
    aiDependency: team.aiDependency,
    aiLiteracy: team.aiLiteracy,
    testCoverage: team.testCoverage,
    documentation: team.documentation,
    quality: team.quality,
    morale: team.morale,
    seniorHp: team.seniorHp,
    techDebt: team.techDebt,
    deliveryScore: team.shipping,
  };
}

/**
 * 全社判定用の組織指標スナップショット（四半期レビュー等）。
 * - 品質・負債・AI 系: 全チーム平均（健全な1チームだけでは押し上げられない）
 * - 士気・シニアHP: 選択中チーム（詳細 sim の継続不能判定・四半期 seed 契約と整合）
 * - 出荷: 合計
 *
 * 士気/HP を全平均にすると粗粒度チームの消耗で Q1 勝率が潰れるため、
 * HUD 集約とは分けて選択中チームを正とする（quarterReviewSeeds.ts 参照）。
 */
export function companyOrgFromTeams(teams: readonly TeamRunState[], fallback: OrgState): OrgState {
  if (teams.length === 0) return fallback;
  const n = teams.length;
  const avg = (pick: (t: TeamRunState) => number): number =>
    Math.round(teams.reduce((a, t) => a + pick(t), 0) / n);
  return {
    aiEnabled: fallback.aiEnabled,
    aiDependency: avg((t) => t.aiDependency),
    aiLiteracy: avg((t) => t.aiLiteracy),
    testCoverage: avg((t) => t.testCoverage),
    documentation: avg((t) => t.documentation),
    quality: avg((t) => t.quality),
    morale: fallback.morale,
    seniorHp: fallback.seniorHp,
    techDebt: avg((t) => t.techDebt),
    deliveryScore: teams.reduce((a, t) => a + t.shipping, 0),
  };
}

/**
 * 未訪問チーム向けに簡易ロスターを seed 生成する。
 * 詳細操作のロスター上限（ROSTER_CAP=6）と、チーム総人数 `TeamRunState.engineers` は分離する。
 * 7〜8 人チームでもロスターは最大 6 人までとし、総人数は sync 時に縮めない。
 */
export function createTeamRoster(seed: string, teamId: string, engineers: number): RosterState {
  const rng = createRng(`${seed}:roster:${teamId}`);
  const count = Math.max(2, Math.min(6, engineers));
  const used = new Set<string>();
  const members = [];
  for (let i = 0; i < count; i += 1) {
    const arch: MemberArchetype =
      i < STARTER_ARCHETYPES.length
        ? STARTER_ARCHETYPES[i]
        : RECRUIT_ARCHETYPES[Math.floor(rng() * RECRUIT_ARCHETYPES.length)];
    let name = MEMBER_NAMES[Math.floor(rng() * MEMBER_NAMES.length)];
    let guard = 0;
    while (used.has(name) && guard < MEMBER_NAMES.length) {
      name = MEMBER_NAMES[Math.floor(rng() * MEMBER_NAMES.length)];
      guard += 1;
    }
    if (used.has(name)) name = `${name}${i + 1}`;
    used.add(name);
    const m = createMember(arch, name, `m${i}`);
    if (i === 0) m.assignment = 'coding';
    else if (i === 1) m.assignment = 'review';
    else m.assignment = i % 2 === 0 ? 'coding' : 'bench';
    members.push(m);
  }
  return { members, nextId: members.length };
}

/** 部門へ新規チームを append する（採用ドラフト等）。 */
export function appendTeamsToDept(
  teams: TeamRunState[],
  args: {
    seed: string;
    deptId: string;
    count: number;
    template: TeamRunState;
    nextIndexStart?: number;
  },
): TeamRunState[] {
  if (args.count <= 0) return teams;
  const existing = teams.filter((t) => t.deptId === args.deptId);
  const nextIndex = args.nextIndexStart ?? existing.length;
  const added: TeamRunState[] = [];
  for (let i = 0; i < args.count; i += 1) {
    const idx = nextIndex + i;
    const rng = createRng(`${args.seed}:team:${args.deptId}:${idx}:extra`);
    const raw = rivalTeamRaw(rng, {
      aiDependency: args.template.aiDependency,
      reviewQueue: Math.max(2, args.template.reviewQueue),
      incidents: 0,
      morale: args.template.morale,
      techDebt: args.template.techDebt,
      shipping: Math.max(40, Math.round(args.template.shipping * 0.4)),
      engineers: args.template.engineers,
      aiLiteracy: args.template.aiLiteracy,
      seniorHp: args.template.seniorHp,
      aiEnabled: true,
      testCoverage: args.template.testCoverage,
      documentation: args.template.documentation,
      quality: args.template.quality,
    });
    added.push(
      toTeamRunState({
        id: `${args.deptId}-t${idx}`,
        deptId: args.deptId,
        name: teamName(idx),
        raw,
      }),
    );
  }
  return [...teams, ...added];
}

/** 粗粒度進行へ渡す全社モディファイア（詳細 sim の foldRunEffects 相当）。 */
export type CoarseRunModifiers = {
  /** 障害発生率倍率（試練 flammable / レリック耐性など）。 */
  incidentRateMul?: number;
  /** 出荷増分倍率（codingSpeedMul / pause_ai_rollout など）。 */
  shipMul?: number;
  /** 行列消化・鎮火しやすさ（reviewEfficiencyMul 相当）。 */
  reviewMul?: number;
};

/** 粗粒度 1 ステップの結果。 */
export type CoarseStepResult = {
  teams: TeamRunState[];
  /** 非選択チームで新規発生した炎上件数（鎮火前。開数差分ではない）。 */
  ignited: number;
};

/**
 * 非選択チームを粗粒度で 1 ステップ進める（スプリント完了時）。
 * 選択中（excludeId）は詳細 sim 側が正なので触らない。
 *
 * `adjust` は悪化圧力の緩和にだけ使い、指標差分を永続値へ加算しない。
 * （レバー効果は適用時に TeamRunState へ焼き込み済み。投影オーバーレイと二重にしない。）
 */
export function advanceCoarseTeams(
  teams: readonly TeamRunState[],
  args: {
    seed: string;
    stepKey: string;
    excludeId: string;
    adjust?: OrgAdjustState;
    modifiers?: CoarseRunModifiers;
  },
): CoarseStepResult {
  const adjust = args.adjust ?? { company: emptyAdjust(), byDept: {} };
  const incidentRateMul = Math.max(0.2, args.modifiers?.incidentRateMul ?? 1);
  const shipMul = Math.max(0.2, args.modifiers?.shipMul ?? 1);
  const reviewMul = clamp(args.modifiers?.reviewMul ?? 1, 0.4, 1.8);
  let ignited = 0;
  const next = teams.map((team) => {
    if (team.id === args.excludeId) return team;
    const rng = createRng(`${args.seed}:coarse:${args.stepKey}:${team.id}`);
    const deptAdj = mergeAdjust(adjust.company, adjust.byDept[team.deptId] ?? emptyAdjust());
    const teamAdj = mergeAdjust(deptAdj, adjust.byTeam?.[team.id] ?? emptyAdjust());
    // 負のデルタほど圧力を緩める（永続値への再加算はしない）。
    const queueRelief = Math.max(0, -teamAdj.reviewQueueDelta) * 0.2;
    const fireMul = clamp(1 + teamAdj.incidentDelta * 0.12, 0.35, 1.2);
    const debtRelief = Math.max(0, -teamAdj.techDebtDelta) * 0.05;
    const aiPressureMul = clamp(1 + teamAdj.aiDependencyDelta * 0.02, 0.4, 1.2);
    const moraleBias = teamAdj.moraleDelta === 0 ? 0 : Math.sign(teamAdj.moraleDelta) * 0.5;

    const shipGain = Math.max(
      4,
      Math.round(
        ((8 + team.engineers * 2.5 + team.aiLiteracy * 0.08) * (0.75 + rng() * 0.5) -
          team.techDebt * 0.02) *
          shipMul,
      ),
    );
    const queuePressure = Math.max(
      0,
      Math.round(
        team.engineers * 0.35 + team.aiDependency * 0.04 - team.reviewCapacity * 0.05 - queueRelief,
      ),
    );
    const queueDelta = Math.round((rng() * 2 - 0.7) * 2) + queuePressure;
    let reviewQueue = Math.max(0, team.reviewQueue + queueDelta);
    reviewQueue = Math.max(0, reviewQueue - Math.floor((team.reviewCapacity / 25) * reviewMul));

    const fireRoll = rng();
    const fireChance = clamp(
      (team.incidentBias + team.aiDependency * 0.0015) * fireMul * incidentRateMul,
      0.02,
      0.5,
    );
    let incidents = team.incidents;
    if (fireRoll < fireChance) {
      incidents += 1;
      ignited += 1;
    }
    if (rng() < (0.35 + team.reviewCapacity * 0.004) * reviewMul) {
      incidents = Math.max(0, incidents - 1);
    }

    const moraleDelta =
      (reviewQueue > 8 ? -3 : reviewQueue > 4 ? -1 : 1) +
      (incidents > 0 ? -2 : 1) +
      moraleBias +
      Math.round((rng() * 2 - 1) * 2);
    const techDebtDelta =
      Math.round(team.aiDependency * 0.03) - Math.round(team.aiLiteracy * 0.02) - debtRelief;
    const literacyGain = rng() < 0.4 ? 1 : 0;
    const seniorDrain = reviewQueue > 6 ? 2 : reviewQueue > 3 ? 1 : 0;
    const aiDrift = rng() < 0.3 * aiPressureMul ? 1 : 0;
    // 品質を先に確定し、派生の incidentBias と整合させる。
    const quality = clamp(team.quality + (rng() < 0.25 ? -1 : 0), 10, 100);

    return {
      ...team,
      shipping: Math.max(0, team.shipping + shipGain),
      reviewQueue,
      incidents,
      morale: clamp(team.morale + moraleDelta, 5, 100),
      techDebt: Math.max(0, team.techDebt + techDebtDelta),
      aiDependency: clamp(team.aiDependency + aiDrift, 0, 100),
      aiLiteracy: clamp(team.aiLiteracy + literacyGain, 0, 100),
      seniorHp: clamp(team.seniorHp - seniorDrain + (100 - team.seniorHp) * 0.05, 1, 100),
      quality,
      ...deriveTeamCapacities({ engineers: team.engineers, reviewQueue, incidents, quality }),
    };
  });
  return { teams: next, ignited };
}

/**
 * 粗粒度 1 ステップの出荷・炎上発生を、他チーム平均相当へ正規化する。
 * 炎上は開数差分ではなく発生件数（ignited）を使う（同ステップ鎮火で消えないように）。
 */
export function normalizeCoarseTotalsDelta(
  before: readonly Pick<TeamRunState, 'id' | 'shipping'>[],
  after: readonly Pick<TeamRunState, 'id' | 'shipping'>[],
  excludeId: string,
  ignited: number,
): { delivered: number; incidents: number } {
  let deliveredGain = 0;
  let otherCount = 0;
  for (const team of after) {
    if (team.id === excludeId) continue;
    const prev = before.find((t) => t.id === team.id);
    if (!prev) continue;
    otherCount += 1;
    deliveredGain += Math.max(0, team.shipping - prev.shipping);
  }
  if (otherCount <= 0) return { delivered: 0, incidents: 0 };
  return {
    delivered: deliveredGain > 0 ? Math.max(1, Math.round(deliveredGain / otherCount)) : 0,
    // 炎上は稀なので 0 切り捨て（毎ステップ最低 +1 だと Incident KPI が即死する）。
    incidents: Math.max(0, Math.round(Math.max(0, ignited) / otherCount)),
  };
}

/** 行列・障害から派生する耐性・炎上バイアスを再計算する。 */
export function deriveTeamCapacities(
  team: Pick<TeamRunState, 'engineers' | 'reviewQueue' | 'incidents' | 'quality'>,
): Pick<TeamRunState, 'reviewCapacity' | 'incidentBias'> {
  return {
    reviewCapacity: clamp(55 + team.engineers * 4 - team.reviewQueue * 2, 10, 100),
    incidentBias: clamp(0.08 + team.incidents * 0.05 + (100 - team.quality) * 0.002, 0.02, 0.45),
  };
}

/** チーム単位の調整を OrgAdjust 効果として直接永続状態へ適用する。 */
export function applyEffectToTeam(team: TeamRunState, effect: Partial<OrgAdjust>): TeamRunState {
  const adj = { ...emptyAdjust(), ...effect };
  const adjusted = applyAdjustToRaw(team, adj);
  const next = {
    ...team,
    ...adjusted,
    shipping: team.shipping,
  };
  return { ...next, ...deriveTeamCapacities(next) };
}

export interface ProjectOrgScaleInput {
  seed: string;
  teams: readonly TeamRunState[];
  homeTeamId: string;
  activeTeamId: string;
  /** 選択中チームのライブ上書き（スプリント中の行列など）。 */
  activeLive?: Partial<
    Pick<
      TeamRunState,
      'reviewQueue' | 'incidents' | 'shipping' | 'morale' | 'techDebt' | 'aiDependency'
    >
  > & { engineers?: number; aiAssignedCount?: number };
  adjust?: OrgAdjustState;
  diagnosis: DiagnosisType;
  budget: number;
  /** 共通基盤の基準（選択中 org から）。 */
  infraBase: { ci: number; docs: number; aiGuideline: number };
}

/** 永続チーム配列から表示用 OrgScaleState を投影する。 */
export function projectOrgScale(input: ProjectOrgScaleInput): OrgScaleState {
  const adjust = input.adjust ?? { company: emptyAdjust(), byDept: {}, byTeam: {} };
  const byDept = new Map<string, TeamRunState[]>();
  for (const t of input.teams) {
    const list = byDept.get(t.deptId) ?? [];
    list.push(t);
    byDept.set(t.deptId, list);
  }

  const departments = DEPARTMENT_DEFS.map((def: DepartmentDef, d: number) => {
    const deptAdj = mergeAdjust(adjust.company, adjust.byDept[def.id] ?? emptyAdjust());
    const deptTeams = byDept.get(def.id) ?? [];
    // 格子座標は部門内インデックス順で安定配置。
    const sorted = [...deptTeams].sort((a, b) => a.id.localeCompare(b.id));
    const teams: Team[] = sorted.map((run, t) => {
      const live =
        run.id === input.activeTeamId && input.activeLive ? { ...run, ...input.activeLive } : run;
      const teamAdj = mergeAdjust(deptAdj, adjust.byTeam?.[run.id] ?? emptyAdjust());
      const adjusted = applyAdjustToRaw(live, teamAdj);
      const isHome = run.id === input.homeTeamId;
      const isActive = run.id === input.activeTeamId;
      const aiAssignedCount =
        isActive && input.activeLive?.aiAssignedCount !== undefined
          ? input.activeLive.aiAssignedCount
          : estimateRivalAiAssigned(live.engineers, adjusted.aiDependency);
      return {
        id: run.id,
        deptId: run.deptId,
        name: run.name,
        gridX: t,
        gridY: d,
        shipping: live.shipping,
        aiDependency: adjusted.aiDependency,
        reviewQueue: adjusted.reviewQueue,
        incidents: adjusted.incidents,
        morale: adjusted.morale,
        techDebt: adjusted.techDebt,
        engineers: live.engineers,
        aiAssignedCount,
        health: teamHealth(adjusted),
        isPlayer: isHome,
        isActive,
      };
    });
    return aggregateDepartment(def, teams);
  });

  const infraBoost = adjust.company.infraBoost;
  const infra = {
    ci: clamp(Math.round(input.infraBase.ci + infraBoost), 0, 100),
    docs: clamp(Math.round(input.infraBase.docs + infraBoost), 0, 100),
    aiGuideline: clamp(Math.round(input.infraBase.aiGuideline + infraBoost), 0, 100),
  };

  return aggregateCompany(departments, {
    seed: input.seed,
    budget: input.budget,
    diagnosis: input.diagnosis,
    infra,
  });
}

/** 集約不変条件: 部門出荷 = チーム出荷合計。 */
export function assertDeptShippingInvariant(scale: OrgScaleState): boolean {
  return scale.departments.every((d) => d.shipping === d.teams.reduce((s, t) => s + t.shipping, 0));
}

/**
 * アクティブチームのライブ指標を org とチーム固有値から組み立てる。
 * ラン全体の `RunTotals` は混ぜない（他チームの累計ピークで汚染しない）。
 */
export function activeLiveFromOrg(args: {
  org: OrgState;
  engineers: number;
  aiAssignedCount: number;
  /** 選択チームの永続値、またはスプリント実測。 */
  reviewQueue: number;
  incidents: number;
}): NonNullable<ProjectOrgScaleInput['activeLive']> {
  return {
    aiDependency: Math.round(args.org.aiDependency),
    reviewQueue: Math.max(0, args.reviewQueue),
    incidents: Math.max(0, args.incidents),
    morale: Math.round(args.org.morale),
    techDebt: Math.round(args.org.techDebt),
    shipping: Math.round(args.org.deliveryScore),
    engineers: args.engineers,
    aiAssignedCount: args.aiAssignedCount,
  };
}

/** 全チーム平均から共通基盤ハブの基準値を作る（選択チーム切替で揺れない）。 */
export function companyInfraFromTeams(teams: readonly TeamRunState[]): {
  ci: number;
  docs: number;
  aiGuideline: number;
} {
  if (teams.length === 0) return { ci: 0, docs: 0, aiGuideline: 0 };
  const n = teams.length;
  const sum = teams.reduce(
    (acc, t) => ({
      ci: acc.ci + t.testCoverage,
      docs: acc.docs + t.documentation,
      aiGuideline: acc.aiGuideline + t.aiLiteracy,
    }),
    { ci: 0, docs: 0, aiGuideline: 0 },
  );
  return {
    ci: Math.round(sum.ci / n),
    docs: Math.round(sum.docs / n),
    aiGuideline: Math.round(sum.aiGuideline / n),
  };
}
