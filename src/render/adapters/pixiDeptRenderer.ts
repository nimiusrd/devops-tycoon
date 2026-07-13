/**
 * 部署ビューの PixiJS レンダラ（RI-11: Pixi 適用範囲の拡張。SPEC 第22.4）。
 *
 * 状態を読んで描くだけ（第22.2）。描く内容（配置・依存フロー・バナー文言）は純TSの
 * `planDeptBoardScene` が決め、ここは WebGL への反映だけを受け持つ。チームミニ盤面の
 * Container は `iso.ts` の `SpritePool` で再利用し、生成数を予算内に抑える（第22.5）。
 * 全社マップと違い盤面は固定の設計空間（1404×573）なので、viewport（pan/zoom）は
 * 使わず contain-fit の root スケールだけで DOM 版と同じ見え方にする。
 *
 * ⚠ 実 WebGL は CI/Node で回さない方針（architecture §4.2）。本ファイルは Node
 *    から import できる（型検証のため）が、`init()` / `render()` はブラウザでのみ呼ぶこと。
 */
import { Application, Container, Graphics, Rectangle, Text } from 'pixi.js';
import type { DepartmentState } from '../../sim/orgscale/types';
import {
  DEPT_VIEW,
  planDeptBoardScene,
  type DeptBoardScene,
  type DeptFlowPlan,
  type DeptPlatePlan,
  type DeptStageLabelPlan,
  type DeptTeamPlan,
} from '../deptBoardScene';
import {
  BANNER_TONE,
  containFitTransform,
  parseQuadPath,
  pileDotOffsets,
  quadDashPolylines,
  quadEndAngleDeg,
  quadPointAt,
  teamFloorColor,
  teamZoomTransform,
  zoomTransformAt,
  type ContainFitTransform,
} from '../deptPixiView';
import { SpritePool } from '../iso';
import { ensureTexturePoolGuard, releasePixiApp, retainPixiApp } from './pixiTexturePoolGuard';
import type { RendererAdapter } from './index';

/** 破棄オプション（Pixi v8）。`pixiOrgRenderer` と同値。 */
const DESTROY_OPTIONS = { children: true, texture: true, context: true } as const;

/** チームミニ Container の同時描画上限（部門は最大でも 8 チーム前後）。 */
export const DEPT_SPRITE_BUDGET = 16;

const FONT_FAMILY = 'system-ui, sans-serif';
const COLOR_LINE = '#4a3d7a';
const COLOR_TEXT_DIM = '#b9add0';
const COLOR_CREAM = '#ffefd6';
const COLOR_FIRE = '#ff7a2f';

/** DeptPlate（DOM/SVG）と同じ床・側面・グリッドの座標と色。 */
const PLATE = {
  floor: [702, 104, 1262, 384, 702, 664, 142, 384],
  edgeL: [142, 384, 702, 664, 702, 694, 142, 414],
  edgeR: [702, 664, 1262, 384, 1262, 414, 702, 694],
  floorFill: '#2f1b44',
  edgeLFill: '#21112c',
  edgeRFill: '#190c22',
} as const;

/** 描画メトリクス（E2E 安定化・dev 計測用）。 */
export interface DeptRenderMetrics {
  teams: number;
  flows: number;
}

export interface PixiDeptRendererOptions {
  /** チームミニ盤面タップ → 現場へドリルダウン（任意）。 */
  onFocusTeam?: (teamId: string) => void;
  /** dev-only: 直近 render のメトリクス（ブラウザ計測 / E2E 安定化用）。 */
  onRenderMetrics?: (metrics: DeptRenderMetrics) => void;
}

function makeText(style: { fontSize: number; fill: string; bold?: boolean }): Text {
  return new Text({
    text: '',
    style: {
      fontFamily: FONT_FAMILY,
      fontSize: style.fontSize,
      fill: style.fill,
      fontWeight: style.bold ? 'bold' : 'normal',
    },
  });
}

/** 1 チームぶんの子パーツ（プール再利用用）。 */
interface TeamParts {
  /** ミニ盤面（svg ローカル 380×240。pivot=中心）。 */
  mini: Container;
  /** ミニ盤面のベクタ形状（床・机・粒・キャラをまとめて描く）。 */
  gfx: Graphics;
  shelfEmoji: Text;
  codingEmoji: Text;
  reviewEmoji: Text;
  fireEmoji: Text;
  /** バナー（設計座標に直置き。下端中央アンカー）。 */
  banner: Container;
  bannerBg: Graphics;
  bannerTitle: Text;
  bannerSubtitle: Text;
  bannerTagBg: Graphics;
  bannerTag: Text;
  bannerChain: Text;
}

function createTeamContainer(): Container {
  const group = new Container();
  const mini = new Container();
  mini.pivot.set(190, 120);
  const gfx = new Graphics();
  const shelfEmoji = makeText({ fontSize: 11, fill: COLOR_CREAM });
  const codingEmoji = makeText({ fontSize: 9, fill: COLOR_CREAM });
  const reviewEmoji = makeText({ fontSize: 9, fill: COLOR_CREAM });
  const fireEmoji = makeText({ fontSize: 16, fill: COLOR_CREAM });
  mini.addChild(gfx, shelfEmoji, codingEmoji, reviewEmoji, fireEmoji);

  const banner = new Container();
  const bannerBg = new Graphics();
  const bannerTitle = makeText({ fontSize: 13, fill: COLOR_CREAM, bold: true });
  const bannerSubtitle = makeText({ fontSize: 10, fill: COLOR_TEXT_DIM, bold: true });
  const bannerTagBg = new Graphics();
  const bannerTag = makeText({ fontSize: 9.5, fill: COLOR_CREAM });
  const bannerChain = makeText({ fontSize: 10, fill: COLOR_FIRE });
  banner.addChild(bannerBg, bannerTitle, bannerSubtitle, bannerTagBg, bannerTag, bannerChain);
  banner.eventMode = 'none';

  group.addChild(mini, banner);
  for (const child of mini.children) child.eventMode = 'none';
  const parts: TeamParts = {
    mini,
    gfx,
    shelfEmoji,
    codingEmoji,
    reviewEmoji,
    fireEmoji,
    banner,
    bannerBg,
    bannerTitle,
    bannerSubtitle,
    bannerTagBg,
    bannerTag,
    bannerChain,
  };
  (group as Container & { teamParts: TeamParts }).teamParts = parts;
  return group;
}

function getParts(group: Container): TeamParts {
  return (group as Container & { teamParts: TeamParts }).teamParts;
}

function resetTeamContainer(group: Container): void {
  const parts = getParts(group);
  parts.mini.removeAllListeners();
  parts.mini.eventMode = 'auto';
  parts.mini.cursor = 'default';
  parts.mini.hitArea = null;
  parts.mini.scale.set(1);
  parts.gfx.clear();
  parts.bannerBg.clear();
  parts.bannerTagBg.clear();
  for (const t of [
    parts.shelfEmoji,
    parts.codingEmoji,
    parts.reviewEmoji,
    parts.fireEmoji,
    parts.bannerTitle,
    parts.bannerSubtitle,
    parts.bannerTag,
    parts.bannerChain,
  ]) {
    t.text = '';
    t.visible = false;
  }
}

/** 等角の机（DOM `MiniDesk` と同値。(x,y) は天板中心相当）。 */
function drawDesk(g: Graphics, x: number, y: number, tone: 'wood' | 'dark'): void {
  const top = tone === 'dark' ? '#5a4a86' : '#caa06a';
  const left = tone === 'dark' ? '#3a2f66' : '#9a7440';
  const right = tone === 'dark' ? '#2b2050' : '#75561f';
  const ox = x - 30;
  const oy = y - 15;
  g.poly([ox, oy + 15, ox + 30, oy, ox + 60, oy + 15, ox + 30, oy + 30]).fill(top);
  g.poly([ox, oy + 15, ox + 30, oy + 30, ox + 30, oy + 38, ox, oy + 23]).fill(left);
  g.poly([ox + 30, oy + 30, ox + 60, oy + 15, ox + 60, oy + 23, ox + 30, oy + 38]).fill(right);
}

/** Done の棚（DOM `DoneShelf` の形状。📦 は Text で重ねる）。 */
function drawShelf(g: Graphics, x: number, y: number): void {
  const ox = x - 24;
  const oy = y - 12;
  g.poly([ox, oy + 12, ox + 24, oy, ox + 48, oy + 12, ox + 24, oy + 24]).fill('#caa46a');
  g.poly([ox, oy + 12, ox + 24, oy + 24, ox + 24, oy + 36, ox, oy + 24]).fill('#9a7440');
  g.poly([ox + 24, oy + 24, ox + 48, oy + 12, ox + 48, oy + 24, ox + 24, oy + 36]).fill('#75561f');
}

/** 工程の粒山（DOM `pileDots` と同値）。 */
function drawPileDots(g: Graphics, cx: number, cy: number, count: number, hot: boolean): void {
  const fill = hot ? '#ff7a2f' : '#cdbff0';
  for (const d of pileDotOffsets(count)) {
    g.circle(cx + d.x, cy + d.y, d.r).fill({ color: fill, alpha: 0.92 });
  }
}

/** ステーションのキャラ（DOM `stationWorker` と同値。表情は Text で重ねる）。 */
function drawWorker(g: Graphics, x: number, y: number): void {
  g.ellipse(x, y + 14, 10, 12).fill('#7a6cc0');
  g.circle(x, y, 8).fill('#ffe0c4');
  g.circle(x - 3, y + 1, 1.6).fill('#33285c');
  g.circle(x + 3, y + 1, 1.6).fill('#33285c');
}

function moodEmoji(mood: DeptTeamPlan['mood']): string | null {
  if (mood === 'panic') return '💢';
  if (mood === 'tired') return '💦';
  if (mood === 'sad') return '😞';
  return null;
}

/** ミニ盤面（svg ローカル 380×240）をチーム計画から描く。 */
function layoutTeamMini(parts: TeamParts, plan: DeptTeamPlan, deptColor: string): void {
  const g = parts.gfx;
  const { team, lanes, mood } = plan;

  // 連鎖炎上の DOM drop-shadow 相当（橙の淡い下敷き）。
  if (plan.chained) {
    g.ellipse(190, 176, 150, 40).fill({ color: '#ff7a2f', alpha: 0.22 });
  }

  g.ellipse(190, 178, 128, 22).fill({ color: '#0b0712', alpha: 0.3 });
  g.poly([42, 150, 190, 76, 338, 150, 190, 224])
    .fill(teamFloorColor(team.health))
    .stroke({ color: deptColor, width: 1.4 });
  g.poly([42, 150, 190, 224, 190, 236, 42, 162]).fill('#30192e');
  g.poly([190, 224, 338, 150, 338, 162, 190, 236]).fill('#221320');

  // 工程間ミニフロー（Coding→Review / Review→Done）。
  g.moveTo(104, 120)
    .lineTo(150, 138)
    .stroke({ color: lanes[1].hot ? '#ff9a93' : '#b388ff', width: 2.5, alpha: 0.9 });
  g.moveTo(236, 140).lineTo(286, 120).stroke({ color: '#ffd45c', width: 2.5, alpha: 0.85 });

  for (const lane of lanes) {
    if (lane.lane === 'done') {
      drawShelf(g, lane.x, lane.y);
      parts.shelfEmoji.text = '📦';
      parts.shelfEmoji.position.set(lane.x - 24 + 10, lane.y - 12 + 8);
      parts.shelfEmoji.visible = true;
      if (lane.count > 0) drawPileDots(g, lane.x, lane.y - 18, lane.count, false);
      continue;
    }
    drawDesk(g, lane.x, lane.y, lane.lane === 'review' && lane.hot ? 'dark' : 'wood');
    if (lane.count > 0) drawPileDots(g, lane.x, lane.y - 22, lane.count, lane.hot);
  }

  drawWorker(g, 64, 86);
  drawWorker(g, 176, 78);
  const codingFace = moodEmoji(mood);
  if (codingFace) {
    parts.codingEmoji.text = codingFace;
    parts.codingEmoji.position.set(64 + 6, 86 - 12);
    parts.codingEmoji.visible = true;
  }
  const reviewFace = moodEmoji(lanes[1].hot ? 'panic' : mood);
  if (reviewFace) {
    parts.reviewEmoji.text = reviewFace;
    parts.reviewEmoji.position.set(176 + 6, 78 - 12);
    parts.reviewEmoji.visible = true;
  }

  if (team.incidents > 0) {
    parts.fireEmoji.text = '🔥';
    parts.fireEmoji.visible = true;
    parts.fireEmoji.position.set(190 - parts.fireEmoji.width / 2, 98 - parts.fireEmoji.height / 2);
  }
}

/** バナー（下端中央アンカー）をチーム計画から描く。 */
function layoutTeamBanner(parts: TeamParts, plan: DeptTeamPlan): void {
  const tone = BANNER_TONE[plan.banner.tone];
  const padX = 12;
  const lineGap = 2;

  parts.bannerTitle.style.fill = tone.text;
  parts.bannerTitle.text = plan.banner.title;
  parts.bannerTitle.visible = true;
  parts.bannerSubtitle.text = plan.banner.subtitle;
  parts.bannerSubtitle.visible = true;
  parts.bannerTag.style.fill = tone.tagText;
  parts.bannerTag.text = plan.banner.tag;
  parts.bannerTag.visible = true;
  if (plan.chained) {
    parts.bannerChain.text = '⚠ 上流から延焼';
    parts.bannerChain.visible = true;
  }

  const tagW = parts.bannerTag.width + 16;
  const tagH = parts.bannerTag.height + 2;
  const contentW = Math.max(
    parts.bannerTitle.width,
    parts.bannerSubtitle.width,
    tagW,
    plan.chained ? parts.bannerChain.width : 0,
  );
  const w = contentW + padX * 2;
  let h = 5 + parts.bannerTitle.height + lineGap + parts.bannerSubtitle.height + 3 + tagH + 6;
  if (plan.chained) h += 4 + parts.bannerChain.height;

  parts.bannerBg
    .roundRect(-w / 2, -h, w, h, 13)
    .fill({ color: tone.bg, alpha: 0.93 })
    .stroke({ color: tone.border, width: 2, alpha: tone.borderAlpha });

  let y = -h + 5;
  parts.bannerTitle.position.set(-parts.bannerTitle.width / 2, y);
  y += parts.bannerTitle.height + lineGap;
  parts.bannerSubtitle.position.set(-parts.bannerSubtitle.width / 2, y);
  y += parts.bannerSubtitle.height + 3;
  parts.bannerTagBg.roundRect(-tagW / 2, y, tagW, tagH, tagH / 2).fill(tone.tagBg);
  parts.bannerTag.position.set(-parts.bannerTag.width / 2, y + 1);
  y += tagH;
  if (plan.chained) {
    parts.bannerChain.position.set(-parts.bannerChain.width / 2, y + 4);
  }

  parts.banner.position.set(plan.banner.x, plan.banner.y);
}

export class PixiDeptRenderer implements RendererAdapter<DepartmentState> {
  private app: Application | null = null;
  /** contain-fit スケールを受ける設計空間ルート。 */
  private readonly root = new Container();
  private readonly plateGfx = new Graphics();
  private readonly flowsGfx = new Graphics();
  private readonly teamsLayer = new Container();
  private readonly labelsLayer = new Container();
  private labelPills: { pill: Container; bg: Graphics; text: Text }[] = [];
  private pool: SpritePool<Container> | null = null;
  /** dispose 済みフラグ（非同期 init の中断判定）。init/dispose は 1 インスタンス 1 回。 */
  private disposed = false;
  private readonly opts: PixiDeptRendererOptions;
  private lastDept: DepartmentState | null = null;
  /** 直近 resize の host 実寸（ズームトゥイーンの中心計算用）。 */
  private hostW = 0;
  private hostH = 0;
  /** 進行中のズームトゥイーン（RI-04。viewport が無いので root を手動で動かす）。 */
  private zoomTween: {
    from: ContainFitTransform;
    to: ContainFitTransform;
    startMs: number;
    /** true=完走 / false=dispose によるキャンセル。 */
    resolve: (completed: boolean) => void;
  } | null = null;
  private tickerBound = false;

  constructor(opts: PixiDeptRendererOptions = {}) {
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

    this.root.addChild(this.plateGfx, this.flowsGfx, this.teamsLayer, this.labelsLayer);
    app.stage.addChild(this.root);

    this.pool = new SpritePool<Container>(createTeamContainer, {
      max: DEPT_SPRITE_BUDGET,
      reset: resetTeamContainer,
    });

    this.app = app;
    retainPixiApp();
  }

  /** init 済みか（React 側の再描画判定用）。 */
  get isReady(): boolean {
    return this.app !== null;
  }

  /** 盤面（mount）のピクセルサイズへ renderer と contain-fit を合わせる。 */
  resize(boardWidth: number, boardHeight: number): void {
    if (!this.app || boardWidth <= 0 || boardHeight <= 0) return;
    this.app.renderer.resize(boardWidth, boardHeight);
    this.hostW = boardWidth;
    this.hostH = boardHeight;
    // ズームトゥイーン進行中は root を触らない（ticker が毎フレーム上書きする）。
    // スプリント進行中は dept 更新のたびに resize() が呼ばれるため、ここで
    // トゥイーンを破棄するとドリルダウンの完了 promise が永遠に解決しない。
    if (this.zoomTween) return;
    const t = containFitTransform(boardWidth, boardHeight, DEPT_VIEW.w, DEPT_VIEW.h);
    this.root.scale.set(t.scale);
    this.root.position.set(t.x, t.y);
  }

  /**
   * チームミニ盤面へカメラが寄るズームイン演出（RI-04 / SPEC 第4.11）。
   * 部署ビューは viewport を使わない固定盤面のため、contain-fit を基準に
   * root の scale/position を easeOutCubic で手動トゥイーンする。
   * 完走で true、dispose によるキャンセルで false を resolve する。呼び出し側は
   * true のときだけ状態遷移（クロスフェード着地）する（unmount 後の遷移防止）。
   */
  focusTeamZoom(teamId: string, durationMs = 360): Promise<boolean> {
    const app = this.app;
    const dept = this.lastDept;
    if (!app || !dept || this.hostW <= 0 || this.hostH <= 0) return Promise.resolve(true);
    const plan = planDeptBoardScene(dept).teams.find((t) => t.teamId === teamId);
    if (!plan) return Promise.resolve(true);

    const fit = containFitTransform(this.hostW, this.hostH, DEPT_VIEW.w, DEPT_VIEW.h);
    const to = teamZoomTransform(fit, plan.x, plan.y, this.hostW, this.hostH);
    const from: ContainFitTransform = {
      scale: this.root.scale.x,
      x: this.root.position.x,
      y: this.root.position.y,
    };

    if (!this.tickerBound) {
      app.ticker.add(() => this.updateZoomTween(durationMs));
      this.tickerBound = true;
    }
    return new Promise((resolve) => {
      this.zoomTween = { from, to, startMs: performance.now(), resolve };
    });
  }

  /** ticker: ズームトゥイーンを 1 フレーム進める。 */
  private updateZoomTween(durationMs: number): void {
    const tween = this.zoomTween;
    if (!tween) return;
    const t = (performance.now() - tween.startMs) / durationMs;
    const at = zoomTransformAt(t, tween.from, tween.to);
    this.root.scale.set(at.scale);
    this.root.position.set(at.x, at.y);
    if (t >= 1) {
      this.zoomTween = null;
      tween.resolve(true);
    }
  }

  /**
   * 視覚回帰向け: Pixi ticker を止めて 1 フレームだけ描く。
   * 部署ビューの Pixi 描画は時間依存の演出を持たない（破線も静的）が、
   * スクショ直前のフレーム揺れを避けるため E2E から明示的に呼ぶ。
   */
  freezeForScreenshot(): void {
    const app = this.app;
    if (!app) return;
    // 進行中のズームトゥイーンは終端へ飛ばして完走扱いで確定させる（決定論・promise 解決）。
    const tween = this.zoomTween;
    if (tween) {
      this.zoomTween = null;
      this.root.scale.set(tween.to.scale);
      this.root.position.set(tween.to.x, tween.to.y);
      tween.resolve(true);
    }
    app.ticker.stop();
    app.render();
  }

  /** 最新の部門状態を読んで 1 フレーム描く。init() 前は何もしない。 */
  render(dept: DepartmentState): void {
    const pool = this.pool;
    if (!pool || !this.app) return;
    this.lastDept = dept;

    const scene = planDeptBoardScene(dept);
    this.drawPlate(scene.plate);
    this.drawFlows(scene.flows);
    this.drawTeams(scene, dept.def.color);
    this.drawStageLabels(scene.stageLabels);

    this.opts.onRenderMetrics?.({ teams: scene.teams.length, flows: scene.flows.length });
  }

  /** 直近 render に使った部門状態（resize 後の再描画用）。 */
  getLastDept(): DepartmentState | null {
    return this.lastDept;
  }

  /** DeptPlate（床・側面・部門 tint・glow・グリッド）を描く。 */
  private drawPlate(plate: DeptPlatePlan): void {
    const g = this.plateGfx;
    g.clear();
    g.poly([...PLATE.edgeL]).fill(PLATE.edgeLFill);
    g.poly([...PLATE.edgeR]).fill(PLATE.edgeRFill);
    g.poly([...PLATE.floor]).fill(PLATE.floorFill);
    g.poly([...PLATE.floor]).fill({ color: plate.color, alpha: 0.12 });
    if (plate.tone === 'hell') {
      g.poly([...PLATE.floor]).fill({ color: '#ff5a45', alpha: 0.1 });
    }
    if (plate.glow) {
      // SVG の radialGradient を同心楕円 3 枚で近似する。
      const color = plate.glow.kind === 'hell' ? '#ff3b30' : '#57e08f';
      const alpha = plate.glow.kind === 'hell' ? 0.06 : 0.04;
      for (const k of [1, 0.66, 0.33]) {
        g.ellipse(plate.glow.x, plate.glow.y, plate.glow.rx * k, plate.glow.ry * k).fill({
          color,
          alpha,
        });
      }
    }
    // 床グリッド（DeptPlate の path と同じ 80×40 間隔の等角線）。
    for (let i = 0; i <= 7; i += 1) {
      g.moveTo(702 - i * 80, 104 + i * 40).lineTo(1262 - i * 80, 384 + i * 40);
      g.moveTo(702 + i * 80, 104 + i * 40).lineTo(142 + i * 80, 384 + i * 40);
    }
    g.stroke({ color: '#ffffff', alpha: 0.07, width: 1.3 });
  }

  /** チーム間依存フロー（破線ベジェ＋矢じり）を描く。 */
  private drawFlows(flows: readonly DeptFlowPlan[]): void {
    const g = this.flowsGfx;
    g.clear();
    for (const flow of flows) {
      const path = parseQuadPath(flow.d);
      if (!path) continue;
      // CSS stroke-dasharray: 6 9 と同じ破線を静的に描く（決定論・スクショ安定）。
      for (const line of quadDashPolylines(path, 6, 9)) {
        g.moveTo(line[0].x, line[0].y);
        for (let i = 1; i < line.length; i += 1) g.lineTo(line[i].x, line[i].y);
        g.stroke({ color: flow.stroke, width: flow.strokeWidth, alpha: flow.opacity });
      }
      // SVG marker 相当の矢じり（終端の接線向き）。
      const end = quadPointAt(path, 1);
      const rad = (quadEndAngleDeg(path) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const tip = { x: end.x + cos * 4, y: end.y + sin * 4 };
      const back = 8;
      const half = 4;
      g.poly([
        tip.x,
        tip.y,
        tip.x - cos * back - sin * half,
        tip.y - sin * back + cos * half,
        tip.x - cos * back + sin * half,
        tip.y - sin * back - cos * half,
      ]).fill({ color: flow.stroke, alpha: flow.opacity });
    }
  }

  /** チームミニ盤面＋バナーを画家順（depth 昇順）に描く。 */
  private drawTeams(scene: DeptBoardScene, deptColor: string): void {
    const pool = this.pool;
    if (!pool) return;
    this.teamsLayer.removeChildren();
    pool.releaseAll();

    const onFocus = this.opts.onFocusTeam;
    const ordered = [...scene.teams].sort((a, b) => a.depth - b.depth || a.x - b.x);
    for (const plan of ordered) {
      const group = pool.acquire();
      if (!group) break;
      const parts = getParts(group);

      parts.mini.position.set(plan.x, plan.y);
      parts.mini.scale.set(plan.scale);
      layoutTeamMini(parts, plan, deptColor);
      layoutTeamBanner(parts, plan);

      if (onFocus) {
        parts.mini.eventMode = 'static';
        parts.mini.cursor = 'pointer';
        // 床菱形の外接矩形（svg ローカル座標）をタップ領域にする。
        parts.mini.hitArea = new Rectangle(42, 76, 296, 160);
        parts.mini.on('pointertap', () => onFocus(plan.teamId));
      }

      this.teamsLayer.addChild(group);
    }
  }

  /** 工程ラベルのピル（DOM `.dept-stage-label` と同配色）を描く。 */
  private drawStageLabels(labels: readonly DeptStageLabelPlan[]): void {
    while (this.labelPills.length < labels.length) {
      const pill = new Container();
      const bg = new Graphics();
      const text = makeText({ fontSize: 10, fill: COLOR_CREAM, bold: true });
      pill.addChild(bg, text);
      pill.eventMode = 'none';
      this.labelsLayer.addChild(pill);
      this.labelPills.push({ pill, bg, text });
    }
    this.labelPills.forEach((entry, i) => {
      const label = labels[i];
      if (!label) {
        entry.pill.visible = false;
        return;
      }
      entry.pill.visible = true;
      entry.text.style.fill = label.hot ? '#ffd0cb' : COLOR_CREAM;
      entry.text.text = label.label;
      const padX = 8;
      const padY = 2;
      const w = entry.text.width + padX * 2;
      const h = entry.text.height + padY * 2;
      entry.bg
        .clear()
        .roundRect(-w / 2, -h / 2, w, h, h / 2)
        .fill({ color: label.hot ? '#3a1414' : '#1f1942', alpha: 0.8 })
        .stroke({
          color: label.hot ? '#ff5f57' : COLOR_LINE,
          width: 1,
          alpha: label.hot ? 0.53 : 1,
        });
      entry.text.position.set(-entry.text.width / 2, -entry.text.height / 2);
      entry.pill.position.set(label.x, label.y);
    });
  }

  /** WebGL リソースを破棄する。init の解決前でも呼べる（disposed で中断させる）。 */
  dispose(): void {
    this.disposed = true;
    // 進行中トゥイーンは「キャンセル」として解放する（await 側のハング防止。
    // 成功扱いにすると unmount 後に onFocusTeam の画面遷移が走ってしまう）。
    this.zoomTween?.resolve(false);
    this.zoomTween = null;
    // CanvasText の unload（TexturePool への返却）は renderer 破棄前に済ませる。
    // app.destroy 後だと TexturePool が先に消え、pipe の後始末が
    // `returnTexture` で落ちる（free に残った未接続スプライトの Text が対象）。
    for (const group of this.pool?.drain() ?? []) {
      group.destroy({ children: true });
    }
    // 自分を生存数から外してから destroy する（共有プール purge の可否判定）。
    if (this.app) releasePixiApp();
    this.app?.destroy(true, DESTROY_OPTIONS);
    this.app = null;
    this.pool = null;
    this.labelPills = [];
    this.lastDept = null;
  }
}
