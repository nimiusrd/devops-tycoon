/**
 * ランマップ生成（SPEC 第4.4）。
 *
 * 層状（列）の有向非巡回グラフを seed付き決定論で生成する。最終層はボス 1 ノード。
 * 通過は列単位で進み、各ノードの `next` は必ず次の層に属する。連結性
 * （どの次層ノードにも入辺が 1 本以上ある）を保証する純TS（第22.3）。
 */
import type { Rng } from '../rng';
import { randInt } from '../rng';
import type { MapNode, NodeType, RunMap } from './types';

/** 層数（0..5 が通常層、6 がボス層）。 */
export const MAP_COLUMNS = 7;

/** ボス直前の層インデックス（休息を出やすくする）。 */
const PRE_BOSS_COL = MAP_COLUMNS - 2;

/** ノード種別の出現重み（第4.4）。 */
const TYPE_WEIGHTS: { type: NodeType; weight: number }[] = [
  { type: 'normal', weight: 44 },
  { type: 'elite', weight: 18 },
  { type: 'event', weight: 18 },
  { type: 'shop', weight: 12 },
  { type: 'rest', weight: 8 },
];

function rollType(rng: Rng): NodeType {
  const total = TYPE_WEIGHTS.reduce((s, t) => s + t.weight, 0);
  let r = rng() * total;
  for (const t of TYPE_WEIGHTS) {
    r -= t.weight;
    if (r < 0) return t.type;
  }
  return 'normal';
}

/** 次層から、行が近い順に少しランダムを混ぜて `count` 件選ぶ。 */
function pickTargets(rng: Rng, row: number, next: MapNode[], count: number): MapNode[] {
  const sorted = [...next].sort((a, b) => Math.abs(a.row - row) - Math.abs(b.row - row));
  const pool = sorted.slice(0, Math.min(next.length, count + 1));
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, 0, i);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/** seed付きでランマップを生成する。 */
export function generateRunMap(rng: Rng): RunMap {
  const cols: MapNode[][] = [];
  for (let c = 0; c < MAP_COLUMNS; c += 1) {
    const nodes: MapNode[] = [];
    if (c === MAP_COLUMNS - 1) {
      nodes.push({ id: `n${c}-0`, type: 'boss', col: c, row: 0, next: [] });
    } else {
      const width = randInt(rng, 2, 3);
      for (let r = 0; r < width; r += 1) {
        let type: NodeType;
        if (c === 0) type = 'normal';
        else if (c === PRE_BOSS_COL && r === 0) type = 'rest';
        else type = rollType(rng);
        nodes.push({ id: `n${c}-${r}`, type, col: c, row: r, next: [] });
      }
    }
    cols.push(nodes);
  }

  // 隣接層を接続（分岐ルート＋連結性保証）。
  for (let c = 0; c < MAP_COLUMNS - 1; c += 1) {
    const cur = cols[c];
    const next = cols[c + 1];
    const incoming = new Set<string>();
    for (const node of cur) {
      const fanout = next.length === 1 ? 1 : randInt(rng, 1, 2);
      const targets = pickTargets(rng, node.row, next, fanout);
      node.next = targets.map((t) => t.id);
      for (const t of targets) incoming.add(t.id);
    }
    for (const t of next) {
      if (!incoming.has(t.id)) {
        const src = cur[randInt(rng, 0, cur.length - 1)];
        if (!src.next.includes(t.id)) src.next.push(t.id);
      }
    }
  }

  return { nodes: cols.flat(), columns: MAP_COLUMNS };
}

/** ノードを ID で引く。 */
export function nodeById(map: RunMap, id: string): MapNode | undefined {
  return map.nodes.find((n) => n.id === id);
}

/** 最初に選べるノード（第 0 層）。 */
export function firstColumnNodes(map: RunMap): string[] {
  return map.nodes.filter((n) => n.col === 0).map((n) => n.id);
}

/** ボスノードを取得する。 */
export function bossNode(map: RunMap): MapNode | undefined {
  return map.nodes.find((n) => n.type === 'boss');
}
