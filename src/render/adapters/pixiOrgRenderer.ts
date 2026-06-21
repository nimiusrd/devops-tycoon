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
import { Application, Container, Graphics } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { Team } from '../../sim/orgscale/types';
import { SpritePool, type CameraRect, type IsoOptions } from '../iso';
import { planOrgScene, type OrgSceneOptions } from '../orgScene';
import { isoLayoutOrigin, layoutIso } from '../orgView';
import type { RendererAdapter } from './index';

/**
 * 破棄オプション（Pixi v8）。子・テクスチャに加え `context: true` で WebGL
 * コンテキストを解放し、画面の出入りでコンテキストが蓄積するのを防ぐ。
 */
const DESTROY_OPTIONS = { children: true, texture: true, context: true } as const;

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
  /** チーム島タップ → 現場へドリルダウン（任意）。 */
  onFocusTeam?: (teamId: string) => void;
}

export class PixiOrgRenderer implements RendererAdapter<PixiOrgInput> {
  private app: Application | null = null;
  private viewport: Viewport | null = null;
  private readonly layer = new Container();
  private pool: SpritePool<Graphics> | null = null;
  /** dispose 済みフラグ（非同期 init の中断判定）。init/dispose は 1 インスタンス 1 回。 */
  private disposed = false;
  private readonly opts: PixiOrgRendererOptions;
  private lastTeams: readonly Team[] = [];
  private fittedLayout: { width: number; height: number } | null = null;

  constructor(opts: PixiOrgRendererOptions) {
    this.opts = opts;
  }

  /** ブラウザでのみ呼ぶ。WebGL コンテキストとビューポートを初期化する。 */
  async init(mount: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({ background: '#0e0b1a', resizeTo: mount, antialias: true });

    if (this.disposed) {
      app.destroy(true, DESTROY_OPTIONS);
      return;
    }

    mount.appendChild(app.canvas);
    // pixi-viewport の wheel は events.domElement に付く。既定は canvas だが、
    // mount（org-field 内）に限定しないとオーバーレイ上の scroll でも map が zoom する。
    app.renderer.events.setTargetElement(mount);

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

    this.pool = new SpritePool<Graphics>(() => new Graphics(), {
      max: this.opts.spriteBudget,
      reset: (g) => {
        g.clear();
        g.removeAllListeners();
      },
    });

    this.app = app;
    this.viewport = viewport;
  }

  /** viewport の可視範囲を `CameraRect` へ変換する（カリング供給）。 */
  getCameraRect(): CameraRect {
    const vp = this.viewport;
    if (!vp) return { x: 0, y: 0, w: 800, h: 600 };
    return {
      x: vp.left,
      y: vp.top,
      w: vp.worldScreenWidth,
      h: vp.worldScreenHeight,
    };
  }

  /** マウント要素のサイズ変更に追従する。 */
  resize(width: number, height: number): void {
    this.viewport?.resize(width, height, width, height);
  }

  /** DOM 盤面と同サイズの world を画面に収める。内容サイズが変わった時だけ再フィットする。 */
  fitToContent(teams: readonly Team[]): void {
    const vp = this.viewport;
    if (!vp) return;
    const layout = layoutIso(teams, this.opts.isoBase, this.opts.pad);
    if (layout.width <= 0 || layout.height <= 0) return;
    if (this.fittedLayout?.width === layout.width && this.fittedLayout.height === layout.height) return;
    vp.fit(true, layout.width, layout.height);
    vp.moveCenter(layout.width / 2, layout.height / 2);
    this.fittedLayout = { width: layout.width, height: layout.height };
  }

  /** 最新チーム列を viewport カメラで描く（React / pan/zoom 共通入口）。 */
  renderTeams(teams: readonly Team[]): void {
    this.lastTeams = teams;
    this.render({ teams, camera: this.getCameraRect() });
  }

  /** 最新のチーム状態を読んで 1 フレーム描く。init() 前は何もしない。 */
  render(input: PixiOrgInput): void {
    const pool = this.pool;
    if (!pool) return;

    this.layer.removeChildren();
    pool.releaseAll();

    const origin = isoLayoutOrigin(input.teams, this.opts.isoBase, this.opts.pad);
    const sceneOpts: OrgSceneOptions = {
      iso: { ...this.opts.isoBase, ...origin },
      spriteBudget: this.opts.spriteBudget,
      cullMargin: this.opts.cullMargin,
    };

    const plan = planOrgScene(input.teams, input.camera, sceneOpts);
    for (const s of plan.sprites) {
      const g = pool.acquire();
      if (!g) break;

      const halfW = sceneOpts.iso.tileW / 2;
      const halfH = sceneOpts.iso.tileH / 2;
      g.moveTo(0, -halfH);
      g.lineTo(halfW, 0);
      g.lineTo(0, halfH);
      g.lineTo(-halfW, 0);
      g.closePath();
      g.fill({ color: s.tint, alpha: s.isPlayer ? 1 : 0.85 });
      if (s.fire > 0) g.stroke({ color: '#ff5f1f', width: 1 + s.fire * 3 });
      g.position.set(s.x, s.y);

      const onFocus = this.opts.onFocusTeam;
      if (onFocus) {
        g.eventMode = 'static';
        g.cursor = 'pointer';
        g.on('pointertap', () => onFocus(s.teamId));
      }

      this.layer.addChild(g);
    }
  }

  /** WebGL リソースを破棄する。init の解決前でも呼べる（disposed で中断させる）。 */
  dispose(): void {
    this.disposed = true;
    this.pool?.releaseAll();
    this.viewport?.destroy();
    this.app?.destroy(true, DESTROY_OPTIONS);
    this.app = null;
    this.viewport = null;
    this.pool = null;
    this.lastTeams = [];
    this.fittedLayout = null;
  }
}
