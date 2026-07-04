/**
 * 部署ビュー（SPEC 第4.9 / mockups/dept-screen）。
 *
 * 部門内の各チームを Coding ▸ Review ▸ Done の小パイプラインとして中解像度で表示し、
 * チーム間依存（連鎖炎上）と部門HUD・部門レバーを見せる。現場と全社の橋渡し層。
 * 状態は読むだけ（第22.2）。
 */
import { DEPARTMENT_LEVERS } from '../data/levers';
import type { DepartmentState, Team } from '../sim/orgscale/types';
import { HEALTH_COLOR, HEALTH_LABEL } from '../render/orgView';
import { formatLeverDefTags, formatLeverTooltip } from '../render/eventOutcomeView';
import { EffectTagList } from './EffectTagList';

export interface DeptScreenProps {
  dept: DepartmentState;
  budget: number;
  onFocusTeam: (id: string) => void;
  onApplyLever: (leverId: string, deptId: string) => void;
}

export function DeptScreen({ dept, budget, onFocusTeam, onApplyLever }: DeptScreenProps) {
  // 連鎖炎上: 炎上チームの下流（配列の次チーム）を「延焼リスク」として印す。
  const fireIndices = dept.teams
    .map((t, i) => (t.health === 'reviewHell' ? i : -1))
    .filter((i) => i >= 0);
  const chained = new Set<number>();
  for (const i of fireIndices) if (i + 1 < dept.teams.length) chained.add(i + 1);

  return (
    <div className="dept-screen" data-testid="dept-screen">
      <header className="dept-head">
        <span className="dot" style={{ background: dept.def.color }} />
        <h2>🏢 {dept.def.name}</h2>
        <span className="dept-health" data-health={dept.health}>
          {HEALTH_LABEL[dept.health]}
        </span>
      </header>

      <dl className="dept-hud" data-testid="dept-hud">
        <Stat label="部門出荷" value={dept.shipping} />
        <Stat label="レビュー耐性" value={dept.reviewResilience} />
        <Stat label="部門AI依存度" value={dept.aiDependency} />
        <Stat label="部門技術的負債" value={dept.techDebt} />
        <Stat label="部門士気" value={dept.morale} />
        <Stat
          label="炎上チーム"
          value={dept.onFire}
          tone={dept.onFire > 0 ? 'bad' : 'good'}
          testid="dept-onfire"
        />
      </dl>

      <div className="dept-teams" data-testid="dept-teams">
        {dept.teams.map((t, i) => (
          <TeamPipeline
            key={t.id}
            team={t}
            chained={chained.has(i)}
            hasDownstream={i + 1 < dept.teams.length}
            onClick={() => onFocusTeam(t.id)}
          />
        ))}
      </div>

      <div className="dept-levers" data-testid="dept-levers">
        <span className="org-levers-title">部門レバー</span>
        {DEPARTMENT_LEVERS.map((l) => (
          <button
            type="button"
            key={l.id}
            className="org-lever"
            data-testid={`lever-${l.id}`}
            disabled={budget < l.cost}
            onClick={() => onApplyLever(l.id, dept.def.id)}
            title={formatLeverTooltip(l)}
          >
            <span className="org-lever-head">
              <b>{l.name}</b>
              <span className="org-lever-cost">💰{l.cost}</span>
            </span>
            <EffectTagList tags={formatLeverDefTags(l)} testId={`lever-tags-${l.id}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** チーム = 小パイプライン（Coding ▸ Review ▸ Done）。 */
function TeamPipeline({
  team,
  chained,
  hasDownstream,
  onClick,
}: {
  team: Team;
  chained: boolean;
  hasDownstream: boolean;
  onClick: () => void;
}) {
  const coding = Math.max(1, Math.round(team.engineers * 0.6));
  const review = team.reviewQueue;
  const done = Math.round(team.shipping / 100);
  return (
    <div className="team-pipe-wrap">
      <button
        type="button"
        className={`team-pipe health-${team.health}${chained ? ' chained' : ''}`}
        data-testid={`team-${team.id}`}
        data-health={team.health}
        onClick={onClick}
        title={`${team.name}（${HEALTH_LABEL[team.health]}）の現場へ`}
      >
        <div className="team-pipe-head">
          <b>
            {team.isPlayer ? '★ ' : ''}
            {team.name}
          </b>
          <span className="team-pipe-badge" style={{ background: HEALTH_COLOR[team.health] }}>
            {HEALTH_LABEL[team.health]}
          </span>
        </div>
        <div className="team-lanes">
          <Lane name="Coding" count={coding} />
          <span className="lane-arrow">▸</span>
          <Lane name="Review" count={review} hot={review >= 6} />
          <span className="lane-arrow">▸</span>
          <Lane name="Done" count={done} />
        </div>
        {team.incidents > 0 && <div className="team-pipe-fire">🔥 炎上 {team.incidents}</div>}
        {chained && (
          <div className="team-pipe-chain" data-testid="chain-fire">
            ⚠ 上流から延焼
          </div>
        )}
      </button>
      {hasDownstream && (
        <span className="dep-arrow" aria-hidden>
          ➜
        </span>
      )}
    </div>
  );
}

function Lane({ name, count, hot }: { name: string; count: number; hot?: boolean }) {
  return (
    <div className={`team-lane${hot ? ' hot' : ''}`}>
      <span className="lane-name">{name}</span>
      <span className="lane-count">{count}</span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  testid,
}: {
  label: string;
  value: number | string;
  tone?: 'good' | 'bad';
  testid?: string;
}) {
  return (
    <div className={`org-stat${tone ? ` tone-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd data-testid={testid}>{value}</dd>
    </div>
  );
}
