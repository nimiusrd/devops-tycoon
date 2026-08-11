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
import {
  activeEngineerCount,
  createMember,
  reviewHpCostMulForReviewers,
  seniorHpShareMul,
  type RosterState,
} from '../member';
import { AI_ADOPTION, TASK_BASE_VALUE } from '../model/process';
import { AI_LITERACY_UNSAFE_CAP } from '../outcome';
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
import { clamp } from '../clamp';

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

/**
 * `createTeamRoster` と同じ配置規則でのコーダー人数。
 * 俯瞰の AI ボット数を、入り込み後の実ロスター配布と揃えるために使う。
 */
export function estimateRosterCoderCount(engineers: number): number {
  if (engineers <= 0) return 0;
  const count = Math.max(2, Math.min(6, Math.floor(engineers)));
  let coders = 0;
  for (let i = 0; i < count; i += 1) {
    if (i === 0) coders += 1;
    else if (i === 1) continue;
    else if (i % 2 === 0) coders += 1;
  }
  return coders;
}

/**
 * `createTeamRoster` と同じ配置規則での coding/review 人数（ベンチ除外）。
 * 未訪問チームの粗粒度シニア負荷分散を、詳細 sim の `activeAssignedCount` と揃える（RI-73）。
 */
export function estimateActiveAssignedCount(engineers: number): number {
  if (engineers <= 0) return 0;
  const count = Math.max(2, Math.min(6, Math.floor(engineers)));
  let assigned = 0;
  for (let i = 0; i < count; i += 1) {
    if (i === 0 || i === 1 || i % 2 === 0) assigned += 1;
  }
  return assigned;
}

/**
 * `createTeamRoster` と同じ配置規則でのレビュアー人数。
 * 未訪問チームの粗粒度に詳細 sim の `reviewHpCostMul` を引き継ぐ（RI-73）。
 */
export function estimateRosterReviewerCount(engineers: number): number {
  if (engineers <= 0) return 0;
  // createTeamRoster は index 1 を常に review にする（最低 2 席）。
  return Math.max(2, Math.min(6, Math.floor(engineers))) >= 2 ? 1 : 0;
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

/** 通常の rival AI依存度振れ幅。 */
export const RIVAL_AI_DEPENDENCY_SPREAD = 25;
/**
 * 低リテラシー組織の rival AI依存度振れ幅（RI-74）。
 * 旧セーブ移行時のクランプ上限としても使う。
 */
export const RIVAL_AI_DEPENDENCY_SPREAD_LOW_LITERACY = 10;

/** 他チームの素の指標を派生 seed から作る（ホームをベースに分散。初期化専用）。 */
function rivalTeamRaw(rng: () => number, base: ReturnType<typeof homeSeedRaw>) {
  const jitter = (center: number, spread: number) => center + Math.round((rng() * 2 - 1) * spread);
  // 乱数消費順は従来どおり（ai→…→shipping→engineers）。順序を変えると固定 seed の
  // ライバル指標がすべてずれるため、追加フィールドは末尾の派生に留める。
  // RI-74: 低リテラシー組織では rival の依存度振れ幅を抑え、enterTeam 後の S1 即死を防ぐ。
  const depSpread =
    base.aiLiteracy <= AI_LITERACY_UNSAFE_CAP
      ? RIVAL_AI_DEPENDENCY_SPREAD_LOW_LITERACY
      : RIVAL_AI_DEPENDENCY_SPREAD;
  const aiDependency = clamp(jitter(base.aiDependency, depSpread), 0, 100);
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
    headcount: raw.engineers,
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
 * 詳細ロスター（上限6）と総席数の差分を常時稼働として合算する。
 * 7〜8 人チームへ入り込んでも、ロスター外の席を切り捨てて粗粒度人数を落とさない。
 */
export function engineersFromRoster(
  team: Pick<TeamRunState, 'engineers' | 'headcount'>,
  roster: RosterState,
): { engineers: number; headcount: number } {
  const rosterActive = activeEngineerCount(roster);
  const headcount = Math.max(team.headcount ?? team.engineers, roster.members.length, rosterActive);
  const offRoster = Math.max(0, headcount - roster.members.length);
  return { engineers: rosterActive + offRoster, headcount };
}

/**
 * 選択中チームの `OrgState` から永続指標へ書き戻す。
 * `engineers` は稼働人数（休職で減る。ロスター外席は常時稼働）。総席数は `headcount` で維持する。
 * `reviewQueue` / `incidents` 未指定時は既存値を保つ（全ラン累計で上書きしない）。
 */
export function syncTeamFromOrg(
  team: TeamRunState,
  org: OrgState,
  extras: {
    engineers: number;
    /** チーム総席数。未指定時は既存 headcount / engineers を維持。 */
    headcount?: number;
    reviewQueue?: number;
    incidents?: number;
  },
): TeamRunState {
  // 全員休職なら稼働 0 を保持する（架空の 1 人を粗粒度へ残さない）。
  // ただし呼び出し側が `engineersFromRoster` 経由ならロスター外席は残る。
  const engineers = Math.max(0, extras.engineers);
  const headcount = Math.max(0, team.headcount ?? team.engineers, extras.headcount ?? 0, engineers);
  const reviewQueue = Math.max(0, extras.reviewQueue ?? team.reviewQueue);
  const incidents = Math.max(0, extras.incidents ?? team.incidents);
  return {
    ...team,
    engineers,
    headcount,
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
 * 詳細操作のロスター上限（ROSTER_CAP=6）と、チーム総人数は分離する。
 * 7〜8 人チームでもロスターは最大 6 人までとし、超過席は `engineersFromRoster` で常時稼働として残す。
 * `aiDependency` 指定時は投影の推定 AI 配布人数と一致するよう決定論的に割り当てる。
 */
export function createTeamRoster(
  seed: string,
  teamId: string,
  engineers: number,
  aiDependency?: number,
): RosterState {
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
  const roster: RosterState = { members, nextId: members.length };
  if (aiDependency === undefined) return roster;
  // 配布目標はチーム総人数ではなく、生成した稼働コーダー数×依存度にする。
  const coders = roster.members.filter((m) => !m.onLeave && m.assignment === 'coding');
  const target = estimateRivalAiAssigned(coders.length, aiDependency);
  let assigned = 0;
  return {
    ...roster,
    members: roster.members.map((m) => {
      if (m.onLeave || m.assignment !== 'coding') return { ...m, aiAssigned: false };
      const on = assigned < target;
      if (on) assigned += 1;
      return { ...m, aiAssigned: on };
    }),
  };
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
      engineers: args.template.headcount ?? args.template.engineers,
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
  /** レビュー容量倍率（reviewCapacityMul）。行列消化に掛ける。 */
  reviewCapacityMul?: number;
  /**
   * Rework 率加算（詳細 sim の reworkRateAdd 相当）。
   * 負値ほど戻りが減り、粗粒度では行列圧力の緩和として効く（RI-83）。
   */
  reworkRateAdd?: number;
  /**
   * シニア体力消費倍率（詳細 sim の seniorHpCostMul 相当。RI-73）。
   * 粗粒度の seniorDrain に掛ける。
   */
  seniorHpCostMul?: number;
  /** スプリント相当の AI 依存度ドリフト（frontier-dependency 等）。 */
  aiDependencyDrift?: number;
};

/** 粗粒度 1 ステップの結果。 */
export type CoarseStepResult = {
  teams: TeamRunState[];
  /** 非選択チームで新規発生した炎上件数（鎮火前。開数差分ではない）。 */
  ignited: number;
  /** 非選択チームの完了数合算（出荷増分を完了の近似とする）。 */
  completed: number;
  /** 非選択チームの AI 支援完了数合算（編成相当の採用率で按分）。 */
  aiAssisted: number;
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
    /**
     * チーム ID → coding/review 配置済み人数（詳細 sim の負荷分散母数）。
     * 未指定時は `estimateActiveAssignedCount(team.engineers)`（createTeamRoster と同じ配置規則）。
     */
    assignedByTeamId?: Readonly<Record<string, number>>;
    /**
     * チーム ID → review 配置済み人数（詳細 sim の reviewHpCostMul 母数）。
     * 未指定時は `estimateRosterReviewerCount(team.engineers)`。
     */
    reviewersByTeamId?: Readonly<Record<string, number>>;
  },
): CoarseStepResult {
  const adjust = args.adjust ?? { company: emptyAdjust(), byDept: {} };
  const incidentRateMul = Math.max(0.2, args.modifiers?.incidentRateMul ?? 1);
  const shipMul = Math.max(0.2, args.modifiers?.shipMul ?? 1);
  const reviewMul = clamp(args.modifiers?.reviewMul ?? 1, 0.4, 1.8);
  const reviewCapacityMul = clamp(args.modifiers?.reviewCapacityMul ?? 1, 0.5, 2);
  const reworkRateAdd = clamp(args.modifiers?.reworkRateAdd ?? 0, -0.5, 0.5);
  const seniorHpCostMul = clamp(args.modifiers?.seniorHpCostMul ?? 1, 0.3, 3);
  const aiDependencyDrift = Math.max(0, Math.round(args.modifiers?.aiDependencyDrift ?? 0));
  let ignited = 0;
  let completed = 0;
  let aiAssisted = 0;
  const next = teams.map((team) => {
    if (team.id === args.excludeId) return team;
    const rng = createRng(`${args.seed}:coarse:${args.stepKey}:${team.id}`);
    const deptAdj = mergeAdjust(adjust.company, adjust.byDept[team.deptId] ?? emptyAdjust());
    const teamAdj = mergeAdjust(deptAdj, adjust.byTeam?.[team.id] ?? emptyAdjust());
    // 負のデルタほど圧力を緩める（永続値への再加算はしない）。
    const queueRelief = Math.max(0, -teamAdj.reviewQueueDelta) * 0.2;
    // Rework 低下は戻りレビュー減として行列圧力を緩める（上昇は圧力増）。
    const reworkRelief = -reworkRateAdd * 20;
    const fireMul = clamp(1 + teamAdj.incidentDelta * 0.12, 0.35, 1.2);
    const debtRelief = Math.max(0, -teamAdj.techDebtDelta) * 0.05;
    const aiPressureMul = clamp(1 + teamAdj.aiDependencyDelta * 0.02, 0.4, 1.2);
    const moraleBias = teamAdj.moraleDelta === 0 ? 0 : Math.sign(teamAdj.moraleDelta) * 0.5;
    const reviewCap = team.reviewCapacity * reviewCapacityMul;

    const coders = estimateRosterCoderCount(team.engineers);
    const adoptionShare =
      coders > 0 ? estimateRivalAiAssigned(coders, team.aiDependency) / coders : 0;
    // 詳細 sim の aiDeliveryValueMul に対応: AI 採用分だけリテラシー連動の出荷倍率を掛ける。
    const aiShare = AI_ADOPTION * clamp(adoptionShare, 0, 1);
    const aiDeliveryMul = 1 + aiShare * 0.85 * (team.aiLiteracy / 100);
    // 稼働 0 なら出荷も 0（休職だらけのチームがベース出荷を出さない）。
    // 完了件数は倍率前の基礎出荷から換算し、倍率は shipping 増分だけに掛ける（詳細 sim と同じ）。
    const baseShipGain =
      team.engineers <= 0
        ? 0
        : Math.max(
            4,
            Math.round(
              ((8 + team.engineers * 2.5 + team.aiLiteracy * 0.08) * (0.75 + rng() * 0.5) -
                team.techDebt * 0.02) *
                shipMul,
            ),
          );
    const shipGain = baseShipGain <= 0 ? 0 : Math.max(4, Math.round(baseShipGain * aiDeliveryMul));
    const completedGain = coarseShipToCompleted(baseShipGain);
    completed += completedGain;
    aiAssisted += Math.round(completedGain * aiShare);
    const queuePressure = Math.max(
      0,
      Math.round(
        team.engineers * 0.35 +
          team.aiDependency * 0.04 -
          reviewCap * 0.05 -
          queueRelief -
          reworkRelief,
      ),
    );
    const queueDelta = Math.round((rng() * 2 - 0.7) * 2) + queuePressure;
    let reviewQueue = Math.max(0, team.reviewQueue + queueDelta);
    reviewQueue = Math.max(0, reviewQueue - Math.floor((reviewCap / 25) * reviewMul));

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
    if (rng() < (0.35 + reviewCap * 0.004) * reviewMul) {
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
    // RI-73 / F-1: 詳細 sim と同じく配置済み人数＋レビュアー人数でシニア消耗を薄める。
    // 未訪問チームは createTeamRoster と同じ決定論的配置を使う（総席数で過大軽減しない）。
    const assigned =
      args.assignedByTeamId?.[team.id] ?? estimateActiveAssignedCount(team.engineers);
    const reviewers =
      args.reviewersByTeamId?.[team.id] ?? estimateRosterReviewerCount(team.engineers);
    const seniorDrain =
      (reviewQueue > 6 ? 2 : reviewQueue > 3 ? 1 : 0) *
      seniorHpCostMul *
      seniorHpShareMul(assigned) *
      reviewHpCostMulForReviewers(reviewers);
    const randomAiDrift = rng() < 0.3 * aiPressureMul ? 1 : 0;
    // 品質を先に確定し、派生の incidentBias と整合させる。
    const quality = clamp(team.quality + (rng() < 0.25 ? -1 : 0), 10, 100);

    return {
      ...team,
      shipping: Math.max(0, team.shipping + shipGain),
      reviewQueue,
      incidents,
      morale: clamp(team.morale + moraleDelta, 5, 100),
      techDebt: Math.max(0, team.techDebt + techDebtDelta),
      aiDependency: clamp(team.aiDependency + aiDependencyDrift + randomAiDrift, 0, 100),
      aiLiteracy: clamp(team.aiLiteracy + literacyGain, 0, 100),
      seniorHp: clamp(team.seniorHp - seniorDrain + (100 - team.seniorHp) * 0.05, 1, 100),
      quality,
      ...deriveTeamCapacities({ engineers: team.engineers, reviewQueue, incidents, quality }),
    };
  });
  return { teams: next, ignited, completed, aiAssisted };
}

/**
 * 粗粒度の出荷ポイントを完了タスク件数へ換算する。
 * 詳細 sim の標準規模（normal=5pt）を 1 件相当とし、ポイント値を completed に混入させない。
 */
export function coarseShipToCompleted(shipGain: number): number {
  if (shipGain <= 0) return 0;
  return Math.max(1, Math.round(shipGain / TASK_BASE_VALUE.normal));
}

/**
 * 粗粒度 1 ステップの出荷・炎上・完了・AI 支援を、他チーム平均相当へ正規化する。
 * 炎上は開数差分ではなく発生件数（ignited）を使う（同ステップ鎮火で消えないように）。
 * 炎上の端数は `incidentCarry` で次ステップへ繰り越し、ステップ丸めで発生実績を消さない。
 */
export function normalizeCoarseTotalsDelta(
  before: readonly Pick<TeamRunState, 'id' | 'shipping'>[],
  after: readonly Pick<TeamRunState, 'id' | 'shipping'>[],
  excludeId: string,
  ignited: number,
  completedGain = 0,
  aiAssistedGain = 0,
  incidentCarry = 0,
): {
  delivered: number;
  incidents: number;
  completed: number;
  aiAssisted: number;
  incidentCarry: number;
} {
  let deliveredGain = 0;
  let otherCount = 0;
  for (const team of after) {
    if (team.id === excludeId) continue;
    const prev = before.find((t) => t.id === team.id);
    if (!prev) continue;
    otherCount += 1;
    deliveredGain += Math.max(0, team.shipping - prev.shipping);
  }
  if (otherCount <= 0) {
    return {
      delivered: 0,
      incidents: 0,
      completed: 0,
      aiAssisted: 0,
      incidentCarry: Math.max(0, incidentCarry),
    };
  }
  const completed = completedGain > 0 ? Math.max(1, Math.round(completedGain / otherCount)) : 0;
  const aiAssisted = Math.max(0, Math.round(Math.max(0, aiAssistedGain) / otherCount));
  // 端数繰り越し: 他チーム平均の 1/2 を四半期中に積み、ステップ丸めで消さない。
  // （フル平均だと Incident KPI / 勝率が崩壊するため、寄与を半分に抑える。）
  const rawIncidents = Math.max(0, ignited) / (otherCount * 2) + Math.max(0, incidentCarry);
  const incidents = Math.floor(rawIncidents + 1e-9);
  return {
    delivered: deliveredGain > 0 ? Math.max(1, Math.round(deliveredGain / otherCount)) : 0,
    incidents,
    completed,
    // 採用率の上限を超えないよう完了数でクリップする。
    aiAssisted: completed > 0 ? Math.min(completed, aiAssisted) : 0,
    incidentCarry: rawIncidents - incidents,
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
      const isActive = run.id === input.activeTeamId;
      const aiAssignedCount =
        isActive && input.activeLive?.aiAssignedCount !== undefined
          ? input.activeLive.aiAssignedCount
          : estimateRivalAiAssigned(
              estimateRosterCoderCount(live.engineers),
              adjusted.aiDependency,
            );
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
        // プレイヤー強調は詳細シミュレーション対象（入り込み先）に合わせる。
        isPlayer: isActive,
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
