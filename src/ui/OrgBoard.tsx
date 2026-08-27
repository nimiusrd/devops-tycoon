/**
 * 全社マップの等角盤面レンダラ（SPEC 第4.8 準拠）。
 *
 * `orgBoardScene` が組み立てたシーン計画を読み、俯瞰オフィス（アイソメ）として描く。
 * 座標は設計空間（1404×573）の % で重ねる。Board.tsx と同型（第22.2）。
 */
import { useLayoutEffect, useRef } from 'react';
import type { OrgScaleState } from '../sim/orgscale/types';
import { ORG_VIEW, planOrgBoardScene, type OrgIslandPlan } from '../render/orgBoardScene';
import { OrgFlowLanes } from './OrgFlowLanes';
import { OrgHubLabel, OrgHubSvg } from './OrgHub';
import { OrgPlate } from './OrgPlate';
import { OrgIslandBadge, OrgTeamActor } from './OrgTeamActor';
import { pct } from './pct';

const VIEW_W = ORG_VIEW.w;
const VIEW_H = ORG_VIEW.h;

/** 設計pxラベルを実ステージ幅へ写す単位なし倍率（`--org-board-scale`）。 */
function useOrgBoardScale() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const apply = (): void => {
      const scale = el.clientWidth > 0 ? el.clientWidth / VIEW_W : 1;
      el.style.setProperty('--org-board-scale', String(scale));
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function ZoneLabel({
  label,
}: {
  label: ReturnType<typeof planOrgBoardScene>['zoneLabels'][number];
}) {
  return (
    <div
      className={`org-zone-label tone-${label.tone}`}
      data-testid={`zone-label-${label.deptId}`}
      style={{ left: pct(label.x, VIEW_W), top: pct(label.y, VIEW_H) }}
    >
      <strong>{label.title}</strong>
      <small>{label.subtitle}</small>
    </div>
  );
}

function OrgIsland({ island, onClick }: { island: OrgIslandPlan; onClick: () => void }) {
  const { team } = island;
  return (
    <div className="org-island-group" style={{ zIndex: 20 + island.depth }}>
      <div
        className={`org-island-badge-wrap tone-${island.badge.tone}`}
        data-testid={`island-badge-${island.teamId}`}
        style={{ left: pct(island.badge.x, VIEW_W), top: pct(island.badge.y, VIEW_H) }}
      >
        <OrgIslandBadge island={island} />
      </div>
      <button
        type="button"
        className={`org-island health-${team.health}${team.isPlayer ? ' is-player' : ''}`}
        data-testid={`team-${team.id}`}
        data-health={team.health}
        style={{
          left: pct(island.x, VIEW_W),
          top: pct(island.y, VIEW_H),
        }}
        onClick={onClick}
        title={island.labels.title}
      >
        <OrgTeamActor island={island} />
        {island.labels.fire && <span className="org-island-fire">{island.labels.fire}</span>}
      </button>
    </div>
  );
}

export interface OrgBoardProps {
  org: OrgScaleState;
  onFocusTeam: (id: string) => void;
}

export function OrgBoard({ org, onFocusTeam }: OrgBoardProps) {
  const scene = planOrgBoardScene(org);
  const hot = org.onFire > 0 || org.departments.some((d) => d.health === 'reviewHell');
  const boardRef = useOrgBoardScale();

  return (
    <div
      ref={boardRef}
      className={`org-board iso-org${hot ? ' org-hell' : ''}`}
      data-testid="org-board"
    >
      <OrgPlate zones={scene.zones} />
      <OrgFlowLanes flows={scene.flows} />

      {scene.zoneLabels.map((z) => (
        <ZoneLabel key={z.deptId} label={z} />
      ))}

      <div
        className="org-hub-station"
        style={{
          left: pct(scene.hub.x, VIEW_W),
          top: pct(scene.hub.y, VIEW_H),
        }}
      >
        <OrgHubSvg />
      </div>
      <OrgHubLabel hub={scene.hub} pctX={(v) => pct(v, VIEW_W)} pctY={(v) => pct(v, VIEW_H)} />

      {scene.islands.map((island) => (
        <OrgIsland key={island.teamId} island={island} onClick={() => onFocusTeam(island.teamId)} />
      ))}

      <div className="org-board-hint">
        チームの島を<b>クリック</b>で状態確認（部署へ）。選択中チームは現場へ
      </div>
    </div>
  );
}
