/**
 * 組織スケール（SPEC 第4.7〜4.11）の公開エントリ。
 *
 * 現場 → 部署 → 全社 → 業界 の集約モデルを、描画非依存・seed付き決定論で提供する。
 */
export type {
  ZoomLevel,
  ZoomState,
  TeamHealth,
  RankingKind,
  DepartmentDef,
  Team,
  TeamRunState,
  DepartmentState,
  OrgScaleState,
  OrgAdjust,
  OrgAdjustState,
  LeverDef,
  RivalOrg,
  LeaderboardEntry,
  IndustryState,
} from './types';
export {
  teamHealth,
  isOnFire,
  aggregateHealth,
  aggregateDepartment,
  aggregateCompany,
  healthRank,
  companyScore,
} from './aggregate';
export { generateOrgScale, estimateRivalAiAssigned, type OrgScaleInput } from './generate';
export { emptyAdjust, emptyAdjustState, mergeAdjust, applyLever, type LeverResult } from './levers';
export { generateIndustry, computeScores, RANKING_KINDS, RANKING_LABEL } from './industry';
export {
  HOME_TEAM_ID,
  ENTER_TEAM_FOCUS_PENALTY,
  ENTER_TEAM_LOCK_SPRINTS,
  RIVAL_AI_DEPENDENCY_SPREAD,
  RIVAL_AI_DEPENDENCY_SPREAD_LOW_LITERACY,
  initTeamRunStates,
  syncTeamFromOrg,
  engineersFromRoster,
  orgFromTeam,
  companyOrgFromTeams,
  createTeamRoster,
  estimateActiveAssignedCount,
  appendTeamsToDept,
  advanceCoarseTeams,
  applyEffectToTeam,
  deriveTeamCapacities,
  normalizeCoarseTotalsDelta,
  coarseShipToCompleted,
  projectOrgScale,
  assertDeptShippingInvariant,
  activeLiveFromOrg,
  companyInfraFromTeams,
  teamName,
  retainNonMetricAdjust,
  stripMetricAdjustments,
  estimateRosterCoderCount,
  type CoarseRunModifiers,
  type CoarseStepResult,
} from './teamState';
