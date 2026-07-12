/**
 * 全社マップの PixiJS レンダラ（DOM/SVG → PixiJS の局所差し替え。SPEC 第22.4）。
 *
 * 状態を読んで描くだけ（第22.2）。描く内容（位置・深度・色・予算）は純TSの
 * `planOrgScene` が決め、ここは WebGL への反映（スプライトの取得・配置・破棄）
 * だけを受け持つ。スプライトは `iso.ts` の `SpritePool` で再利用し、生成数を
 * 予算内に抑える（第22.5）。
 *
 * ⚠ 実 WebGL は CI/Node で回さない方針（architecture §4.2）。本ファイルは Node
 *    から import できる（型検証のため）が、`init()` / `render()` はブラウザ
 *    （DevContainer の dev サーバをホストブラウザで開く）でのみ呼ぶこと。
 */
import { Application, Container, Graphics, Rectangle, Text } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { Team } from '../../sim/orgscale/types';
import { SpritePool, type CameraRect, type IsoOptions } from '../iso';
import {
  boundsCenter,
  deptFocusTargetScale,
  scrollForCenteredTarget,
  worldBoundsForAll,
  worldBoundsForDept,
  worldBoundsForTeamFocus,
  teamFocusTargetScale,
  type WorldBounds,
} from '../orgCamera';
import { planOrgScene, type OrgSceneOptions, type OrgScenePlan, type OrgSprite } from '../orgScene';
import { truncateName } from '../orgIslandView';
import { isoLayoutOrigin, layoutIso, orgLayoutFingerprint, ORG_PAD } from '../orgView';
import { ensureTexturePoolGuard } from './pixiTexturePoolGuard';
import type { RendererAdapter } from './index';

/**
 * 破棄オプション（Pixi v8）。子・テクスチャに加え `context: true` で WebGL
 * コンテキストを解放し、画面の出入りでコンテキストが蓄積するのを防ぐ。
 */
const DESTROY_OPTIONS = { children: true, texture: true, context: true } as const;

/** DOM `.team-island` と同寸（styles.css）。 */
const CARD_W = 116;
const CARD_PAD_X = 10;
const CARD_PAD_Y = 8;
const CARD_RADIUS = 12;
const CARD_LINE_GAP = 2;
const COLOR_BG = '#1b1438';
const COLOR_TEXT = '#f0e8ff';
const COLOR_TEXT_DIM = '#b9add0';
const COLOR_SUN = '#ffd45c';
const COLOR_FIRE = '#ff7a2f';
const COLOR_FIRE_STROKE = '#ff5f1f';

/** dot LOD の菱形半径（`ORG_PAD` 内に収める）。 */
function dotLodHalfExtents(halfW: number, halfH: number): { halfW: number; halfH: number } {
  const scale = Math.min(ORG_PAD / halfW, ORG_PAD / halfH, 1);
  return { halfW: halfW * scale, halfH: halfH * scale };
}

/** カメラ遷移の既定時間 ms。 */
const CAMERA_ANIM_MS = 480;
const CAMERA_EASE = 'easeOutCubic';

/** org-field スクロール窓（canvas 上の可視領域）。 */
export interface OrgFieldView {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

/** PixiJS 全社マップレンダラの入力（チーム配列＋カメラ可視範囲）。 */
export interface PixiOrgInput {
  teams: readonly Team[];
  camera: CameraRect;
}

/** レンダラの設定（シーン計画のパラメータ＋操作コールバック）。 */
export interface PixiOrgRendererOptions {
  /** アイソメ投影のベース（origin は teams から毎フレーム算出）。 */
  isoBase: IsoOptions;
  /** 盤面余白 px（DOM の layoutIso と同値）。 */
  pad: number;
  /** 同時描画スプライト上限。 */
  spriteBudget: number;
  /** カリング余白 px。 */
  cullMargin?: number;
  /** 部門 ID → 枠線色（DOM `deptColor` と同値）。 */
  deptColor?: (deptId: string) => string;
  /** チーム島タップ → 現場へドリルダウン（任意）。 */
  onFocusTeam?: (teamId: string) => void;
  /** dev-only: 直近のシーン計画メトリクス（ブラウザ計測用）。 */
  onPlanMetrics?: (plan: OrgScenePlan) => void;
}

/** 1 島 Container の子パーツ（プール再利用用）。 */
interface IslandParts {
  bg: Graphics;
  diamond: Graphics;
  /** 炎上 stroke 専用（fill の alpha を点滅で汚さない）。 */
  fireRing: Graphics;
  nameText: Text;
  shippingText: Text;
  aiText: Text;
  fireText: Text;
  badge: Graphics;
}

/** クリック判定用の矩形（島中心からの offset）。 */
interface IslandHitBounds {
  hitX: number;
  hitY: number;
  hitW: number;
  hitH: number;
}

/** 炎上 stroke の点滅対象。 */
interface FirePulse {
  gfx: Graphics;
  fire: number;
}

interface FittedLayout {
  width: number;
  height: number;
  key: string;
}

function makeText(style: { fontSize: number; fill: string; bold?: boolean }): Text {
  return new Text({
    text: '',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: style.fontSize,
      fill: style.fill,
      fontWeight: style.bold ? 'bold' : 'normal',
    },
  });
}

function createIslandContainer(): Container {
  const container = new Container();
  const parts: IslandParts = {
    bg: new Graphics(),
    diamond: new Graphics(),
    fireRing: new Graphics(),
    nameText: makeText({ fontSize: 13, fill: COLOR_TEXT, bold: true }),
    shippingText: makeText({ fontSize: 11, fill: COLOR_TEXT_DIM }),
    aiText: makeText({ fontSize: 11, fill: COLOR_TEXT_DIM }),
    fireText: makeText({ fontSize: 11, fill: COLOR_FIRE }),
    badge: new Graphics(),
  };
  container.addChild(
    parts.bg,
    parts.diamond,
    parts.fireRing,
    parts.nameText,
    parts.shippingText,
    parts.aiText,
    parts.fireText,
    parts.badge,
  );
  for (const child of container.children) {
    child.eventMode = 'none';
  }
  (container as Container & { islandParts: IslandParts }).islandParts = parts;
  return container;
}

function getParts(container: Container): IslandParts {
  return (container as Container & { islandParts: IslandParts }).islandParts;
}

function hideAllParts(parts: IslandParts): void {
  parts.bg.visible = false;
  parts.diamond.visible = false;
  parts.fireRing.visible = false;
  parts.nameText.visible = false;
  parts.shippingText.visible = false;
  parts.aiText.visible = false;
  parts.fireText.visible = false;
  parts.badge.visible = false;
}

/** 幅に収まるまで省略し、描画後の高さを返す。 */
function layoutLabelLine(text: Text, value: string | null, maxWidth: number): number {
  if (!value) {
    text.text = '';
    text.visible = false;
    return 0;
  }
  text.style.wordWrap = true;
  text.style.wordWrapWidth = maxWidth;
  text.visible = true;
  let shown = value;
  text.text = shown;
  while (shown.length > 1 && text.width > maxWidth) {
    shown = truncateName(shown, shown.length - 1);
    text.text = shown;
  }
  return text.height;
}

function drawFireRing(g: Graphics, halfW: number, halfH: number, fire: number): void {
  g.clear();
  g.alpha = 1;
  g.moveTo(0, -halfH);
  g.lineTo(halfW, 0);
  g.lineTo(0, halfH);
  g.lineTo(-halfW, 0);
  g.closePath();
  g.stroke({ color: COLOR_FIRE_STROKE, width: 1 + fire * 3, alpha: 1 });
  g.visible = true;
}

function drawDiamond(g: Graphics, halfW: number, halfH: number, fill: string, alpha: number): void {
  g.clear();
  g.alpha = 1;
  g.moveTo(0, -halfH);
  g.lineTo(halfW, 0);
  g.lineTo(0, halfH);
  g.lineTo(-halfW, 0);
  g.closePath();
  g.fill({ color: fill, alpha });
  g.visible = true;
}

/** 菱形の当たり判定（タイル矩形より狭く、重なり時の誤クリックを減らす）。 */
function diamondHitArea(
  halfW: number,
  halfH: number,
): { contains: (x: number, y: number) => boolean } {
  return {
    contains(x: number, y: number) {
      if (halfW <= 0 || halfH <= 0) return false;
      return Math.abs(x / halfW) + Math.abs(y / halfH) <= 1;
    },
  };
}

function drawCardBg(
  g: Graphics,
  w: number,
  h: number,
  deptColor: string,
  healthColor: string,
  isPlayer: boolean,
  fire: number,
): void {
  g.clear();
  const x = -w / 2;
  const y = -h / 2;
  // 健全度グロー（DOM: box-shadow 0 0 0 2px health55）
  g.roundRect(x - 2, y - 2, w + 4, h + 4, CARD_RADIUS + 2);
  g.fill({ color: healthColor, alpha: 0.33 });
  if (isPlayer) {
    g.roundRect(x - 3, y - 3, w + 6, h + 6, CARD_RADIUS + 3);
    g.stroke({ color: COLOR_SUN, width: 2 });
  }
  g.roundRect(x, y, w, h, CARD_RADIUS);
  g.fill({ color: COLOR_BG });
  g.stroke({ color: deptColor, width: 2 });
  if (fire > 0) {
    g.stroke({ color: COLOR_FIRE_STROKE, width: 1 + fire * 2, alpha: 0.9 });
  }
  g.visible = true;
}

function layoutCard(parts: IslandParts, s: OrgSprite): IslandHitBounds & { w: number; h: number } {
  const labels = s.labels;
  const innerW = CARD_W - CARD_PAD_X * 2;
  const left = -CARD_W / 2 + CARD_PAD_X;

  hideAllParts(parts);

  const lineHeights = [
    layoutLabelLine(parts.nameText, labels.name.length > 0 ? labels.name : null, innerW),
    layoutLabelLine(parts.shippingText, labels.shipping, innerW),
    layoutLabelLine(parts.aiText, labels.ai, innerW),
    layoutLabelLine(parts.fireText, labels.fire, innerW),
  ].filter((h) => h > 0);

  const contentH =
    lineHeights.reduce((sum, h) => sum + h, 0) +
    Math.max(0, lineHeights.length - 1) * CARD_LINE_GAP;
  const h = contentH + CARD_PAD_Y * 2;
  const topY = -h / 2 + CARD_PAD_Y;

  let y = topY;
  for (const text of [parts.nameText, parts.shippingText, parts.aiText, parts.fireText]) {
    if (!text.visible) continue;
    text.position.set(left, y);
    y += text.height + CARD_LINE_GAP;
  }

  drawCardBg(parts.bg, CARD_W, h, s.deptColor, s.tint, s.isPlayer, s.fire);

  if (labels.showBadge) {
    parts.badge.clear();
    parts.badge.circle(CARD_W / 2 - CARD_PAD_X - 5, topY + 11, 5);
    parts.badge.fill({ color: s.tint });
    parts.badge.visible = true;
  }

  return { w: CARD_W, h, hitX: -CARD_W / 2, hitY: -h / 2, hitW: CARD_W, hitH: h };
}

function layoutBadge(
  parts: IslandParts,
  s: OrgSprite,
  halfW: number,
  halfH: number,
): IslandHitBounds {
  hideAllParts(parts);
  const dHalfW = halfW * 0.55;
  const dHalfH = halfH * 0.55;
  drawDiamond(parts.diamond, dHalfW, dHalfH, s.tint, s.isPlayer ? 1 : 0.85);
  if (s.fire > 0) {
    drawFireRing(parts.fireRing, dHalfW, dHalfH, s.fire);
  }

  const labels = s.labels;
  let minX = -dHalfW;
  let maxX = dHalfW;
  const minY = -dHalfH;
  let maxY = dHalfH;
  const textY = halfH * 0.6;

  if (labels.name) {
    parts.nameText.text = labels.name;
    parts.nameText.position.set(-dHalfW, textY);
    parts.nameText.visible = true;
    minX = Math.min(minX, -dHalfW);
    maxX = Math.max(maxX, -dHalfW + parts.nameText.width);
    maxY = Math.max(maxY, textY + parts.nameText.height);
  }

  if (labels.fire) {
    const fireX = labels.name ? -dHalfW + parts.nameText.width + 4 : -dHalfW;
    parts.fireText.text = labels.fire;
    parts.fireText.position.set(fireX, textY);
    parts.fireText.visible = true;
    minX = Math.min(minX, fireX);
    maxX = Math.max(maxX, fireX + parts.fireText.width);
    maxY = Math.max(maxY, textY + parts.fireText.height);
  }

  return {
    hitX: minX,
    hitY: minY,
    hitW: maxX - minX,
    hitH: maxY - minY,
  };
}

function layoutDot(
  parts: IslandParts,
  s: OrgSprite,
  halfW: number,
  halfH: number,
): IslandHitBounds {
  hideAllParts(parts);
  const dot = dotLodHalfExtents(halfW, halfH);
  drawDiamond(parts.diamond, dot.halfW, dot.halfH, s.tint, s.isPlayer ? 1 : 0.85);
  if (s.fire > 0) {
    drawFireRing(parts.fireRing, dot.halfW, dot.halfH, s.fire);
  }
  return {
    hitX: -dot.halfW,
    hitY: -dot.halfH,
    hitW: dot.halfW * 2,
    hitH: dot.halfH * 2,
  };
}

export class PixiOrgRenderer implements RendererAdapter<PixiOrgInput> {
  private app: Application | null = null;
  private viewport: Viewport | null = null;
  private readonly layer = new Container();
  private pool: SpritePool<Container> | null = null;
  /** dispose 済みフラグ（非同期 init の中断判定）。init/dispose は 1 インスタンス 1 回。 */
  private disposed = false;
  private readonly opts: PixiOrgRendererOptions;
  private lastTeams: readonly Team[] = [];
  private fittedLayout: FittedLayout | null = null;
  private readonly firePulses: FirePulse[] = [];
  private tickerBound = false;
  private fieldView: OrgFieldView = { scrollX: 0, scrollY: 0, width: 800, height: 600 };
  private scrollHost: HTMLElement | null = null;
  /** 直近 render のシーン計画（dev 計測 / デバッグ）。 */
  private lastPlan: OrgScenePlan | null = null;

  constructor(opts: PixiOrgRendererOptions) {
    this.opts = opts;
  }

  /** ブラウザでのみ呼ぶ。WebGL コンテキストとビューポートを初期化する。 */
  async init(mount: HTMLElement): Promise<void> {
    ensureTexturePoolGuard();
    const app = new Application();
    await app.init({
      background: '#0e0b1a',
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
    // ヒットテストは canvas 座標系で行うため、イベントターゲットは canvas に合わせる。
    // wheel は mount 全体に付くが、盤面外スクロールでの zoom は overlay 内 canvas 外で起きにくい。
    app.renderer.events.setTargetElement(app.canvas);

    const viewport = new Viewport({
      events: app.renderer.events,
      screenWidth: mount.clientWidth,
      screenHeight: mount.clientHeight,
      worldWidth: 4000,
      worldHeight: 4000,
    });
    viewport.drag().pinch().wheel().decelerate();
    viewport.addChild(this.layer);
    app.stage.addChild(viewport);

    const redraw = (): void => {
      if (this.lastTeams.length > 0) this.renderTeams(this.lastTeams);
    };
    viewport.on('moved', redraw);
    viewport.on('zoomed', redraw);

    this.pool = new SpritePool<Container>(createIslandContainer, {
      max: this.opts.spriteBudget,
      reset: (c) => {
        c.removeAllListeners();
        c.eventMode = 'auto';
        c.cursor = 'default';
        c.position.set(0, 0);
        c.hitArea = null;
        const parts = getParts(c);
        parts.bg.clear();
        parts.diamond.clear();
        parts.diamond.alpha = 1;
        parts.fireRing.clear();
        parts.fireRing.alpha = 1;
        parts.badge.clear();
        parts.nameText.text = '';
        parts.shippingText.text = '';
        parts.aiText.text = '';
        parts.fireText.text = '';
        hideAllParts(parts);
      },
    });

    if (!this.tickerBound) {
      app.ticker.add(() => this.pulseFireStrokes());
      this.tickerBound = true;
    }

    this.app = app;
    this.viewport = viewport;
  }

  /** org-field のスクロール窓を更新する（カリングの可視範囲）。 */
  setFieldView(view: OrgFieldView): void {
    this.fieldView = view;
  }

  /** 横スクロールする `.org-field` 要素（フォーカス後に可視窓へ合わせる）。 */
  setScrollHost(el: HTMLElement | null): void {
    this.scrollHost = el;
  }

  /** init 済みか（React 側のカメラ同期判定用）。 */
  get isReady(): boolean {
    return this.viewport !== null;
  }

  /** viewport の現在 scale（E2E / dev 計測用）。 */
  getZoomScale(): number | null {
    return this.viewport?.scale.x ?? null;
  }

  /** 直近 render のシーン計画メトリクス（ブラウザ dev 計測用）。 */
  getLastPlan(): OrgScenePlan | null {
    return this.lastPlan;
  }

  /** world 座標が `.org-field` 可視窓の中央に来るよう scroll を同期する。 */
  private revealWorldPointInScrollHost(worldX: number, worldY: number): void {
    const vp = this.viewport;
    const host = this.scrollHost;
    if (!vp || !host) return;

    const screen = vp.toScreen(worldX, worldY);
    const { scrollLeft, scrollTop } = scrollForCenteredTarget(
      screen.x,
      screen.y,
      host.clientWidth,
      host.clientHeight,
      host.scrollWidth,
      host.scrollHeight,
    );
    host.scrollLeft = scrollLeft;
    host.scrollTop = scrollTop;
    this.fieldView = {
      scrollX: scrollLeft,
      scrollY: scrollTop,
      width: host.clientWidth,
      height: host.clientHeight,
    };
  }

  /** world bounds へ viewport を合わせる（animate=false なら即時 fit）。 */
  private animateToBounds(
    bounds: WorldBounds,
    animate: boolean,
    resolveScale?: (currentScale: number, fitScale: number) => number,
  ): Promise<void> {
    const vp = this.viewport;
    if (!vp) return Promise.resolve();
    const center = boundsCenter(bounds);
    // width/height を同時に animate すると fitWidth/fitHeight が別々に適用され横長に歪む。
    // fit() と同様、findFit で等方 scale を使う。
    const fitScale = vp.findFit(bounds.width, bounds.height);
    const scale = resolveScale ? resolveScale(vp.scale.x, fitScale) : fitScale;
    const finish = (): void => {
      this.revealWorldPointInScrollHost(center.x, center.y);
    };
    if (!animate) {
      vp.fit(false, bounds.width, bounds.height);
      if (resolveScale) vp.setZoom(scale, false);
      vp.moveCenter(center.x, center.y);
      finish();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      vp.animate({
        time: CAMERA_ANIM_MS,
        ease: CAMERA_EASE,
        position: center,
        scale,
        callbackOnComplete: () => {
          finish();
          resolve();
        },
      });
    });
  }

  /** 全社 fit（パンくず「全社」復帰）。 */
  focusCompany(teams: readonly Team[], animate = true): Promise<void> {
    const bounds = worldBoundsForAll(teams, this.opts.isoBase, this.opts.pad);
    if (!bounds) return Promise.resolve();
    this.fittedLayout = null;
    return this.animateToBounds(bounds, animate).then(() => {
      const layout = layoutIso(teams, this.opts.isoBase, this.opts.pad);
      if (layout.width <= 0 || layout.height <= 0) return;
      const key = layout.placed
        .map(({ item }) => `${item.id}:${item.gridX}:${item.gridY}`)
        .join('|');
      this.fittedLayout = { width: layout.width, height: layout.height, key };
    });
  }

  /** 部門ゾーンへ fit（部門チップ）。 */
  focusDepartment(teams: readonly Team[], deptId: string, animate = true): Promise<void> {
    const bounds = worldBoundsForDept(teams, deptId, this.opts.isoBase, this.opts.pad);
    if (!bounds) return Promise.resolve();
    return this.animateToBounds(bounds, animate, deptFocusTargetScale);
  }

  /** チーム島へ寄せる（ドリルダウン前のカメラ演出）。 */
  focusTeamCamera(teams: readonly Team[], teamId: string, animate = true): Promise<void> {
    const bounds = worldBoundsForTeamFocus(teams, teamId, this.opts.isoBase, this.opts.pad);
    const vp = this.viewport;
    if (!bounds || !vp) return Promise.resolve();

    const center = boundsCenter(bounds);
    const fitScale = vp.findFit(bounds.width, bounds.height);
    const targetScale = teamFocusTargetScale(vp.scale.x, fitScale);

    if (!animate) {
      vp.moveCenter(center.x, center.y);
      vp.setZoom(targetScale, true);
      this.revealWorldPointInScrollHost(center.x, center.y);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      vp.animate({
        time: CAMERA_ANIM_MS,
        ease: CAMERA_EASE,
        position: center,
        scale: targetScale,
        callbackOnComplete: () => {
          this.revealWorldPointInScrollHost(center.x, center.y);
          resolve();
        },
      });
    });
  }

  /** 炎上菱形 stroke の点滅（browser のみ）。 */
  private pulseFireStrokes(): void {
    if (this.firePulses.length === 0) return;
    const phase = 0.5 + 0.5 * Math.sin(performance.now() / 200);
    for (const { gfx, fire } of this.firePulses) {
      gfx.alpha = 0.55 + phase * 0.45 * fire;
    }
  }

  /**
   * 視覚回帰向け: Pixi ticker と炎上 alpha を時間非依存の固定値へ止める。
   * CSS animation 停止だけでは canvas 内の点滅が残るため E2E 専用。
   */
  freezeForScreenshot(): void {
    const app = this.app;
    if (!app) return;
    app.ticker.stop();
    const phase = 0.5;
    for (const { gfx, fire } of this.firePulses) {
      gfx.alpha = 0.55 + phase * 0.45 * fire;
    }
    app.render();
  }

  /** viewport の可視範囲を `CameraRect` へ変換する（カリング供給）。 */
  getCameraRect(): CameraRect {
    const vp = this.viewport;
    if (!vp) return { x: 0, y: 0, w: 800, h: 600 };
    const scale = vp.scale.x;
    const { scrollX, scrollY, width, height } = this.fieldView;
    return {
      x: vp.left + scrollX / scale,
      y: vp.top + scrollY / scale,
      w: width / scale,
      h: height / scale,
    };
  }

  /** 盤面（mount）と renderer のピクセルサイズを更新する。 */
  resize(boardWidth: number, boardHeight: number): void {
    if (boardWidth > 0 && boardHeight > 0) {
      this.app?.renderer.resize(boardWidth, boardHeight);
    }
    this.viewport?.resize(boardWidth, boardHeight, boardWidth, boardHeight);
  }

  /** 直近 fitToContent で使った layout 指紋（React 側との同期確認用）。 */
  getFittedLayoutFingerprint(): string | null {
    if (!this.fittedLayout) return null;
    const { width, height, key } = this.fittedLayout;
    return `${width}x${height}:${key}`;
  }

  /** fitToContent のキャッシュを破棄する（layout 変更時の強制 refit 用）。 */
  invalidateFitCache(): void {
    this.fittedLayout = null;
  }

  /** DOM 盤面と同サイズの world を画面に収める。内容サイズが変わった時だけ再フィットする。 */
  fitToContent(teams: readonly Team[]): void {
    const vp = this.viewport;
    if (!vp) return;
    const layout = layoutIso(teams, this.opts.isoBase, this.opts.pad);
    if (layout.width <= 0 || layout.height <= 0) return;
    const fingerprint = orgLayoutFingerprint(teams, this.opts.isoBase, this.opts.pad);
    if (this.getFittedLayoutFingerprint() === fingerprint) return;
    const key = layout.placed.map(({ item }) => `${item.id}:${item.gridX}:${item.gridY}`).join('|');
    vp.fit(true, layout.width, layout.height);
    vp.moveCenter(layout.width / 2, layout.height / 2);
    this.fittedLayout = { width: layout.width, height: layout.height, key };
  }

  /** 最新チーム列を viewport カメラで描く（React / pan/zoom 共通入口）。 */
  renderTeams(teams: readonly Team[]): void {
    this.lastTeams = teams;
    this.render({ teams, camera: this.getCameraRect() });
  }

  /** 最新のチーム状態を読んで 1 フレーム描く。init() 前は何もしない。 */
  render(input: PixiOrgInput): void {
    const pool = this.pool;
    const vp = this.viewport;
    if (!pool || !vp) return;

    this.layer.removeChildren();
    pool.releaseAll();
    this.firePulses.length = 0;

    const origin = isoLayoutOrigin(input.teams, this.opts.isoBase, this.opts.pad);
    const zoomScale = vp.scale.x;
    const sceneOpts: OrgSceneOptions = {
      iso: { ...this.opts.isoBase, ...origin },
      spriteBudget: this.opts.spriteBudget,
      cullMargin: this.opts.cullMargin,
      zoomScale,
      deptColor: this.opts.deptColor,
    };

    const halfW = sceneOpts.iso.tileW / 2;
    const halfH = sceneOpts.iso.tileH / 2;
    const plan = planOrgScene(input.teams, input.camera, sceneOpts);
    this.lastPlan = plan;
    this.opts.onPlanMetrics?.(plan);
    const onFocus = this.opts.onFocusTeam;

    for (const s of plan.sprites) {
      const island = pool.acquire();
      if (!island) break;

      const parts = getParts(island);
      let hit: IslandHitBounds;
      let useDiamondHit = false;

      if (s.detail === 'card') {
        const size = layoutCard(parts, s);
        hit = { hitX: -size.w / 2, hitY: -size.h / 2, hitW: size.w, hitH: size.h };
      } else if (s.detail === 'badge') {
        hit = layoutBadge(parts, s, halfW, halfH);
        if (s.fire > 0) {
          this.firePulses.push({ gfx: parts.fireRing, fire: s.fire });
        }
      } else {
        hit = layoutDot(parts, s, halfW, halfH);
        useDiamondHit = true;
        if (s.fire > 0) {
          this.firePulses.push({ gfx: parts.fireRing, fire: s.fire });
        }
      }

      island.position.set(s.x, s.y);
      island.interactiveChildren = false;

      if (onFocus) {
        island.eventMode = 'static';
        island.cursor = 'pointer';
        island.hitArea = useDiamondHit
          ? diamondHitArea(hit.hitW / 2, hit.hitH / 2)
          : new Rectangle(hit.hitX, hit.hitY, hit.hitW, hit.hitH);
        island.on('pointertap', () => onFocus(s.teamId));
      }

      this.layer.addChild(island);
    }
  }

  /** WebGL リソースを破棄する。init の解決前でも呼べる（disposed で中断させる）。 */
  dispose(): void {
    this.disposed = true;
    this.firePulses.length = 0;
    // CanvasText の unload（TexturePool への返却）は renderer 破棄前に済ませる。
    // app.destroy 後だと TexturePool が先に消え、pipe の後始末が
    // `returnTexture` で落ちる（free に残った未接続島の Text が対象。RI-11 で顕在化）。
    for (const island of this.pool?.drain() ?? []) {
      island.destroy({ children: true });
    }
    this.viewport?.destroy();
    this.app?.destroy(true, DESTROY_OPTIONS);
    this.app = null;
    this.viewport = null;
    this.pool = null;
    this.lastTeams = [];
    this.fittedLayout = null;
    this.lastPlan = null;
  }
}
