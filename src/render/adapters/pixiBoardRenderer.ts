/**
 * スプリント盤面（現場）の PixiJS レンダラ（RI-11 残務 / RI-07。SPEC 第22.4）。
 *
 * 状態を読んで描くだけ（第22.2）。描く内容は純TSの `planBoardScene` が決め、ここは
 * WebGL への反映だけを受け持つ。工程間フロー線・タスク粒・ステーションキャラに加え、
 * RI-142 の時刻付き plan から炎上・介入・常駐オーラを上限付きプールで描く。ラベル・
 * 吹き出し・凡例は HTML オーバーレイとして重ねる。初期化失敗時は進行を止める。
 *
 * RI-07: 粒とキャラは Graphics 直描きではなく、variant×size / lane×mood ごとに
 * RenderTexture へ焼き込んで Sprite で使い回す（粒数×表情の組合せに強く、
 * RI-05/06/08 の土台になる）。粒 Container は `iso.ts` の `SpritePool` で再利用する。
 *
 * 実 WebGL はブラウザの E2E で検証する。本ファイルは Node
 *    から import できる（型検証のため）が、`init()` / `render()` はブラウザでのみ呼ぶこと。
 */
import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { GameAssetId } from '../../data/assets';
import type { Lane } from '../../sim/types';
import { boardEffectProgress, type BoardAuraPlan, type TimedBoardEffect } from '../boardEffects';
import {
  BOARD_VIEW,
  type BoardDotPlan,
  type BoardFlow,
  type BoardReviewHeatFieldPlan,
  type BoardReviewTrailPlan,
  type BoardScenePlan,
  type BoardStationPlan,
  type StationMood,
} from '../boardScene';
import {
  actorTextureKey,
  boardAnimationElapsedMs,
  bobOffsetY,
  dotTextureKey,
  fireShakeOffset,
  flowDriftOffset,
  lineDashSegments,
  planBoardDotsForRender,
} from '../boardPixiView';
import { BOARD_PIXI_LAYER_ORDER, BOARD_RENDER_BUDGETS } from '../boardRenderBudget';
import { BoardTaskMotion, shipmentParticle, TASK_MOTION } from '../boardTaskMotion';
import { officeActorMotion, officeLight } from '../officeAtmosphere';
import { containFitTransform } from '../deptPixiView';
import { SpritePool, type SpritePoolSnapshot } from '../iso';
import { TASK_COLORS, TASK_DIAMETER } from '../taskView';
import { gameAssetMoodStyle, stationAssetForLane } from '../gameAssetView';
import { flowDashPeriod, VISUAL_TOKENS } from '../visualTokens';
import { loadGameAssetTexture } from './gameAssetTextures';
import { ensureTexturePoolGuard, releasePixiApp, retainPixiApp } from './pixiTexturePoolGuard';
import type { RendererAdapter } from './index';

/** 破棄オプション（Pixi v8）。`pixiOrgRenderer` と同値。 */
const DESTROY_OPTIONS = { children: true, texture: false, context: true } as const;

/** 互換 export。正本は BOARD_RENDER_BUDGETS。 */
export const BOARD_SPRITE_BUDGET = BOARD_RENDER_BUDGETS.dots;

const FONT_FAMILY = 'system-ui, sans-serif';

/**
 * キャラクターのローカル座標系と実表示サイズ。
 * DOM は `.station` の共有トークン幅の中に width=210 height=190 viewBox=220×200 の
 * SVG を置くため、設計空間では盤面幅×stationWidthPercent・ローカル倍率 min(W/220,H/200)。
 */
const ACTOR_LOCAL = VISUAL_TOKENS.dimensions.sprint.actor.local;
const ACTOR_DOM = VISUAL_TOKENS.dimensions.sprint.actor.dom;
const ACTOR_STATUS_OFFSET = VISUAL_TOKENS.dimensions.sprint.actor.statusOffset;
const ACTOR_WIDTH_RATIO = VISUAL_TOKENS.dimensions.sprint.stationWidthPercent / 100;
const ACTOR_W = BOARD_VIEW.w * ACTOR_WIDTH_RATIO;
const ACTOR_H = (ACTOR_W * ACTOR_DOM.h) / ACTOR_DOM.w;
const ACTOR_SCALE = Math.min(ACTOR_W / ACTOR_LOCAL.w, ACTOR_H / ACTOR_LOCAL.h);

/** レーンごとのキャラ見た目。 */
const ACTOR_STYLE: Record<Lane, { body: string; hair: string; skin: string; emoji?: string }> = {
  backlog: {
    body: VISUAL_TOKENS.colors.actor.body.backlog,
    hair: VISUAL_TOKENS.colors.actor.hair.backlog,
    skin: VISUAL_TOKENS.colors.actor.skin,
  },
  coding: {
    body: VISUAL_TOKENS.colors.actor.body.coding,
    hair: VISUAL_TOKENS.colors.actor.hair.coding,
    skin: VISUAL_TOKENS.colors.actor.skin,
    emoji: '✨',
  },
  review: {
    body: VISUAL_TOKENS.colors.actor.body.review,
    hair: VISUAL_TOKENS.colors.actor.hair.review,
    skin: '#f4d2b3',
    emoji: '💧',
  },
  rework: {
    body: VISUAL_TOKENS.colors.actor.body.rework,
    hair: VISUAL_TOKENS.colors.actor.hair.rework,
    skin: VISUAL_TOKENS.colors.actor.skin,
    emoji: '💦',
  },
  done: {
    body: VISUAL_TOKENS.colors.actor.body.done,
    hair: VISUAL_TOKENS.colors.actor.hair.done,
    skin: VISUAL_TOKENS.colors.actor.skin,
    emoji: '🎉',
  },
};

const INK = VISUAL_TOKENS.colors.ink;

/** DOM の station layer と同じ画家順。 */
const STATION_Z: Record<Lane, number> = {
  backlog: VISUAL_TOKENS.layers.sprint.station,
  coding: VISUAL_TOKENS.layers.sprint.station,
  rework: VISUAL_TOKENS.layers.sprint.station,
  review: VISUAL_TOKENS.layers.sprint.stationReview,
  done: VISUAL_TOKENS.layers.sprint.stationDone,
};

export interface BoardRenderResourceMetrics {
  budget: number;
  requested: number;
  rendered: number;
  dropped: number;
  /** reduced motion など、予算以外の理由で描かなかった数。 */
  suppressed: number;
  pool: Readonly<SpritePoolSnapshot> | null;
}

/** 描画メトリクス（E2E 安定化・dev 計測用）。 */
export interface BoardRenderMetrics {
  dots: number;
  actors: number;
  flows: number;
  reviewTrails: number;
  reviewHeat: number;
  effects: number;
  auras: number;
  /** 取得処理が完了した人物SVGの種類数（失敗時のフォールバックも完了扱い）。 */
  assets: number;
  resources: {
    dots: BoardRenderResourceMetrics;
    reviewTrails: BoardRenderResourceMetrics;
    effects: BoardRenderResourceMetrics;
    auras: BoardRenderResourceMetrics;
  };
}

function resourceMetrics(
  budget: number,
  requested: number,
  rendered: number,
  suppressed: number,
  pool: { snapshot(): Readonly<SpritePoolSnapshot> } | null,
): BoardRenderResourceMetrics {
  return {
    budget,
    requested,
    rendered,
    dropped: Math.max(0, requested - rendered - suppressed),
    suppressed,
    pool: pool?.snapshot() ?? null,
  };
}

export function emptyBoardRenderMetrics(): BoardRenderMetrics {
  return {
    dots: 0,
    actors: 0,
    flows: 0,
    reviewTrails: 0,
    reviewHeat: 0,
    effects: 0,
    auras: 0,
    assets: 0,
    resources: {
      dots: resourceMetrics(BOARD_RENDER_BUDGETS.dots, 0, 0, 0, null),
      reviewTrails: resourceMetrics(BOARD_RENDER_BUDGETS.reviewTrails, 0, 0, 0, null),
      effects: resourceMetrics(BOARD_RENDER_BUDGETS.transientEffects, 0, 0, 0, null),
      auras: resourceMetrics(BOARD_RENDER_BUDGETS.auras, 0, 0, 0, null),
    },
  };
}

/** レンダラ入力（Board.tsx が plan と drag ハイライトをまとめて渡す）。 */
export interface BoardPixiInput {
  scene: BoardScenePlan;
  /** ドラッグ介入（RI-30）で掴める粒（シアン輪郭）。 */
  draggableTaskIds?: ReadonlySet<number>;
  /** ドラッグ中の粒（金色輪郭・最前面）。 */
  dragTaskId?: number | null;
  /** 一時演出の時刻付きタイムライン。 */
  effects: readonly TimedBoardEffect[];
  /** 進行中モディファイアの常駐オーラ。 */
  auras: readonly BoardAuraPlan[];
  /** prefers-reduced-motion 時はアニメ位相を固定する。 */
  reducedMotion: boolean;
}

export interface PixiBoardRendererOptions {
  /** dev-only: 直近 render のメトリクス（ブラウザ計測 / E2E 安定化用）。 */
  onRenderMetrics?: (metrics: BoardRenderMetrics) => void;
  /** DOM オーバーレイを挟むため、基盤と一時演出を別 canvas に描く。 */
  stratum?: 'all' | 'base' | 'effects';
}

export interface BoardAtmosphereMetrics {
  officeSprites: number;
  shipmentSprites: number;
  visibleShipmentSprites: number;
}

/** 1 粒ぶんの子パーツ（プール再利用用）。 */
interface DotParts {
  sprite: Sprite;
  ring: Graphics;
  flame: Text;
}

function createReviewTrail(): Graphics {
  const trail = new Graphics();
  trail.eventMode = 'none';
  return trail;
}

function resetReviewTrail(trail: Graphics): void {
  trail.clear();
  trail.alpha = 1;
  trail.rotation = 0;
  trail.position.set(0, 0);
}

function createDotContainer(): Container {
  const group = new Container();
  const sprite = new Sprite();
  sprite.anchor.set(0.5);
  const ring = new Graphics();
  const flame = new Text({
    text: '🔥',
    style: { fontFamily: FONT_FAMILY, fontSize: 14 },
  });
  flame.anchor.set(0.5, 1);
  flame.visible = false;
  group.addChild(sprite, ring, flame);
  group.eventMode = 'none';
  for (const child of group.children) child.eventMode = 'none';
  (group as Container & { dotParts: DotParts }).dotParts = { sprite, ring, flame };
  return group;
}

function getDotParts(group: Container): DotParts {
  return (group as Container & { dotParts: DotParts }).dotParts;
}

function resetDotContainer(group: Container): void {
  const parts = getDotParts(group);
  parts.ring.clear();
  parts.flame.visible = false;
  group.rotation = 0;
}

/** アニメ適用用の粒メタデータ（render で組み直す）。 */
interface DotEntry {
  id: number;
  group: Container;
  baseX: number;
  baseY: number;
  fire: boolean;
  burnUrgency?: number;
  motion?: { angleDeg: number; speedMul: number };
}

interface ReviewTrailEntry {
  trail: Graphics;
  baseAlpha: number;
  speedMul: number;
  phaseOffsetMs: number;
}

interface EffectParts {
  graphics: Graphics;
  label: Text;
}

interface EffectEntry {
  group: Container;
  plan: TimedBoardEffect;
}

function createEffectContainer(): Container {
  const group = new Container();
  const graphics = new Graphics();
  const label = new Text({
    text: '',
    style: { fontFamily: FONT_FAMILY, fontSize: 9, fontWeight: '900' },
  });
  label.anchor.set(0.5);
  label.visible = false;
  group.addChild(graphics, label);
  group.eventMode = 'none';
  graphics.eventMode = 'none';
  label.eventMode = 'none';
  (group as Container & { effectParts: EffectParts }).effectParts = { graphics, label };
  return group;
}

function getEffectParts(group: Container): EffectParts {
  return (group as Container & { effectParts: EffectParts }).effectParts;
}

function resetEffectContainer(group: Container): void {
  const parts = getEffectParts(group);
  parts.graphics.clear();
  parts.label.text = '';
  parts.label.visible = false;
  parts.label.tint = 0xffffff;
  group.visible = false;
  group.alpha = 1;
  group.rotation = 0;
  group.scale.set(1);
  group.position.set(0, 0);
}

/** アニメ適用用のキャラメタデータ。 */
interface ActorEntry {
  lane: Lane;
  count: number;
  mood: StationMood;
  assetId: GameAssetId;
  assetTexture: Texture | null;
  assetLoaded: boolean;
  assetLoading: boolean;
  desk: Sprite;
  char: Sprite;
  status: Text;
  light: Sprite;
  shadow: Sprite;
  baseX: number;
  baseY: number;
}

/** 机（ローカル 220×200 座標）。 */
function drawDesk(g: Graphics, lane: Lane): void {
  const dark = lane === 'coding';
  const desk = VISUAL_TOKENS.colors.actor.desk;
  const top = dark ? desk.darkTop : desk.woodTop;
  const left = dark ? desk.darkLeft : desk.woodLeft;
  const right = dark ? desk.darkRight : desk.woodRight;
  g.poly([40, 150, 110, 115, 180, 150, 110, 185]).fill(top);
  g.poly([40, 150, 110, 185, 110, 215, 40, 180]).fill(left);
  g.poly([110, 185, 180, 150, 180, 180, 110, 215]).fill(right);
  g.moveTo(40, 150)
    .lineTo(110, 115)
    .lineTo(180, 150)
    .stroke({ color: '#ffffff', alpha: 0.13, width: 1.5 });
  g.rect(38, 150, 3.2, 34).fill(desk.leg);
  g.rect(178, 150, 3.2, 34).fill(desk.leg);
  g.rect(108, 185, 3.2, 34).fill(desk.leg);
  // PC/モニタ（Coding/Review の机に）。
  if (lane === 'coding' || lane === 'review') {
    g.poly([92, 138, 110, 130, 128, 138, 110, 146]).fill('#0e1430');
    g.poly([96, 137, 110, 131, 110, 139, 96, 145]).fill({ color: '#3fb6ff', alpha: 0.85 });
  }
}

/** 目（胴体グループ原点 (60,4) 込みの絶対座標）。 */
function drawEyes(g: Graphics, mood: StationMood): void {
  const ox = 60;
  const oy = 4;
  if (mood === 'happy' || mood === 'cheer') {
    g.moveTo(ox + 37, oy + 50)
      .quadraticCurveTo(ox + 41, oy + 44, ox + 46, oy + 50)
      .stroke({ color: INK, width: 2.6, cap: 'round' });
    g.moveTo(ox + 54, oy + 50)
      .quadraticCurveTo(ox + 58, oy + 44, ox + 63, oy + 50)
      .stroke({ color: INK, width: 2.6, cap: 'round' });
    return;
  }
  if (mood === 'tired') {
    g.ellipse(ox + 42, oy + 52, 6, 2.6).fill({ color: '#b98a92', alpha: 0.5 });
    g.ellipse(ox + 58, oy + 52, 6, 2.6).fill({ color: '#b98a92', alpha: 0.5 });
    g.moveTo(ox + 37, oy + 48)
      .lineTo(ox + 47, oy + 48)
      .stroke({ color: INK, width: 2.4, cap: 'round' });
    g.moveTo(ox + 53, oy + 48)
      .lineTo(ox + 63, oy + 48)
      .stroke({ color: INK, width: 2.4, cap: 'round' });
    return;
  }
  if (mood === 'exhausted') {
    // 疲れ果て: 閉じ目（下がり弧）＋濃いクマ＋汗。
    g.ellipse(ox + 42, oy + 53, 6.5, 3).fill({ color: '#b98a92', alpha: 0.6 });
    g.ellipse(ox + 58, oy + 53, 6.5, 3).fill({ color: '#b98a92', alpha: 0.6 });
    g.moveTo(ox + 37, oy + 48)
      .quadraticCurveTo(ox + 41, oy + 52, ox + 46, oy + 48)
      .stroke({ color: INK, width: 2.4, cap: 'round' });
    g.moveTo(ox + 54, oy + 48)
      .quadraticCurveTo(ox + 58, oy + 52, ox + 63, oy + 48)
      .stroke({ color: INK, width: 2.4, cap: 'round' });
    g.ellipse(ox + 68, oy + 36, 2.5, 3.5).fill({
      color: VISUAL_TOKENS.colors.aiBot.eye,
      alpha: 0.85,
    });
    return;
  }
  if (mood === 'panic') {
    for (const cx of [42, 58]) {
      g.circle(ox + cx, oy + 48, 8)
        .fill({ color: '#ffffff', alpha: 0.13 })
        .stroke({ color: INK, width: 2.4 });
      g.circle(ox + cx, oy + 48, 3).fill(INK);
    }
    return;
  }
  if (mood === 'sad') {
    g.moveTo(ox + 36, oy + 44)
      .quadraticCurveTo(ox + 41, oy + 47, ox + 45, oy + 45)
      .stroke({ color: INK, width: 2, cap: 'round' });
    g.moveTo(ox + 55, oy + 45)
      .quadraticCurveTo(ox + 59, oy + 43, ox + 64, oy + 44)
      .stroke({ color: INK, width: 2, cap: 'round' });
    g.circle(ox + 42, oy + 51, 2.6).fill(INK);
    g.circle(ox + 58, oy + 51, 2.6).fill(INK);
    return;
  }
  g.circle(ox + 42, oy + 48, 3).fill(INK);
  g.circle(ox + 58, oy + 48, 3).fill(INK);
}

/** 口。 */
function drawMouth(g: Graphics, mood: StationMood): void {
  const ox = 60;
  const oy = 4;
  if (mood === 'cheer' || mood === 'happy') {
    g.moveTo(ox + 40, oy + 58)
      .quadraticCurveTo(ox + 50, oy + 67, ox + 60, oy + 58)
      .stroke({ color: '#9a5a4a', width: 2.6, cap: 'round' });
    return;
  }
  if (mood === 'panic') {
    g.ellipse(ox + 50, oy + 62, 5, 6).fill('#3a0f14');
    return;
  }
  if (mood === 'sad') {
    g.moveTo(ox + 43, oy + 63)
      .quadraticCurveTo(ox + 50, oy + 59, ox + 57, oy + 63)
      .stroke({ color: '#8a4a3a', width: 2.2, cap: 'round' });
    return;
  }
  if (mood === 'tired') {
    g.moveTo(ox + 43, oy + 60)
      .lineTo(ox + 57, oy + 60)
      .stroke({ color: '#8a4a3a', width: 2.2, cap: 'round' });
    return;
  }
  if (mood === 'exhausted') {
    // へろへろの波線口。
    g.moveTo(ox + 44, oy + 61)
      .quadraticCurveTo(ox + 47, oy + 58, ox + 50, oy + 61)
      .quadraticCurveTo(ox + 53, oy + 64, ox + 56, oy + 61)
      .stroke({ color: '#8a4a3a', width: 2.2, cap: 'round' });
    return;
  }
  g.moveTo(ox + 43, oy + 59)
    .quadraticCurveTo(ox + 50, oy + 63, ox + 57, oy + 59)
    .stroke({ color: '#9a5a4a', width: 2, cap: 'round' });
}

/** キャラ（胴体・頭・髪・表情）。 */
function drawCharacter(g: Graphics, lane: Lane, mood: StationMood): void {
  const s = ACTOR_STYLE[lane];
  const ox = 60;
  const oy = 4;
  if (mood === 'cheer') {
    // 胴体（腕上げ・ガッツポーズ）。
    g.moveTo(ox + 23, oy + 124)
      .quadraticCurveTo(ox + 23, oy + 92, ox + 50, oy + 92)
      .quadraticCurveTo(ox + 77, oy + 92, ox + 77, oy + 124)
      .closePath()
      .fill(s.body);
    g.moveTo(ox + 27, oy + 100)
      .quadraticCurveTo(ox + 17, oy + 78, ox + 25, oy + 66)
      .stroke({ color: s.body, width: 9, cap: 'round' });
    g.moveTo(ox + 73, oy + 100)
      .quadraticCurveTo(ox + 83, oy + 78, ox + 75, oy + 66)
      .stroke({ color: s.body, width: 9, cap: 'round' });
    g.circle(ox + 24, oy + 62, 6).fill(s.skin);
    g.circle(ox + 76, oy + 62, 6).fill(s.skin);
  } else {
    g.moveTo(ox + 22, oy + 124)
      .quadraticCurveTo(ox + 22, oy + 92, ox + 50, oy + 92)
      .quadraticCurveTo(ox + 78, oy + 92, ox + 78, oy + 124)
      .closePath()
      .fill(s.body);
  }
  // 頭・髪。
  g.circle(ox + 50, oy + 48, 24).fill(s.skin);
  g.moveTo(ox + 27, oy + 46)
    .quadraticCurveTo(ox + 28, oy + 22, ox + 50, oy + 22)
    .quadraticCurveTo(ox + 72, oy + 22, ox + 73, oy + 44)
    .quadraticCurveTo(ox + 62, oy + 35, ox + 50, oy + 35)
    .quadraticCurveTo(ox + 38, oy + 35, ox + 27, oy + 46)
    .closePath()
    .fill(s.hair);
  drawEyes(g, mood);
  drawMouth(g, mood);
  // ほっぺ（上機嫌時）。
  if (mood === 'happy' || mood === 'cheer') {
    g.circle(ox + 35, oy + 40, 3).fill({ color: '#ff8fb0', alpha: 0.7 });
    g.circle(ox + 65, oy + 40, 3).fill({ color: '#ff8fb0', alpha: 0.7 });
  }
}

/** 粒テクスチャの余白（グロー・影のはみ出しぶん）。 */
const DOT_PAD = VISUAL_TOKENS.dimensions.sprint.dotTexturePadding;

/** variant 別のグロー（CSS box-shadow の近似。色と強さ）。 */
const DOT_GLOW: Partial<Record<BoardDotPlan['variant'], { color: string; alpha: number }>> = {
  ai: { color: VISUAL_TOKENS.colors.taskGlow.ai, alpha: 0.3 },
  gold: { color: VISUAL_TOKENS.colors.taskGlow.gold, alpha: 0.32 },
  incident: { color: VISUAL_TOKENS.colors.taskGlow.incident, alpha: 0.38 },
};

function boardAuraColor(kind: BoardAuraPlan['kind']): string {
  const colors = VISUAL_TOKENS.colors.boardEffects;
  switch (kind) {
    case 'throttle':
      return colors.sweepEdge;
    case 'overtime':
      return colors.reworkEdge;
    case 'andon':
      return colors.firefight;
    case 'stability':
      return colors.sweepMid;
  }
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function effectPulse(progress: number): number {
  return Math.max(0, Math.sin(Math.PI * progress));
}

export class PixiBoardRenderer implements RendererAdapter<BoardPixiInput> {
  private app: Application | null = null;
  /** contain-fit スケールを受ける設計空間ルート。 */
  private readonly root = new Container();
  private readonly officeLayer = new Container();
  private readonly flowsGfx = new Graphics();
  private readonly reviewHeatLayer = new Container();
  private readonly reviewHeatGfx = new Graphics();
  private readonly stationsLayer = new Container();
  private readonly reviewTrailsLayer = new Container();
  private readonly dotsLayer = new Container();
  private readonly shipmentsLayer = new Container();
  private readonly shipmentSprites: Sprite[] = [];
  private readonly taskMotion = new BoardTaskMotion();
  private readonly auraLayer = new Container();
  private readonly auraGfx = new Graphics();
  private readonly effectsLayer = new Container();
  private pool: SpritePool<Container> | null = null;
  private reviewTrailPool: SpritePool<Graphics> | null = null;
  private effectPool: SpritePool<Container> | null = null;
  /** 焼き込みテクスチャ（自前管理。dispose で明示破棄する）。 */
  private readonly textures = new Map<string, Texture>();
  private actors: ActorEntry[] = [];
  private dotEntries: DotEntry[] = [];
  private reviewTrailEntries: ReviewTrailEntry[] = [];
  private effectEntries: EffectEntry[] = [];
  private activeAuras: readonly BoardAuraPlan[] = [];
  private reviewHeat: BoardReviewHeatFieldPlan | null = null;
  private lastFlows: readonly BoardFlow[] = [];
  private dotRequestedCount = 0;
  private dotDroppedCount = 0;
  private reviewTrailRequestedCount = 0;
  private effectRequestedCount = 0;
  private effectSuppressedCount = 0;
  private auraRequestedCount = 0;
  /** アニメ経過時間（ms）。freeze で 0 に戻し位相 0 の決定論フレームにする。 */
  private elapsedMs = 0;
  private frozen = false;
  private reducedMotion = false;
  /** 視覚回帰では最新演出の中央位相へ固定する。通常時は performance.now()。 */
  private effectNowOverride: number | null = null;
  /** 進化オーバーレイ等で ticker だけ止める。screenshot freeze とは独立。 */
  private loopPaused = false;
  /** dispose 済みフラグ（非同期 init の中断判定）。init/dispose は 1 インスタンス 1 回。 */
  private disposed = false;
  private readonly opts: PixiBoardRendererOptions;
  private readonly stratum: NonNullable<PixiBoardRendererOptions['stratum']>;
  private lastInput: BoardPixiInput | null = null;

  constructor(opts: PixiBoardRendererOptions = {}) {
    this.opts = opts;
    this.stratum = opts.stratum ?? 'all';
  }

  /** ブラウザでのみ呼ぶ。WebGL コンテキストと描画レイヤを初期化する。 */
  async init(mount: HTMLElement): Promise<void> {
    ensureTexturePoolGuard();
    const app = new Application();
    await app.init({
      backgroundAlpha: 0,
      resizeTo: mount,
      antialias: true,
      resolution: window.devicePixelRatio,
      autoDensity: true,
    });

    if (this.disposed) {
      app.destroy(true, DESTROY_OPTIONS);
      return;
    }

    mount.appendChild(app.canvas);
    app.renderer.events.setTargetElement(app.canvas);

    this.root.sortableChildren = true;
    this.officeLayer.zIndex = BOARD_PIXI_LAYER_ORDER.office;
    this.flowsGfx.zIndex = BOARD_PIXI_LAYER_ORDER.flows;
    this.reviewHeatLayer.zIndex = BOARD_PIXI_LAYER_ORDER.reviewHeat;
    this.stationsLayer.zIndex = BOARD_PIXI_LAYER_ORDER.stations;
    this.reviewTrailsLayer.zIndex = BOARD_PIXI_LAYER_ORDER.reviewTrails;
    this.dotsLayer.zIndex = BOARD_PIXI_LAYER_ORDER.dots;
    this.shipmentsLayer.zIndex = BOARD_PIXI_LAYER_ORDER.shipments;
    this.auraLayer.zIndex = BOARD_PIXI_LAYER_ORDER.auras;
    this.effectsLayer.zIndex = BOARD_PIXI_LAYER_ORDER.transientEffects;

    if (this.stratum !== 'effects') {
      this.reviewHeatLayer.addChild(this.reviewHeatGfx);
      this.auraLayer.addChild(this.auraGfx);
      this.root.addChild(
        this.officeLayer,
        this.flowsGfx,
        this.reviewHeatLayer,
        this.stationsLayer,
        this.reviewTrailsLayer,
        this.dotsLayer,
        this.shipmentsLayer,
        this.auraLayer,
      );
    }
    if (this.stratum !== 'base') this.root.addChild(this.effectsLayer);
    app.stage.addChild(this.root);
    app.stage.eventMode = 'none';

    if (this.stratum !== 'effects') {
      this.pool = new SpritePool<Container>(createDotContainer, {
        max: BOARD_RENDER_BUDGETS.dots,
        reset: resetDotContainer,
      });
      this.reviewTrailPool = new SpritePool<Graphics>(createReviewTrail, {
        max: BOARD_RENDER_BUDGETS.reviewTrails,
        reset: resetReviewTrail,
      });
    }
    if (this.stratum !== 'base') {
      this.effectPool = new SpritePool<Container>(createEffectContainer, {
        max: BOARD_RENDER_BUDGETS.transientEffects,
        reset: resetEffectContainer,
      });
    }

    this.app = app;
    retainPixiApp();

    // CSS keyframes（flybob / bob / flowBobDrift / fireShake / dash）相当の
    // 常時アニメ。座標本体は render() の plan 由来で、ここはオフセットだけを足す。
    app.ticker.add(() => {
      if (this.frozen || this.loopPaused || this.reducedMotion) return;
      this.elapsedMs += app.ticker.deltaMS;
      this.applyAnimations(this.elapsedMs, performance.now());
    });
  }

  /** init 済みか（React 側の再描画判定用）。 */
  get isReady(): boolean {
    return this.app !== null;
  }

  /** 盤面（mount）のピクセルサイズへ renderer と contain-fit を合わせる。 */
  resize(boardWidth: number, boardHeight: number): void {
    if (!this.app || boardWidth <= 0 || boardHeight <= 0) return;
    this.app.renderer.resize(boardWidth, boardHeight);
    const t = containFitTransform(boardWidth, boardHeight, BOARD_VIEW.w, BOARD_VIEW.h);
    this.root.scale.set(t.scale);
    this.root.position.set(t.x, t.y);
    this.paintIfTickerStopped();
  }

  /**
   * 視覚回帰向け: アニメ位相を 0 に固定し、ticker を止めて 1 フレームだけ描く。
   * 位相 0 では全オフセットが 0 になり（boardPixiView の時間関数の契約）、
   * 同一状態＝同一ピクセルの決定論フレームになる。
   */
  freezeForScreenshot(): void {
    const app = this.app;
    if (!app) return;
    this.frozen = true;
    this.taskMotion.settle();
    this.elapsedMs = 0;
    const latest = this.effectEntries[this.effectEntries.length - 1]?.plan;
    const effectNowMs = latest
      ? latest.startedAtMs + latest.delayMs + latest.durationMs * 0.55
      : performance.now();
    this.effectNowOverride = effectNowMs;
    this.applyAnimations(0, effectNowMs);
    app.ticker.stop();
    app.render();
  }

  /**
   * オーバーレイ中など、壁時計アニメだけを止める。
   * freezeForScreenshot と違い位相は保持する（解除後に飛び跳ねない）。
   */
  setAnimationsPaused(paused: boolean): void {
    this.loopPaused = paused;
    this.syncTickerState();
  }

  /** オーバーレイ・reduced motion・視覚回帰の各停止理由を一か所で合成する。 */
  private syncTickerState(paintWhenStopped = true): void {
    const app = this.app;
    if (!app) return;
    if (this.loopPaused || this.reducedMotion || this.frozen) {
      app.ticker.stop();
      // ticker 停止が最初の RAF 前でも、静止フレームを空にしない。
      if (paintWhenStopped) app.render();
    } else {
      app.ticker.start();
    }
  }

  /** ticker 停止中は自動描画が無いので、静止フレームを明示的に canvas へ焼く。 */
  private paintIfTickerStopped(): void {
    if (!this.app || !(this.loopPaused || this.reducedMotion || this.frozen)) return;
    this.app.render();
  }

  /** 最新のシーン計画を読んで 1 フレーム描く。init() 前は何もしない。 */
  render(input: BoardPixiInput): void {
    if (!this.app) return;
    this.lastInput = input;
    const { scene } = input;
    this.reducedMotion = input.reducedMotion;

    if (this.stratum !== 'effects') {
      this.lastFlows = scene.flows;
      this.drawFlows(this.elapsedMs);
      this.syncReviewHeat(scene.reviewEffects.heatField);
      this.syncActors(scene.stations);
      this.syncReviewTrails(scene.reviewEffects.trails);
      this.syncDots(scene.dots, input.draggableTaskIds ?? new Set(), input.dragTaskId ?? null);
      this.syncAuras(input.auras);
    }
    if (this.stratum !== 'base') this.syncEffects(input.effects);
    this.applyAnimations(
      boardAnimationElapsedMs(this.elapsedMs, this.reducedMotion),
      this.effectNowOverride ?? performance.now(),
    );

    this.emitRenderMetrics();
    this.syncTickerState(false);
    this.paintIfTickerStopped();
  }

  /** 直近 render の入力（resize 後の再描画用）。 */
  getLastInput(): BoardPixiInput | null {
    return this.lastInput;
  }

  /** dev/E2E が必要な時だけ読み、毎フレーム DOM を更新しない。 */
  getAtmosphereMetrics(): BoardAtmosphereMetrics {
    return {
      officeSprites: this.officeLayer.children.length,
      shipmentSprites: this.shipmentSprites.length,
      visibleShipmentSprites: this.shipmentSprites.filter(
        (sprite) => sprite.visible && sprite.alpha > 0,
      ).length,
    };
  }

  /** 焼き込みテクスチャを取得（無ければ生成してキャッシュ）。 */
  private bakeTexture(key: string, build: () => Container): Texture {
    const cached = this.textures.get(key);
    if (cached) return cached;
    const app = this.app;
    if (!app) return Texture.EMPTY;
    const target = build();
    const texture = app.renderer.generateTexture({
      target,
      resolution: 2,
      frame: (target as Container & { bakeFrame?: Rectangle }).bakeFrame,
    });
    target.destroy({ children: true });
    this.textures.set(key, texture);
    return texture;
  }

  /** 机テクスチャ（lane 別。220×200 フレームでキャラと位置合わせ）。 */
  private deskTexture(lane: Lane): Texture {
    return this.bakeTexture(`desk:${lane}`, () => {
      const c = new Container();
      const g = new Graphics();
      drawDesk(g, lane);
      c.addChild(g);
      (c as Container & { bakeFrame?: Rectangle }).bakeFrame = new Rectangle(
        0,
        0,
        ACTOR_LOCAL.w,
        ACTOR_LOCAL.h,
      );
      return c;
    });
  }

  /** キャラテクスチャ（lane×mood。220×200 フレーム）。 */
  private charTexture(lane: Lane, mood: StationMood): Texture {
    return this.bakeTexture(actorTextureKey(lane, mood), () => {
      const c = new Container();
      const g = new Graphics();
      drawCharacter(g, lane, mood);
      c.addChild(g);
      const style = ACTOR_STYLE[lane];
      if (style.emoji && (mood !== 'neutral' || lane === 'coding')) {
        const emoji = new Text({
          text: style.emoji,
          style: { fontFamily: FONT_FAMILY, fontSize: 13 },
        });
        emoji.position.set(60 + 74, 4 + 28 - 13);
        c.addChild(emoji);
      }
      (c as Container & { bakeFrame?: Rectangle }).bakeFrame = new Rectangle(
        0,
        0,
        ACTOR_LOCAL.w,
        ACTOR_LOCAL.h,
      );
      return c;
    });
  }

  /** 粒テクスチャ（variant×size。グロー・影ごと焼き込み）。 */
  private dotTexture(variant: BoardDotPlan['variant'], size: BoardDotPlan['size']): Texture {
    return this.bakeTexture(dotTextureKey(variant, size), () => {
      const d = TASK_DIAMETER[size];
      const s = d + DOT_PAD * 2;
      const cx = s / 2;
      const c = new Container();
      const g = new Graphics();
      // ドロップシャドウ（CSS 0 3px 4px #0005 の近似）。
      g.ellipse(cx, cx + 3, d / 2, d / 2).fill({ color: '#000000', alpha: 0.18 });
      // グロー（ai / gold / incident。box-shadow の広がりを同心円 2 枚で近似）。
      const glow = DOT_GLOW[variant];
      if (glow) {
        g.circle(cx, cx, d / 2 + 8).fill({ color: glow.color, alpha: glow.alpha * 0.45 });
        g.circle(cx, cx, d / 2 + 4).fill({ color: glow.color, alpha: glow.alpha });
      }
      g.circle(cx, cx, d / 2).fill(TASK_COLORS[variant]);
      // 内側下部の陰（CSS inset 0 -3px 5px #00000033 の近似）。
      g.ellipse(cx, cx + d * 0.22, d * 0.36, d * 0.2).fill({ color: '#000000', alpha: 0.2 });
      c.addChild(g);
      (c as Container & { bakeFrame?: Rectangle }).bakeFrame = new Rectangle(0, 0, s, s);
      return c;
    });
  }

  /** 工程間フロー（破線＋矢じり）。offset を時間で流してマーチングアンツにする。 */
  private drawFlows(elapsedMs: number): void {
    const g = this.flowsGfx;
    g.clear();
    // CSS `dash` keyframes: 1s で dashoffset 0 → -period。
    const { dash, gap } = VISUAL_TOKENS.dimensions.sprint.flowDash;
    const period = flowDashPeriod({ dash, gap });
    const offset = period > 0 ? -((elapsedMs / 1000) * period) % period : 0;
    for (const f of this.lastFlows) {
      const color = f.rework ? VISUAL_TOKENS.colors.flow.hot : VISUAL_TOKENS.colors.flow.normal;
      const width = f.rework ? 2.5 : 3.5;
      const alpha = f.rework ? 0.6 : 0.85;
      for (const [a, b] of lineDashSegments(f.x1, f.y1, f.x2, f.y2, dash, gap, offset)) {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color, width, alpha });
      }
      // SVG marker（M0,0 L6,3 L0,6）相当の矢じり（線の終端向き）。
      const rad = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const back = 6;
      const half = 3;
      g.poly([
        f.x2 + cos * 1,
        f.y2 + sin * 1,
        f.x2 - cos * back - sin * half,
        f.y2 - sin * back + cos * half,
        f.x2 - cos * back + sin * half,
        f.y2 - sin * back - cos * half,
      ]).fill({ color, alpha });
    }
  }

  /** Review ゾーン内の局所ヒートフィールドを plan と同期する。 */
  private syncReviewHeat(heat: BoardReviewHeatFieldPlan | null): void {
    const g = this.reviewHeatGfx;
    g.clear();
    this.reviewHeat = heat;
    if (!heat) {
      this.reviewHeatLayer.visible = false;
      return;
    }

    this.reviewHeatLayer.visible = true;
    const maxAlpha = VISUAL_TOKENS.dimensions.sprint.reviewEffects.heatField.maxAlpha;
    const alpha = maxAlpha * heat.intensity;
    const outerColor = VISUAL_TOKENS.colors.board.heatOverlay;
    const innerColor = heat.hell
      ? VISUAL_TOKENS.colors.health.reviewHell
      : VISUAL_TOKENS.colors.flow.hot;
    g.ellipse(heat.x, heat.y, heat.radiusX, heat.radiusY).fill({
      color: outerColor,
      alpha: alpha * 0.45,
    });
    g.ellipse(heat.x, heat.y, heat.radiusX * 0.7, heat.radiusY * 0.7).fill({
      color: innerColor,
      alpha: alpha * 0.65,
    });
    g.ellipse(heat.x, heat.y, heat.radiusX * 0.38, heat.radiusY * 0.38).fill({
      color: innerColor,
      alpha,
    });
  }

  /** Coding / Rework から Review へ向かう上限付きの光跡を plan と同期する。 */
  private syncReviewTrails(trails: readonly BoardReviewTrailPlan[]): void {
    const pool = this.reviewTrailPool;
    if (!pool) return;
    this.reviewTrailRequestedCount = trails.length;
    this.reviewTrailsLayer.removeChildren();
    pool.releaseAll();
    this.reviewTrailEntries = [];

    for (const plan of trails) {
      const trail = pool.acquire();
      if (!trail) break;
      const color =
        plan.tone === 'ai'
          ? VISUAL_TOKENS.colors.taskGlow.ai
          : plan.tone === 'rework'
            ? VISUAL_TOKENS.colors.flow.hot
            : VISUAL_TOKENS.colors.flow.normal;
      const parts = 3;
      for (let i = 0; i < parts; i += 1) {
        const from = -plan.length * ((i + 1) / parts);
        const to = -plan.length * (i / parts);
        const nearDot = (i + 1) / parts;
        trail
          .moveTo(from, 0)
          .lineTo(to, 0)
          .stroke({
            color,
            width: plan.width * (0.35 + nearDot * 0.65),
            alpha: 0.2 + nearDot * 0.5,
            cap: 'round',
          });
      }
      trail.position.set(plan.x, plan.y);
      trail.rotation = (plan.angleDeg * Math.PI) / 180;
      this.reviewTrailsLayer.addChild(trail);
      this.reviewTrailEntries.push({
        trail,
        baseAlpha: 0.6 + plan.progress * 0.25,
        speedMul: plan.speedMul,
        phaseOffsetMs: plan.taskId * 37,
      });
    }
  }

  /** 時限モディファイアの常駐オーラを共有 plan から描く。 */
  private syncAuras(auras: readonly BoardAuraPlan[]): void {
    const g = this.auraGfx;
    g.clear();
    this.auraRequestedCount = auras.length;
    this.activeAuras = auras.slice(0, BOARD_RENDER_BUDGETS.auras);
    this.auraLayer.visible = this.activeAuras.length > 0;
    const tokens = VISUAL_TOKENS.dimensions.sprint.boardEffects.aura;
    for (const aura of this.activeAuras) {
      const elapsedRatio =
        aura.totalTicks > 0 ? 1 - Math.min(1, aura.remainingTicks / aura.totalTicks) : 1;
      const alpha = tokens.minAlpha + elapsedRatio * tokens.elapsedAlpha;
      const color = boardAuraColor(aura.kind);
      g.rect(0, 0, BOARD_VIEW.w, BOARD_VIEW.h).fill({ color, alpha: alpha * 0.2 });
      g.ellipse(
        BOARD_VIEW.w / 2,
        BOARD_VIEW.h * 0.42,
        BOARD_VIEW.w * 0.42,
        BOARD_VIEW.h * 0.48,
      ).fill({
        color,
        alpha: alpha * 0.34,
      });
    }
  }

  /** 一時演出を上限付きプールへ同期する。reduced motion では装飾だけを抑制する。 */
  private syncEffects(effects: readonly TimedBoardEffect[]): void {
    const pool = this.effectPool;
    if (!pool) return;
    this.effectsLayer.removeChildren();
    pool.releaseAll();
    this.effectEntries = [];
    const nowMs = this.effectNowOverride ?? performance.now();
    const active = effects.filter(
      (plan) => plan.startedAtMs + plan.delayMs + plan.durationMs > nowMs,
    );
    this.effectRequestedCount = active.length;
    this.effectSuppressedCount = this.reducedMotion ? active.length : 0;
    if (this.reducedMotion) return;

    for (const plan of active) {
      const group = pool.acquire();
      if (!group) break;
      this.prepareEffect(group, plan);
      this.effectsLayer.addChild(group);
      this.effectEntries.push({ group, plan });
    }
  }

  /** effect kind ごとの局所図形を構築し、時間変化は applyEffectAnimations に任せる。 */
  private prepareEffect(group: Container, plan: TimedBoardEffect): void {
    const { graphics: g, label } = getEffectParts(group);
    const colors = VISUAL_TOKENS.colors.boardEffects;
    const sizes = VISUAL_TOKENS.dimensions.sprint.boardEffects;
    group.visible = true;

    if (plan.source === 'fire') {
      const effect = plan.effect;
      switch (effect.kind) {
        case 'spread': {
          const r = sizes.spread.size / 2;
          g.circle(0, 0, r * 1.7).fill({ color: colors.fireMid, alpha: 0.22 });
          g.circle(0, 0, r).fill(colors.fireEdge);
          g.circle(-r * 0.18, -r * 0.18, r * 0.62).fill(colors.fireMid);
          g.circle(-r * 0.32, -r * 0.32, r * 0.25).fill(colors.fireCore);
          break;
        }
        case 'extinguish': {
          const size =
            effect.source === 'firefight' ? sizes.extinguish.firefightSize : sizes.extinguish.size;
          const r = size / 2;
          g.circle(0, 0, r).fill({ color: colors.extinguishWash, alpha: 0.24 });
          g.circle(0, 0, r * 0.72).stroke({ color: colors.extinguishCore, alpha: 0.8, width: 3 });
          g.circle(0, 0, r * 0.3).fill({ color: colors.extinguishCore, alpha: 0.7 });
          break;
        }
        case 'ignite': {
          const r = sizes.ignite.size / 2;
          g.circle(0, 0, r).fill({ color: colors.fireMid, alpha: 0.22 });
          g.circle(0, 0, r * 0.62).stroke({ color: colors.fireCore, alpha: 0.7, width: 3 });
          g.circle(0, 0, r * 0.26).fill(colors.fireMid);
          break;
        }
      }
      return;
    }

    const effect = plan.effect;
    switch (effect.kind) {
      case 'reviewSweep': {
        const tone =
          effect.outcome === 'incident'
            ? { core: colors.fireCore, mid: colors.fireMid, edge: colors.fireEdge }
            : effect.outcome === 'rework'
              ? { core: colors.reworkCore, mid: colors.reworkMid, edge: colors.reworkEdge }
              : { core: colors.sweepCore, mid: colors.sweepMid, edge: colors.sweepEdge };
        const r = sizes.sweep.size / 2;
        g.moveTo(-sizes.sweep.trailLength, 0)
          .lineTo(-r * 0.4, 0)
          .stroke({ color: tone.mid, alpha: 0.65, width: 5, cap: 'round' });
        g.circle(0, 0, r * 1.45).fill({ color: tone.mid, alpha: 0.2 });
        g.circle(0, 0, r).fill(tone.edge);
        g.circle(-r * 0.2, -r * 0.2, r * 0.58).fill(tone.mid);
        g.circle(-r * 0.32, -r * 0.32, r * 0.25).fill(tone.core);
        break;
      }
      case 'split': {
        const { badgeWidth, badgeHeight, shardSize } = sizes.split;
        g.roundRect(-badgeWidth / 2, -badgeHeight / 2, badgeWidth, badgeHeight, 6)
          .fill({ color: colors.splitPanel, alpha: 0.9 })
          .stroke({ color: colors.splitText, alpha: 0.65, width: 1 });
        for (const x of [-badgeWidth * 0.72, badgeWidth * 0.72]) {
          g.circle(x, -badgeHeight * 0.6, shardSize / 2).fill(colors.splitShard);
        }
        label.text = 'split';
        label.tint = Number.parseInt(colors.splitText.slice(1), 16);
        label.visible = true;
        break;
      }
      case 'firefight': {
        const r = sizes.firefight.size / 2;
        g.circle(0, 0, r).stroke({ color: colors.firefight, alpha: 0.9, width: 3 });
        g.circle(0, 0, sizes.firefight.burstSize / 2).fill({
          color: colors.extinguishWash,
          alpha: 0.18,
        });
        g.circle(0, 0, r * 0.34).fill({ color: colors.extinguishCore, alpha: 0.78 });
        break;
      }
      case 'assignDash':
        g.roundRect(
          0,
          -sizes.assignDash.width / 2,
          sizes.assignDash.length,
          sizes.assignDash.width,
          2,
        ).fill(colors.reworkEdge);
        g.circle(sizes.assignDash.length, 0, sizes.assignDash.width).fill(colors.splitText);
        break;
      case 'boardAura': {
        const color = boardAuraColor(effect.modifierKind);
        g.ellipse(0, 0, BOARD_VIEW.w * 0.42, BOARD_VIEW.h * 0.45).fill({ color, alpha: 0.2 });
        break;
      }
      case 'successPulse':
        g.ellipse(0, 0, BOARD_VIEW.w * 0.42, BOARD_VIEW.h * 0.45).fill({
          color: colors.sweepMid,
          alpha: 0.24,
        });
        break;
    }
  }

  /** ステーションキャラ（机＋キャラ Sprite）を plan と同期する。 */
  private syncActors(stations: readonly BoardStationPlan[]): void {
    // 5 体固定なので初回だけ生成し、以後はテクスチャ差し替えのみ。
    if (this.actors.length === 0) {
      const ordered = [...stations].sort(
        (a, b) => STATION_Z[a.lane] - STATION_Z[b.lane] || a.x - b.x,
      );
      for (const s of ordered) {
        // 同じ柔らかな照明テクスチャを陰と稼働灯に共用。足元のローカル装飾寸法。
        const glow = this.bakeTexture('office-soft-light', () => {
          const g = new Graphics();
          for (let radius = 32; radius >= 2; radius -= 2) {
            g.circle(0, 0, radius).fill({ color: VISUAL_TOKENS.colors.text, alpha: 0.065 });
          }
          return g;
        });
        const shadow = new Sprite();
        shadow.texture = glow;
        shadow.anchor.set(0.5);
        shadow.scale.set(2.1, 0.65);
        shadow.tint = VISUAL_TOKENS.colors.board.contactShadow;
        shadow.alpha = 0.7;
        shadow.eventMode = 'none';
        const light = new Sprite();
        light.texture = glow;
        light.anchor.set(0.5);
        light.scale.set(3.4, 1.45);
        light.blendMode = 'add';
        light.eventMode = 'none';
        this.officeLayer.addChild(light, shadow);
        const desk = new Sprite();
        desk.anchor.set(0.5);
        const char = new Sprite();
        char.anchor.set(0.5);
        const status = new Text({
          text: '',
          style: { fontFamily: FONT_FAMILY, fontSize: 13 },
        });
        status.anchor.set(0.5);
        desk.scale.set(ACTOR_SCALE);
        char.scale.set(ACTOR_SCALE);
        desk.eventMode = 'none';
        char.eventMode = 'none';
        status.eventMode = 'none';
        // DOM版と同じ画家順: 人物を先に描き、机とモニタで下半身を隠す。
        this.stationsLayer.addChild(char, desk, status);
        this.actors.push({
          lane: s.lane,
          count: s.count,
          mood: s.mood,
          assetId: stationAssetForLane(s.lane),
          assetTexture: null,
          assetLoaded: false,
          assetLoading: false,
          desk,
          char,
          status,
          light,
          shadow,
          baseX: s.x,
          baseY: s.y,
        });
      }
    }
    for (const actor of this.actors) {
      const s = stations.find((st) => st.lane === actor.lane);
      if (!s) continue;
      actor.mood = s.mood;
      actor.count = s.count;
      const lighting = officeLight(s);
      actor.light.tint = lighting.color;
      actor.light.alpha = lighting.alpha;
      actor.light.position.set(s.x, s.y + ACTOR_H * 0.42);
      actor.shadow.position.set(s.x, s.y + ACTOR_H * 0.49);
      actor.baseX = s.x;
      actor.baseY = s.y;
      actor.desk.texture = this.deskTexture(actor.lane);
      actor.assetId = stationAssetForLane(actor.lane);
      if (!actor.assetLoading && !actor.assetLoaded) {
        actor.assetLoading = true;
        void loadGameAssetTexture(actor.assetId).then((texture) => {
          if (this.disposed) return;
          actor.assetTexture = texture;
          actor.assetLoaded = true;
          actor.assetLoading = false;
          this.applyActorVisual(actor);
          // 非同期取得がticker停止後に完了しても、新しいSpriteを確実にcanvasへ反映する。
          this.app?.render();
          this.emitRenderMetrics();
        });
      }
      this.applyActorVisual(actor);
      actor.desk.position.set(s.x, s.y);
      actor.char.position.set(s.x, s.y);
      actor.status.position.set(
        s.x + ACTOR_W * ACTOR_STATUS_OFFSET.xRatio,
        s.y + ACTOR_H * ACTOR_STATUS_OFFSET.yRatio,
      );
    }
  }

  private emitRenderMetrics(): void {
    const dotPool = this.pool;
    const reviewTrailPool = this.reviewTrailPool;
    const effectPool = this.effectPool;
    this.opts.onRenderMetrics?.({
      dots: this.dotEntries.length,
      actors: this.actors.length,
      flows: this.lastFlows.length,
      assets: this.actors.filter((actor) => actor.assetLoaded).length,
      reviewTrails: this.reviewTrailEntries.length,
      reviewHeat: this.reviewHeat?.intensity ?? 0,
      effects: this.effectEntries.length,
      auras: this.activeAuras.length,
      resources: {
        dots: {
          ...resourceMetrics(
            BOARD_RENDER_BUDGETS.dots,
            this.dotRequestedCount,
            this.dotEntries.length,
            0,
            dotPool,
          ),
          dropped: this.dotDroppedCount,
        },
        reviewTrails: resourceMetrics(
          BOARD_RENDER_BUDGETS.reviewTrails,
          this.reviewTrailRequestedCount,
          this.reviewTrailEntries.length,
          0,
          reviewTrailPool,
        ),
        effects: resourceMetrics(
          BOARD_RENDER_BUDGETS.transientEffects,
          this.effectRequestedCount,
          this.effectEntries.length,
          this.effectSuppressedCount,
          effectPool,
        ),
        auras: resourceMetrics(
          BOARD_RENDER_BUDGETS.auras,
          this.auraRequestedCount,
          this.activeAuras.length,
          0,
          null,
        ),
      },
    });
  }

  /** SVGアセットと既存の生成人物フォールバックへ共通の気分演出を適用する。 */
  private applyActorVisual(actor: ActorEntry): void {
    const mood = gameAssetMoodStyle(actor.mood);
    actor.char.texture = actor.assetTexture ?? this.charTexture(actor.lane, actor.mood);
    const texture = actor.assetTexture;
    if (texture && texture.width > 0 && texture.height > 0) {
      const scale = Math.min(ACTOR_W / texture.width, ACTOR_H / texture.height) * mood.scale;
      actor.char.scale.set(scale);
    } else {
      actor.char.scale.set(ACTOR_SCALE * mood.scale);
    }
    actor.char.tint = Number.parseInt(mood.tint.slice(1), 16);
    actor.char.alpha = mood.alpha;
    actor.status.text = mood.marker ?? '';
    actor.status.visible = mood.marker !== null;
    actor.status.alpha = mood.alpha;
  }

  /** タスク粒（Sprite＋輪郭リング＋炎 Text）を plan と同期する。 */
  private syncDots(
    dots: readonly BoardDotPlan[],
    draggableIds: ReadonlySet<number>,
    dragTaskId: number | null,
  ): void {
    const pool = this.pool;
    if (!pool) return;
    this.dotsLayer.removeChildren();
    pool.releaseAll();
    this.dotEntries = [];
    const renderPlan = planBoardDotsForRender(dots, draggableIds, dragTaskId);
    this.dotRequestedCount = renderPlan.requested;
    this.dotDroppedCount = renderPlan.dropped;
    const pinned = new Set(draggableIds);
    if (dragTaskId !== null) pinned.add(dragTaskId);
    this.taskMotion.sync(
      renderPlan.dots,
      this.elapsedMs,
      this.reducedMotion || this.frozen || this.loopPaused,
      pinned,
    );

    for (const dot of renderPlan.dots) {
      const group = pool.acquire();
      if (!group) break;
      const parts = getDotParts(group);
      const d = TASK_DIAMETER[dot.size];

      parts.sprite.texture = this.dotTexture(dot.variant, dot.size);
      group.position.set(dot.x, dot.y);

      const draggable = draggableIds.has(dot.id);
      const dragging = dot.id === dragTaskId;
      if (draggable || dragging) {
        // CSS `.task-dot.draggable` の outline（2px シアン / ドラッグ中は金色）。
        parts.ring.circle(0, 0, d / 2 + 3).stroke({
          color: dragging ? VISUAL_TOKENS.colors.sun : VISUAL_TOKENS.colors.interaction.drag,
          width: 2,
          alpha: dragging ? 1 : 0.67,
        });
      }

      if (dot.fire) {
        const urgency = dot.burnUrgency;
        // CSS `.flame`: font-size 0.75〜1.1em を焼き込みサイズ比で近似。
        const scale = urgency !== undefined ? 0.75 + (1 - urgency) * 0.35 : 0.9;
        parts.flame.scale.set(scale);
        parts.flame.position.set(0, -d / 2 + 3);
        parts.flame.visible = true;
      }

      this.dotsLayer.addChild(group);
      this.dotEntries.push({
        id: dot.id,
        group,
        baseX: dot.x,
        baseY: dot.y,
        fire: dot.fire,
        burnUrgency: dot.burnUrgency,
        motion: dot.motion
          ? { angleDeg: dot.motion.angleDeg, speedMul: dot.motion.speedMul }
          : undefined,
      });
    }
  }

  /** CSS keyframes 相当の時間オフセットを全対象へ適用する（位相 0 で全て 0）。 */
  private applyAnimations(elapsedMs: number, effectNowMs: number): void {
    this.drawFlows(elapsedMs);
    this.drawShipments();

    if (this.reviewHeat) {
      const heatTokens = VISUAL_TOKENS.dimensions.sprint.reviewEffects.heatField;
      const phase = (2 * Math.PI * elapsedMs) / heatTokens.pulsePeriodMs;
      this.reviewHeatLayer.alpha =
        1 - heatTokens.pulseAmplitude / 2 + (Math.sin(phase) + 1) * (heatTokens.pulseAmplitude / 2);
    } else {
      this.reviewHeatLayer.alpha = 1;
    }

    const trailPulse = VISUAL_TOKENS.dimensions.sprint.reviewEffects.trail.pulseAmplitude;
    for (const entry of this.reviewTrailEntries) {
      const period = 1150 / Math.max(entry.speedMul, 0.01);
      const phase = (2 * Math.PI * (elapsedMs + entry.phaseOffsetMs)) / period;
      entry.trail.alpha =
        entry.baseAlpha * (1 - trailPulse / 2 + (Math.sin(phase) + 1) * (trailPulse / 2));
    }

    if (this.activeAuras.length > 0) {
      const aura = VISUAL_TOKENS.dimensions.sprint.boardEffects.aura;
      const phase = (2 * Math.PI * elapsedMs) / aura.pulsePeriodMs;
      this.auraLayer.alpha =
        1 - aura.pulseAmplitude / 2 + (Math.sin(phase) + 1) * (aura.pulseAmplitude / 2);
    } else {
      this.auraLayer.alpha = 1;
    }

    this.applyEffectAnimations(effectNowMs);

    for (const actor of this.actors) {
      if (actor.mood === 'panic') {
        // CSS `.cbob.shake`（cshake 0.3s: translate(0,-2px) rotate(-1.4deg)）。
        const period = 300;
        const phase = ((elapsedMs % period) + period) % period;
        const wave = (1 - Math.cos((2 * Math.PI * phase) / period)) / 2;
        actor.char.position.set(actor.baseX, actor.baseY - 2 * wave);
        actor.char.rotation =
          gameAssetMoodStyle(actor.mood).rotation + (-1.4 * wave * Math.PI) / 180;
      } else {
        const gesture = officeActorMotion(actor, elapsedMs);
        actor.char.position.set(actor.baseX + gesture.x, actor.baseY + gesture.y);
        actor.char.rotation = gameAssetMoodStyle(actor.mood).rotation + gesture.rotation;
      }
      actor.status.position.set(
        actor.baseX + ACTOR_W * ACTOR_STATUS_OFFSET.xRatio,
        actor.baseY + ACTOR_H * ACTOR_STATUS_OFFSET.yRatio,
      );
    }

    for (const entry of this.dotEntries) {
      let dx = 0;
      let dy = 0;
      if (entry.motion) {
        // CSS `flowBobDrift`（フロー粒の方向ドリフト＋bob）。
        const drift = flowDriftOffset(entry.motion.angleDeg, entry.motion.speedMul, elapsedMs);
        dx += drift.x;
        dy += drift.y;
      } else if (!entry.fire) {
        // CSS `flybob`（静止粒の上下 bob 2.4s）。
        dy += bobOffsetY(elapsedMs, 2400, 3);
      }
      if (entry.fire) {
        // CSS `fireShake`（炎上粒のジッタ。緊急度で周期が縮む）。
        const shake = fireShakeOffset(elapsedMs, entry.burnUrgency);
        dx += shake.x;
        dy += shake.y;
      }
      const position = this.taskMotion.position(entry.id, this.elapsedMs);
      entry.group.position.set(
        (position?.x ?? entry.baseX) + dx,
        (position?.y ?? entry.baseY) + dy,
      );
    }
  }

  /** 小さな光を一度だけ焼き、最大64枚の加算合成Spriteを使い回す。毎フレーム図形を再生成しない。 */
  private drawShipments(): void {
    this.taskMotion.prune(this.elapsedMs);
    const bursts = this.taskMotion.bursts;
    const count = bursts.length * TASK_MOTION.particlesPerBurst;
    for (let i = 0; i < count; i += 1) {
      let sprite = this.shipmentSprites[i];
      if (!sprite) {
        sprite = new Sprite();
        sprite.texture = this.bakeTexture('shipment-light', () => {
          const g = new Graphics();
          g.circle(0, 0, 7).fill({ color: VISUAL_TOKENS.colors.text, alpha: 0.08 });
          g.circle(0, 0, 4).fill({ color: VISUAL_TOKENS.colors.text, alpha: 0.25 });
          g.circle(0, 0, 1.8).fill(VISUAL_TOKENS.colors.text);
          return g;
        });
        sprite.anchor.set(0.5);
        sprite.blendMode = 'add';
        sprite.eventMode = 'none';
        this.shipmentsLayer.addChild(sprite);
        this.shipmentSprites.push(sprite);
      }
      const burst = bursts[Math.floor(i / TASK_MOTION.particlesPerBurst)];
      const particle = shipmentParticle(burst, i % TASK_MOTION.particlesPerBurst, this.elapsedMs);
      sprite.visible = true;
      sprite.position.set(particle.x, particle.y);
      sprite.alpha = particle.alpha;
      sprite.scale.set(particle.scale);
      sprite.tint = burst.gold ? VISUAL_TOKENS.colors.sun : VISUAL_TOKENS.colors.mint;
    }
    for (let i = count; i < this.shipmentSprites.length; i += 1) {
      this.shipmentSprites[i].visible = false;
    }
  }

  /** 時刻付き plan を現在フレームの座標・透明度・拡大率へ写す。 */
  private applyEffectAnimations(nowMs: number): void {
    for (const entry of this.effectEntries) {
      const { group, plan } = entry;
      const startsAt = plan.startedAtMs + plan.delayMs;
      if (nowMs < startsAt) {
        group.visible = false;
        continue;
      }
      const progress = boardEffectProgress(plan, nowMs);
      if (progress >= 1) {
        group.visible = false;
        continue;
      }
      group.visible = true;
      const pulse = effectPulse(progress);

      if (plan.source === 'fire') {
        const effect = plan.effect;
        switch (effect.kind) {
          case 'spread':
            group.position.set(
              lerp(effect.fromX, effect.toX, progress),
              lerp(effect.fromY, effect.toY, progress),
            );
            group.alpha = Math.min(1, progress * 7) * (0.75 + pulse * 0.25);
            group.scale.set(0.5 + pulse * 0.7);
            break;
          case 'extinguish':
            group.position.set(effect.x, effect.y);
            group.alpha = pulse;
            group.scale.set(0.3 + progress * 1.9);
            break;
          case 'ignite':
            group.position.set(effect.x, effect.y);
            group.alpha = pulse;
            group.scale.set(0.4 + pulse * 1.4);
            break;
        }
        continue;
      }

      const effect = plan.effect;
      switch (effect.kind) {
        case 'reviewSweep': {
          const angle = Math.atan2(effect.toY - effect.fromY, effect.toX - effect.fromX);
          group.position.set(
            lerp(effect.fromX, effect.toX, progress),
            lerp(effect.fromY, effect.toY, progress),
          );
          group.rotation = angle;
          group.alpha = Math.min(1, progress * 8) * (0.72 + pulse * 0.28);
          group.scale.set(0.6 + pulse * 0.5);
          break;
        }
        case 'split':
          group.position.set(effect.x, effect.y);
          group.alpha = pulse;
          group.scale.set(0.55 + pulse * 0.75);
          break;
        case 'firefight':
          group.position.set(effect.x, effect.y);
          group.alpha = pulse;
          group.scale.set(0.4 + progress * 1.8);
          break;
        case 'assignDash':
          group.position.set(
            lerp(effect.fromX, effect.toX, progress),
            lerp(effect.fromY, effect.toY, progress),
          );
          group.rotation = (effect.angleDeg * Math.PI) / 180;
          group.alpha = pulse;
          group.scale.set(0.3 + pulse, 0.75 + pulse * 0.25);
          break;
        case 'boardAura':
        case 'successPulse':
          group.position.set(BOARD_VIEW.w / 2, BOARD_VIEW.h * 0.42);
          group.alpha = pulse * 0.85;
          group.scale.set(0.72 + progress * 0.38);
          break;
      }
    }
  }

  /** WebGL リソースを破棄する。init の解決前でも呼べる（disposed で中断させる）。 */
  dispose(): void {
    this.disposed = true;
    // CanvasText の unload（TexturePool への返却）は renderer 破棄前に済ませる
    // （pixiDeptRenderer と同じ破棄順序。app.destroy 後だと returnTexture で落ちる）。
    for (const group of this.pool?.drain() ?? []) {
      group.destroy({ children: true });
    }
    for (const trail of this.reviewTrailPool?.drain() ?? []) {
      trail.destroy();
    }
    for (const effect of this.effectPool?.drain() ?? []) {
      effect.destroy({ children: true });
    }
    // 焼き込みテクスチャは自前管理なので明示破棄する。
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
    // 自分を生存数から外してから destroy する（共有プール purge の可否判定）。
    if (this.app) releasePixiApp();
    this.app?.destroy(true, DESTROY_OPTIONS);
    this.app = null;
    this.pool = null;
    this.reviewTrailPool = null;
    this.effectPool = null;
    this.actors = [];
    this.dotEntries = [];
    this.taskMotion.clear();
    this.shipmentSprites.length = 0;
    this.reviewTrailEntries = [];
    this.effectEntries = [];
    this.activeAuras = [];
    this.reviewHeat = null;
    this.dotRequestedCount = 0;
    this.dotDroppedCount = 0;
    this.reviewTrailRequestedCount = 0;
    this.effectRequestedCount = 0;
    this.effectSuppressedCount = 0;
    this.auraRequestedCount = 0;
    this.effectNowOverride = null;
    this.lastInput = null;
  }
}
