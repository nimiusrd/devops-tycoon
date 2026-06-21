/**
 * 全社マップの PixiJS レンダラ「骨組み」（DOM/SVG → PixiJS の局所差し替え。SPEC 第22.4）。
 *
 * 状態を読んで描くだけ（第22.2）。描く内容（位置・深度・色・予算）は純TSの
 * `planOrgScene` が決め、ここは WebGL への反映（スプライトの取得・配置・破棄）
 * だけを受け持つ。スプライトは `iso.ts` の `SpritePool` で再利用し、生成数を
 * 予算内に抑える（第22.5）。
 *
 * ⚠ 実 WebGL は CI/Node で回さない方針（architecture §4.2）。本ファイルは Node
 *    から import できる（型検証のため）が、`init()` / `render()` はブラウザ
 *    （DevContainer の dev サーバをホストブラウザで開く）でのみ呼ぶこと。
 *
 * ローカル（DevContainer）で詰める TODO:
 *  - 仮の Graphics ダイヤ → 健全度別スプライト/テクスチャへ差し替え。
 *  - 炎上(fire)・渋滞の演出（点滅・パーティクル・延焼アニメ）。
 *  - pixi-viewport のズーム/パンと、4階層ズーム遷移（zoomTo 等）の接続。
 *  - 性能予算 DoD の計測（FPS / メモリ / スプライト数 / カリング数）。
 */
import { Application, Container, Graphics } from 'pixi.js';
import { Viewport } from 'pixi-viewport';
import type { Team } from '../../sim/orgscale/types';
import { SpritePool, type CameraRect } from '../iso';
import { planOrgScene, type OrgSceneOptions } from '../orgScene';
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
export interface PixiOrgRendererOptions extends OrgSceneOptions {
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

  constructor(opts: PixiOrgRendererOptions) {
    this.opts = opts;
  }

  /** ブラウザでのみ呼ぶ。WebGL コンテキストとビューポートを初期化する。 */
  async init(mount: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({ background: '#0e0b1a', resizeTo: mount, antialias: true });

    // init は非同期。解決前に dispose された場合（React.StrictMode の二重マウントや
    // 初期化中の画面離脱）は、ここで破棄して中断する。app はまだローカル変数なので
    // dispose() からは触れず、この継続で確実に後始末してリーク（孤児 canvas /
    // WebGL コンテキスト）を防ぐ。
    if (this.disposed) {
      app.destroy(true, DESTROY_OPTIONS);
      return;
    }

    mount.appendChild(app.canvas);

    const viewport = new Viewport({
      events: app.renderer.events,
      screenWidth: mount.clientWidth,
      screenHeight: mount.clientHeight,
    });
    viewport.drag().pinch().wheel().decelerate();
    viewport.addChild(this.layer);
    app.stage.addChild(viewport);

    // スプライトはプールで再利用し、生成数を予算上限に抑える（第22.5）。
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

  /** 最新のチーム状態を読んで 1 フレーム描く。init() 前は何もしない。 */
  render(input: PixiOrgInput): void {
    const pool = this.pool;
    if (!pool) return; // init() 前（または Node からの誤呼び出し）は描画しない。

    // 前フレームのスプライトを全返却してから再利用する。
    this.layer.removeChildren();
    pool.releaseAll();

    const plan = planOrgScene(input.teams, input.camera, this.opts);
    for (const s of plan.sprites) {
      const g = pool.acquire();
      if (!g) break; // 予算上限。planOrgScene と二重の安全弁。

      // TODO(local): 仮ダイヤ。健全度スプライト/テクスチャへ差し替える。
      const halfW = this.opts.iso.tileW / 2;
      const halfH = this.opts.iso.tileH / 2;
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
  }
}
