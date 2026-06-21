/**
 * 全社マップの「シーン計画」（PixiJS 移行の供給先。SPEC 第22.4 / 第22.5）。
 *
 * 何を・どこに・どの順で描くかを純TSで決める。GPU を使わないので Vitest で
 * 数値検証でき（カリング数 / 予算超過数 / 深度順）、DOM/SVG でも PixiJS でも
 * 同じ計画を読んで描けばよい（描画は状態を読むだけ。第22.2）。
 *
 * 座標・深度・カリング・予算は `render/iso.ts` のプリミティブに委譲する。
 * チーム島の DOM レイアウト（箱に収める）は `render/orgView.ts` の `layoutIso`、
 * こちらはカメラ可視範囲＋スプライト予算で「実際に描く列」を絞り込む役割。
 */
import type { Team } from '../sim/orgscale/types';
import { cullVisible, depthSort, isoProject, type CameraRect, type IsoOptions } from './iso';
import { HEALTH_COLOR } from './orgView';

/** シーン計画のパラメータ。 */
export interface OrgSceneOptions {
  /** アイソメ投影のパラメータ（タイル寸法・原点）。 */
  iso: IsoOptions;
  /**
   * 同時に描画するスプライト数の上限（性能予算）。深度順に詰め、超過分は描かない。
   * 数百〜数千チーム時のフレーム時間・メモリを守る要（第22.5）。
   */
  spriteBudget: number;
  /** カリングの余白 px（島の見た目サイズ分の取りこぼしを救う）。 */
  cullMargin?: number;
}

/** 1 スプライト分の描画指示（WebGL 非依存。レンダラはこれを読むだけ）。 */
export interface OrgSprite {
  teamId: string;
  /** 投影後の画面座標（配列は画家順=奥→手前）。 */
  x: number;
  y: number;
  /** 健全度由来の色（tint。緑/黄/赤）。 */
  tint: string;
  /** プレイヤーチームの強調表示か。 */
  isPlayer: boolean;
  /** 炎上演出の強度 0..1（incidents 由来）。 */
  fire: number;
}

/** シーン計画の結果（描画列＋数値メトリクス）。 */
export interface OrgScenePlan {
  /** 実際に描く（可視・予算内・画家順の）スプライト列。 */
  sprites: OrgSprite[];
  /** 画面外カリングで除外した数。 */
  culled: number;
  /** スプライト予算超過で省いた数。 */
  overBudget: number;
  /** カリング前の総チーム数。 */
  total: number;
}

/** この件数の炎上で fire 強度が最大（1.0）に達する。 */
const FIRE_MAX = 6;

/**
 * チーム配列とカメラ矩形から、全社マップの 1 フレーム分の描画列を組み立てる。
 *
 * 手順: 1) 画面外カリング → 2) 画家順に深度ソート → 3) スプライト予算で頭打ち。
 * いずれも `iso.ts` のプリミティブに委譲し、決定論で同一入力＝同一計画にする。
 */
export function planOrgScene(
  teams: readonly Team[],
  camera: CameraRect,
  opts: OrgSceneOptions,
): OrgScenePlan {
  const { iso, spriteBudget, cullMargin = 0 } = opts;
  // 1) 画面外カリング（性能の要。第22.5）。
  const { visible, culled } = cullVisible(teams, camera, iso, cullMargin);
  // 2) 画家順（奥→手前）に深度ソート。
  const sorted = depthSort(visible);
  // 3) スプライト予算で頭打ち（無制限な生成を防ぐ）。
  const drawn = spriteBudget >= 0 ? sorted.slice(0, spriteBudget) : sorted;
  const overBudget = sorted.length - drawn.length;
  const sprites = drawn.map((t): OrgSprite => {
    const p = isoProject(t.gridX, t.gridY, iso);
    return {
      teamId: t.id,
      x: p.x,
      y: p.y,
      tint: HEALTH_COLOR[t.health],
      isPlayer: t.isPlayer,
      fire: Math.min(1, Math.max(0, t.incidents) / FIRE_MAX),
    };
  });
  return { sprites, culled, overBudget, total: teams.length };
}
