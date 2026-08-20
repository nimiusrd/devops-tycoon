/**
 * 組織スケール状態の決定論生成・投影（SPEC 第4.8 / 第22.3 / RI-64）。
 *
 * ラン中の正本は `TeamRunState[]`（`teamState.ts`）。本モジュールの
 * `generateOrgScale` は単発生成（テスト・旧互換）用に初期化→投影する。
 * エンジンは永続 teams を `projectOrgScale` へ渡す。
 */
import type { DiagnosisType, RunTotals } from '../run/types';
import type { OrgState } from '../types';
import { COARSE_TEAM_BALANCE } from '../../data/balance';
import { emptyAdjustState } from './levers';
import {
  activeLiveFromOrg,
  appendTeamsToDept,
  HOME_TEAM_ID,
  initTeamRunStates,
  projectOrgScale,
} from './teamState';
import type { OrgAdjustState, OrgScaleState } from './types';

export { estimateRivalAiAssigned } from './teamState';

/** 全社生成の入力。実ランの現場状態と予算・調整を渡す（単発生成用）。 */
export interface OrgScaleInput {
  seed: string;
  org: OrgState;
  totals: RunTotals;
  diagnosis: DiagnosisType;
  budget: number;
  /** これまでに発動したレバーの蓄積（無指定は無調整）。 */
  adjust?: OrgAdjustState;
  /** プレイヤーチームの規模（稼働エンジニア数。休職除外。既定 5）。 */
  playerEngineers?: number;
  /** プレイヤーチームの AI 配布人数（ロスター由来。既定 0）。 */
  playerAiAssigned?: number;
  /**
   * 進行中スプリントの現在のレビュー待ち行列（`totals` は resolveSprint 後に更新される
   * ため、スプリント中に俯瞰すると行列が古くなる。現在値を畳み込んで現場を映す）。
   */
  liveReviewQueue?: number;
  /** 進行中スプリントで盤面に残る未鎮火インシデント数（同上）。 */
  liveIncidents?: number;
  /**
   * 永続チーム配列（指定時は再初期化せず投影のみ。RI-64）。
   * 無指定なら seed から一度だけ初期化して投影する。
   */
  teams?: ReturnType<typeof initTeamRunStates>;
  homeTeamId?: string;
  activeTeamId?: string;
}

/**
 * 全社マップ状態を生成する。
 * `teams` 未指定時はホーム＋ライバルを seed から初期化し、
 * `adjust.company.extraTeams` 分を先頭部門へ append してから投影する（テスト互換）。
 */
export function generateOrgScale(input: OrgScaleInput): OrgScaleState {
  const engineers = input.playerEngineers ?? COARSE_TEAM_BALANCE.defaultHomeEngineers.value;
  const adjust = input.adjust ?? emptyAdjustState();
  let teams =
    input.teams ??
    initTeamRunStates({
      seed: input.seed,
      org: input.org,
      homeEngineers: engineers,
      homeReviewQueue: Math.max(input.totals.reviewQueuePeak, input.liveReviewQueue ?? 0),
      homeIncidents: Math.max(
        Math.max(0, input.totals.incidents - input.totals.contained),
        input.liveIncidents ?? 0,
      ),
    });
  const homeTeamId = input.homeTeamId ?? HOME_TEAM_ID;
  const activeTeamId = input.activeTeamId ?? homeTeamId;
  // 単発生成では extraTeams をここで反映（エンジン経路は apply 時に append 済み）。
  if (!input.teams) {
    const extra = Math.max(0, Math.round(adjust.company.extraTeams));
    if (extra > 0) {
      const template = teams.find((t) => t.id === homeTeamId) ?? teams[0];
      const productCount = teams.filter((t) => t.deptId === 'product').length;
      teams = appendTeamsToDept(teams, {
        seed: input.seed,
        deptId: 'product',
        count: extra,
        template,
        nextIndexStart: productCount,
      });
    }
  }

  const active = teams.find((t) => t.id === activeTeamId);
  return projectOrgScale({
    seed: input.seed,
    teams,
    homeTeamId,
    activeTeamId,
    activeLive: activeLiveFromOrg({
      org: input.org,
      engineers,
      aiAssignedCount: Math.max(0, input.playerAiAssigned ?? 0),
      reviewQueue: input.liveReviewQueue ?? active?.reviewQueue ?? 0,
      incidents: input.liveIncidents ?? active?.incidents ?? 0,
    }),
    adjust,
    diagnosis: input.diagnosis,
    budget: input.budget,
    infraBase: {
      ci: input.org.testCoverage,
      docs: input.org.documentation,
      aiGuideline: input.org.aiLiteracy,
    },
  });
}
