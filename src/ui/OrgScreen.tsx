/**
 * 全社マップ（全社俯瞰モード。SPEC 第4.8 / mockups/org-screen）。
 *
 * 部門ゾーン・チーム島（健全度で色分け）・共通基盤ハブ・全社HUD・全社レバーを表示する。
 * チーム島をタップすると現場へドリルダウンし、部門ヘッダから部署ビューへ寄る。
 * 状態は読むだけ（第22.2）。島の配置は `render/iso.ts` のアイソメ投影で決まる。
 */
import { useCallback, useMemo } from 'react';
import { COMPANY_LEVERS } from '../data/levers';
import { diagnosisView } from '../sim/diagnosis';
import type { OrgScaleState, Team } from '../sim/orgscale/types';
import { getRendererKind } from '../render/adapters/selectRenderer';
import { HEALTH_COLOR, HEALTH_LABEL, layoutIso, ORG_ISO, ORG_PAD } from '../render/orgView';
import { OrgPixiField } from './OrgPixiField';

const ISO = ORG_ISO;
const PAD = ORG_PAD;

export interface OrgScreenProps {
  org: OrgScaleState;
  budget: number;
  onFocusDept: (id: string) => void;
  onFocusTeam: (id: string) => void;
  onApplyLever: (leverId: string) => void;
}

export function OrgScreen({ org, budget, onFocusDept, onFocusTeam, onApplyLever }: OrgScreenProps) {
  const teams = org.departments.flatMap((d) => d.teams);
  const layout = layoutIso(teams, ISO, PAD);
  const usePixi = getRendererKind(window.location.search) === 'pixi';
  const deptColorMap = useMemo(
    () => Object.fromEntries(org.departments.map((d) => [d.def.id, d.def.color])),
    [org.departments],
  );
  const deptColor = useCallback((id: string) => deptColorMap[id] ?? '#6b4a9e', [deptColorMap]);
  const fieldHeight = Math.max(260, layout.height);

  return (
    <div className="org-screen" data-testid="org-screen">
      <header className="org-head">
        <h2>🗺 全社マップ</h2>
        <span className="org-diagnosis" data-testid="org-diagnosis">
          {diagnosisView(org.diagnosis).label}
        </span>
        <span className="org-rank">健全度 {org.healthRank}</span>
      </header>

      <dl className="org-hud" data-testid="org-hud">
        <Stat label="全社出荷" value={org.shipping} />
        <Stat label="部門 / チーム" value={`${org.deptCount} / ${org.teamCount}`} />
        <Stat label="エンジニア" value={org.engineers} />
        <Stat
          label="AI依存度"
          value={`${org.aiDependency}`}
          tone={org.aiDependency >= 70 ? 'warn' : undefined}
        />
        <Stat label="技術的負債" value={org.techDebt} />
        <Stat label="全社士気" value={org.morale} />
        <Stat
          label="炎上中チーム"
          value={org.onFire}
          tone={org.onFire > 0 ? 'bad' : 'good'}
          testid="org-onfire"
        />
        <Stat label="四半期予算" value={budget} tone="budget" />
      </dl>

      <div className="org-depts" data-testid="org-depts">
        {org.departments.map((d) => (
          <button
            type="button"
            key={d.def.id}
            className="org-dept-chip"
            data-testid={`dept-chip-${d.def.id}`}
            style={{ borderColor: d.def.color }}
            onClick={() => onFocusDept(d.def.id)}
            title="部署ビューへ寄る"
          >
            <span className="dot" style={{ background: d.def.color }} />
            <b>{d.def.name}</b>
            <span className="org-dept-meta">
              出荷 {d.shipping} ・ 炎上 {d.onFire} ・ 耐性 {d.reviewResilience}
            </span>
          </button>
        ))}
      </div>

      <div className="org-field" data-testid="org-field" style={{ height: fieldHeight }}>
        <div className="org-field-board" style={{ width: layout.width, height: fieldHeight }}>
          <div
            className="org-infra-hub"
            data-testid="org-infra-hub"
            title="共通基盤ハブ（全チームへ波及）"
          >
            <span aria-hidden>🛰</span>
            <span>共通基盤</span>
            <span className="org-infra-meta">
              CI {org.infra.ci} / Docs {org.infra.docs} / AI {org.infra.aiGuideline}
            </span>
          </div>
          {usePixi ? (
            <OrgPixiField teams={teams} onFocusTeam={onFocusTeam} deptColor={deptColor} />
          ) : (
            layout.placed.map(({ item, x, y }) => (
              <TeamIsland
                key={item.id}
                team={item}
                color={deptColor(item.deptId)}
                x={x}
                y={y}
                onClick={() => onFocusTeam(item.id)}
              />
            ))
          )}
        </div>
      </div>

      <div className="org-levers" data-testid="org-levers">
        <span className="org-levers-title">全社レバー</span>
        {COMPANY_LEVERS.map((l) => (
          <button
            type="button"
            key={l.id}
            className="org-lever"
            data-testid={`lever-${l.id}`}
            disabled={budget < l.cost}
            onClick={() => onApplyLever(l.id)}
            title={l.description}
          >
            <b>{l.name}</b>
            <span className="org-lever-cost">💰{l.cost}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TeamIsland({
  team,
  color,
  x,
  y,
  onClick,
}: {
  team: Team;
  color: string;
  x: number;
  y: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`team-island health-${team.health}${team.isPlayer ? ' is-player' : ''}`}
      data-testid={`team-${team.id}`}
      data-health={team.health}
      style={{
        left: x,
        top: y,
        borderColor: color,
        boxShadow: `0 0 0 2px ${HEALTH_COLOR[team.health]}55`,
      }}
      onClick={onClick}
      title={`${team.name}（${HEALTH_LABEL[team.health]}）へドリルダウン`}
    >
      <span className="team-badge" style={{ background: HEALTH_COLOR[team.health] }} />
      <b className="team-name">
        {team.isPlayer ? '★ ' : ''}
        {team.name}
      </b>
      <span className="team-meta">出荷 {team.shipping}</span>
      <span className="team-meta">AI {team.aiDependency}</span>
      {team.incidents > 0 && <span className="team-fire">🔥{team.incidents}</span>}
    </button>
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
  tone?: 'good' | 'warn' | 'bad' | 'budget';
  testid?: string;
}) {
  return (
    <div className={`org-stat${tone ? ` tone-${tone}` : ''}`}>
      <dt>{label}</dt>
      <dd data-testid={testid}>{value}</dd>
    </div>
  );
}
