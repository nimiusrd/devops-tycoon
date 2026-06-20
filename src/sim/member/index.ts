/**
 * 個体メンバー育成（SPEC 第12章 / MVP4）の公開エントリ。
 *
 * ドメイン型と、生成・編成・成長・スタミナ管理の純関数を再エクスポートする。
 * 乱数は引数の seed付きPRNG からのみ消費し、描画を知らない（第22.3 / 22.2）。
 */
export type {
  Member,
  MemberRank,
  MemberStats,
  MemberExpression,
  LaneAssignment,
  RosterState,
  FormationEffects,
  GrowthOutcome,
  TraitId,
} from './types';
export {
  ROSTER_CAP,
  RECRUIT_COST,
  STAMINA_RECOVER_BETWEEN,
  REST_STAMINA_RECOVER,
  createMember,
  createInitialRoster,
  canRecruit,
  pickRecruitArchetype,
  recruitMember,
  assignMember,
  setAiAssigned,
  foldFormationEffects,
  applySprintGrowth,
  recoverStamina,
  memberExpression,
  rosterSummary,
  rankLabel,
  xpForLevel,
  computeStaminaMax,
  effectiveImpl,
  effectiveReview,
  effectiveAiMastery,
} from './roster';
export type { GrowthContext } from './roster';
