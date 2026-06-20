/**
 * ランマップ画面（SPEC 第4.4）。
 *
 * 層状の分岐ルートを表示し、次に選べるノードをクリックで進入する。
 * ノード種別はアイコンで示す（通常/高負荷/イベント/ショップ/休息/ボス）。
 */
import { getBoss } from '../data/bosses';
import { MAP_COLUMNS } from '../sim/run/map';
import type { NodeType, RunState } from '../sim/run/types';

const NODE_ICON: Record<NodeType, string> = {
  normal: '💻',
  elite: '🔥',
  event: '◇',
  shop: '🛒',
  rest: '☕',
  boss: '★',
};

const NODE_LABEL: Record<NodeType, string> = {
  normal: '通常',
  elite: '高負荷',
  event: 'イベント',
  shop: 'ショップ',
  rest: '休息',
  boss: 'ボス',
};

export interface RunMapScreenProps {
  state: RunState;
  onEnter: (id: string) => void;
}

export function RunMapScreen({ state, onEnter }: RunMapScreenProps) {
  const boss = getBoss(state.bossId);
  const columns = Array.from({ length: MAP_COLUMNS }, (_, c) =>
    state.map.nodes.filter((n) => n.col === c).sort((a, b) => a.row - b.row),
  );

  return (
    <div className="run-map" data-testid="run-map">
      <div className="map-banner">
        <span className="pill">四半期末ボス</span>
        <b className="boss-name">★ {boss?.name ?? 'ボス'}</b>
        <span className="boss-desc">{boss?.description}</span>
      </div>
      <div className="map-columns">
        {columns.map((nodes, c) => (
          <div className="map-col" key={c}>
            {nodes.map((node) => {
              const available = state.available.includes(node.id);
              const visited = state.visited.includes(node.id);
              return (
                <button
                  type="button"
                  key={node.id}
                  className={`map-node node-${node.type}${available ? ' available' : ''}${
                    visited ? ' visited' : ''
                  }`}
                  data-testid={`node-${node.id}`}
                  data-type={node.type}
                  disabled={!available}
                  onClick={() => onEnter(node.id)}
                  title={NODE_LABEL[node.type]}
                >
                  <span className="node-icon">{NODE_ICON[node.type]}</span>
                  <span className="node-label">{NODE_LABEL[node.type]}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="map-hint">
        {state.available.length > 0
          ? '次に進むノードを選んでください（ルートでリスクと報酬が変わります）。'
          : 'ボスへ進みます。'}
      </p>
    </div>
  );
}
