/**
 * スプリント盤面（現場）の PixiJS レンダラ（RI-11 残務 / RI-07。SPEC 第22.4）。
 *
 * 状態を読んで描くだけ（第22.2）。描く内容は純TSの `planBoardScene` が決め、ここは
 * WebGL への反映だけを受け持つ。Pixi 化するのは常駐物＝工程間フロー線・タスク粒・
 * ステーションキャラのみで、イベント駆動の演出（FireEffects / InterventionEffects /
 * 数字ポップ / オーラ）・ラベル・吹き出し・凡例は DOM オーバーレイのまま重ねる
 * （DOM 版と演出コンポーネントを共有し、レンダラ間の見た目乖離を避ける）。
 *
 * RI-07: 粒とキャラは Graphics 直描きではなく、variant×size / lane×mood ごとに
 * RenderTexture へ焼き込んで Sprite で使い回す（粒数×表情の組合せに強く、
 * RI-05/06/08 の土台になる）。粒 Container は `iso.ts` の `SpritePool` で再利用する。
 *
 * ⚠ 実 WebGL は CI/Node で回さない方針（architecture §4.2）。本ファイルは Node
 *    から import できる（型検証のため）が、`init()` / `render()` はブラウザでのみ呼ぶこと。
 */
import { Application, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import type { Lane } from '../../sim/types';
import {
  BOARD_VIEW,
  type BoardDotPlan,
  type BoardFlow,
  type BoardScenePlan,
  type BoardStationPlan,
  type StationMood,
} from '../boardScene';
import {
  actorTextureKey,
  bobOffsetY,
  dotTextureKey,
  fireShakeOffset,
  flowDriftOffset,
  lineDashSegments,
} from '../boardPixiView';
import { containFitTransform } from '../deptPixiView';
import { SpritePool } from '../iso';
import { TASK_COLORS, TASK_DIAMETER } from '../taskView';
import { ensureTexturePoolGuard } from './pixiTexturePoolGuard';
import type { RendererAdapter } from './index';

/** 破棄オプション（Pixi v8）。`pixiOrgRenderer` と同値。 */
const DESTROY_OPTIONS = { children: true, texture: true, context: true } as const;

/** 粒 Container の同時描画上限（cap 合計 70 ＋ フロー粒の余裕）。 */
export const BOARD_SPRITE_BUDGET = 96;

const FONT_FAMILY = 'system-ui, sans-serif';

/**
 * キャラ SVG（OfficeActors）のローカル座標系と実表示サイズ。
 * DOM は `.station { width: 15% }` の中に width=210 height=190 viewBox=220×200 の
 * SVG を置くため、設計空間では幅 1404×0.15=210.6px・ローカル倍率 min(W/220,H/200)。
 */
const ACTOR_LOCAL = { w: 220, h: 200 } as const;
const ACTOR_W = BOARD_VIEW.w * 0.15;
const ACTOR_H = (ACTOR_W * 190) / 210;
const ACTOR_SCALE = Math.min(ACTOR_W / ACTOR_LOCAL.w, ACTOR_H / ACTOR_LOCAL.h);

/** レーンごとのキャラ見た目（OfficeActors の STYLE と同値）。 */
const ACTOR_STYLE: Record<Lane, { body: string; hair: string; skin: string; emoji?: string }> = {
  backlog: { body: '#7a6cc0', hair: '#4a3530', skin: '#ffe0c4' },
  coding: { body: '#4fb3a0', hair: '#5a3a2a', skin: '#ffe0c4', emoji: '✨' },
  review: { body: '#5b6b8c', hair: '#3a3340', skin: '#f4d2b3', emoji: '💧' },
  rework: { body: '#c0728a', hair: '#3a2a40', skin: '#ffe0c4', emoji: '💦' },
  done: { body: '#3fa86e', hair: '#4a3020', skin: '#ffe0c4', emoji: '🎉' },
};

const INK = '#33285c';

/** DOM の z-index（station 4 / review 5 / done 6）と同じ画家順。 */
const STATION_Z: Record<Lane, number> = { backlog: 4, coding: 4, rework: 4, review: 5, done: 6 };

/** 粒の重なり順（DOM: 通常 7 / flowing・炎上 8 / draggable 9 / dragging 12）。 */
function dotZ(dot: BoardDotPlan, draggable: boolean, dragging: boolean): number {
  if (dragging) return 12;
  if (draggable) return 9;
  if (dot.motion || dot.fire) return 8;
  return 7;
}

/** 描画メトリクス（E2E 安定化・dev 計測用）。 */
export interface BoardRenderMetrics {
  dots: number;
  actors: number;
  flows: number;
}

/** レンダラ入力（Board.tsx が plan と drag ハイライトをまとめて渡す）。 */
export interface BoardPixiInput {
  scene: BoardScenePlan;
  /** ドラッグ介入（RI-30）で掴める粒（シアン輪郭）。 */
  draggableTaskIds?: ReadonlySet<number>;
  /** ドラッグ中の粒（金色輪郭・最前面）。 */
  dragTaskId?: number | null;
}

export interface PixiBoardRendererOptions {
  /** dev-only: 直近 render のメトリクス（ブラウザ計測 / E2E 安定化用）。 */
  onRenderMetrics?: (metrics: BoardRenderMetrics) => void;
}

/** 1 粒ぶんの子パーツ（プール再利用用）。 */
interface DotParts {
  sprite: Sprite;
  ring: Graphics;
  flame: Text;
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
  group: Container;
  baseX: number;
  baseY: number;
  fire: boolean;
  burnUrgency?: number;
  motion?: { angleDeg: number; speedMul: number };
}

/** アニメ適用用のキャラメタデータ。 */
interface ActorEntry {
  lane: Lane;
  mood: StationMood;
  desk: Sprite;
  char: Sprite;
  baseX: number;
  baseY: number;
}

/** 机（OfficeActors の Desk と同値。ローカル 220×200 座標）。 */
function drawDesk(g: Graphics, lane: Lane): void {
  const dark = lane === 'coding';
  const top = dark ? '#5a4a86' : '#caa06a';
  const left = dark ? '#3a2f66' : '#9a7440';
  const right = dark ? '#2b2050' : '#75561f';
  g.poly([40, 150, 110, 115, 180, 150, 110, 185]).fill(top);
  g.poly([40, 150, 110, 185, 110, 215, 40, 180]).fill(left);
  g.poly([110, 185, 180, 150, 180, 180, 110, 215]).fill(right);
  g.moveTo(40, 150)
    .lineTo(110, 115)
    .lineTo(180, 150)
    .stroke({ color: '#ffffff', alpha: 0.13, width: 1.5 });
  g.rect(38, 150, 3.2, 34).fill('#5a3f18');
  g.rect(178, 150, 3.2, 34).fill('#5a3f18');
  g.rect(108, 185, 3.2, 34).fill('#5a3f18');
  // PC/モニタ（Coding/Review の机に）。
  if (lane === 'coding' || lane === 'review') {
    g.poly([92, 138, 110, 130, 128, 138, 110, 146]).fill('#0e1430');
    g.poly([96, 137, 110, 131, 110, 139, 96, 145]).fill({ color: '#3fb6ff', alpha: 0.85 });
  }
}

/** 目（OfficeActors の Eyes と同値。胴体グループ原点 (60,4) 込みの絶対座標）。 */
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

/** 口（OfficeActors の Mouth と同値）。 */
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
  g.moveTo(ox + 43, oy + 59)
    .quadraticCurveTo(ox + 50, oy + 63, ox + 57, oy + 59)
    .stroke({ color: '#9a5a4a', width: 2, cap: 'round' });
}

/** キャラ（胴体・頭・髪・表情。OfficeActors の bob 対象グループと同値）。 */
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
const DOT_PAD = 20;

/** variant 別のグロー（CSS box-shadow の近似。色と強さ）。 */
const DOT_GLOW: Partial<Record<BoardDotPlan['variant'], { color: string; alpha: number }>> = {
  ai: { color: '#b388ff', alpha: 0.3 },
  gold: { color: '#ffd45c', alpha: 0.32 },
  incident: { color: '#ff7a2f', alpha: 0.38 },
};

export class PixiBoardRenderer implements RendererAdapter<BoardPixiInput> {
  private app: Application | null = null;
  /** contain-fit スケールを受ける設計空間ルート。 */
  private readonly root = new Container();
  private readonly flowsGfx = new Graphics();
  private readonly stationsLayer = new Container();
  private readonly dotsLayer = new Container();
  private pool: SpritePool<Container> | null = null;
  /** 焼き込みテクスチャ（自前管理。dispose で明示破棄する）。 */
  private readonly textures = new Map<string, Texture>();
  private actors: ActorEntry[] = [];
  private dotEntries: DotEntry[] = [];
  private lastFlows: readonly BoardFlow[] = [];
  /** アニメ経過時間（ms）。freeze で 0 に戻し位相 0 の決定論フレームにする。 */
  private elapsedMs = 0;
  private frozen = false;
  /** dispose 済みフラグ（非同期 init の中断判定）。init/dispose は 1 インスタンス 1 回。 */
  private disposed = false;
  private readonly opts: PixiBoardRendererOptions;
  private lastInput: BoardPixiInput | null = null;

  constructor(opts: PixiBoardRendererOptions = {}) {
    this.opts = opts;
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

    this.root.addChild(this.flowsGfx, this.stationsLayer, this.dotsLayer);
    app.stage.addChild(this.root);
    app.stage.eventMode = 'none';

    this.pool = new SpritePool<Container>(createDotContainer, {
      max: BOARD_SPRITE_BUDGET,
      reset: resetDotContainer,
    });

    this.app = app;

    // CSS keyframes（flybob / bob / flowBobDrift / fireShake / dash）相当の
    // 常時アニメ。座標本体は render() の plan 由来で、ここはオフセットだけを足す。
    app.ticker.add(() => {
      if (this.frozen) return;
      this.elapsedMs += app.ticker.deltaMS;
      this.applyAnimations(this.elapsedMs);
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
    this.elapsedMs = 0;
    this.applyAnimations(0);
    app.ticker.stop();
    app.render();
  }

  /** 最新のシーン計画を読んで 1 フレーム描く。init() 前は何もしない。 */
  render(input: BoardPixiInput): void {
    const pool = this.pool;
    if (!pool || !this.app) return;
    this.lastInput = input;
    const { scene } = input;

    this.lastFlows = scene.flows;
    this.drawFlows(this.elapsedMs);
    this.syncActors(scene.stations);
    this.syncDots(scene.dots, input.draggableTaskIds ?? new Set(), input.dragTaskId ?? null);
    this.applyAnimations(this.elapsedMs);

    this.opts.onRenderMetrics?.({
      dots: this.dotEntries.length,
      actors: this.actors.length,
      flows: scene.flows.length,
    });
  }

  /** 直近 render の入力（resize 後の再描画用）。 */
  getLastInput(): BoardPixiInput | null {
    return this.lastInput;
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
    // CSS `dash` keyframes: 1s で dashoffset 0 → -15px。
    const offset = -((elapsedMs / 1000) * 15) % 15;
    for (const f of this.lastFlows) {
      const color = f.rework ? '#ff9a93' : '#cdbff0';
      const width = f.rework ? 2.5 : 3.5;
      const alpha = f.rework ? 0.6 : 0.85;
      for (const [a, b] of lineDashSegments(f.x1, f.y1, f.x2, f.y2, 6, 9, offset)) {
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

  /** ステーションキャラ（机＋キャラ Sprite）を plan と同期する。 */
  private syncActors(stations: readonly BoardStationPlan[]): void {
    // 5 体固定なので初回だけ生成し、以後はテクスチャ差し替えのみ。
    if (this.actors.length === 0) {
      const ordered = [...stations].sort(
        (a, b) => STATION_Z[a.lane] - STATION_Z[b.lane] || a.x - b.x,
      );
      for (const s of ordered) {
        const desk = new Sprite();
        desk.anchor.set(0.5);
        const char = new Sprite();
        char.anchor.set(0.5);
        desk.scale.set(ACTOR_SCALE);
        char.scale.set(ACTOR_SCALE);
        desk.eventMode = 'none';
        char.eventMode = 'none';
        this.stationsLayer.addChild(desk, char);
        this.actors.push({ lane: s.lane, mood: s.mood, desk, char, baseX: s.x, baseY: s.y });
      }
    }
    for (const actor of this.actors) {
      const s = stations.find((st) => st.lane === actor.lane);
      if (!s) continue;
      actor.mood = s.mood;
      actor.baseX = s.x;
      actor.baseY = s.y;
      actor.desk.texture = this.deskTexture(actor.lane);
      actor.char.texture = this.charTexture(actor.lane, s.mood);
      actor.desk.position.set(s.x, s.y);
      actor.char.position.set(s.x, s.y);
    }
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

    // DOM の z-index 相当の重なり順（安定ソート）。
    const ordered = dots
      .map((dot, i) => ({ dot, i }))
      .sort(
        (a, b) =>
          dotZ(a.dot, draggableIds.has(a.dot.id), a.dot.id === dragTaskId) -
            dotZ(b.dot, draggableIds.has(b.dot.id), b.dot.id === dragTaskId) || a.i - b.i,
      );

    for (const { dot } of ordered) {
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
          color: dragging ? '#ffd45c' : '#7bdcff',
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
  private applyAnimations(elapsedMs: number): void {
    this.drawFlows(elapsedMs);

    for (const actor of this.actors) {
      if (actor.mood === 'panic') {
        // CSS `.cbob.shake`（cshake 0.3s: translate(0,-2px) rotate(-1.4deg)）。
        const period = 300;
        const phase = ((elapsedMs % period) + period) % period;
        const wave = (1 - Math.cos((2 * Math.PI * phase) / period)) / 2;
        actor.char.position.set(actor.baseX, actor.baseY - 2 * wave);
        actor.char.rotation = (-1.4 * wave * Math.PI) / 180;
      } else {
        // CSS `.cbob`（bob 2.8s / coding は 1.2s）。
        const period = actor.lane === 'coding' ? 1200 : 2800;
        actor.char.position.set(actor.baseX, actor.baseY + bobOffsetY(elapsedMs, period, 3));
        actor.char.rotation = 0;
      }
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
      entry.group.position.set(entry.baseX + dx, entry.baseY + dy);
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
    // 焼き込みテクスチャは自前管理なので明示破棄する。
    for (const texture of this.textures.values()) texture.destroy(true);
    this.textures.clear();
    this.app?.destroy(true, DESTROY_OPTIONS);
    this.app = null;
    this.pool = null;
    this.actors = [];
    this.dotEntries = [];
    this.lastInput = null;
  }
}
