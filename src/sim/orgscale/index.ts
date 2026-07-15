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
