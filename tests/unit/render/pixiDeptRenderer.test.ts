import type { Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameAssetId } from '../../../src/data/assets';
import { aggregateDepartment } from '../../../src/sim/orgscale/aggregate';
import type { Team } from '../../../src/sim/orgscale/types';
import { DEPT_VIEW, planDeptBoardScene } from '../../../src/render/deptBoardScene';
import {
  containFitTransform,
  teamMiniRenderScale,
  teamZoomTransform,
  zoomTransformAt,
} from '../../../src/render/deptPixiView';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';
import {
  DEPT_SPRITE_BUDGET,
  PixiDeptRenderer,
} from '../../../src/render/adapters/pixiDeptRenderer';

// GPU 境界だけを置き換える。シーン計画・座標変換・SpritePool は実物を通す。
const pixi = vi.hoisted(() => {
  function point(initial = 0) {
    return {
      x: initial,
      y: initial,
      set(x: number, y = x) {
        this.x = x;
        this.y = y;
      },
    };
  }

  class Container {
    children: Container[] = [];
    parent: Container | null = null;
    position = point();
    scale = point(1);
    pivot = point();
    visible = true;
    eventMode = 'auto';
    cursor = 'default';
    hitArea: unknown = null;
    listeners = new Map<string, (() => void)[]>();
    addChild(...children: Container[]) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
      return children[0];
    }
    removeChildren() {
      const removed = this.children.splice(0);
      for (const child of removed) child.parent = null;
      return removed;
    }
    on(event: string, listener: () => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
      return this;
    }
    emit(event: string) {
      for (const listener of this.listeners.get(event) ?? []) listener();
    }
    removeAllListeners() {
      this.listeners.clear();
    }
    destroy = vi.fn((options?: { children?: boolean }) => {
      if (this.parent) {
        const siblings = this.parent.children;
        siblings.splice(siblings.indexOf(this), 1);
        this.parent = null;
      }
      if (options?.children) {
        for (const child of [...this.children]) child.destroy(options);
      }
    });
  }

  class Graphics extends Container {
    commands: { op: string; args: unknown[] }[] = [];
    record(op: string, args: unknown[]) {
      this.commands.push({ op, args });
      return this;
    }
    clear() {
      this.commands = [];
      return this;
    }
    poly(...args: unknown[]) {
      return this.record('poly', args);
    }
    fill(...args: unknown[]) {
      return this.record('fill', args);
    }
    stroke(...args: unknown[]) {
      return this.record('stroke', args);
    }
    ellipse(...args: unknown[]) {
      return this.record('ellipse', args);
    }
    circle(...args: unknown[]) {
      return this.record('circle', args);
    }
    moveTo(...args: unknown[]) {
      return this.record('moveTo', args);
    }
    lineTo(...args: unknown[]) {
      return this.record('lineTo', args);
    }
    roundRect(...args: unknown[]) {
      return this.record('roundRect', args);
    }
  }

  class Text extends Container {
    text: string;
    style: { fontSize: number; fill: string; fontWeight: string };
    constructor(options: { text: string; style: Text['style'] }) {
      super();
      this.text = options.text;
      this.style = options.style;
    }
    get width() {
      return this.text.length * this.style.fontSize * 0.5;
    }
    get height() {
      return this.style.fontSize;
    }
  }

  class Sprite extends Container {
    anchor = point();
    width = 0;
    height = 0;
    tint = 0xffffff;
    alpha = 1;
    texture: unknown;
  }

  class Rectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
  }

  const init = vi.fn<() => Promise<void>>();
  class Application {
    static instances: Application[] = [];
    canvas = { tagName: 'CANVAS' };
    stage = new Container();
    renderer = { resize: vi.fn(), events: { setTargetElement: vi.fn() } };
    ticker = {
      callbacks: [] as (() => void)[],
      add: vi.fn((callback: () => void): void => {
        this.ticker.callbacks.push(callback);
      }),
      stop: vi.fn(),
    };
    render = vi.fn();
    init = init;
    destroy = vi.fn((_removeView: boolean, options: { children: boolean }) => {
      this.stage.destroy(options);
    });
    constructor() {
      Application.instances.push(this);
    }
  }

  return { Application, Container, Graphics, Text, Sprite, Rectangle, init };
});

const boundary = vi.hoisted(() => ({
  loadAsset: vi.fn<(id: GameAssetId) => Promise<Texture | null>>(),
  ensureTexturePoolGuard: vi.fn(),
  retainPixiApp: vi.fn(),
  releasePixiApp: vi.fn(),
}));

vi.mock('pixi.js', () => pixi);
vi.mock('../../../src/render/adapters/gameAssetTextures', () => ({
  loadGameAssetTexture: boundary.loadAsset,
}));
vi.mock('../../../src/render/adapters/pixiTexturePoolGuard', () => boundary);

type TestContainer = InstanceType<typeof pixi.Container>;
type TestApplication = InstanceType<typeof pixi.Application>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function team(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    deptId: 'product',
    name: id,
    gridX: 0,
    gridY: 0,
    shipping: 200,
    aiDependency: 50,
    reviewQueue: 0,
    incidents: 0,
    morale: 70,
    techDebt: 20,
    engineers: 8,
    aiAssignedCount: 0,
    health: 'healthy',
    isPlayer: false,
    isActive: false,
    ...overrides,
  };
}

function department(teams: Team[]) {
  return aggregateDepartment(
    { id: 'product', name: 'プロダクト', color: '#aabbcc', teamCount: teams.length },
    teams,
  );
}

function layers(app: TestApplication) {
  const root = app.stage.children[0];
  return {
    root,
    plate: root.children[0] as InstanceType<typeof pixi.Graphics>,
    flows: root.children[1] as InstanceType<typeof pixi.Graphics>,
    teams: root.children[2],
    labels: root.children[3],
  };
}

function miniParts(group: TestContainer) {
  const mini = group.children[0];
  const banner = group.children[1];
  return {
    mini,
    codingFallback: mini.children[1],
    reviewFallback: mini.children[2],
    codingAsset: mini.children[3] as InstanceType<typeof pixi.Sprite>,
    reviewAsset: mini.children[4] as InstanceType<typeof pixi.Sprite>,
    shelf: mini.children[5] as InstanceType<typeof pixi.Text>,
    codingMood: mini.children[6] as InstanceType<typeof pixi.Text>,
    reviewMood: mini.children[7] as InstanceType<typeof pixi.Text>,
    fire: mini.children[8] as InstanceType<typeof pixi.Text>,
    banner,
    title: banner.children[1] as InstanceType<typeof pixi.Text>,
    subtitle: banner.children[2] as InstanceType<typeof pixi.Text>,
    tag: banner.children[4] as InstanceType<typeof pixi.Text>,
    chain: banner.children[5] as InstanceType<typeof pixi.Text>,
  };
}

function transform(node: TestContainer) {
  return { scale: node.scale.x, x: node.position.x, y: node.position.y };
}

describe('Pixi 部署レンダラー', () => {
  const renderers: PixiDeptRenderer[] = [];
  let mount: HTMLElement;

  beforeEach(() => {
    vi.clearAllMocks();
    pixi.Application.instances = [];
    pixi.init.mockResolvedValue(undefined);
    boundary.loadAsset.mockReset().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    mount = { appendChild: vi.fn() } as unknown as HTMLElement;
  });

  afterEach(() => {
    for (const renderer of renderers.splice(0)) renderer.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function makeRenderer(options: ConstructorParameters<typeof PixiDeptRenderer>[0] = {}) {
    const renderer = new PixiDeptRenderer(options);
    renderers.push(renderer);
    return renderer;
  }

  async function initialize(options: ConstructorParameters<typeof PixiDeptRenderer>[0] = {}) {
    const renderer = makeRenderer(options);
    await renderer.init(mount);
    return { renderer, app: pixi.Application.instances[pixi.Application.instances.length - 1] };
  }

  it('初期化前の操作は無害で、初期化後は canvas とイベントを接続して正のサイズへ contain-fit する', async () => {
    const metrics = vi.fn();
    const renderer = makeRenderer({ onRenderMetrics: metrics });
    renderer.resize(100, 100);
    renderer.render(department([team('alpha')]));
    renderer.freezeForScreenshot();
    expect(renderer.isReady).toBe(false);
    expect(renderer.getLastDept()).toBeNull();
    expect(metrics).not.toHaveBeenCalled();
    await expect(renderer.focusTeamZoom('alpha')).resolves.toBe(true);

    await renderer.init(mount);
    const app = pixi.Application.instances[0];
    expect(renderer.isReady).toBe(true);
    expect(boundary.ensureTexturePoolGuard).toHaveBeenCalledOnce();
    expect(boundary.retainPixiApp).toHaveBeenCalledOnce();
    expect(pixi.init).toHaveBeenCalledWith({
      backgroundAlpha: 0,
      resizeTo: mount,
      antialias: true,
      resolution: 2,
      autoDensity: true,
    });
    expect(mount.appendChild).toHaveBeenCalledExactlyOnceWith(app.canvas);
    expect(app.renderer.events.setTargetElement).toHaveBeenCalledExactlyOnceWith(app.canvas);
    expect(layers(app).root.children).toHaveLength(4);

    renderer.resize(0, 500);
    renderer.resize(700, -1);
    expect(app.renderer.resize).not.toHaveBeenCalled();
    renderer.resize(1000, 800);
    expect(app.renderer.resize).toHaveBeenCalledExactlyOnceWith(1000, 800);
    expect(transform(layers(app).root)).toEqual(
      containFitTransform(1000, 800, DEPT_VIEW.w, DEPT_VIEW.h),
    );
  });

  it('シーン計画の画家順・バナー・炎上フローとクリック先を実際の表示ツリーへ反映する', async () => {
    const onFocusTeam = vi.fn();
    const metrics = vi.fn();
    const { renderer, app } = await initialize({ onFocusTeam, onRenderMetrics: metrics });
    const dept = department([
      team('alpha', { health: 'reviewHell', reviewQueue: 8, incidents: 2, isPlayer: true }),
      team('bravo', { health: 'congested', reviewQueue: 2 }),
      team('charlie', { morale: 20 }),
    ]);
    const scene = planDeptBoardScene(dept);
    renderer.render(dept);
    const drawn = layers(app);
    const ordered = [...scene.teams].sort((a, b) => a.depth - b.depth || a.x - b.x);
    expect(renderer.getLastDept()).toBe(dept);
    expect(metrics).toHaveBeenLastCalledWith({ teams: 3, flows: 2, assets: 0 });
    expect(drawn.teams.children).toHaveLength(3);

    for (const [index, plan] of ordered.entries()) {
      const parts = miniParts(drawn.teams.children[index]);
      expect(parts.mini.position).toMatchObject({ x: plan.x, y: plan.y });
      expect(parts.mini.scale.x).toBe(teamMiniRenderScale(plan.scale));
      expect(parts.title.text).toBe(plan.banner.title);
      expect(parts.subtitle.text).toBe(plan.banner.subtitle);
      expect(parts.tag.text).toBe(plan.banner.tag);
      expect(parts.banner.position).toMatchObject({ x: plan.banner.x, y: plan.banner.y });
      expect(parts.chain.visible && parts.chain.text !== '').toBe(plan.chained);
      expect(parts.fire.visible && parts.fire.text !== '').toBe(plan.team.incidents > 0);
      expect(parts.shelf.text).toBe('📦');
      expect(parts.mini).toMatchObject({ eventMode: 'static', cursor: 'pointer' });
      expect(parts.mini.hitArea).toEqual(new pixi.Rectangle(42, 76, 296, 160));
      parts.mini.emit('pointertap');
      expect(onFocusTeam).toHaveBeenLastCalledWith(plan.teamId);
    }
    expect(onFocusTeam).toHaveBeenCalledTimes(3);
    const byName = new Map(
      drawn.teams.children.map((group) => {
        const parts = miniParts(group);
        return [parts.title.text, parts];
      }),
    );
    expect(byName.get('★ alpha')!.codingMood.text).toBe('💢');
    expect(byName.get('bravo')!.codingMood.text).toBe('💦');
    expect(byName.get('bravo')!.chain.text).toBe('⚠ 上流から延焼');
    expect(byName.get('charlie')!.codingMood.text).toBe('😞');

    for (const flow of scene.flows) {
      expect(drawn.flows.commands).toContainEqual({
        op: 'stroke',
        args: [{ color: flow.stroke, width: flow.strokeWidth, alpha: flow.opacity }],
      });
      expect(drawn.flows.commands).toContainEqual({
        op: 'fill',
        args: [{ color: flow.stroke, alpha: flow.opacity }],
      });
    }
    expect(drawn.flows.commands.filter((command) => command.op === 'poly')).toHaveLength(2);
    const reviewLabel = drawn.labels.children[1].children[1] as InstanceType<typeof pixi.Text>;
    expect(reviewLabel.text).toBe('🔍 Review');
    expect(reviewLabel.style.fill).toBe(VISUAL_TOKENS.colors.bannerTone.hell.text);
    expect(boundary.loadAsset.mock.calls).toEqual([['platform-architect'], ['qa-alchemist']]);
  });

  it('炎上から健全への再描画ではプールを再利用し、旧バナー・気分・イベントと床の炎上色を残さない', async () => {
    const onFocusTeam = vi.fn();
    const { renderer, app } = await initialize({ onFocusTeam });
    renderer.render(
      department([
        team('fire', { health: 'reviewHell', reviewQueue: 8, incidents: 2 }),
        team('chained', { health: 'reviewHell', reviewQueue: 7, incidents: 2 }),
      ]),
    );
    const drawn = layers(app);
    const oldGroups = [...drawn.teams.children];
    const oldLabels = [...drawn.labels.children];
    expect(drawn.plate.commands).toContainEqual({
      op: 'fill',
      args: [{ color: VISUAL_TOKENS.colors.department.hellOverlay, alpha: 0.1 }],
    });
    expect(drawn.plate.commands).toContainEqual({
      op: 'fill',
      args: [{ color: VISUAL_TOKENS.colors.department.glowHell, alpha: 0.06 }],
    });

    renderer.render(department([team('new-team', { shipping: 0 })]));
    expect(drawn.teams.children).toHaveLength(1);
    expect(oldGroups).toContain(drawn.teams.children[0]);
    expect(drawn.labels.children).toEqual(oldLabels);
    expect(drawn.flows.commands).toEqual([]);
    const parts = miniParts(drawn.teams.children[0]);
    expect(parts.title.text).toBe('new-team');
    for (const indicator of [parts.chain, parts.fire, parts.codingMood, parts.reviewMood]) {
      expect(indicator.visible).toBe(false);
      expect(indicator.text).toBe('');
    }
    parts.mini.emit('pointertap');
    expect(onFocusTeam).toHaveBeenCalledExactlyOnceWith('new-team');
    expect(drawn.plate.commands).not.toContainEqual({
      op: 'fill',
      args: [{ color: VISUAL_TOKENS.colors.department.hellOverlay, alpha: 0.1 }],
    });
    expect(drawn.plate.commands).toContainEqual({
      op: 'fill',
      args: [{ color: VISUAL_TOKENS.colors.department.glowHealthy, alpha: 0.04 }],
    });
    const reviewLabel = drawn.labels.children[1].children[1] as InstanceType<typeof pixi.Text>;
    expect(reviewLabel.style.fill).toBe(VISUAL_TOKENS.colors.cream);

    renderer.dispose();
    for (const group of oldGroups) {
      expect(group.destroy).toHaveBeenCalledExactlyOnceWith({ children: true });
      expect(group.destroy.mock.invocationCallOrder[0]).toBeLessThan(
        app.destroy.mock.invocationCallOrder[0],
      );
    }
    expect(boundary.releasePixiApp.mock.invocationCallOrder[0]).toBeLessThan(
      app.destroy.mock.invocationCallOrder[0],
    );
    expect(app.destroy).toHaveBeenCalledExactlyOnceWith(true, {
      children: true,
      texture: false,
      context: true,
    });
    expect(renderer.isReady).toBe(false);
    expect(renderer.getLastDept()).toBeNull();
    renderer.dispose();
    expect(app.destroy).toHaveBeenCalledOnce();
    expect(boundary.releasePixiApp).toHaveBeenCalledOnce();
  });

  it('チーム数が予算を超えても生成を上限に収め、空部署への切替で全チームを外す', async () => {
    const metrics = vi.fn();
    const { renderer, app } = await initialize({ onRenderMetrics: metrics });
    const dept = department(
      Array.from({ length: DEPT_SPRITE_BUDGET + 1 }, (_, index) => team(`t${index}`)),
    );
    renderer.render(dept);
    const drawn = layers(app);
    expect(drawn.teams.children).toHaveLength(DEPT_SPRITE_BUDGET);
    expect(metrics).toHaveBeenLastCalledWith({
      teams: DEPT_SPRITE_BUDGET + 1,
      flows: DEPT_SPRITE_BUDGET,
      assets: 0,
    });
    const groups = [...drawn.teams.children];
    expect(miniParts(groups[0]).mini.eventMode).toBe('auto');
    expect(miniParts(groups[0]).mini.hitArea).toBeNull();
    renderer.render(dept);
    expect(new Set(drawn.teams.children)).toEqual(new Set(groups));
    renderer.render(department([]));
    expect(drawn.teams.children).toHaveLength(0);
    expect(drawn.flows.commands).toEqual([]);
    expect(metrics).toHaveBeenLastCalledWith({ teams: 0, flows: 0, assets: 0 });
    renderer.dispose();
    for (const group of groups) expect(group.destroy).toHaveBeenCalledOnce();
  });

  it('アセット完了時には最新部署を再描画し、成功した人物だけを差し替え失敗は再取得しない', async () => {
    const coding = deferred<Texture | null>();
    const review = deferred<Texture | null>();
    boundary.loadAsset.mockReturnValueOnce(coding.promise).mockReturnValueOnce(review.promise);
    const metrics = vi.fn();
    const { renderer, app } = await initialize({ onRenderMetrics: metrics });
    renderer.render(department([team('old')]));
    const latest = department([team('latest', { health: 'congested', reviewQueue: 8 })]);
    renderer.render(latest);
    const drawn = layers(app);
    expect(miniParts(drawn.teams.children[0]).codingFallback.visible).toBe(true);
    expect(miniParts(drawn.teams.children[0]).codingAsset.visible).toBe(false);
    expect(boundary.loadAsset).toHaveBeenCalledTimes(2);

    const texture = { label: 'coding' } as Texture;
    coding.resolve(texture);
    await coding.promise;
    const parts = miniParts(drawn.teams.children[0]);
    expect(parts.title.text).toBe('latest');
    expect(renderer.getLastDept()).toBe(latest);
    expect(parts.codingAsset).toMatchObject({
      visible: true,
      texture,
      width: 30,
      height: 34,
      tint: 0xb8b0c8,
      alpha: 0.84,
    });
    expect(parts.codingAsset.position).toMatchObject({ x: 64, y: 74 });
    expect(parts.codingFallback.visible).toBe(false);
    expect(parts.reviewFallback.visible).toBe(true);
    expect(parts.reviewAsset).toMatchObject({ visible: false, tint: 0xffb6a8, alpha: 0.95 });
    expect(parts.reviewMood.text).toBe('💢');
    expect(metrics).toHaveBeenLastCalledWith({ teams: 1, flows: 0, assets: 1 });

    review.resolve(null);
    await review.promise;
    renderer.render(latest);
    expect(boundary.loadAsset).toHaveBeenCalledTimes(2);
    expect(miniParts(drawn.teams.children[0]).reviewFallback.visible).toBe(true);
    expect(miniParts(drawn.teams.children[0]).reviewAsset.visible).toBe(false);
    expect(metrics).toHaveBeenLastCalledWith({ teams: 1, flows: 0, assets: 1 });
    expect(drawn.plate.commands.filter((command) => command.op === 'ellipse')).toHaveLength(0);
  });

  it('破棄後にアセットが完了しても再描画・メトリクス通知をしない', async () => {
    const asset = deferred<Texture | null>();
    boundary.loadAsset.mockReturnValue(asset.promise);
    const metrics = vi.fn();
    const { renderer, app } = await initialize({ onRenderMetrics: metrics });
    renderer.render(department([team('alpha')]));
    renderer.dispose();
    metrics.mockClear();
    asset.resolve({ label: 'late' } as Texture);
    await asset.promise;
    renderer.render(department([team('late')]));
    renderer.resize(100, 100);
    renderer.freezeForScreenshot();
    expect(metrics).not.toHaveBeenCalled();
    expect(app.render).not.toHaveBeenCalled();
    expect(app.renderer.resize).not.toHaveBeenCalled();
    expect(renderer.getLastDept()).toBeNull();
  });

  it('初期化の完了前に破棄された場合は canvas を接続せず生存数も増やさない', async () => {
    const pending = deferred<void>();
    pixi.init.mockReturnValueOnce(pending.promise);
    const renderer = makeRenderer();
    const initialization = renderer.init(mount);
    renderer.dispose();
    pending.resolve();
    await initialization;
    const app = pixi.Application.instances[0];
    expect(mount.appendChild).not.toHaveBeenCalled();
    expect(app.renderer.events.setTargetElement).not.toHaveBeenCalled();
    expect(boundary.retainPixiApp).not.toHaveBeenCalled();
    expect(boundary.releasePixiApp).not.toHaveBeenCalled();
    expect(app.destroy).toHaveBeenCalledExactlyOnceWith(true, {
      children: true,
      texture: false,
      context: true,
    });
    expect(renderer.isReady).toBe(false);
  });

  it('部署・画面サイズ・対象チームが未確定のズームは即時完了して ticker を追加しない', async () => {
    const { renderer, app } = await initialize();
    await expect(renderer.focusTeamZoom('alpha')).resolves.toBe(true);
    renderer.render(department([team('alpha')]));
    await expect(renderer.focusTeamZoom('alpha')).resolves.toBe(true);
    renderer.resize(1000, 800);
    await expect(renderer.focusTeamZoom('missing')).resolves.toBe(true);
    expect(app.ticker.add).not.toHaveBeenCalled();
  });

  it('ズームは途中の resize で中断せず補間位置から終点へ進み、次回も同じ ticker を使う', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(100);
    const { renderer, app } = await initialize();
    const dept = department([team('alpha')]);
    renderer.render(dept);
    renderer.resize(1000, 800);
    const root = layers(app).root;
    const from = transform(root);
    const to = teamZoomTransform(from, 702, 320, 1000, 800);
    const complete = vi.fn();
    const zoom = renderer.focusTeamZoom('alpha', 400);
    void zoom.then(complete);
    expect(app.ticker.add).toHaveBeenCalledOnce();
    now.mockReturnValue(300);
    app.ticker.callbacks[0]();
    expect(transform(root)).toEqual(zoomTransformAt(0.5, from, to));
    renderer.resize(1200, 900);
    expect(transform(root)).toEqual(zoomTransformAt(0.5, from, to));
    await Promise.resolve();
    expect(complete).not.toHaveBeenCalled();

    now.mockReturnValue(500);
    app.ticker.callbacks[0]();
    await expect(zoom).resolves.toBe(true);
    expect(transform(root)).toEqual(to);
    app.ticker.callbacks[0]();
    expect(complete).toHaveBeenCalledExactlyOnceWith(true);

    renderer.resize(1200, 900);
    const resizedFit = containFitTransform(1200, 900, DEPT_VIEW.w, DEPT_VIEW.h);
    expect(transform(root)).toEqual(resizedFit);
    const next = renderer.focusTeamZoom('alpha', 400);
    now.mockReturnValue(900);
    app.ticker.callbacks[0]();
    await expect(next).resolves.toBe(true);
    expect(transform(root)).toEqual(teamZoomTransform(resizedFit, 702, 320, 1200, 900));
    expect(app.ticker.add).toHaveBeenCalledOnce();
  });

  it('スクリーンショット凍結はズームを終点で完走させ、ticker 停止後に一枚だけ描画する', async () => {
    const { renderer, app } = await initialize();
    renderer.render(department([team('alpha')]));
    renderer.resize(1000, 800);
    const root = layers(app).root;
    const to = teamZoomTransform(transform(root), 702, 320, 1000, 800);
    const zoom = renderer.focusTeamZoom('alpha');
    renderer.freezeForScreenshot();
    await expect(zoom).resolves.toBe(true);
    expect(transform(root)).toEqual(to);
    expect(app.ticker.stop).toHaveBeenCalledOnce();
    expect(app.render).toHaveBeenCalledOnce();
    expect(app.ticker.stop.mock.invocationCallOrder[0]).toBeLessThan(
      app.render.mock.invocationCallOrder[0],
    );
    renderer.freezeForScreenshot();
    expect(app.render).toHaveBeenCalledTimes(2);
  });

  it('進行中ズームの破棄は false で完了し、破棄後の ticker では状態を動かさない', async () => {
    const { renderer, app } = await initialize();
    renderer.render(department([team('alpha')]));
    renderer.resize(1000, 800);
    const root = layers(app).root;
    const before = transform(root);
    const zoom = renderer.focusTeamZoom('alpha');
    renderer.dispose();
    await expect(zoom).resolves.toBe(false);
    app.ticker.callbacks[0]();
    expect(transform(root)).toEqual(before);
    expect(app.render).not.toHaveBeenCalled();
  });
});
