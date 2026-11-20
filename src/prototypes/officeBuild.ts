import { getLever } from '../data/levers';
import { createRunEngine } from '../sim/run/engine';
import type { RunPersistState } from '../sim/run/persist';
import type { RosterState } from '../sim/member/types';

export const OFFICE_BUILD_SEED = 'issue-736-office-build';
const REVIEW_HELP_ID = 'teamReviewHelp';

export function officeReviewHelp() {
  const lever = getLever(REVIEW_HELP_ID);
  if (!lever) throw new Error('Office build requires the team review lever');
  return lever;
}

export function createOfficeBuildStart(): RunPersistState {
  const engine = createRunEngine({ seed: OFFICE_BUILD_SEED });
  engine.startRun();
  const start = engine.exportPersistState();
  if (!start?.extras.teams) throw new Error('Office build requires a setup checkpoint');

  // 同じ滞留から比較できるよう、初期編成に引き継ぎのレビュー待ちと炎上を設定する。
  start.extras.teams = start.extras.teams.map((team) =>
    team.id === start.extras.activeTeamId ? { ...team, reviewQueue: 10, incidents: 1 } : team,
  );
  return start;
}

export function prepareOfficeBuild(
  start: RunPersistState,
  roster: RosterState,
  requestReviewHelp: boolean,
) {
  const engine = createRunEngine();
  engine.hydratePersistState(start);
  const { activeTeamId } = engine.snapshot();
  for (const member of roster.members) {
    engine.assignMember(member.id, member.assignment);
    engine.setMemberAi(member.id, member.aiAssigned);
  }
  const reviewHelpApplied =
    requestReviewHelp && engine.applyOrgLever(REVIEW_HELP_ID, undefined, activeTeamId);

  const forecast = engine.whatIfComputeInput();
  if (!forecast) throw new Error('Office build preview requires setup');
  engine.beginSetupSprint();
  return {
    engine,
    forecast: { ...forecast, teamReviewQueue: forecast.teamReviewQueue ?? 0 },
    reviewHelpApplied,
    launch: engine.snapshot(),
  };
}
