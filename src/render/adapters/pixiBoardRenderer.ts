/**
 * スプリント盤面の PixiJS レンダラ（RI-11 / SPEC 第22.4）。
 *
 * `planBoardScene` を読んで Graphics/Text へ反映するだけ（第22.2）。
 * 延焼・介入演出は DOM オーバーレイのまま（Board.tsx）。
 * 実 WebGL はブラウザでのみ初期化する。
 */
import { Application, Container, Graphics, Text } from 'pixi.js';
import type { Task } from '../../sim/types';
import {
  BOARD_VIEW,
  planBoardScene,
  type BoardDotPlan,
  type BoardFlow,
  type BoardScenePlan,
  type BoardStationPlan,
} from '../boardScene';
import { SpritePool } from '../iso';
import { TASK_COLORS, TASK_DIAMETER } from '../taskView';
import type { RendererAdapter } from './index';

const DESTROY_OPTIONS = { children: true, texture: true, context: true } as const;

const COLOR_BG = '#1c1438';
const COLOR_TEXT = '#f0e8ff';
const COLOR_TEXT_DIM = '#b9add0';
const COLOR_HOT = '#ff7a2f';

/** タスク粒プール上限（cap 合計 + 流動粒の余裕）。 */
export const BOARD_DOT_BUDGET = 120;

export interface PixiBoardInput {
  tasks: readonly Task[];
}

export interface PixiBoardRendererOptions {
  spriteBudget?: number;
  onPlanMetrics?: (metrics: BoardPixiMetrics) => void;
}

export interface BoardPixiMetrics {
  dots: number;
  stations: number;
  flows: number;
  sprites: number;
}

interface DotParts {
  body: Graphics;
  flame: Text;
}

function makeText(style: {
  fontSize: number;
  fill: string;
  bold?: boolean;
  align?: 'left' | 'center';
}): Text {
  return new Text({
    text: '',
    style: {
      fontFamily: 'system-ui, sans-serif',
      fontSize: style.fontSize,
      fill: style.fill,
      fontWeight: style.bold ? 'bold' : 'normal',
      align: style.align ?? 'left',
    },
  });
}

function createDotContainer(): Container {
  const container = new Container();
  const parts: DotParts = {
    body: new Graphics(),
    flame: makeText({ fontSize: 12, fill: COLOR_HOT, align: 'center' }),
  };
  parts.flame.anchor.set(0.5, 1);
  container.addChild(parts.body, parts.flame);
  for (const child of container.children) {
    child.eventMode = 'none';
  }
  (container as Container & { dotParts: DotParts }).dotParts = parts;
  return container;
}

function getDotParts(container: Container): DotParts {
  return (container as Container & { dotParts: DotParts }).dotParts;
}

/** シーン計画から描画予算メトリクスを純関数で見積もる（Vitest 用）。 */
export function estimateBoardPixiMetrics(scene: BoardScenePlan): BoardPixiMetrics {
  return {
    dots: scene.dots.length,
    stations: scene.stations.length,
    flows: scene.flows.length,
    sprites: scene.dots.length,
  };
}

function paintOfficeRoom(g: Graphics): void {
  g.clear();
  // 左壁
  g.poly([702, 6, 142, 286, 142, 398, 702, 118], true);
  g.fill({ color: 0x3a2f68 });
  // 右壁
  g.poly([702, 6, 1262, 286, 1262, 398, 702, 118], true);
  g.fill({ color: 0x2e2552 });
  // 床
  g.poly([702, 118, 1262, 398, 702, 678, 142, 398], true);
  g.fill({ color: 0x3b2f66 });
  // 窓（簡略）
  g.poly([903.6, 120.2, 1138.8, 237.8, 1138.8, 298.3, 903.6, 180.7], true);
  g.fill({ color: 0x1d1640 });
  g.poly([909.2, 125.3, 1133.2, 237.3, 1133.2, 293.3, 909.2, 181.3], true);
  g.fill({ color: 0xff9e7a });
  g.circle(1082.8, 230, 17);
  g.fill({ color: 0xfff0c0, alpha: 0.9 });
  // スラブ（中央作業島の簡略）
  g.poly([520, 250, 860, 250, 920, 340, 460, 340], true);
  g.fill({ color: 0x2a2150, alpha: 0.55 });
}

function paintFlows(g: Graphics, flows: readonly BoardFlow[]): void {
  g.clear();
  for (const f of flows) {
    g.moveTo(f.x1, f.y1);
    g.lineTo(f.x2, f.y2);
    g.stroke({
      width: f.rework ? 2.5 : 3.5,
      color: f.rework ? 0xff9a93 : 0xcdbff0,
      alpha: f.rework ? 0.6 : 0.85,
    });
    // 簡易矢印頭
    const dx = f.x2 - f.x1;
    const dy = f.y2 - f.y1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const tipX = f.x2;
    const tipY = f.y2;
    const baseX = tipX - ux * 10;
    const baseY = tipY - uy * 10;
    g.poly([tipX, tipY, baseX + px * 4, baseY + py * 4, baseX - px * 4, baseY - py * 4], true);
    g.fill({ color: f.rework ? 0xff9a93 : 0xcdbff0, alpha: f.rework ? 0.6 : 0.85 });
  }
}

function paintStationActor(g: Graphics, s: BoardStationPlan): void {
  const x = s.x;
  const y = s.y;
  // 机
  g.poly([x - 36, y + 8, x, y - 10, x + 36, y + 8, x, y + 26], true);
  g.fill({ color: s.hot ? 0x5a4a86 : 0xcaa06a });
  g.poly([x - 36, y + 8, x, y + 26, x, y + 34, x - 36, y + 16], true);
  g.fill({ color: s.hot ? 0x3a2f66 : 0x9a7440 });
  g.poly([x, y + 26, x + 36, y + 8, x + 36, y + 16, x, y + 34], true);
  g.fill({ color: s.hot ? 0x2b2050 : 0x75561f });
  // キャラ
  const body =
    s.mood === 'panic' ? 0xe04b40 : s.mood === 'happy' || s.mood === 'cheer' ? 0x57e08f : 0x7a6cc0;
  g.ellipse(x, y - 8, 12, 14);
  g.fill({ color: body });
  g.circle(x, y - 24, 10);
  g.fill({ color: 0xffe0c4 });
}

function paintDot(parts: DotParts, dot: BoardDotPlan): void {
  parts.body.clear();
  const d = TASK_DIAMETER[dot.size];
  const r = d / 2;
  parts.body.circle(0, 0, r);
  parts.body.fill({ color: TASK_COLORS[dot.variant] });
  if (dot.burnUrgency !== undefined) {
    parts.body.circle(0, 0, r + 2);
    parts.body.stroke({
      width: 2,
      color: COLOR_HOT,
      alpha: 0.35 + (1 - dot.burnUrgency) * 0.45,
    });
  }
  parts.flame.visible = !!dot.fire;
  if (dot.fire) {
    parts.flame.text = '🔥';
    parts.flame.position.set(0, -r);
    const urg = dot.burnUrgency ?? 1;
    parts.flame.style.fontSize = 10 + (1 - urg) * 6;
  }
}

export class PixiBoardRenderer implements RendererAdapter<PixiBoardInput> {
  private app: Application | null = null;
  private readonly world = new Container();
  private readonly roomLayer = new Graphics();
  private readonly flowLayer = new Graphics();
  private readonly stationGfx = new Graphics();
  private readonly stationLabelLayer = new Container();
  private readonly dotLayer = new Container();
  private readonly overlayLabelLayer = new Container();
  private pool: SpritePool<Container> | null = null;
  private disposed = false;
  private readonly opts: PixiBoardRendererOptions;
  private lastTasks: readonly Task[] = [];
  private worldScale = 1;
  private offsetX = 0;
  private offsetY = 0;
  private frozen = false;

  constructor(opts: PixiBoardRendererOptions = {}) {
    this.opts = opts;
  }

  async init(mount: HTMLElement): Promise<void> {
    const app = new Application();
    await app.init({
      background: COLOR_BG,
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

    this.world.addChild(
      this.roomLayer,
      this.flowLayer,
      this.stationGfx,
      this.stationLabelLayer,
      this.dotLayer,
      this.overlayLabelLayer,
    );
    app.stage.addChild(this.world);

    this.pool = new SpritePool<Container>(createDotContainer, {
      max: this.opts.spriteBudget ?? BOARD_DOT_BUDGET,
      reset: (c) => {
        c.position.set(0, 0);
        const parts = getDotParts(c);
        parts.body.clear();
        parts.flame.text = '';
        parts.flame.visible = false;
      },
    });

    this.app = app;
    paintOfficeRoom(this.roomLayer);
    this.resize(mount.clientWidth, mount.clientHeight);
  }

  get isReady(): boolean {
    return this.app !== null;
  }

  freezeForScreenshot(): void {
    const app = this.app;
    if (!app) return;
    this.frozen = true;
    app.ticker.stop();
    if (this.lastTasks.length > 0) this.renderTasks(this.lastTasks);
    app.render();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.app?.renderer.resize(width, height);
    const sx = width / BOARD_VIEW.w;
    const sy = height / BOARD_VIEW.h;
    this.worldScale = Math.min(sx, sy);
    this.offsetX = (width - BOARD_VIEW.w * this.worldScale) / 2;
    this.offsetY = (height - BOARD_VIEW.h * this.worldScale) / 2;
    this.world.scale.set(this.worldScale);
    this.world.position.set(this.offsetX, this.offsetY);
  }

  renderTasks(tasks: readonly Task[]): void {
    this.lastTasks = tasks;
    this.render({ tasks });
  }

  render(input: PixiBoardInput): void {
    const pool = this.pool;
    const app = this.app;
    if (!pool || !app) return;

    const scene = planBoardScene([...input.tasks]);
    const metrics = estimateBoardPixiMetrics(scene);
    this.opts.onPlanMetrics?.(metrics);

    paintFlows(this.flowLayer, scene.flows);

    this.stationGfx.clear();
    for (const s of scene.stations) {
      paintStationActor(this.stationGfx, s);
    }

    this.stationLabelLayer.removeChildren();
    for (const s of scene.stations) {
      const label = makeText({
        fontSize: 13,
        fill: s.hot ? COLOR_HOT : COLOR_TEXT,
        bold: true,
        align: 'center',
      });
      label.text = `${s.icon} ${s.label} ${s.count}${s.hot ? ' ⚠' : ''}`;
      label.anchor.set(0.5, 0.5);
      label.position.set(s.labelX, s.labelY);
      this.stationLabelLayer.addChild(label);

      if (s.bubble) {
        const bubble = makeText({
          fontSize: 11,
          fill: COLOR_TEXT,
          align: 'center',
        });
        bubble.text = s.bubble;
        bubble.anchor.set(0.5, 0.5);
        bubble.position.set(s.bubbleX, s.bubbleY);
        this.stationLabelLayer.addChild(bubble);
      }
    }

    this.overlayLabelLayer.removeChildren();
    for (const s of scene.stations) {
      if (s.overflow <= 0) continue;
      const of = makeText({ fontSize: 14, fill: COLOR_HOT, bold: true, align: 'center' });
      of.text = `+${s.overflow}`;
      of.anchor.set(0.5, 0.5);
      of.position.set(s.overflowX, s.overflowY);
      this.overlayLabelLayer.addChild(of);
    }

    // 凡例
    const legend = makeText({ fontSize: 11, fill: COLOR_TEXT_DIM, align: 'left' });
    legend.text = 'AI利用 / 手戻り / 高価値 / 技術的負債 / 炎上';
    legend.position.set(24, BOARD_VIEW.h - 28);
    this.overlayLabelLayer.addChild(legend);

    this.dotLayer.removeChildren();
    pool.releaseAll();
    for (const dot of scene.dots) {
      const c = pool.acquire();
      if (!c) break;
      const parts = getDotParts(c);
      paintDot(parts, dot);
      c.position.set(dot.x, dot.y);
      this.dotLayer.addChild(c);
    }
  }

  getPoolStats(): { created: number; reuse: number; active: number } | null {
    const pool = this.pool;
    if (!pool) return null;
    return {
      created: pool.createdCount,
      reuse: pool.reuseCount,
      active: pool.activeCount,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.frozen = false;
    this.pool?.releaseAll();
    this.pool = null;
    this.app?.destroy(true, DESTROY_OPTIONS);
    this.app = null;
  }
}
