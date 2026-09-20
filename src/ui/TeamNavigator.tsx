/** Canvasの島と同じチームをキーボード・小画面から選ぶ。盤面の二重描画は行わない。 */
import type { Team } from '../sim/orgscale/types';
import { HEALTH_LABEL } from '../render/orgView';

export function TeamNavigator({
  teams,
  selectedTeamId,
  onFocusTeam,
}: {
  teams: readonly Team[];
  selectedTeamId?: string | null;
  onFocusTeam: (id: string) => void;
}) {
  return (
    <details className="team-navigator" data-testid="team-navigator">
      <summary>チームを選ぶ（{teams.length}）</summary>
      <div className="org-depts" role="group" aria-label="チーム一覧">
        {teams.map((team) => (
          <button
            type="button"
            key={team.id}
            className="org-dept-chip"
            data-testid={`team-${team.id}`}
            data-team-id={team.id}
            data-health={team.health}
            onClick={() => onFocusTeam(team.id)}
            aria-pressed={selectedTeamId === team.id}
            aria-current={team.isActive ? true : undefined}
            aria-label={`${team.name}を選ぶ。健全度 ${HEALTH_LABEL[team.health]}`}
          >
            <b>{team.name}</b>
            <span>
              {HEALTH_LABEL[team.health]}・出荷 {team.shipping}・AI {team.aiDependency}・
              {team.engineers}人
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
