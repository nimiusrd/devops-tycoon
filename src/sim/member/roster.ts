/**
 * 個体メンバーの生成・編成・成長・スタミナ管理（SPEC 第12章）。
 *
 * すべて純関数で、乱数は引数の seed付きPRNG からのみ消費する（決定論。第22.3）。
 * 編成（誰をどのレーンに置き、誰に AI を配るか）は `foldFormationEffects` で
 * `CardEffects`（スプリント確率モデルに掛かる係数）へ集約し、既存のスプリント
 * 純関数を一切変更せずに結果へ反映する（follow-ups: 個体値→組織値を純関数で集約）。
 */
import {
  MEMBER_NAMES,
  RECRUIT_ARCHETYPES,
  STARTER_ARCHETYPES,
  type MemberArchetype,
} from '../../data/members';
import { foldTraitModifiers } from '../../data/traits';
import type { Rng } from '../rng';
import type {
  FormationEffects,
  GrowthOutcome,
  LaneAssignment,
  Member,
  MemberExpression,
  MemberRank,
  RosterState,
} from './types';
import { clamp } from '../clamp';

// --- 育成・編成のパラメータ（バランス調整の集約点）---

/** ランクごとの寄与倍率（昇格を編成価値に反映する）。 */
const RANK_MUL: Record<MemberRank, number> = { junior: 0.82, middle: 1, senior: 1.25 };
/** ランクごとの基礎スタミナ上限。 */
const RANK_STAMINA: Record<MemberRank, number> = { junior: 70, middle: 85, senior: 95 };
/** ランクごとの学習速度（ジュニアほど伸びる）。 */
const RANK_LEARN: Record<MemberRank, number> = { junior: 1.3, middle: 1, senior: 0.7 };

/** ミドル／シニアへ昇格するレベル閾値。 */
const MIDDLE_LEVEL = 4;
const SENIOR_LEVEL = 8;

/** スプリント 1 回の基礎スタミナ消費。 */
const BASE_DRAIN = 22;
/** レーン別の消費倍率（レビューは消耗が大きい）。 */
const LANE_DRAIN_MUL: Record<'coding' | 'review', number> = { coding: 1, review: 1.25 };
/** AI を配ったコーダーの消費軽減（AI が肩代わり）。 */
const AI_DRAIN_RELIEF = 0.85;

/** これ以下のスタミナで離脱（休職）判定が走る閾値。 */
const LEAVE_THRESHOLD = 14;
/** 離脱の最大確率（スタミナ 0 のとき）。 */
const LEAVE_MAX_P = 0.5;
/** 休職から復帰するスタミナ（上限に対する割合）。 */
const RETURN_RATIO = 0.4;
/** 休職中の回復ボーナス（離れて休む分だけ回復が速い）。 */
const LEAVE_RECOVERY_MUL = 1.25;

/** スプリント間の自然なスタミナ回復。 */
export const STAMINA_RECOVER_BETWEEN = 16;
/** 休息ノード（heal）でのスタミナ回復。 */
export const REST_STAMINA_RECOVER = 45;

/** コーダー不在時の Coding 速度倍率（実装はほぼ止まる）。 */
const NO_CODER_CODING_SPEED = 0.15;
/** コーダー不在時の並列枠ペナルティ（beginSprint の下限まで枠を削る大きな負値）。 */
const NO_CODER_SLOT_PENALTY = -99;

// --- ランク・スタミナ・経験値の純関数 ---

/** ランクの表示ラベル。 */
export function rankLabel(rank: MemberRank): string {
  return rank === 'junior' ? 'ジュニア' : rank === 'middle' ? 'ミドル' : 'シニア';
}

/** レベルから到達しうるランク（初期ランクと比較して高い方を採用する）。 */
function rankFromLevel(level: number): MemberRank {
  if (level >= SENIOR_LEVEL) return 'senior';
  if (level >= MIDDLE_LEVEL) return 'middle';
  return 'junior';
}

const RANK_ORDER: MemberRank[] = ['junior', 'middle', 'senior'];
function higherRank(a: MemberRank, b: MemberRank): MemberRank {
  return RANK_ORDER.indexOf(a) >= RANK_ORDER.indexOf(b) ? a : b;
}

/** 次レベルまでに必要な経験値。 */
export function xpForLevel(level: number): number {
  return 80 + (level - 1) * 30;
}

/** ランク・レベル・トレイトからスタミナ上限を導く（純関数）。 */
export function computeStaminaMax(
  rank: MemberRank,
  level: number,
  traits: Member['traits'],
): number {
  const base = RANK_STAMINA[rank] + (level - 1) * 2;
  return Math.round(base * foldTraitModifiers(traits).staminaMaxMul);
}

/** 実装力の編成寄与（ランク・トレイト込み）。 */
export function effectiveImpl(m: Member): number {
  return m.stats.implementation * RANK_MUL[m.rank] * foldTraitModifiers(m.traits).implMul;
}
/** レビュー力の編成寄与（ランク・トレイト込み）。 */
export function effectiveReview(m: Member): number {
  return m.stats.review * RANK_MUL[m.rank] * foldTraitModifiers(m.traits).reviewMul;
}
/** AI習熟の編成寄与（ランク込み）。 */
export function effectiveAiMastery(m: Member): number {
  return m.stats.aiMastery * RANK_MUL[m.rank];
}

// --- メンバー・ロスター生成 ---

function pickName(rng: Rng): string {
  return MEMBER_NAMES[Math.floor(rng() * MEMBER_NAMES.length)];
}

/** アーキタイプ + 名前から個体を作る（レベル1・スタミナ満タン・推奨レーンへ配置）。 */
export function createMember(arch: MemberArchetype, name: string, id: string): Member {
  const staminaMax = computeStaminaMax(arch.rank, 1, arch.traits);
  return {
    id,
    name,
    rank: arch.rank,
    level: 1,
    xp: 0,
    stats: { ...arch.stats },
    stamina: staminaMax,
    staminaMax,
    traits: [...arch.traits],
    assignment: arch.preferred,
    aiAssigned: arch.preferred === 'coding',
    onLeave: false,
  };
}

/** 初期ロスターで AI を既定配布するスターター（習熟が高いジュニアのみ。RI-77）。 */
const STARTER_DEFAULT_AI_ARCHETYPE_ID = 'starter-ai-junior';

/** 初期ロスター（バランス型コーダー2 + レビュアー1）を生成する。 */
export function createInitialRoster(rng: Rng): RosterState {
  const used = new Set<string>();
  const members = STARTER_ARCHETYPES.map((arch, i) => {
    let name = pickName(rng);
    // 名前重複を避ける（プールが尽きたら連番付与）。
    let guard = 0;
    while (used.has(name) && guard < MEMBER_NAMES.length) {
      name = pickName(rng);
      guard += 1;
    }
    if (used.has(name)) name = `${name}${i + 1}`;
    used.add(name);
    const member = createMember(arch, name, `m${i}`);
    // RI-77: コーダー全員 ON だと既定のままが全面ベットになる。習熟が高い1人だけ配る。
    if (arch.preferred === 'coding') {
      member.aiAssigned = arch.id === STARTER_DEFAULT_AI_ARCHETYPE_ID;
    }
    return member;
  });
  return { members, nextId: members.length };
}

/** ロスターに空きがあるかどうか（採用の上限）。 */
export const ROSTER_CAP = 6;
/** 採用 1 人にかかる予算コスト（ラン経済。SPEC 第4.4: 予算は採用・施策に使う）。 */
export const RECRUIT_COST = 25;
export function canRecruit(roster: RosterState): boolean {
  return roster.members.length < ROSTER_CAP;
}

/**
 * 採用候補のアーキタイプを 1 つ選ぶ（seed付きPRNG）。採用 UI/ノードが提示に使う。
 */
export function pickRecruitArchetype(rng: Rng): MemberArchetype {
  return RECRUIT_ARCHETYPES[Math.floor(rng() * RECRUIT_ARCHETYPES.length)];
}

/** 候補アーキタイプを採用し、ロスターへ加える（上限超過は変化なし。免疫的に新オブジェクトを返す）。 */
export function recruitMember(roster: RosterState, arch: MemberArchetype, rng: Rng): RosterState {
  if (!canRecruit(roster)) return roster;
  const used = new Set(roster.members.map((m) => m.name));
  let name = pickName(rng);
  let guard = 0;
  while (used.has(name) && guard < MEMBER_NAMES.length) {
    name = pickName(rng);
    guard += 1;
  }
  if (used.has(name)) name = `${name}+`;
  const member = createMember(arch, name, `m${roster.nextId}`);
  // 採用直後はベンチへ（編成は明示的な配置で行う）。
  member.assignment = 'bench';
  member.aiAssigned = false;
  return { members: [...roster.members, member], nextId: roster.nextId + 1 };
}

// --- 編成操作（免疫的に新ロスターを返す）---

/** 有効なレーン配置（window.game 経由の不正値を弾く防御に使う）。 */
const VALID_LANES: readonly LaneAssignment[] = ['coding', 'review', 'bench'];

function mapMember(roster: RosterState, id: string, fn: (m: Member) => Member): RosterState {
  let changed = false;
  const members = roster.members.map((m) => {
    if (m.id !== id) return m;
    changed = true;
    return fn(m);
  });
  return changed ? { ...roster, members } : roster;
}

/**
 * メンバーをレーンへ配置する（休職中は変更不可）。
 * 不正なレーン値（window.game の素の JS 呼び出し等）は無視して状態を保つ。
 * AI 配布はコーディング担当のみ有効なので、コーディング以外へ移したら AI を外す。
 */
export function assignMember(
  roster: RosterState,
  id: string,
  assignment: LaneAssignment,
): RosterState {
  if (!VALID_LANES.includes(assignment)) return roster;
  return mapMember(roster, id, (m) => {
    if (m.onLeave) return m;
    const aiAssigned = assignment === 'coding' ? m.aiAssigned : false;
    return { ...m, assignment, aiAssigned };
  });
}

/**
 * メンバーへの AI 配布を切り替える（コーディング担当のみ有効。休職・レビュー・ベンチは無効）。
 * `on` は真偽値へ強制する。window.game 経由で非ブール値（関数等）が渡っても
 * 後段の `structuredClone`（スナップショット）が壊れないようにするため。
 */
export function setAiAssigned(roster: RosterState, id: string, on: boolean): RosterState {
  const want = on === true;
  return mapMember(roster, id, (m) => {
    if (m.onLeave || m.assignment !== 'coding') return { ...m, aiAssigned: false };
    return { ...m, aiAssigned: want };
  });
}

// --- 編成効果の集約（個体値 → CardEffects）---

/** 在籍かつ稼働中（休職でない）か。 */
function isActive(m: Member): boolean {
  return !m.onLeave;
}

/**
 * 編成を 1 つの `FormationEffects` へ畳み込む（純関数）。
 * コーダーの実装力は Coding 速度・並列枠へ、レビュアーのレビュー力は Review 効率/容量へ、
 * AI 配布は配った相手の AI習熟で手戻り・障害を増減させ、さらに「AIを配ったコーダーの割合」が
 * 実 AI 採用率（aiAdoptionShare）になる。誰をどこに置き、誰に AI を配るかが戦術になる。
 * コーダーを誰も置かなければ実装はほぼ止まる（幽霊実装者を残さない）。
 */
export function foldFormationEffects(roster: RosterState): FormationEffects {
  const coders = roster.members.filter((m) => isActive(m) && m.assignment === 'coding');
  const reviewers = roster.members.filter((m) => isActive(m) && m.assignment === 'review');
  const noCoder = coders.length === 0;

  const codingPower = coders.reduce((s, m) => s + effectiveImpl(m), 0);
  const reviewPower = reviewers.reduce((s, m) => s + effectiveReview(m), 0);
  // 巨大PR等のレビュー負荷（コーダーのトレイト由来）。
  const reviewLoad = coders.reduce((p, m) => p * foldTraitModifiers(m.traits).reviewLoadMul, 1);

  // コーダー不在なら実装能力をほぼ無くす（最低枠の保険分も速度で潰す）。
  const codingSpeedMul = noCoder ? NO_CODER_CODING_SPEED : clamp(0.7 + codingPower / 230, 0.6, 1.8);
  const reviewEfficiencyMul = clamp((0.7 + reviewPower / 200) * reviewLoad, 0.55, 1.8);
  const reviewCapacityMul = clamp(0.8 + reviewers.length * 0.18, 0.8, 1.6);

  // AI 配布の効果（配った相手の AI習熟・トレイトで決まる）。AI を実際に使うのは
  // コーディング担当のタスクなので、効果対象もコーダーに揃える（採用率と一致させる）。
  let reworkRateAdd = 0;
  let incidentRateMul = 1;
  for (const m of coders) {
    if (!m.aiAssigned) continue;
    const masteryNorm = clamp(effectiveAiMastery(m) / 100, 0, 1.2);
    const traitMods = foldTraitModifiers(m.traits);
    // RI-77: 配布時の手戻り上乗せを弱め、習熟が高い相手への配布が報われやすくする。
    reworkRateAdd += 0.05 - 0.14 * masteryNorm + traitMods.aiReworkAdd;
    incidentRateMul *= 1 + (0.05 - 0.1 * masteryNorm);
  }

  // 実 AI 採用率の倍率: AIを配った稼働コーダーの割合（コーダー不在なら 0）。
  const aiCoders = coders.filter((m) => m.aiAssigned).length;
  const aiAdoptionShare = noCoder ? 0 : aiCoders / coders.length;

  const seniors = roster.members.filter(
    (m) => isActive(m) && m.assignment !== 'bench' && m.rank === 'senior',
  ).length;

  return {
    effects: {
      codingSpeedMul,
      reviewEfficiencyMul,
      reviewCapacityMul,
      reworkRateAdd: clamp(reworkRateAdd, -0.3, 0.3),
      incidentRateMul: clamp(incidentRateMul, 0.6, 1.6),
    },
    codingSlotBonus: noCoder ? NO_CODER_SLOT_PENALTY : clamp(coders.length - 1, 0, 3),
    focusBonus: Math.min(2, seniors),
    aiAdoptionShare,
  };
}

// --- 成長・スタミナ・離脱 ---

/** 1 段レベルアップした個体を返す（昇格判定込み・純関数）。promotion は呼び出し側で検出。 */
function levelUpOnce(m: Member): Member {
  const level = m.level + 1;
  const stats = {
    implementation: clamp(m.stats.implementation + 3, 0, 100),
    review: clamp(m.stats.review + 3, 0, 100),
    aiMastery: clamp(m.stats.aiMastery + 2, 0, 100),
  };
  const rank = higherRank(m.rank, rankFromLevel(level));
  const staminaMax = computeStaminaMax(rank, level, m.traits);
  return { ...m, level, stats, rank, staminaMax };
}

/** スプリントの生産性シグナル（成長の伸びに使う）。 */
export interface GrowthContext {
  delivered: number;
  done: number;
}

/**
 * スプリント後の成長・消耗・離脱を適用した新ロスターと結果を返す（純関数）。
 * 配置された稼働メンバーのみ経験値を得て消耗し、スタミナ枯渇で休職リスクを負う。
 * 乱数は離脱判定のみで、メンバー配列順に安定して消費する（決定論）。
 */
export function applySprintGrowth(
  roster: RosterState,
  ctx: GrowthContext,
  rng: Rng,
): { roster: RosterState; outcome: GrowthOutcome } {
  const outcome: GrowthOutcome = {
    promotions: [],
    leveledUp: [],
    wentOnLeave: [],
    docGain: 0,
  };

  const members = roster.members.map((member) => {
    let m = member;

    // ドキュメント魔は在籍（非休職）するだけでドキュメントを積む。
    if (!m.onLeave) {
      outcome.docGain += foldTraitModifiers(m.traits).docPerSprint;
    }

    // 休職・ベンチは成長/消耗の対象外（回復は recoverStamina が担う）。
    if (m.onLeave || m.assignment === 'bench') return m;

    const traitMods = foldTraitModifiers(m.traits);

    // 経験値と昇格。
    const baseXp = clamp(18 + ctx.done * 1.2, 18, 70);
    const gained = Math.round(baseXp * traitMods.xpMul * RANK_LEARN[m.rank]);
    let xp = m.xp + gained;
    const startRank = m.rank;
    let leveled = false;
    while (xp >= xpForLevel(m.level)) {
      xp -= xpForLevel(m.level);
      m = levelUpOnce(m);
      leveled = true;
    }
    m = { ...m, xp };
    if (leveled) outcome.leveledUp.push(m.id);
    if (m.rank !== startRank) {
      outcome.promotions.push({ id: m.id, name: m.name, to: m.rank });
    }

    // スタミナ消費。
    const laneMul = LANE_DRAIN_MUL[m.assignment as 'coding' | 'review'];
    const aiRelief = m.aiAssigned && m.assignment === 'coding' ? AI_DRAIN_RELIEF : 1;
    const drain = Math.round(BASE_DRAIN * laneMul * traitMods.staminaDrainMul * aiRelief);
    const stamina = Math.max(0, m.stamina - drain);
    m = { ...m, stamina };

    // 離脱（休職）判定。スタミナが低いほど確率が上がる。
    if (stamina <= LEAVE_THRESHOLD) {
      const p = LEAVE_MAX_P * (1 - stamina / LEAVE_THRESHOLD);
      if (rng() < p) {
        outcome.wentOnLeave.push({ id: m.id, name: m.name });
        m = { ...m, onLeave: true, assignment: 'bench', aiAssigned: false };
      }
    }

    return m;
  });

  return { roster: { ...roster, members }, outcome };
}

/**
 * 全メンバーのスタミナを回復する（スプリント間 / 休息ノード）。
 * 休職中はやや速く回復し、上限の一定割合まで戻ると復帰（ベンチ）する。
 * `skipIds` のメンバーは今回回復しない（このスプリントで休職入りした直後の者を
 * 即復帰させないために使う。休職に実コストを持たせる）。
 */
export function recoverStamina(
  roster: RosterState,
  amount: number,
  skipIds?: ReadonlySet<string>,
): RosterState {
  const members = roster.members.map((m) => {
    if (skipIds?.has(m.id)) return m;
    const gain = Math.round(amount * (m.onLeave ? LEAVE_RECOVERY_MUL : 1));
    const stamina = Math.min(m.staminaMax, m.stamina + gain);
    if (m.onLeave && stamina >= m.staminaMax * RETURN_RATIO) {
      return { ...m, stamina, onLeave: false };
    }
    return { ...m, stamina };
  });
  return { ...roster, members };
}

// --- 表示・集計（UI 用の純関数）---

/** スタミナ・休職から表情演出を導く（SPEC 第12.2）。 */
export function memberExpression(m: Member): MemberExpression {
  if (m.onLeave) return 'leave';
  const ratio = m.staminaMax > 0 ? m.stamina / m.staminaMax : 0;
  if (ratio < 0.25) return 'tired';
  if (ratio > 0.8) return 'great';
  return 'normal';
}

/** ロスターの集計（UI 表示用）。 */
export function rosterSummary(roster: RosterState): {
  total: number;
  active: number;
  onLeave: number;
  coders: number;
  reviewers: number;
} {
  let active = 0;
  let onLeave = 0;
  let coders = 0;
  let reviewers = 0;
  for (const m of roster.members) {
    if (m.onLeave) onLeave += 1;
    else active += 1;
    if (!m.onLeave && m.assignment === 'coding') coders += 1;
    if (!m.onLeave && m.assignment === 'review') reviewers += 1;
  }
  return { total: roster.members.length, active, onLeave, coders, reviewers };
}

/** 休職を除いた稼働エンジニア数（組織スケールの `Team.engineers` へ載せる）。 */
export function activeEngineerCount(roster: RosterState): number {
  return roster.members.reduce((n, m) => n + (isActive(m) ? 1 : 0), 0);
}

/** 稼働かつ AI 配布中の人数（プレイヤーチーム島の AI ボット表示へ載せる）。 */
export function aiAssignedCount(roster: RosterState): number {
  return roster.members.reduce((n, m) => n + (isActive(m) && m.aiAssigned ? 1 : 0), 0);
}
