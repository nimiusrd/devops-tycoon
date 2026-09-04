import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PixiOrgRendererOptions } from '../../../src/render/adapters/pixiOrgRenderer';
import { ORG_CARD_W, ORG_ISO, ORG_PAD } from '../../../src/render/orgView';
import type { Team } from '../../../src/sim/orgscale/types';

/** WebGL と入力イベントだけを置き換え、シーン計画・カメラ計算・プールは実物を使う。 */
const pixi = vi.hoisted(() => {
  class Point {
    x = 0;
    y = 0;
    set(x: number, y = x) {
      this.x = x;
      this.y = y;
    }
  }

  class Container {
    children: Container[] = [];
    position = new Point();
    visible = true;
    alpha = 1;
    eventMode = 'auto';
    cursor = 'default';
    interactiveChildren = true;
    hitArea: { contains(x: number, y: number): boolean } | null = null;
    listeners = new Map<string, Array<() => void>>();
    addChild(...children: Container[]) {
      this.children.push(...children);
      return children[0];
    }
    removeChildren() {
      return this.children.splice(0);
    }
    on(event: string, callback: () => void) {
      this.listeners.set(event, [...(this.listeners.get(event) ?? []), callback]);
      return this;
    }
    emit(event: string) {
      for (const callback of this.listeners.get(event) ?? []) callback();
    }
    removeAllListeners() {
      this.listeners.clear();
    }
    destroy = vi.fn((_options?: { children?: boolean }) => {});
  }

  class Graphics extends Container {
    clear = vi.fn(() => this);
    moveTo = vi.fn((_x: number, _y: number) => this);
    lineTo = vi.fn((_x: number, _y: number) => this);
    closePath = vi.fn(() => this);
    roundRect = vi.fn((_x: number, _y: number, _w: number, _h: number, _r: number) => this);
    circle = vi.fn((_x: number, _y: number, _radius: number) => this);
    fill = vi.fn((_style: { color: string; alpha?: number }) => this);
    stroke = vi.fn((_style: { color: string; width: number; alpha?: number }) => this);
  }

  class Text extends Container {
    text: string;
    style: { fontSize: number; fill: string; wordWrap?: boolean; wordWrapWidth?: number };
    constructor(options: { text: string; style: Text['style'] }) {
      super();
      this.text = options.text;
      this.style = options.style;
    }
    // 幅制約を検証するための決定論的な計測値。実フォントの検証は E2E に任せる。
    get width() {
      return this.text.length * this.style.fontSize;
    }
    get height() {
      return this.text ? this.style.fontSize : 0;
    }
  }

  class Texture {
    destroy = vi.fn();
    constructor(readonly label: string) {}
  }

  class Sprite extends Container {
    anchor = new Point();
    width = 0;
    height = 0;
    tint = 0xffffff;
    texture: Texture | undefined;
  }

  class Rectangle {
    constructor(
      readonly x: number,
      readonly y: number,
      readonly width: number,
      readonly height: number,
    ) {}
    contains(x: number, y: number) {
      return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
    }
  }

  interface Animation {
    time: number;
    ease: string;
    position: { x: number; y: number };
    scale: number;
    callbackOnComplete(): void;
  }

  class Viewport extends Container {
    static instances: Viewport[] = [];
    scale = new Point();
    left = 0;
    top = 0;
    constructor(public options: { screenWidth: number; screenHeight: number }) {
      super();
      this.scale.set(1);
      Viewport.instances.push(this);
    }
    drag = vi.fn(() => this);
    pinch = vi.fn(() => this);
    wheel = vi.fn(() => this);
    decelerate = vi.fn(() => this);
    findFit = vi.fn((width: number, height: number) =>
      Math.min(this.options.screenWidth / width, this.options.screenHeight / height),
    );
    fit = vi.fn((_center: boolean, width: number, height: number) => {
      this.scale.set(this.findFit(width, height));
    });
    setZoom = vi.fn((scale: number, center: boolean) => {
      const x = this.left + this.options.screenWidth / this.scale.x / 2;
      const y = this.top + this.options.screenHeight / this.scale.y / 2;
      this.scale.set(scale);
      if (center) this.moveCenter(x, y);
    });
    moveCenter = vi.fn((x: number, y: number) => {
      this.left = x - this.options.screenWidth / this.scale.x / 2;
      this.top = y - this.options.screenHeight / this.scale.y / 2;
    });
    toScreen(x: number, y: number) {
      return { x: (x - this.left) * this.scale.x, y: (y - this.top) * this.scale.y };
    }
    resize = vi.fn((width: number, height: number, _worldWidth: number, _worldHeight: number) => {
      this.options.screenWidth = width;
      this.options.screenHeight = height;
    });
    animate = vi.fn((_animation: Animation) => {});
    completeAnimation() {
      const animation = this.animate.mock.lastCall?.[0];
      if (!animation) throw new Error('開始済みのカメラ遷移がありません');
      this.setZoom(animation.scale, false);
      this.moveCenter(animation.position.x, animation.position.y);
      animation.callbackOnComplete();
    }
  }

  class Application {
    static instances: Application[] = [];
    static initializing: Promise<void> | undefined;
    stage = new Container();
    canvas = {};
    renderer = {
      events: { setTargetElement: vi.fn() },
      resize: vi.fn(),
    };
    ticker = {
      add: vi.fn<(callback: () => void) => void>(),
      stop: vi.fn(),
    };
    init = vi.fn(async (_options: unknown) => {
      await Application.initializing;
    });
    render = vi.fn();
    destroy = vi.fn();
    constructor() {
      Application.instances.push(this);
    }
    tick() {
      for (const [callback] of this.ticker.add.mock.calls) callback();
    }
  }

  return {
    Application,
    Container,
    Graphics,
    Rectangle,
    Sprite,
    Text,
    Texture,
    Viewport,
    Assets: { load: vi.fn<(url: string) => Promise<Texture>>() },
    GlobalResourceRegistry: { release: vi.fn() },
    TexturePool: { returnTexture: vi.fn(), _texturePool: {}, _poolKeyHash: {} },
  };
});

vi.mock('pixi.js', () => pixi);
vi.mock('pixi-viewport', () => ({ Viewport: pixi.Viewport }));

const CAMERA = { x: -10000, y: -10000, w: 20000, h: 20000 };

function team(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    name: id,
    deptId: 'platform',
    gridX: 0,
    gridY: 0,
    shipping: 42,
    aiDependency: 35,
    reviewQueue: 0,
    incidents: 0,
    morale: 50,
    techDebt: 0,
    engineers: 2,
    aiAssignedCount: 0,
    health: 'healthy',
    isPlayer: false,
    isActive: false,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function texts(container: InstanceType<typeof pixi.Container>) {
  return container.children.filter(
    (child): child is InstanceType<typeof pixi.Text> => child instanceof pixi.Text,
  );
}

function avatars(container: InstanceType<typeof pixi.Container>) {
  return container.children.filter(
    (child): child is InstanceType<typeof pixi.Sprite> => child instanceof pixi.Sprite,
  );
}

function graphics(container: InstanceType<typeof pixi.Container>) {
  return container.children.filter(
    (child): child is InstanceType<typeof pixi.Graphics> => child instanceof pixi.Graphics,
  );
}

describe('Pixi 全社マップレンダラー', () => {
  const renderers: Array<{ dispose(): void }> = [];

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    pixi.Application.instances.length = 0;
    pixi.Application.initializing = undefined;
    pixi.Viewport.instances.length = 0;
    pixi.Assets.load.mockReset().mockImplementation(() => new Promise(() => {}));
  });

  afterEach(() => {
    for (const renderer of renderers.splice(0)) renderer.dispose();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function create(options: Partial<PixiOrgRendererOptions> = {}) {
    const { PixiOrgRenderer } = await import('../../../src/render/adapters/pixiOrgRenderer');
    const renderer = new PixiOrgRenderer({
      isoBase: ORG_ISO,
      pad: ORG_PAD,
      spriteBudget: 20,
      ...options,
    });
    renderers.push(renderer);
    const mount = { clientWidth: 1000, clientHeight: 600, appendChild: vi.fn() };
    return { renderer, mount, PixiOrgRenderer };
  }

  async function initialized(options: Partial<PixiOrgRendererOptions> = {}) {
    const created = await create(options);
    await created.renderer.init(created.mount as unknown as HTMLElement);
    const app = pixi.Application.instances.at(-1)!;
    const viewport = pixi.Viewport.instances.at(-1)!;
    return { ...created, app, viewport, layer: viewport.children[0] };
  }

  it('初期化前は安全な既定値を返し、破棄後に初期化が完了しても canvas を接続しない', async () => {
    const { renderer, mount } = await create();
    expect(renderer.isReady).toBe(false);
    expect(renderer.getZoomScale()).toBeNull();
    expect(renderer.getLastPlan()).toBeNull();
    expect(renderer.getCameraRect()).toEqual({ x: 0, y: 0, w: 800, h: 600 });
    renderer.renderTeams([team('初期化前')]);
    renderer.fitToContent([team('初期化前')]);
    renderer.freezeForScreenshot();
    await renderer.focusCompany([team('初期化前')]);
    await renderer.focusTeamCamera([team('初期化前')], '初期化前');
    expect(renderer.getLastPlan()).toBeNull();

    const pending = deferred<void>();
    pixi.Application.initializing = pending.promise;
    const initialization = renderer.init(mount as unknown as HTMLElement);
    renderer.dispose();
    pending.resolve();
    await initialization;

    expect(mount.appendChild).not.toHaveBeenCalled();
    expect(pixi.Application.instances[0].destroy).toHaveBeenCalledExactlyOnceWith(true, {
      children: true,
      texture: false,
      context: true,
    });
    expect(pixi.Viewport.instances).toHaveLength(0);
    expect(renderer.isReady).toBe(false);
  });

  it('canvas をイベント座標の基準にして操作を有効化し、resize と破棄を公開状態へ反映する', async () => {
    const { renderer, mount, app, viewport } = await initialized();
    expect(mount.appendChild).toHaveBeenCalledExactlyOnceWith(app.canvas);
    expect(app.renderer.events.setTargetElement).toHaveBeenCalledExactlyOnceWith(app.canvas);
    expect(app.init).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: 2, resizeTo: mount }),
    );
    expect(viewport.drag).toHaveBeenCalledOnce();
    expect(viewport.pinch).toHaveBeenCalledOnce();
    expect(viewport.wheel).toHaveBeenCalledOnce();
    expect(viewport.decelerate).toHaveBeenCalledOnce();
    expect(renderer.isReady).toBe(true);
    expect(renderer.getZoomScale()).toBe(1);

    renderer.resize(1200, 700);
    expect(app.renderer.resize).toHaveBeenCalledExactlyOnceWith(1200, 700);
    expect(viewport.resize).toHaveBeenLastCalledWith(1200, 700, 1200, 700);
    renderer.resize(0, 0);
    expect(app.renderer.resize).toHaveBeenCalledTimes(1);
    expect(viewport.resize).toHaveBeenLastCalledWith(0, 0, 0, 0);
    renderer.dispose();
    renderer.dispose();
    expect(app.destroy).toHaveBeenCalledOnce();
    expect(viewport.destroy).toHaveBeenCalledOnce();
    expect(renderer.isReady).toBe(false);
    expect(renderer.getZoomScale()).toBeNull();
  });

  it('可視領域と予算に従う画家順で島を描き、再利用後のクリックは現在のチームだけを通知する', async () => {
    const onFocusTeam = vi.fn();
    const onPlanMetrics = vi.fn();
    const { renderer, layer } = await initialized({
      spriteBudget: 2,
      onFocusTeam,
      onPlanMetrics,
      deptColor: () => '#123456',
    });
    const teams = [team('手前', { gridX: 2 }), team('奥'), team('中間', { gridX: 1 })];
    renderer.render({ teams, camera: CAMERA });

    expect(renderer.getLastPlan()).toMatchObject({ total: 3, culled: 0, overBudget: 1 });
    expect(onPlanMetrics).toHaveBeenLastCalledWith(renderer.getLastPlan());
    expect(layer.children.map((island) => texts(island)[0].text)).toEqual(['奥', '中間']);
    expect(graphics(layer.children[0])[0].stroke).toHaveBeenCalledWith({
      color: '#123456',
      width: 2,
    });
    const retained = [...layer.children];
    layer.children[0].emit('pointertap');
    expect(onFocusTeam).toHaveBeenCalledExactlyOnceWith('奥');

    renderer.render({ teams: [team('新チーム')], camera: CAMERA });
    expect(layer.children).toHaveLength(1);
    expect(retained).toContain(layer.children[0]);
    const island = layer.children[0];
    expect(island.position).toMatchObject({ x: ORG_PAD, y: ORG_PAD });
    expect(island.interactiveChildren).toBe(false);
    expect(island.eventMode).toBe('static');
    expect(island.cursor).toBe('pointer');
    expect(island.hitArea?.contains(0, 0)).toBe(true);
    expect(island.hitArea?.contains(ORG_CARD_W, 0)).toBe(false);
    island.emit('pointertap');
    expect(onFocusTeam.mock.calls).toEqual([['奥'], ['新チーム']]);

    renderer.render({ teams, camera: { x: 50000, y: 50000, w: 10, h: 10 } });
    expect(renderer.getLastPlan()).toMatchObject({
      total: 3,
      culled: 3,
      overBudget: 0,
      sprites: [],
    });
    expect(layer.children).toHaveLength(0);
    for (const pooled of retained) {
      expect(pooled.eventMode).toBe('auto');
      expect(pooled.cursor).toBe('default');
      expect(pooled.hitArea).toBeNull();
      expect(pooled.children.every((child) => !child.visible)).toBe(true);
      pooled.emit('pointertap');
    }
    expect(onFocusTeam).toHaveBeenCalledTimes(2);
    renderer.dispose();
    for (const pooled of retained)
      expect(pooled.destroy).toHaveBeenCalledExactlyOnceWith({ children: true });
    expect(renderer.getLastPlan()).toBeNull();
  });

  it('スクロールとズームをカリングへ反映し、移動・ズーム通知で最新状態を再描画する', async () => {
    const { renderer, viewport, layer } = await initialized();
    viewport.emit('moved');
    expect(renderer.getLastPlan()).toBeNull();
    viewport.left = 20;
    viewport.top = 30;
    viewport.scale.set(2);
    renderer.setFieldView({ scrollX: 60, scrollY: 40, width: 300, height: 200 });
    expect(renderer.getCameraRect()).toEqual({ x: 50, y: 50, w: 150, h: 100 });
    renderer.renderTeams([team('表示'), team('画面外', { gridX: 30 })]);
    expect(renderer.getLastPlan()?.sprites.map((sprite) => sprite.teamId)).toEqual(['表示']);
    expect(layer.children[0].eventMode).toBe('auto');
    viewport.left = 50000;
    viewport.emit('moved');
    expect(layer.children).toHaveLength(0);
    viewport.left = 0;
    viewport.top = 0;
    renderer.setFieldView({ scrollX: 0, scrollY: 0, width: 800, height: 600 });
    viewport.scale.set(0.5);
    viewport.emit('zoomed');
    expect(renderer.getLastPlan()?.sprites[0]).toMatchObject({ teamId: '表示', detail: 'badge' });
  });

  it('カードから badge・dot へ切り替えると不要なラベルと人物を隠し、dot は菱形でクリック判定する', async () => {
    const onRenderMetrics = vi.fn();
    const { renderer, viewport, layer } = await initialized({
      onFocusTeam: vi.fn(),
      onRenderMetrics,
    });
    const teams = [
      team('とても長い名前を持つ開発チーム', { incidents: 3, isPlayer: true, aiAssignedCount: 2 }),
    ];
    renderer.renderTeams(teams);
    const island = layer.children[0];
    const name = texts(island)[0];
    expect(name.text.startsWith('★ ')).toBe(true);
    expect(name.text.endsWith('…')).toBe(true);
    expect(name.width).toBeLessThanOrEqual(name.style.wordWrapWidth!);
    expect(
      texts(island)
        .filter((text) => text.visible)
        .map((text) => text.text),
    ).toEqual(expect.arrayContaining(['出荷 42', '2人', '🔥3', '💢']));
    expect(island.children.every((child) => child.eventMode === 'none')).toBe(true);

    viewport.scale.set(0.5);
    viewport.emit('zoomed');
    expect(layer.children[0]).toBe(island);
    expect(
      texts(island)
        .filter((text) => text.visible)
        .map((text) => text.text),
    ).toEqual(['★ とても長い名前…', '🔥3']);
    expect(avatars(island).every((avatar) => !avatar.visible)).toBe(true);
    expect(onRenderMetrics).toHaveBeenLastCalledWith({
      avatarAssetsLoaded: 0,
      avatarAssetsRequired: 0,
    });
    expect(island.hitArea).toBeInstanceOf(pixi.Rectangle);

    viewport.scale.set(0.2);
    viewport.emit('zoomed');
    expect(renderer.getLastPlan()?.sprites[0].detail).toBe('dot');
    expect(texts(island).every((text) => !text.visible)).toBe(true);
    expect(island.hitArea).not.toBeInstanceOf(pixi.Rectangle);
    expect(island.hitArea?.contains(0, 0)).toBe(true);
    expect(island.hitArea?.contains(ORG_PAD, 0)).toBe(true);
    expect(island.hitArea?.contains(ORG_PAD, 1)).toBe(false);
    expect(island.hitArea?.contains(ORG_PAD + 1, 0)).toBe(false);
  });

  it('人物を一度だけ取得し、成功した人物だけを表示して失敗した人物の代替表示を保つ', async () => {
    const first = deferred<InstanceType<typeof pixi.Texture>>();
    const second = deferred<InstanceType<typeof pixi.Texture>>();
    pixi.Assets.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onRenderMetrics = vi.fn();
    const { renderer, layer } = await initialized({ onRenderMetrics });
    const teams = [team('人物 A'), team('人物 B', { gridX: 1, health: 'congested' })];
    renderer.renderTeams(teams);
    renderer.renderTeams(teams);
    expect(pixi.Assets.load).toHaveBeenCalledTimes(2);
    expect(onRenderMetrics).toHaveBeenLastCalledWith({
      avatarAssetsLoaded: 0,
      avatarAssetsRequired: 2,
    });
    expect(layer.children.flatMap(avatars).every((avatar) => !avatar.visible)).toBe(true);

    const loaded = new pixi.Texture('取得できた人物');
    first.resolve(loaded);
    second.reject(new Error('取得できない人物'));
    await first.promise;
    await second.promise.catch(() => {});
    await Promise.resolve();

    expect(onRenderMetrics).toHaveBeenLastCalledWith({
      avatarAssetsLoaded: 2,
      avatarAssetsRequired: 2,
    });
    for (const island of layer.children) {
      expect(avatars(island).map((avatar) => avatar.visible)).toEqual([true, false, false, false]);
      expect(avatars(island)[0]).toMatchObject({ texture: loaded, width: 15, height: 15 });
      // カード背景/菱形/炎上線/バッジの後に、4 人分の代替図形が並ぶ。
      expect(
        graphics(island)
          .slice(4)
          .map((fallback) => fallback.visible),
      ).toEqual([false, true, false, false]);
    }
    expect(avatars(layer.children[1])[0].alpha).toBe(0.84);
    expect(avatars(layer.children[1])[0].tint).toBe(0xb8b0c8);
    renderer.renderTeams(teams);
    expect(pixi.Assets.load).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledOnce();
    renderer.dispose();
    expect(loaded.destroy).not.toHaveBeenCalled();
  });

  it('人物の取得待ち中に破棄した場合、遅い完了は再描画や共有テクスチャ破棄を起こさない', async () => {
    const pending = deferred<InstanceType<typeof pixi.Texture>>();
    pixi.Assets.load.mockReturnValue(pending.promise);
    const onRenderMetrics = vi.fn();
    const { renderer, app, layer } = await initialized({ onRenderMetrics });
    renderer.renderTeams([team('待機中', { engineers: 1 })]);
    const island = layer.children[0];
    renderer.dispose();
    expect(island.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      app.destroy.mock.invocationCallOrder[0],
    );
    const loaded = new pixi.Texture('遅延した人物');
    pending.resolve(loaded);
    await pending.promise;
    await Promise.resolve();
    expect(onRenderMetrics).toHaveBeenCalledTimes(1);
    expect(renderer.getLastPlan()).toBeNull();
    expect(loaded.destroy).not.toHaveBeenCalled();
  });

  it('同一配置の状態更新は再 fit せず、配置変更・キャッシュ無効化・全社復帰を同期する', async () => {
    const { renderer, viewport } = await initialized();
    const teams = [team('最初'), team('追加', { gridX: 2 })];
    renderer.fitToContent(teams);
    const fingerprint = renderer.getFittedLayoutFingerprint();
    expect(fingerprint).toContain('最初:0:0|追加:2:0');
    expect(viewport.fit).toHaveBeenCalledTimes(1);
    renderer.fitToContent(teams.map((value) => ({ ...value, shipping: 99 })));
    expect(viewport.fit).toHaveBeenCalledTimes(1);

    const moved = [teams[0], { ...teams[1], gridY: 1 }];
    renderer.fitToContent(moved);
    expect(viewport.fit).toHaveBeenCalledTimes(2);
    expect(renderer.getFittedLayoutFingerprint()).not.toBe(fingerprint);
    renderer.invalidateFitCache();
    expect(renderer.getFittedLayoutFingerprint()).toBeNull();
    renderer.fitToContent(moved);
    expect(viewport.fit).toHaveBeenCalledTimes(3);

    await renderer.focusCompany(teams, false);
    expect(renderer.getFittedLayoutFingerprint()).toBe(fingerprint);
    expect(viewport.fit.mock.lastCall?.[0]).toBe(false);
    renderer.fitToContent(teams);
    expect(viewport.fit).toHaveBeenCalledTimes(4);
    renderer.dispose();
    expect(renderer.getFittedLayoutFingerprint()).toBeNull();
  });

  it('部門とチームへ即時フォーカスすると拡大量を抑え、スクロール窓の中心へ対象を合わせる', async () => {
    const { renderer, viewport } = await initialized();
    const teams = [team('対象'), team('遠方', { deptId: 'other', gridX: 10 })];
    const host = {
      clientWidth: 300,
      clientHeight: 200,
      scrollWidth: 1000,
      scrollHeight: 600,
      scrollLeft: 0,
      scrollTop: 0,
    };
    renderer.setScrollHost(host as HTMLElement);
    await renderer.focusDepartment(teams, 'platform', false);
    expect(renderer.getZoomScale()).toBe(1.5);
    expect(viewport.moveCenter).toHaveBeenLastCalledWith(ORG_PAD, ORG_PAD);
    expect(host).toMatchObject({ scrollLeft: 350, scrollTop: 200 });
    const camera = renderer.getCameraRect();
    expect(camera.x + camera.w / 2).toBeCloseTo(ORG_PAD);
    expect(camera.y + camera.h / 2).toBeCloseTo(ORG_PAD);

    viewport.scale.set(0.2);
    await renderer.focusTeamCamera(teams, '対象', false);
    expect(renderer.getZoomScale()).toBe(0.7);
    expect(viewport.setZoom).toHaveBeenLastCalledWith(0.7, true);
    const teamCamera = renderer.getCameraRect();
    expect(teamCamera.x + teamCamera.w / 2).toBeCloseTo(ORG_PAD);
    expect(teamCamera.y + teamCamera.h / 2).toBeCloseTo(ORG_PAD);
    renderer.setScrollHost(null);
    await renderer.focusCompany(teams, false);
    expect(host).toMatchObject({ scrollLeft: 350, scrollTop: 200 });
  });

  it.each(['company', 'department', 'team'] as const)(
    '%s のカメラ遷移は完了後に Promise とスクロールを同期する',
    async (target) => {
      const { renderer, viewport } = await initialized();
      const teams = [team('対象')];
      const host = {
        clientWidth: 300,
        clientHeight: 200,
        scrollWidth: 1000,
        scrollHeight: 600,
        scrollLeft: 0,
        scrollTop: 0,
      };
      renderer.setScrollHost(host as HTMLElement);
      const completion = vi.fn();
      const transition =
        target === 'company'
          ? renderer.focusCompany(teams)
          : target === 'department'
            ? renderer.focusDepartment(teams, 'platform')
            : renderer.focusTeamCamera(teams, '対象');
      void transition.then(completion);
      expect(viewport.animate).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          time: 480,
          ease: 'easeOutCubic',
          position: { x: ORG_PAD, y: ORG_PAD },
          scale: expect.any(Number),
        }),
      );
      await Promise.resolve();
      expect(completion).not.toHaveBeenCalled();
      expect(host.scrollLeft).toBe(0);
      viewport.completeAnimation();
      await transition;
      expect(completion).toHaveBeenCalledOnce();
      expect(host.scrollLeft).toBeCloseTo(350);
      expect(host.scrollTop).toBeCloseTo(200);
      if (target === 'company') expect(renderer.getFittedLayoutFingerprint()).toContain('対象:0:0');
    },
  );

  it('空の組織や存在しない対象へのフォーカスはカメラとリングを動かさない', async () => {
    const { renderer, viewport } = await initialized({ pad: 0 });
    await renderer.focusCompany([]);
    await renderer.focusDepartment([team('対象')], '存在しない部門');
    await renderer.focusTeamCamera([team('対象')], '存在しないチーム');
    renderer.playFocusRing([team('対象')], '存在しないチーム');
    renderer.fitToContent([]);
    expect(viewport.animate).not.toHaveBeenCalled();
    expect(viewport.fit).not.toHaveBeenCalled();
    expect(renderer.focusRingActive).toBe(false);
  });

  it('炎上線を脈動させ、フォーカスリングを拡大・消去し、撮影固定では時間依存の描画を止める', async () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { renderer, app, viewport, layer, PixiOrgRenderer } = await initialized();
    viewport.scale.set(0.5);
    const teams = [team('炎上', { incidents: 6 })];
    renderer.renderTeams(teams);
    const fire = graphics(layer.children[0])[2];
    app.tick();
    expect(fire.alpha).toBeGreaterThanOrEqual(0.55);
    expect(fire.alpha).toBeLessThanOrEqual(1);
    const initialAlpha = fire.alpha;
    now += 100;
    app.tick();
    expect(fire.alpha).not.toBe(initialAlpha);
    expect(graphics(layer.children[0])[1].alpha).toBe(1);

    const ring = viewport.children[1] as InstanceType<typeof pixi.Graphics>;
    renderer.playFocusRing(teams, '炎上');
    expect(renderer.focusRingActive).toBe(true);
    app.tick();
    const firstRadius = ring.circle.mock.calls[0][2];
    expect(ring.stroke).toHaveBeenCalledWith(expect.objectContaining({ width: 8, alpha: 1 }));
    now += PixiOrgRenderer.FOCUS_RING_MS / 2;
    app.tick();
    expect(ring.circle.mock.calls[2][2]).toBeGreaterThan(firstRadius);
    expect(ring.stroke).toHaveBeenCalledWith(expect.objectContaining({ alpha: 0.5 }));
    now += PixiOrgRenderer.FOCUS_RING_MS / 2;
    app.tick();
    expect(renderer.focusRingActive).toBe(false);
    expect(ring.circle).toHaveBeenCalledTimes(4);

    renderer.playFocusRing(teams, '炎上');
    renderer.freezeForScreenshot();
    expect(app.ticker.stop).toHaveBeenCalledOnce();
    expect(fire.alpha).toBeCloseTo(0.775);
    expect(renderer.focusRingActive).toBe(false);
    expect(app.render).toHaveBeenCalledOnce();
  });
});
