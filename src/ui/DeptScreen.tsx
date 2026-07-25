/**
 * 部署ビュー（SPEC 第4.9 / RI-64）。
 *
 * 部門内の各チームを Coding ▸ Review ▸ Done の小パイプラインとして中解像度で表示し、
 * チーム間依存（連鎖炎上）と部門HUD・部門／チームレバーを見せる。
 * 状態確認（島クリック）と入り込みを分離する。
 */
import { lazy, Suspense } from 'react';
import { DEPARTMENT_LEVERS, TEAM_LEVERS } from '../data/levers';
import { ENTER_TEAM_FOCUS_PENALTY, ENTER_TEAM_LOCK_SPRINTS } from '../sim/orgscale';
import type { DepartmentState, Team } from '../sim/orgscale/types';
import type { RunPhase } from '../sim/run/types';
import { HEALTH_LABEL } from '../render/orgView';
import { formatLeverDefTags, formatLeverTooltip } from '../render/eventOutcomeView';
import { DeptBoard } from './DeptBoard';
import { EffectTagList } from './EffectTagList';
import { usePixiRenderer } from './usePixiRenderer';

/** Pixi 部署盤面は動的 import（RI-12）。usePixi 時のみチャンクを取得する。 */
const DeptPixiBoard = lazy(() =>
  import('./DeptPixiBoard').then((m) => ({ default: m.DeptPixiBoard })),
);

export interface DeptScreenProps {
  dept: DepartmentState;
  budget: number;
  selectedTeamId: string | null;
  activeTeamId: string;
  teamLockUntilSprint: number;
  sprintsPlayed: number;
  /** 入り込み可否判定用（sprint / quarterReview はエンジン側で拒否）。 */
  phase: RunPhase;
  onFocusTeam: (id: string) => void;
  onEnterTeam: (id: string) => void;
  onApplyLever: (leverId: string, deptId?: string, teamId?: string) => void;
}

export function DeptScreen({
  dept,
  budget,
  selectedTeamId,
  activeTeamId,
  teamLockUntilSprint,
  sprintsPlayed,
  phase,
  onFocusTeam,
  onEnterTeam,
  onApplyLever,
}: DeptScreenProps) {
  const { usePixi, onWebglError } = usePixiRenderer();
  const selected: Team | undefined = dept.teams.find((t) => t.id === selectedTeamId);
  const locked = sprintsPlayed < teamLockUntilSprint;
  // エンジン契約: sprint は全入り込み拒否。quarterReview は他チーム切替のみ拒否。
  const canEnter = selected
    ? selected.id === activeTeamId
      ? phase !== 'sprint'
      : phase !== 'sprint' && phase !== 'quarterReview' && !locked
    : false;

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

      <div className="dept-field" data-testid="dept-field">
        {usePixi ? (
          <Suspense fallback={null}>
            <DeptPixiBoard dept={dept} onFocusTeam={onFocusTeam} onWebglError={onWebglError} />
          </Suspense>
        ) : (
          <DeptBoard dept={dept} onFocusTeam={onFocusTeam} selectedTeamId={selectedTeamId} />
        )}
      </div>

      {selected && (
        <div className="dept-team-panel" data-testid="dept-team-panel">
          <div className="dept-team-panel-head">
            <strong>{selected.name}</strong>
            <span data-health={selected.health}>{HEALTH_LABEL[selected.health]}</span>
            {selected.id === activeTeamId && (
              <span className="dept-team-active" data-testid="team-active-badge">
                選択中
              </span>
            )}
          </div>
          <dl className="dept-team-stats">
            <Stat label="出荷" value={selected.shipping} />
            <Stat label="AI依存" value={selected.aiDependency} />
            <Stat label="行列" value={selected.reviewQueue} />
            <Stat label="炎上" value={selected.incidents} />
            <Stat label="士気" value={selected.morale} />
            <Stat label="負債" value={selected.techDebt} />
          </dl>
          <div className="dept-team-actions">
            <button
              type="button"
              className="org-lever"
              data-testid="enter-team"
              disabled={!canEnter}
              onClick={() => onEnterTeam(selected.id)}
              title={
                selected.id === activeTeamId
                  ? phase === 'sprint'
                    ? 'スプリント中は現場へ戻れません'
                    : '選択中チームの現場へ戻る'
                  : phase === 'sprint'
                    ? 'スプリント中はチームを切り替えられません'
                    : phase === 'quarterReview'
                      ? '四半期レビュー中はチームを切り替えられません'
                      : locked
                        ? `入り込み拘束中（あと${teamLockUntilSprint - sprintsPlayed}スプリント）`
                        : `入り込む（次スプリント集中力${ENTER_TEAM_FOCUS_PENALTY}、${ENTER_TEAM_LOCK_SPRINTS}スプリント拘束）`
              }
            >
              {selected.id === activeTeamId ? '現場へ戻る' : '入り込む'}
            </button>
          </div>
          <div className="dept-levers" data-testid="team-levers">
            <span className="org-levers-title">チームレバー</span>
            {TEAM_LEVERS.map((l) => (
              <button
                type="button"
                key={l.id}
                className="org-lever"
                data-testid={`lever-${l.id}`}
                disabled={budget < l.cost}
                onClick={() => onApplyLever(l.id, undefined, selected.id)}
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
      )}

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
