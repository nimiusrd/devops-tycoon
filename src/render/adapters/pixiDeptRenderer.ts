/**
 * 部署ビューの PixiJS レンダラ（RI-11 / SPEC 第22.4）。
 *
 * `planDeptBoardScene` を読んで Graphics/Text へ反映するだけ（第22.2）。
 * 実 WebGL はブラウザでのみ初期化する（CI/Node では init しない）。
 */
import { Application, Container, Graphics, Rectangle, Text } from 'pixi.js';
import type { DepartmentState } from '../../sim/orgscale/types';
import {
  DEPT_VIEW,
  planDeptBoardScene,
  TEAM_MINI_DESIGN_W,
  type DeptBoardScene,
  type DeptFlowPlan,
  type DeptTeamPlan,
} from '../deptBoardScene';
import { SpritePool } from '../iso';
import type { RendererAdapter } from './index';

const DESTROY_OPTIONS = { children: true, texture: true, context: true } as const;

const TEAM_MINI_H = 240;
const COLOR_BG = '#160f2e';
const COLOR_TEXT = '#f0e8ff';
const COLOR_TEXT_DIM = '#b9add0';
const COLOR_SUN = '#ffd45c';
const COLOR_FIRE = '#ff7a2f';

/** 同時描画チーム Container 上限（部署は少数だがプール予算を明示）。 */
export const DEPT_SPRITE_BUDGET = 24;

export interface PixiDeptInput {
  dept: DepartmentState;
}

export interface PixiDeptRendererOptions {
  spriteBudget?: number;
  onFocusTeam?: (teamId: string) => void;
  onPlanMetrics?: (metrics: DeptPixiMetrics) => void;
}

export interface DeptPixiMetrics {
  teams: number;
  flows: number;
  stageLabels: number;
  sprites: number;
}

interface TeamParts {
  plate: Graphics;
  desks: Graphics;
  dots: Graphics;
  workers: Graphics;
  bannerBg: Graphics;
  title: Text;
  subtitle: Text;
  tag: Text;
  chain: Text;
  fire: Text;
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

function createTeamContainer(): Container {
  const container = new Container();
  const parts: TeamParts = {
    plate: new Graphics(),
    desks: new Graphics(),
    dots: new Graphics(),
    workers: new Graphics(),
    bannerBg: new Graphics(),
    title: makeText({ fontSize: 13, fill: COLOR_TEXT, bold: true, align: 'center' }),
    subtitle: makeText({ fontSize: 10, fill: COLOR_TEXT_DIM, align: 'center' }),
    tag: makeText({ fontSize: 10, fill: COLOR_SUN, bold: true, align: 'center' }),
    chain: makeText({ fontSize: 10, fill: COLOR_FIRE, bold: true, align: 'center' }),
    fire: makeText({ fontSize: 16, fill: COLOR_FIRE, align: 'center' }),
  };
  container.addChild(
    parts.plate,
    parts.desks,
    parts.dots,
    parts.workers,
    parts.bannerBg,
    parts.title,
    parts.subtitle,
    parts.tag,
    parts.chain,
    parts.fire,
  );
  for (const child of container.children) {
    child.eventMode = 'none';
  }
  (container as Container & { teamParts: TeamParts }).teamParts = parts;
  return container;
}

function getTeamParts(container: Container): TeamParts {
  return (container as Container & { teamParts: TeamParts }).teamParts;
}

/** SVG 二次ベジェ `M x,y Q cx,cy ex,ey` を描画する。 */
export function strokeQuadraticPath(
  g: Graphics,
  d: string,
  stroke: string,
  strokeWidth: number,
  alpha: number,
): void {
  const m = d.match(
    /^M\s*([-\d.]+)\s*,\s*([-\d.]+)\s*Q\s*([-\d.]+)\s*,\s*([-\d.]+)\s+([-\d.]+)\s*,\s*([-\d.]+)/i,
  );
  if (!m) return;
  const sx = Number(m[1]);
  const sy = Number(m[2]);
  const cx = Number(m[3]);
  const cy = Number(m[4]);
  const ex = Number(m[5]);
  const ey = Number(m[6]);
  g.moveTo(sx, sy);
  g.quadraticCurveTo(cx, cy, ex, ey);
  g.stroke({ width: strokeWidth, color: stroke, alpha });
}

/** シーン計画から描画予算メトリクスを純関数で見積もる（Vitest 用）。 */
export function estimateDeptPixiMetrics(scene: DeptBoardScene): DeptPixiMetrics {
  return {
    teams: scene.teams.length,
    flows: scene.flows.length,
    stageLabels: scene.stageLabels.length,
    sprites: scene.teams.length,
  };
}

function drawMiniDesk(g: Graphics, x: number, y: number, dark: boolean): void {
  const top = dark ? 0x5a4a86 : 0xcaa06a;
  const left = dark ? 0x3a2f66 : 0x9a7440;
  const right = dark ? 0x2b2050 : 0x75561f;
  const ox = x - 30;
  const oy = y - 15;
  g.poly([ox, oy + 15, ox + 30, oy, ox + 60, oy + 15, ox + 30, oy + 30], true);
  g.fill({ color: top });
  g.poly([ox, oy + 15, ox + 30, oy + 30, ox + 30, oy + 38, ox, oy + 23], true);
  g.fill({ color: left });
  g.poly([ox + 30, oy + 30, ox + 60, oy + 15, ox + 60, oy + 23, ox + 30, oy + 38], true);
  g.fill({ color: right });
}

function drawDoneShelf(g: Graphics, x: number, y: number): void {
  const ox = x - 24;
  const oy = y - 12;
  g.poly([ox, oy + 12, ox + 24, oy, ox + 48, oy + 12, ox + 24, oy + 24], true);
  g.fill({ color: 0xcaa46a });
  g.poly([ox, oy + 12, ox + 24, oy + 24, ox + 24, oy + 36, ox, oy + 24], true);
  g.fill({ color: 0x9a7440 });
  g.poly([ox + 24, oy + 24, ox + 48, oy + 12, ox + 48, oy + 24, ox + 24, oy + 36], true);
  g.fill({ color: 0x75561f });
}

function drawPileDots(g: Graphics, cx: number, cy: number, count: number, hot: boolean): void {
  const cap = Math.min(count, 12);
  const perRow = 4;
  const fill = hot ? 0xff7a2f : 0xcdbff0;
  const r = count > 8 ? 5 : 6;
  for (let i = 0; i < cap; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    g.circle(cx + (col - 1.5) * 10, cy - row * 9, r);
    g.fill({ color: fill, alpha: 0.92 });
  }
}

function drawWorker(g: Graphics, x: number, y: number): void {
  g.ellipse(x, y + 14, 10, 12);
  g.fill({ color: 0x7a6cc0 });
  g.circle(x, y, 8);
  g.fill({ color: 0xffe0c4 });
  g.circle(x - 3, y + 1, 1.6);
  g.fill({ color: 0x33285c });
  g.circle(x + 3, y + 1, 1.6);
  g.fill({ color: 0x33285c });
}

function paintTeam(parts: TeamParts, plan: DeptTeamPlan, deptColor: string): void {
  const { team, lanes } = plan;
  const floor =
    team.health === 'reviewHell' ? 0x4a2b45 : team.health === 'congested' ? 0x3f3470 : 0x3a2f68;

  parts.plate.clear();
  parts.desks.clear();
  parts.dots.clear();
  parts.workers.clear();
  parts.bannerBg.clear();

  // ミニ盤面はローカル 380×240。Container をチーム中心へ置き scale する。
  const localW = TEAM_MINI_DESIGN_W;
  const localH = TEAM_MINI_H;
  const ox = -localW / 2;
  const oy = -localH / 2;

  parts.plate.ellipse(0, oy + 178, 128, 22);
  parts.plate.fill({ color: 0x0b0712, alpha: 0.3 });
  parts.plate.poly(
    [ox + 42, oy + 150, ox + 190, oy + 76, ox + 338, oy + 150, ox + 190, oy + 224],
    true,
  );
  parts.plate.fill({ color: floor });
  parts.plate.stroke({ width: 1.4, color: deptColor });
  parts.plate.poly(
    [ox + 42, oy + 150, ox + 190, oy + 224, ox + 190, oy + 236, ox + 42, oy + 162],
    true,
  );
  parts.plate.fill({ color: 0x30192e });
  parts.plate.poly(
    [ox + 190, oy + 224, ox + 338, oy + 150, ox + 338, oy + 162, ox + 190, oy + 236],
    true,
  );
  parts.plate.fill({ color: 0x221320 });

  const reviewHot = lanes[1]?.hot ?? false;
  parts.desks.moveTo(ox + 104, oy + 120);
  parts.desks.lineTo(ox + 150, oy + 138);
  parts.desks.stroke({
    width: 2.5,
    color: reviewHot ? 0xff9a93 : 0xb388ff,
    alpha: 0.9,
  });
  parts.desks.moveTo(ox + 236, oy + 140);
  parts.desks.lineTo(ox + 286, oy + 120);
  parts.desks.stroke({ width: 2.5, color: 0xffd45c, alpha: 0.85 });

  for (const lane of lanes) {
    const lx = ox + lane.x;
    const ly = oy + lane.y;
    if (lane.lane === 'done') {
      drawDoneShelf(parts.desks, lx, ly);
      if (lane.count > 0) drawPileDots(parts.dots, lx, ly - 18, lane.count, false);
    } else {
      drawMiniDesk(parts.desks, lx, ly, lane.lane === 'review' && lane.hot);
      if (lane.count > 0) drawPileDots(parts.dots, lx, ly - 22, lane.count, lane.hot);
      if (lane.lane === 'coding') drawWorker(parts.workers, ox + 64, oy + 86);
      if (lane.lane === 'review') drawWorker(parts.workers, ox + 176, oy + 78);
    }
  }

  parts.fire.visible = team.incidents > 0;
  if (team.incidents > 0) {
    parts.fire.text = '🔥';
    parts.fire.anchor.set(0.5, 0.5);
    parts.fire.position.set(0, oy + 98);
  }

  // バナーはミニ盤面の上（ローカル座標で負の Y）。
  const bannerW = 200;
  const bannerH = plan.chained ? 72 : 56;
  const by = oy - 8 - bannerH;
  const toneFill =
    plan.banner.tone === 'hell' ? 0x4a2038 : plan.banner.tone === 'warn' ? 0x3a3058 : 0x241a44;
  parts.bannerBg.roundRect(-bannerW / 2, by, bannerW, bannerH, 10);
  parts.bannerBg.fill({ color: toneFill, alpha: 0.92 });
  parts.bannerBg.stroke({
    width: 2,
    color:
      plan.banner.tone === 'hell' ? 0xff7a2f : plan.banner.tone === 'warn' ? 0xffd45c : 0x6b4a9e,
  });

  parts.title.text = plan.banner.title;
  parts.title.anchor.set(0.5, 0);
  parts.title.position.set(0, by + 6);

  parts.subtitle.text = plan.banner.subtitle;
  parts.subtitle.anchor.set(0.5, 0);
  parts.subtitle.position.set(0, by + 24);

  parts.tag.text = plan.banner.tag;
  parts.tag.anchor.set(0.5, 0);
  parts.tag.position.set(0, by + 40);

  parts.chain.visible = plan.chained;
  if (plan.chained) {
    parts.chain.text = '⚠ 上流から延焼';
    parts.chain.anchor.set(0.5, 0);
    parts.chain.position.set(0, by + 54);
  }
}

function paintPlate(g: Graphics, scene: DeptBoardScene): void {
  g.clear();
  // 側面
  g.poly([142, 384, 702, 664, 702, 694, 142, 414], true);
  g.fill({ color: 0x2a1636 });
  g.poly([702, 664, 1262, 384, 1262, 414, 702, 694], true);
  g.fill({ color: 0x20102c });
  // 上面
  g.poly([702, 104, 1262, 384, 702, 664, 142, 384], true);
  g.fill({ color: 0x3a2350 });
  // 部門色ティント
  g.poly([702, 104, 1262, 384, 702, 664, 142, 384], true);
  g.fill({ color: scene.plate.color, alpha: 0.12 });
  if (scene.plate.tone === 'hell') {
    g.poly([702, 104, 1262, 384, 702, 664, 142, 384], true);
    g.fill({ color: 0xff5a45, alpha: 0.1 });
  }
  if (scene.plate.glow) {
    const { x, y, rx, ry, kind } = scene.plate.glow;
    g.ellipse(x, y, rx, ry);
    g.fill({ color: kind === 'hell' ? 0xff3b30 : 0x57e08f, alpha: kind === 'hell' ? 0.12 : 0.08 });
  }
}

function paintFlows(g: Graphics, flows: readonly DeptFlowPlan[]): void {
  g.clear();
  for (const flow of flows) {
    strokeQuadraticPath(g, flow.d, flow.stroke, flow.strokeWidth, flow.opacity);
  }
}

export class PixiDeptRenderer implements RendererAdapter<PixiDeptInput> {
  private app: Application | null = null;
  private readonly world = new Container();
  private readonly plateLayer = new Graphics();
  private readonly flowLayer = new Graphics();
  private readonly labelLayer = new Container();
  private readonly teamLayer = new Container();
  private readonly hintText: Text;
  private pool: SpritePool<Container> | null = null;
  private disposed = false;
  private readonly opts: PixiDeptRendererOptions;
  private lastDept: DepartmentState | null = null;
  private worldScale = 1;
  private offsetX = 0;
  private offsetY = 0;

  constructor(opts: PixiDeptRendererOptions = {}) {
    this.opts = opts;
    this.hintText = makeText({ fontSize: 12, fill: COLOR_TEXT_DIM, align: 'center' });
    this.hintText.text = 'チームの島をクリックでそのチームの現場（能動操作）へ';
    this.hintText.anchor.set(0.5, 1);
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

    this.world.addChild(this.plateLayer, this.flowLayer, this.labelLayer, this.teamLayer);
    this.world.eventMode = 'passive';
    app.stage.addChild(this.world);
    app.stage.addChild(this.hintText);

    this.pool = new SpritePool<Container>(createTeamContainer, {
      max: this.opts.spriteBudget ?? DEPT_SPRITE_BUDGET,
      reset: (c) => {
        c.removeAllListeners();
        c.eventMode = 'auto';
        c.cursor = 'default';
        c.position.set(0, 0);
        c.scale.set(1);
        c.hitArea = null;
        const parts = getTeamParts(c);
        parts.plate.clear();
        parts.desks.clear();
        parts.dots.clear();
        parts.workers.clear();
        parts.bannerBg.clear();
        parts.title.text = '';
        parts.subtitle.text = '';
        parts.tag.text = '';
        parts.chain.text = '';
        parts.chain.visible = false;
        parts.fire.text = '';
        parts.fire.visible = false;
      },
    });

    this.app = app;
    this.resize(mount.clientWidth, mount.clientHeight);
  }

  get isReady(): boolean {
    return this.app !== null;
  }

  /** 視覚回帰向けに ticker を止め、最終フレームを描く。 */
  freezeForScreenshot(): void {
    const app = this.app;
    if (!app) return;
    app.ticker.stop();
    app.render();
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.app?.renderer.resize(width, height);
    const sx = width / DEPT_VIEW.w;
    const sy = height / DEPT_VIEW.h;
    this.worldScale = Math.min(sx, sy);
    this.offsetX = (width - DEPT_VIEW.w * this.worldScale) / 2;
    this.offsetY = (height - DEPT_VIEW.h * this.worldScale) / 2;
    this.world.scale.set(this.worldScale);
    this.world.position.set(this.offsetX, this.offsetY);
    this.hintText.position.set(width / 2, height - 10);
    this.hintText.style.fontSize = Math.max(10, 12 * this.worldScale);
  }

  renderDept(dept: DepartmentState): void {
    this.lastDept = dept;
    this.render({ dept });
  }

  render(input: PixiDeptInput): void {
    const pool = this.pool;
    const app = this.app;
    if (!pool || !app) return;

    const scene = planDeptBoardScene(input.dept);
    const metrics = estimateDeptPixiMetrics(scene);
    this.opts.onPlanMetrics?.(metrics);

    paintPlate(this.plateLayer, scene);
    paintFlows(this.flowLayer, scene.flows);

    this.labelLayer.removeChildren();
    for (const label of scene.stageLabels) {
      const t = makeText({
        fontSize: 13,
        fill: label.hot ? COLOR_FIRE : COLOR_TEXT,
        bold: true,
        align: 'center',
      });
      t.text = label.label;
      t.anchor.set(0.5, 0.5);
      t.position.set(label.x, label.y);
      this.labelLayer.addChild(t);
    }

    this.teamLayer.removeChildren();
    pool.releaseAll();

    const sorted = [...scene.teams].sort((a, b) => a.depth - b.depth);
    for (const plan of sorted) {
      const c = pool.acquire();
      if (!c) break;
      const parts = getTeamParts(c);
      paintTeam(parts, plan, scene.plate.color);
      c.position.set(plan.x, plan.y);
      c.scale.set(plan.scale);
      c.eventMode = 'static';
      c.cursor = 'pointer';
      const hitW = TEAM_MINI_DESIGN_W;
      const hitH = TEAM_MINI_H + 80;
      c.hitArea = new Rectangle(-hitW / 2, -hitH / 2 - 40, hitW, hitH);
      c.removeAllListeners();
      c.on('pointertap', () => this.opts.onFocusTeam?.(plan.teamId));
      this.teamLayer.addChild(c);
    }
  }

  /** プール統計（Vitest / dev 計測）。 */
  getPoolStats(): { created: number; reuse: number; active: number } | null {
    const pool = this.pool;
    if (!pool) return null;
    return {
      created: pool.createdCount,
      reuse: pool.reuseCount,
      active: pool.activeCount,
    };
  }

  getLastDept(): DepartmentState | null {
    return this.lastDept;
  }

  dispose(): void {
    this.disposed = true;
    this.pool?.releaseAll();
    this.pool = null;
    this.app?.destroy(true, DESTROY_OPTIONS);
    this.app = null;
  }
}
