/**
 * 全社マップの「状態→見た目」ヘルパー（SPEC 第4.8 / 第22.2）。
 *
 * チームの健全度→色・ラベル、チーム島のアイソメ配置を導出する純関数。
 * 描画は状態を読むだけ（第22.2）なので GPU 不要で検証できる（第22.5）。
 * 座標計算は `render/iso.ts` を使い、将来の PixiJS レンダラとも共有する。
 */
import type { TeamHealth } from '../sim/orgscale/types';
import { depthSort, isoProject, type DepthItem, type IsoOptions } from './iso';
import { VISUAL_TOKENS } from './visualTokens';

/** 健全度ごとの色（緑/黄/赤。旧モック org-screen 由来）。 */
export const HEALTH_COLOR: Record<TeamHealth, string> = VISUAL_TOKENS.colors.health;

/** 健全度の短いラベル。 */
export const HEALTH_LABEL: Record<TeamHealth, string> = {
  healthy: '健全',
  congested: '渋滞',
  reviewHell: '炎上',
};

/** 配置済み要素（投影後の画面座標を持つ）。 */
export interface Placed<T> {
  item: T;
  x: number;
  y: number;
}

/** レイアウト結果（画家順の配置と全体サイズ）。 */
export interface Layout<T> {
  placed: Placed<T>[];
  width: number;
  height: number;
}

/**
 * 全社マップ DOM/Pixi 共通のアイソメ寸法・余白。
 * 116px カード（`.team-island`）が重ならないよう、格子 1 ステップ ≒ カード幅 + 余白に合わせる。
 */
export const ORG_ISO = VISUAL_TOKENS.dimensions.organization.iso;
export const ORG_PAD = VISUAL_TOKENS.dimensions.organization.padding;
/** DOM `.team-island` / Pixi card の幅 px。 */
export const ORG_CARD_W = VISUAL_TOKENS.dimensions.organization.card.width;
/** 同時描画スプライト上限（性能予算。第22.5）。
 * Vitestの大規模fixture（100/500/1000件）でカリングと表示予算を確認する。
 * 通常ラン（~10 チーム）は overBudget=0。1000 件全可視 stress では 500 件まで描画。 */
export const ORG_SPRITE_BUDGET = 500;

/**
 * `layoutIso` の min 正規化 + pad を `isoProject` の origin に写す。
 * Pixi 側で DOM と同じ座標系を使うための純関数（GPU 不要）。
 */
export function isoLayoutOrigin<T extends DepthItem>(
  items: readonly T[],
  iso: IsoOptions,
  pad = 0,
): { originX: number; originY: number } {
  if (items.length === 0) return { originX: pad, originY: pad };
  const points = items.map((it) => isoProject(it.gridX, it.gridY, iso));
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  return { originX: -minX + pad, originY: -minY + pad };
}

/**
 * 格子座標を持つ要素群をアイソメ投影し、左上が (pad, pad) に収まるよう平行移動する。
 * 画家順（奥→手前）に並べて返すので、そのまま重ね描きできる。
 */
export function layoutIso<T extends DepthItem>(
  items: readonly T[],
  iso: IsoOptions,
  pad = 0,
): Layout<T> {
  const sorted = depthSort(items);
  const points = sorted.map((it) => isoProject(it.gridX, it.gridY, iso));
  if (points.length === 0) return { placed: [], width: pad * 2, height: pad * 2 };
  const minX = Math.min(...points.map((p) => p.x));
  const minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x));
  const maxY = Math.max(...points.map((p) => p.y));
  const placed = sorted.map((item, i) => ({
    item,
    x: points[i].x - minX + pad,
    y: points[i].y - minY + pad,
  }));
  return { placed, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}

/** 全社マップ layoutIso の指紋（Pixi fitToContent キャッシュ / React 同期用）。 */
export function orgLayoutFingerprint<T extends DepthItem & { id: string }>(
  items: readonly T[],
  iso: IsoOptions,
  pad = 0,
): string {
  const layout = layoutIso(items, iso, pad);
  const key = layout.placed.map(({ item }) => `${item.id}:${item.gridX}:${item.gridY}`).join('|');
  return `${layout.width}x${layout.height}:${key}`;
}
