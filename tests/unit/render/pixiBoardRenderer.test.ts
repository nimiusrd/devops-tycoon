import type { Texture } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emptyBoardRenderMetrics,
  PixiBoardRenderer,
  type BoardPixiInput,
  type BoardRenderMetrics,
  type PixiBoardRendererOptions,
} from '../../../src/render/adapters/pixiBoardRenderer';
import { createTimedBoardEffects, type BoardEffectPayload } from '../../../src/render/boardEffects';
import {
  BOARD_VIEW,
  planBoardScene,
  type BoardDotPlan,
  type StationMood,
} from '../../../src/render/boardScene';
import {
  BOARD_PIXI_LAYER_ORDER,
  BOARD_RENDER_BUDGETS,
} from '../../../src/render/boardRenderBudget';
import { VISUAL_TOKENS } from '../../../src/render/visualTokens';
import type { Task } from '../../../src/sim/types';

// WebGL・canvas と SVG 取得だけを置換し、シーン計画と SpritePool は実装を使う。
const pixi = vi.hoisted(() => {
  class Point {
    constructor(
      public x = 0,
      public y = x,
    ) {}
    set(x: number, y = x) {
      this.x = x;
      this.y = y;
    }
  }

  class Container {
    children: Container[] = [];
    position = new Point();
    scale = new Point(1);
    anchor = new Point();
    visible = true;
    alpha = 1;
    rotation = 0;
    tint = 0xffffff;
    eventMode = 'auto';
    zIndex = 0;
    sortableChildren = false;
    destroy = vi.fn();
    addChild(...children: Container[]) {
      this.children.push(...children);
      return children[0];
    }
    removeChildren() {
      return this.children.splice(0);
    }
  }

  class Graphics extends Container {
    commands: { method: string; args: unknown[] }[] = [];
    clear() {
      this.commands = [];
      return this;
    }
    private draw(method: string, args: unknown[]) {
      this.commands.push({ method, args });
      return this;
    }
    circle(...args: unknown[]) {
      return this.draw('circle', args);
    }
    ellipse(...args: unknown[]) {
      return this.draw('ellipse', args);
    }
    rect(...args: unknown[]) {
      return this.draw('rect', args);
    }
    roundRect(...args: unknown[]) {
      return this.draw('roundRect', args);
    }
    moveTo(...args: unknown[]) {
      return this.draw('moveTo', args);
    }
    lineTo(...args: unknown[]) {
      return this.draw('lineTo', args);
    }
    quadraticCurveTo(...args: unknown[]) {
      return this.draw('quadraticCurveTo', args);
    }
    poly(...args: unknown[]) {
      return this.draw('poly', args);
    }
    fill(...args: unknown[]) {
      return this.draw('fill', args);
    }
    stroke(...args: unknown[]) {
      return this.draw('stroke', args);
    }
    closePath() {
      return this.draw('closePath', []);
    }
  }

  class FakeTexture {
    static EMPTY = new FakeTexture();
    destroy = vi.fn();
    constructor(
      public width = 220,
      public height = 200,
    ) {}
  }

  class Sprite extends Container {
    texture = FakeTexture.EMPTY;
  }

  class Text extends Sprite {
    text: string;
    constructor(options: { text: string; style: unknown }) {
      super();
      this.text = options.text;
    }
  }

  class Rectangle {
    constructor(
      public x: number,
      public y: number,
      public width: number,
      public height: number,
    ) {}
  }

  const initialize = vi.fn<() => Promise<void>>();
  const applications: Application[] = [];
  class Application {
    constructor() {
      applications.push(this);
    }
    stage = new Container();
    canvas = { nodeName: 'CANVAS' };
    render = vi.fn();
    destroy = vi.fn();
    init = vi.fn(initialize);
    callbacks: (() => void)[] = [];
    ticker = {
      deltaMS: 0,
      add: vi.fn((callback: () => void) => this.callbacks.push(callback)),
      start: vi.fn(),
      stop: vi.fn(),
    };
    renderer = {
      events: { setTargetElement: vi.fn() },
      resize: vi.fn(),
      generateTexture: vi.fn(
        (_options: { target: Container; resolution: number; frame: Rectangle }) =>
          new FakeTexture(),
      ),
    };
    advance(deltaMS: number) {
      this.ticker.deltaMS = deltaMS;
      for (const callback of this.callbacks) callback();
    }
  }

  return {
    Application,
    Container,
    Graphics,
    Rectangle,
    Sprite,
    Text,
    Texture: FakeTexture,
    initialize,
    applications,
    load: vi.fn<(id: string) => Promise<Texture | null>>(),
    ensure: vi.fn(),
    retain: vi.fn(),
    release: vi.fn(),
  };
});

vi.mock('pixi.js', () => pixi);
vi.mock('../../../src/render/adapters/gameAssetTextures', () => ({
  loadGameAssetTexture: pixi.load,
}));
vi.mock('../../../src/render/adapters/pixiTexturePoolGuard', () => ({
  ensureTexturePoolGuard: pixi.ensure,
  retainPixiApp: pixi.retain,
  releasePixiApp: pixi.release,
}));

type FakeApplication = InstanceType<typeof pixi.Application>;
type FakeContainer = InstanceType<typeof pixi.Container>;
type FakeGraphics = InstanceType<typeof pixi.Graphics>;
type FakeSprite = InstanceType<typeof pixi.Sprite>;
type FakeText = InstanceType<typeof pixi.Text>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    kind: 'normal',
    highValue: false,
    aiAssisted: false,
    lane: 'coding',
    progress: 0,
    reworkAttempts: 0,
    wasReworked: false,
    incident: false,
    debt: false,
    ...overrides,
  };
}

function input(overrides: Partial<BoardPixiInput> = {}): BoardPixiInput {
  return { scene: planBoardScene([]), effects: [], auras: [], reducedMotion: false, ...overrides };
}

function layer(app: FakeApplication, name: keyof typeof BOARD_PIXI_LAYER_ORDER): FakeContainer {
  const found = app.stage.children[0].children.find(
    (child) => child.zIndex === BOARD_PIXI_LAYER_ORDER[name],
  );
  expect(found, `${name} レイヤー`).toBeDefined();
  return found!;
}

function graphics(container: FakeContainer, index = 0): FakeGraphics {
  return container.children[index] as FakeGraphics;
}

function sprite(container: FakeContainer, index = 0): FakeSprite {
  return container.children[index] as FakeSprite;
}

function label(container: FakeContainer, index = 2): FakeText {
  return container.children[index] as FakeText;
}

function drawCalls(g: FakeGraphics, method: string) {
  return g.commands.filter((command) => command.method === method).map((command) => command.args);
}

const renderers: PixiBoardRenderer[] = [];

async function mounted(options: PixiBoardRendererOptions = {}) {
  const metrics = vi.fn<(value: BoardRenderMetrics) => void>();
  const renderer = new PixiBoardRenderer({ onRenderMetrics: metrics, ...options });
  renderers.push(renderer);
  const appendChild = vi.fn();
  const mount = { appendChild } as unknown as HTMLElement;
  await renderer.init(mount);
  // Application の公開境界へ渡された stage / ticker を観測し、renderer の private には触れない。
  const app = pixi.applications.at(-1)!;
  return {
    renderer,
    app,
    metrics,
    appendChild,
    mount,
    latest: () => metrics.mock.calls.at(-1)![0],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  pixi.applications.length = 0;
  pixi.initialize.mockResolvedValue(undefined);
  pixi.load.mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  vi.spyOn(performance, 'now').mockReturnValue(1_000);
});

afterEach(() => {
  for (const renderer of renderers.splice(0)) renderer.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Pixi スプリント盤面レンダラー', () => {
  it('出荷光粒は到着後に描き、停止中は位置を保持し、再利用後も上限とreduced motionを守る', async () => {
    const { renderer, app } = await mounted({ stratum: 'base' });
    const review = planBoardScene([task({ lane: 'review' })]);
    const done = planBoardScene([task({ lane: 'done' })]);
    renderer.render(input({ scene: review }));
    renderer.render(input({ scene: done }));
    const shipments = layer(app, 'shipments');
    expect(shipments.children).toHaveLength(8);
    expect(shipments.children.every((s) => s.alpha === 0)).toBe(true);
    app.advance(260);
    const positions = shipments.children.map((s) => ({ ...s.position }));
    expect(shipments.children.every((s) => s.alpha > 0)).toBe(true);
    renderer.setAnimationsPaused(true);
    app.advance(1000);
    expect(shipments.children.map((s) => ({ ...s.position }))).toEqual(positions);
    renderer.setAnimationsPaused(false);
    app.advance(600);
    expect(shipments.children.every((s) => !s.visible)).toBe(true);
    const sprites = [...shipments.children];
    renderer.render(input({ scene: review }));
    renderer.render(input({ scene: done }));
    expect(shipments.children).toEqual(sprites);
    renderer.render(input({ scene: done, reducedMotion: true }));
    expect(shipments.children.every((s) => !s.visible)).toBe(true);
    expect(layer(app, 'dots').children[0].position).toMatchObject({
      x: done.dots[0].x,
      y: done.dots[0].y,
    });
  });

  it('足元照明は同じテクスチャ10枚を保持し、疲弊と混乱が静止状態でも見える', async () => {
    const { renderer, app } = await mounted({ stratum: 'base' });
    const scene = planBoardScene([]);
    renderer.render(input({ scene }));
    const office = layer(app, 'office');
    const sprites = [...office.children];
    expect(sprites).toHaveLength(10);
    renderer.render(
      input({
        scene: { ...scene, stations: scene.stations.map((s) => ({ ...s, mood: 'panic' })) },
        reducedMotion: true,
      }),
    );
    expect(office.children).toEqual(sprites);
    expect(sprite(office).tint).toBe(VISUAL_TOKENS.colors.health.reviewHell);
    expect(sprite(office, 1).texture).toBe(sprite(office).texture);
  });

  it('初期メトリクスは全資源が未使用で、呼び出しごとに独立している', () => {
    const first = emptyBoardRenderMetrics();
    expect(first).toMatchObject({
      dots: 0,
      actors: 0,
      flows: 0,
      effects: 0,
      auras: 0,
      assets: 0,
      reviewHeat: 0,
      reviewTrails: 0,
    });
    for (const resource of Object.values(first.resources)) {
      expect(resource).toMatchObject({
        requested: 0,
        rendered: 0,
        dropped: 0,
        suppressed: 0,
        pool: null,
      });
    }
    expect(first.resources.dots.budget).toBe(BOARD_RENDER_BUDGETS.dots);
    first.resources.dots.requested = 10;
    expect(emptyBoardRenderMetrics().resources.dots.requested).toBe(0);
  });

  it('初期化前の描画・リサイズ・停止要求と破棄は安全に処理する', () => {
    const renderer = new PixiBoardRenderer();
    expect(renderer.isReady).toBe(false);
    expect(renderer.getLastInput()).toBeNull();
    renderer.render(input());
    renderer.resize(100, 100);
    renderer.freezeForScreenshot();
    renderer.setAnimationsPaused(true);
    renderer.dispose();
    renderer.dispose();
    expect(renderer.getLastInput()).toBeNull();
    expect(pixi.retain).not.toHaveBeenCalled();
    expect(pixi.release).not.toHaveBeenCalled();
  });

  it.each([
    [
      'all',
      [
        'office',
        'flows',
        'reviewHeat',
        'stations',
        'reviewTrails',
        'dots',
        'shipments',
        'auras',
        'transientEffects',
      ],
    ],
    [
      'base',
      ['office', 'flows', 'reviewHeat', 'stations', 'reviewTrails', 'dots', 'shipments', 'auras'],
    ],
    ['effects', ['transientEffects']],
  ] as const)(
    '%s canvas の担当レイヤーだけを正しい重なり順で初期化する',
    async (stratum, names) => {
      const { renderer, app, appendChild, mount } = await mounted({ stratum });
      expect(renderer.isReady).toBe(true);
      expect(app.init).toHaveBeenCalledExactlyOnceWith({
        backgroundAlpha: 0,
        resizeTo: mount,
        antialias: true,
        resolution: 2,
        autoDensity: true,
      });
      expect(appendChild).toHaveBeenCalledExactlyOnceWith(app.canvas);
      expect(app.renderer.events.setTargetElement).toHaveBeenCalledExactlyOnceWith(app.canvas);
      expect(app.stage.eventMode).toBe('none');
      const root = app.stage.children[0];
      expect(root.sortableChildren).toBe(true);
      expect(root.children.map((child) => child.zIndex)).toEqual(
        names.map((name) => BOARD_PIXI_LAYER_ORDER[name]),
      );
      expect(pixi.ensure).toHaveBeenCalledOnce();
      expect(pixi.retain).toHaveBeenCalledOnce();
    },
  );

  it('盤面を contain-fit で中央配置し、停止中のリサイズでも再描画する', async () => {
    const { renderer, app } = await mounted();
    renderer.resize(0, 400);
    renderer.resize(800, -1);
    expect(app.renderer.resize).not.toHaveBeenCalled();
    renderer.resize(BOARD_VIEW.w / 2, BOARD_VIEW.h);
    const root = app.stage.children[0];
    expect(root.scale).toMatchObject({ x: 0.5, y: 0.5 });
    expect(root.position).toMatchObject({ x: 0, y: BOARD_VIEW.h / 4 });
    expect(app.render).not.toHaveBeenCalled();
    renderer.setAnimationsPaused(true);
    app.render.mockClear();
    renderer.resize(BOARD_VIEW.w * 2, BOARD_VIEW.h);
    expect(root.scale).toMatchObject({ x: 1, y: 1 });
    expect(root.position).toMatchObject({ x: BOARD_VIEW.w / 2, y: 0 });
    expect(app.render).toHaveBeenCalledOnce();
  });

  it('scene の粒・Review 警告と軌跡を描き、次の frame では不要な描画を消す', async () => {
    const { renderer, app, latest } = await mounted();
    const scene = planBoardScene([
      ...Array.from({ length: 12 }, (_, index) => task({ id: index, lane: 'review' })),
      task({ id: 20, progress: 0.5 }),
      task({ id: 21, progress: 0.7, aiAssisted: true }),
      task({ id: 22, lane: 'rework', progress: 0.8 }),
      task({ id: 23, lane: 'rework', incident: true, burnTicksLeft: 1 }),
      task({ id: 24, highValue: true, kind: 'complex' }),
    ]);
    const frame = input({ scene });
    renderer.render(frame);
    expect(renderer.getLastInput()).toBe(frame);
    expect(latest()).toMatchObject({
      dots: scene.dots.length,
      actors: 5,
      flows: 5,
      reviewTrails: 3,
      reviewHeat: 1,
    });
    expect(layer(app, 'reviewHeat').visible).toBe(true);
    expect(drawCalls(graphics(layer(app, 'reviewHeat')), 'ellipse')).toHaveLength(3);
    const trails = layer(app, 'reviewTrails').children as FakeGraphics[];
    expect(trails).toHaveLength(3);
    for (const [index, trail] of trails.entries()) {
      const plan = scene.reviewEffects.trails[index];
      expect(trail.position).toMatchObject({ x: plan.x, y: plan.y });
      expect(trail.rotation).toBeCloseTo((plan.angleDeg * Math.PI) / 180);
      expect(drawCalls(trail, 'stroke')).toHaveLength(3);
    }
    expect(drawCalls(layer(app, 'flows') as FakeGraphics, 'poly')).toHaveLength(scene.flows.length);
    renderer.render(input());
    expect(layer(app, 'reviewHeat').visible).toBe(false);
    expect(graphics(layer(app, 'reviewHeat')).commands).toEqual([]);
    expect(layer(app, 'reviewTrails').children).toEqual([]);
    expect(layer(app, 'dots').children).toEqual([]);
    expect(latest()).toMatchObject({ dots: 0, reviewTrails: 0, reviewHeat: 0 });
    for (const trail of trails) {
      expect(trail.commands).toEqual([]);
      expect(trail.rotation).toBe(0);
      expect(trail.alpha).toBe(1);
    }
  });

  it('ドラッグ粒を最前面に描き、再利用後はリングと炎を残さずテクスチャを共有する', async () => {
    const { renderer, app, latest } = await mounted();
    const scene = planBoardScene([
      task({ id: 1 }),
      task({ id: 2, incident: true, burnTicksLeft: 1 }),
    ]);
    renderer.render(input({ scene, draggableTaskIds: new Set([1]), dragTaskId: 2 }));
    const groups = [...layer(app, 'dots').children];
    expect(drawCalls(graphics(groups[0], 1), 'stroke')[0][0]).toMatchObject({
      color: VISUAL_TOKENS.colors.interaction.drag,
      alpha: 0.67,
    });
    expect(drawCalls(graphics(groups[1], 1), 'stroke')[0][0]).toMatchObject({
      color: VISUAL_TOKENS.colors.sun,
      alpha: 1,
    });
    expect(label(groups[1]).visible).toBe(true);
    expect(label(groups[1]).scale.x).toBeGreaterThan(0.75);
    const generatedCount = app.renderer.generateTexture.mock.calls.length;

    renderer.render(input({ scene: planBoardScene([task({ id: 3 }), task({ id: 4 })]) }));
    const reused = layer(app, 'dots').children;
    expect(new Set(reused)).toEqual(new Set(groups));
    for (const group of reused) {
      expect(graphics(group, 1).commands).toEqual([]);
      expect(label(group).visible).toBe(false);
      expect(group.rotation).toBe(0);
    }
    expect(sprite(reused[0]).texture).toBe(sprite(reused[1]).texture);
    expect(app.renderer.generateTexture).toHaveBeenCalledTimes(generatedCount);
    expect(latest().resources.dots.pool).toMatchObject({
      createdCount: 2,
      reuseCount: 2,
      activeCount: 2,
    });
  });

  it('描画予算を超えても操作中の粒を保持し、各プールの超過数と再利用を計測する', async () => {
    const { renderer, app, latest } = await mounted();
    const dotCount = BOARD_RENDER_BUDGETS.dots + 5;
    const seedScene = planBoardScene([task({ progress: 0.5 })]);
    const dots: BoardDotPlan[] = Array.from({ length: dotCount }, (_, index) => ({
      ...seedScene.dots[0],
      id: index,
      x: index,
      y: 10,
      motion: undefined,
    }));
    const trailCount = BOARD_RENDER_BUDGETS.reviewTrails + 2;
    const effectCount = BOARD_RENDER_BUDGETS.transientEffects + 3;
    const auras: BoardPixiInput['auras'] = Array.from({ length: 6 }, (_, index) => ({
      kind: (['throttle', 'overtime', 'andon', 'stability'] as const)[index % 4],
      remainingTicks: 2,
      totalTicks: index === 3 ? 0 : 10,
    }));
    const frame = input({
      scene: {
        ...seedScene,
        dots,
        reviewEffects: {
          heatField: null,
          trails: Array.from({ length: trailCount }, (_, index) => ({
            ...seedScene.reviewEffects.trails[0],
            taskId: index,
          })),
        },
      },
      dragTaskId: dotCount - 1,
      effects: createTimedBoardEffects(
        Array.from({ length: effectCount }, () => ({
          source: 'intervention',
          effect: { kind: 'successPulse' },
        })),
        0,
        900,
      ).effects,
      auras,
    });
    renderer.render(frame);
    expect(layer(app, 'dots').children.at(-1)?.position.x).toBe(dotCount - 1);
    expect(latest().resources).toMatchObject({
      dots: { requested: dotCount, rendered: BOARD_RENDER_BUDGETS.dots, dropped: 5 },
      reviewTrails: {
        requested: trailCount,
        rendered: BOARD_RENDER_BUDGETS.reviewTrails,
        dropped: 2,
      },
      effects: {
        requested: effectCount,
        rendered: BOARD_RENDER_BUDGETS.transientEffects,
        dropped: 3,
      },
      auras: { requested: 6, rendered: 4, dropped: 2 },
    });
    expect(drawCalls(graphics(layer(app, 'auras')), 'rect')).toHaveLength(4);
    renderer.render(frame);
    for (const key of ['dots', 'reviewTrails', 'effects'] as const) {
      const resource = latest().resources[key];
      expect(resource.pool).toMatchObject({
        createdCount: resource.budget,
        reuseCount: resource.budget,
        retainedCount: resource.budget,
      });
    }
    renderer.render(input());
    expect(layer(app, 'auras').visible).toBe(false);
    expect(graphics(layer(app, 'auras')).commands).toEqual([]);
  });

  it.each<StationMood>(['neutral', 'happy', 'tired', 'exhausted', 'panic', 'sad', 'cheer'])(
    'SVG 未取得でも %s の人物と状態印を描き、同じ表情のテクスチャは再利用する',
    async (mood) => {
      const { renderer, app } = await mounted();
      const overrides = { backlog: mood, coding: mood, review: mood, rework: mood, done: mood };
      const scene = planBoardScene([], overrides);
      renderer.render(input({ scene }));
      const stations = layer(app, 'stations');
      expect(stations.children).toHaveLength(15);
      const markers: Record<StationMood, string> = {
        neutral: '',
        happy: '✨',
        tired: '💦',
        exhausted: '💦',
        panic: '💢',
        sad: '😞',
        cheer: '🎉',
      };
      for (let index = 0; index < 5; index += 1) {
        const character = sprite(stations, index * 3);
        const desk = sprite(stations, index * 3 + 1);
        const status = label(stations, index * 3 + 2);
        expect(character.texture).not.toBe(pixi.Texture.EMPTY);
        expect(desk.texture).not.toBe(character.texture);
        expect(character.position).toEqual(desk.position);
        expect(status.text).toBe(markers[mood]);
        expect(status.visible).toBe(mood !== 'neutral');
      }
      expect(app.renderer.generateTexture).toHaveBeenCalledTimes(11);
      // 先頭の足元照明を除き、人物・机は同じフレームを共有する。
      for (const [options] of app.renderer.generateTexture.mock.calls.slice(1)) {
        expect(options.resolution).toBe(2);
        expect(options.frame).toMatchObject({
          width: VISUAL_TOKENS.dimensions.sprint.actor.local.w,
          height: VISUAL_TOKENS.dimensions.sprint.actor.local.h,
        });
        expect(graphics(options.target).commands.length).toBeGreaterThan(0);
        expect(options.target.destroy).toHaveBeenCalledExactlyOnceWith({ children: true });
      }
      renderer.render(input({ scene }));
      expect(app.renderer.generateTexture).toHaveBeenCalledTimes(11);
      expect(pixi.load).toHaveBeenCalledTimes(5);
      expect(stations.children).toHaveLength(15);
    },
  );

  it('停止・reduced motion・スクリーンショット固定を合成し、再開まで位相を進めない', async () => {
    const { renderer, app } = await mounted();
    const scene = planBoardScene([
      task({ id: 1 }),
      task({ id: 2, progress: 0.6 }),
      task({ id: 3, lane: 'rework', incident: true, burnTicksLeft: 1 }),
    ]);
    const frame = input({ scene });
    renderer.render(frame);
    const positions = () => layer(app, 'dots').children.map((group) => ({ ...group.position }));
    const initial = positions();
    app.advance(50);
    const moving = positions();
    expect(moving).not.toEqual(initial);
    renderer.setAnimationsPaused(true);
    app.advance(100);
    expect(positions()).toEqual(moving);
    renderer.setAnimationsPaused(false);
    expect(app.ticker.start).toHaveBeenCalled();
    app.advance(50);
    expect(positions()).not.toEqual(moving);

    renderer.render({ ...frame, reducedMotion: true });
    expect(positions()).toEqual(initial);
    app.advance(500);
    expect(positions()).toEqual(initial);
    app.ticker.start.mockClear();
    renderer.setAnimationsPaused(false);
    expect(app.ticker.start).not.toHaveBeenCalled();
    renderer.render(frame);
    expect(app.ticker.start).toHaveBeenCalledOnce();
    renderer.freezeForScreenshot();
    expect(positions()).toEqual(initial);
    app.ticker.start.mockClear();
    renderer.setAnimationsPaused(false);
    app.advance(500);
    expect(positions()).toEqual(initial);
    expect(app.ticker.start).not.toHaveBeenCalled();
  });

  const effectCases: {
    name: string;
    payload: BoardEffectPayload;
    x: number;
    y: number;
    rotation?: number;
    text?: string;
  }[] = [
    {
      name: '延焼',
      payload: {
        source: 'fire',
        effect: {
          kind: 'spread',
          fromTaskId: 1,
          toTaskId: 2,
          fromX: 10,
          fromY: 20,
          toX: 110,
          toY: 220,
        },
      },
      x: 60,
      y: 120,
    },
    {
      name: '自動鎮火',
      payload: {
        source: 'fire',
        effect: { kind: 'extinguish', taskId: 1, source: 'auto', x: 40, y: 50 },
      },
      x: 40,
      y: 50,
    },
    {
      name: '介入鎮火',
      payload: {
        source: 'fire',
        effect: { kind: 'extinguish', taskId: 1, source: 'firefight', x: 40, y: 50 },
      },
      x: 40,
      y: 50,
    },
    {
      name: '点火',
      payload: { source: 'fire', effect: { kind: 'ignite', taskId: 1, x: 40, y: 50 } },
      x: 40,
      y: 50,
    },
    ...(['done', 'rework', 'incident'] as const).map((outcome) => ({
      name: `レビュー介入 ${outcome}`,
      payload: {
        source: 'intervention',
        effect: {
          kind: 'reviewSweep',
          taskId: 1,
          fromX: 10,
          fromY: 20,
          toX: 110,
          toY: 120,
          staggerIndex: 1,
          outcome,
        },
      } satisfies BoardEffectPayload,
      x: 60,
      y: 70,
      rotation: Math.PI / 4,
    })),
    {
      name: '分割',
      payload: { source: 'intervention', effect: { kind: 'split', taskId: 1, x: 40, y: 50 } },
      x: 40,
      y: 50,
      text: 'split',
    },
    {
      name: '消火支援',
      payload: { source: 'intervention', effect: { kind: 'firefight', taskId: 1, x: 40, y: 50 } },
      x: 40,
      y: 50,
    },
    {
      name: '担当割当',
      payload: {
        source: 'intervention',
        effect: {
          kind: 'assignDash',
          taskId: 1,
          fromX: 10,
          fromY: 20,
          toX: 110,
          toY: 120,
          angleDeg: 30,
        },
      },
      x: 60,
      y: 70,
      rotation: Math.PI / 6,
    },
    {
      name: '盤面オーラ',
      payload: {
        source: 'intervention',
        effect: { kind: 'boardAura', modifierKind: 'andon', durationTicks: 10 },
      },
      x: BOARD_VIEW.w / 2,
      y: BOARD_VIEW.h * 0.42,
    },
    {
      name: '成功通知',
      payload: { source: 'intervention', effect: { kind: 'successPulse' } },
      x: BOARD_VIEW.w / 2,
      y: BOARD_VIEW.h * 0.42,
    },
  ];

  it.each(effectCases)(
    '$name は共通タイムラインに従って中央位置まで動き、期限で非表示になる',
    async ({ payload, x, y, rotation = 0, text = '' }) => {
      const { renderer, app, latest } = await mounted({ stratum: 'effects' });
      const [effect] = createTimedBoardEffects([payload], 1, 1_000).effects;
      vi.mocked(performance.now).mockReturnValue(
        effect.startedAtMs + effect.delayMs + effect.durationMs / 2,
      );
      renderer.render(input({ effects: [effect] }));
      const effectLayer = layer(app, 'transientEffects');
      const group = effectLayer.children[0];
      expect(effectLayer.children).toHaveLength(1);
      expect(group.visible).toBe(true);
      expect(group.position.x).toBeCloseTo(x);
      expect(group.position.y).toBeCloseTo(y);
      expect(group.rotation).toBeCloseTo(rotation);
      expect(group.alpha).toBeGreaterThan(0);
      expect(group.scale.x).toBeGreaterThan(0);
      expect(group.alpha).toBeLessThanOrEqual(1);
      expect(graphics(group).commands.length).toBeGreaterThan(0);
      expect(label(group, 1).text).toBe(text);
      expect(label(group, 1).visible).toBe(text !== '');
      expect(latest()).toMatchObject({ dots: 0, actors: 0, flows: 0, effects: 1, auras: 0 });
      expect(latest().resources.dots.pool).toBeNull();
      expect(pixi.load).not.toHaveBeenCalled();

      vi.mocked(performance.now).mockReturnValue(
        effect.startedAtMs + effect.delayMs + effect.durationMs,
      );
      app.advance(16);
      expect(group.visible).toBe(false);
      renderer.render(input({ effects: [effect] }));
      expect(effectLayer.children).toHaveLength(0);
      expect(latest().effects).toBe(0);
    },
  );

  it('遅延中の演出は隠し、スクリーンショットでは最新演出の中央位相を描く', async () => {
    const { renderer, app } = await mounted({ stratum: 'effects' });
    const effects = createTimedBoardEffects(
      [
        {
          source: 'intervention',
          effect: {
            kind: 'reviewSweep',
            taskId: 1,
            fromX: 10,
            fromY: 20,
            toX: 110,
            toY: 120,
            staggerIndex: 2,
            outcome: 'done',
          },
        },
      ],
      1,
      1_000,
    ).effects;
    renderer.render(input({ effects }));
    const group = layer(app, 'transientEffects').children[0];
    expect(group.visible).toBe(false);
    renderer.freezeForScreenshot();
    expect(group.visible).toBe(true);
    expect(group.position.x).toBeCloseTo(65);
    expect(group.position.y).toBeCloseTo(75);
    expect(app.ticker.stop).toHaveBeenCalledOnce();
    expect(app.render).toHaveBeenCalledOnce();
    vi.mocked(performance.now).mockReturnValue(1_000_000);
    renderer.render(input({ effects }));
    expect(layer(app, 'transientEffects').children[0].visible).toBe(true);
    expect(layer(app, 'transientEffects').children[0].position.x).toBeCloseTo(65);
  });

  it('reduced motion は有効な一時演出だけを抑制数に計上し、解除後はプールを再利用する', async () => {
    const { renderer, app, latest } = await mounted();
    const effects = createTimedBoardEffects(
      [
        { source: 'intervention', effect: { kind: 'split', taskId: 1, x: 40, y: 50 } },
        {
          source: 'intervention',
          effect: {
            kind: 'assignDash',
            taskId: 2,
            fromX: 1,
            fromY: 2,
            toX: 10,
            toY: 20,
            angleDeg: 30,
          },
        },
      ],
      0,
      900,
    ).effects;
    renderer.render(input({ effects }));
    const groups = [...layer(app, 'transientEffects').children];
    expect(label(groups[0], 1).text).toBe('split');
    const expired = createTimedBoardEffects(
      [{ source: 'intervention', effect: { kind: 'successPulse' } }],
      3,
      0,
    ).effects;
    renderer.render(input({ effects: [...effects, ...expired], reducedMotion: true }));
    expect(layer(app, 'transientEffects').children).toEqual([]);
    expect(latest().resources.effects).toMatchObject({
      requested: 2,
      rendered: 0,
      suppressed: 2,
      dropped: 0,
    });
    for (const group of groups) {
      expect(label(group, 1).text).toBe('');
      expect(label(group, 1).visible).toBe(false);
      expect(label(group, 1).tint).toBe(0xffffff);
      expect(group.rotation).toBe(0);
      expect(group.scale).toMatchObject({ x: 1, y: 1 });
      expect(graphics(group).commands).toEqual([]);
    }
    renderer.render(input({ effects }));
    expect(new Set(layer(app, 'transientEffects').children)).toEqual(new Set(groups));
    expect(latest().resources.effects).toMatchObject({
      requested: 2,
      rendered: 2,
      suppressed: 0,
      dropped: 0,
      pool: { createdCount: 2, reuseCount: 2 },
    });
  });

  it('base canvas は一時演出を描かず、effects canvas との担当を分ける', async () => {
    const { renderer, app, latest } = await mounted({ stratum: 'base' });
    const effects = createTimedBoardEffects(
      [{ source: 'intervention', effect: { kind: 'successPulse' } }],
      0,
      900,
    ).effects;
    renderer.render(input({ effects, scene: planBoardScene([task()]) }));
    expect(layer(app, 'dots').children).toHaveLength(1);
    expect(
      app.stage.children[0].children.some(
        (child) => child.zIndex === BOARD_PIXI_LAYER_ORDER.transientEffects,
      ),
    ).toBe(false);
    expect(latest()).toMatchObject({
      dots: 1,
      actors: 5,
      effects: 0,
      resources: { effects: { pool: null, requested: 0 } },
    });
  });

  it('読み込み完了は停止中も人物を差し替えて描画し、失敗した人物はフォールバックを保持する', async () => {
    const pending = deferred<Texture | null>();
    pixi.load.mockReturnValueOnce(pending.promise).mockResolvedValue(null);
    const { renderer, app, latest } = await mounted();
    renderer.setAnimationsPaused(true);
    renderer.render(input());
    const stations = layer(app, 'stations');
    const character = sprite(stations);
    const fallback = character.texture;
    await Promise.resolve();
    expect(latest().assets).toBe(4);
    expect(sprite(stations, 3).texture).not.toBe(pixi.Texture.EMPTY);
    const loaded = new pixi.Texture(400, 200);
    app.render.mockClear();
    pending.resolve(loaded as unknown as Texture);
    await Promise.resolve();
    expect(character.texture).toBe(loaded);
    expect(character.texture).not.toBe(fallback);
    expect(character.scale.x).toBeCloseTo(
      (BOARD_VIEW.w * VISUAL_TOKENS.dimensions.sprint.stationWidthPercent) / 100 / 400,
    );
    expect(app.render).toHaveBeenCalledOnce();
    expect(latest().assets).toBe(5);
    renderer.render(input());
    expect(pixi.load).toHaveBeenCalledTimes(5);
    renderer.dispose();
    expect(loaded.destroy).not.toHaveBeenCalled();
  });

  it('破棄後に SVG 取得が完了しても人物・メトリクス・canvas を更新しない', async () => {
    const pending = deferred<Texture | null>();
    pixi.load.mockReturnValue(pending.promise);
    const { renderer, app, metrics } = await mounted();
    const effects = createTimedBoardEffects(
      [{ source: 'intervention', effect: { kind: 'split', taskId: 1, x: 40, y: 50 } }],
      0,
      900,
    ).effects;
    renderer.render(input({ scene: planBoardScene([task({ progress: 0.5 })]), effects }));
    const character = sprite(layer(app, 'stations'));
    const fallback = character.texture;
    const pooledDot = layer(app, 'dots').children[0];
    const pooledTrail = layer(app, 'reviewTrails').children[0];
    const pooledEffect = layer(app, 'transientEffects').children[0];
    const textures = app.renderer.generateTexture.mock.results.map((result) => result.value);
    renderer.render(input()); // free に戻った粒も dispose で破棄される。
    renderer.dispose();
    expect(pooledDot.destroy).toHaveBeenCalledExactlyOnceWith({ children: true });
    expect(pooledTrail.destroy).toHaveBeenCalledExactlyOnceWith();
    expect(pooledEffect.destroy).toHaveBeenCalledExactlyOnceWith({ children: true });
    for (const resource of [pooledDot, pooledTrail, pooledEffect]) {
      expect(resource.destroy.mock.invocationCallOrder[0]).toBeLessThan(
        app.destroy.mock.invocationCallOrder[0],
      );
    }
    for (const texture of textures) expect(texture.destroy).toHaveBeenCalledExactlyOnceWith(true);
    expect(pixi.release).toHaveBeenCalledOnce();
    expect(pixi.release.mock.invocationCallOrder[0]).toBeLessThan(
      app.destroy.mock.invocationCallOrder[0],
    );
    expect(app.destroy).toHaveBeenCalledExactlyOnceWith(true, {
      children: true,
      texture: false,
      context: true,
    });
    metrics.mockClear();
    app.render.mockClear();
    pending.resolve(new pixi.Texture() as unknown as Texture);
    await Promise.resolve();
    expect(character.texture).toBe(fallback);
    expect(metrics).not.toHaveBeenCalled();
    expect(app.render).not.toHaveBeenCalled();
    expect(renderer.isReady).toBe(false);
    expect(renderer.getLastInput()).toBeNull();
    renderer.dispose();
    expect(app.destroy).toHaveBeenCalledOnce();
  });

  it('初期化待ちで破棄された canvas は mount せず、生成済み Application を破棄する', async () => {
    const pending = deferred<void>();
    pixi.initialize.mockReturnValue(pending.promise);
    const renderer = new PixiBoardRenderer();
    renderers.push(renderer);
    const appendChild = vi.fn();
    const initializing = renderer.init({ appendChild } as unknown as HTMLElement);
    const app = pixi.applications.at(-1)!;
    renderer.dispose();
    pending.resolve(undefined);
    await initializing;
    expect(renderer.isReady).toBe(false);
    expect(appendChild).not.toHaveBeenCalled();
    expect(pixi.retain).not.toHaveBeenCalled();
    expect(app.destroy).toHaveBeenCalledExactlyOnceWith(true, {
      children: true,
      texture: false,
      context: true,
    });
  });
});
