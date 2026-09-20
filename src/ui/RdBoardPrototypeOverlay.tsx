/**
 * R&D 盤面 A/B のプレースホルダ背景とデバッグオーバーレイ。
 * 本番アートではない。色に頼らずラベルで炎上・渋滞・延焼を指せるようにする。
 */
import { BOARD_VIEW, LANE_STATION_CENTERS, type RdBoardLayout } from '../render/boardScene';
import {
  planRdHitAreas,
  planRdSignalMarkers,
  planRdSpreadLink,
  type RdHitArea,
} from '../render/rdBoardPrototype';
import type { BoardScenePlan } from '../render/boardScene';
import { writeRdLayoutToLocation } from '../render/rdBoardLayout';
import { VISUAL_TOKENS } from '../render/visualTokens';
import { pct } from './pct';

const VIEW_W = BOARD_VIEW.w;
const VIEW_H = BOARD_VIEW.h;

const LANE_ORDER = ['backlog', 'coding', 'review', 'rework', 'done'] as const;

export function RdLaneRoom() {
  const bandH = 96;
  return (
    <svg
      className="office-room rd-lane-room"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      data-testid="rd-lane-room"
    >
      <rect width={VIEW_W} height={VIEW_H} fill={VISUAL_TOKENS.colors.panel} />
      {LANE_ORDER.map((lane) => {
        const y = LANE_STATION_CENTERS[lane].y;
        const hot = lane === 'review';
        return (
          <g key={lane}>
            <rect
              x={24}
              y={y - bandH / 2}
              width={VIEW_W - 48}
              height={bandH}
              rx={12}
              fill={hot ? VISUAL_TOKENS.colors.health.reviewHell : VISUAL_TOKENS.colors.ink}
              opacity={hot ? 0.22 : 0.45}
            />
            <text
              x={40}
              y={y + 6}
              fill={VISUAL_TOKENS.colors.textDim}
              fontSize={18}
              fontFamily="sans-serif"
            >
              {lane}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function RdBoardPrototypeOverlay({
  scene,
  layout,
  onLayoutChange,
  hitTaskId,
  showHits,
}: {
  scene: BoardScenePlan;
  layout: RdBoardLayout;
  onLayoutChange: (layout: RdBoardLayout) => void;
  hitTaskId: number | null;
  showHits: boolean;
}) {
  const markers = planRdSignalMarkers(scene);
  const spread = planRdSpreadLink(scene);
  const hits = showHits ? planRdHitAreas(scene.dots) : [];

  const switchLayout = (next: RdBoardLayout) => {
    writeRdLayoutToLocation(next);
    onLayoutChange(next);
  };

  return (
    <div className="rd-board-overlay" data-testid="rd-board-overlay">
      <div className="rd-board-picker" data-testid="rd-layout-picker">
        <span className="rd-board-picker-title">R&amp;D A/B</span>
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="rd-layout-iso"
          aria-pressed={layout === 'iso'}
          onClick={() => switchLayout('iso')}
        >
          A iso
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          data-testid="rd-layout-lane"
          aria-pressed={layout === 'lane'}
          onClick={() => switchLayout('lane')}
        >
          B lane
        </button>
        <span className="rd-board-hit-log" data-testid="rd-last-hit">
          {hitTaskId === null ? 'hit: —' : `hit: #${hitTaskId}`}
        </span>
      </div>

      {spread && (
        <svg
          className="rd-spread-link"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <line
            x1={spread.fromX}
            y1={spread.fromY}
            x2={spread.toX}
            y2={spread.toY}
            stroke={VISUAL_TOKENS.colors.cream}
            strokeWidth={3}
            strokeDasharray="8 6"
          />
        </svg>
      )}

      {hits.map((hit) => (
        <RdHitRing key={hit.id} hit={hit} active={hit.id === hitTaskId} />
      ))}

      {markers.map((marker) => (
        <div
          key={marker.id}
          className="rd-signal-label"
          data-testid={`rd-signal-${marker.id}`}
          style={{ left: pct(marker.x, VIEW_W), top: pct(marker.y, VIEW_H) }}
        >
          {marker.label}
        </div>
      ))}
    </div>
  );
}

function RdHitRing({ hit, active }: { hit: RdHitArea; active: boolean }) {
  return (
    <div
      className={`rd-hit-ring${active ? ' is-active' : ''}${hit.fire ? ' is-fire' : ''}`}
      data-testid={`rd-hit-${hit.id}`}
      style={{
        left: pct(hit.x, VIEW_W),
        top: pct(hit.y, VIEW_H),
        width: pct(hit.r * 2, VIEW_W),
        height: pct(hit.r * 2, VIEW_H),
      }}
    />
  );
}
