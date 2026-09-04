import { Children, isValidElement, type ReactNode, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BoardPixiInput,
  PixiBoardRendererOptions,
} from '../../../src/render/adapters/pixiBoardRenderer';
import type { PixiDeptRendererOptions } from '../../../src/render/adapters/pixiDeptRenderer';
import type { PixiOrgRendererOptions } from '../../../src/render/adapters/pixiOrgRenderer';
import type { DepartmentState, Team } from '../../../src/sim/orgscale/types';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as {
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: [] as (() => void)[],
  layoutEffects: [] as (() => void)[],
  enqueue(
    queue: (() => void)[],
    setup: () => void | (() => void),
    dependencies: readonly unknown[],
  ) {
    const index = this.cursor++;
    const previous = this.slots[index];
    if (
      previous?.dependencies?.length === dependencies.length &&
      dependencies.every((value, i) => Object.is(value, previous.dependencies?.[i]))
    ) {
      return;
    }
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    this.slots[index] = slot;
    queue.push(() => {
      previous?.cleanup?.();
      slot.cleanup = setup() ?? undefined;
    });
  },
}));

const boundary = vi.hoisted(() => ({
  board: vi.fn(),
  department: vi.fn(),
  organization: vi.fn(),
  reducedMotion: null as boolean | null,
}));

// Node 上で ref の接続、layout/passive effect、アンマウントを代行する。
// コンポーネントと layout 指紋は実装を使い、WebGL adapter だけを置き換える。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useEffect(setup: () => void | (() => void), dependencies: readonly unknown[]) {
    hooks.enqueue(hooks.effects, setup, dependencies);
  },
  useLayoutEffect(setup: () => void | (() => void), dependencies: readonly unknown[]) {
    hooks.enqueue(hooks.layoutEffects, setup, dependencies);
  },
  useImperativeHandle(
    ref: RefObject<unknown>,
    create: () => unknown,
    dependencies: readonly unknown[],
  ) {
    hooks.enqueue(
      hooks.layoutEffects,
      () => {
        ref.current = create();
        return () => {
          ref.current = null;
        };
      },
      dependencies,
    );
  },
}));
vi.mock('framer-motion', () => ({ useReducedMotion: () => boundary.reducedMotion }));
vi.mock('../../../src/render/adapters/pixiBoardRenderer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/render/adapters/pixiBoardRenderer')>()),
  PixiBoardRenderer: boundary.board,
}));
vi.mock('../../../src/render/adapters/pixiDeptRenderer', () => ({
  PixiDeptRenderer: boundary.department,
}));
vi.mock('../../../src/render/adapters/pixiOrgRenderer', () => ({
  PixiOrgRenderer: boundary.organization,
}));

import { emptyBoardRenderMetrics } from '../../../src/render/adapters/pixiBoardRenderer';
import { planBoardScene } from '../../../src/render/boardScene';
import { BoardPixiLayer, type BoardPixiLayerProps } from '../../../src/ui/BoardPixiLayer';
import { DeptPixiBoard, type DeptPixiBoardProps } from '../../../src/ui/DeptPixiBoard';
import {
  OrgPixiField,
  type OrgPixiFieldHandle,
  type OrgPixiFieldProps,
} from '../../../src/ui/OrgPixiField';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class RendererLifecycle {
  isReady = false;
  initialization = deferred<void>();
  init = vi.fn(() =>
    this.initialization.promise.then(() => {
      this.isReady = true;
    }),
  );
  resize = vi.fn();
  dispose = vi.fn(() => {
    this.isReady = false;
  });
  freezeForScreenshot = vi.fn();
}

class BoardRenderer extends RendererLifecycle {
  options: PixiBoardRendererOptions;
  lastInput: BoardPixiInput | null = null;
  render = vi.fn((input: BoardPixiInput) => {
    this.lastInput = input;
  });
  getLastInput = vi.fn(() => this.lastInput);
  setAnimationsPaused = vi.fn();
  constructor(options: PixiBoardRendererOptions) {
    super();
    this.options = options;
  }
}

class DeptRenderer extends RendererLifecycle {
  options: PixiDeptRendererOptions;
  lastDept: DepartmentState | null = null;
  render = vi.fn((dept: DepartmentState) => {
    this.lastDept = dept;
  });
  getLastDept = vi.fn(() => this.lastDept);
  focusTeamZoom = vi.fn((_id: string) => Promise.resolve(true));
  constructor(options: PixiDeptRendererOptions) {
    super();
    this.options = options;
  }
}

class OrgRenderer extends RendererLifecycle {
  options: PixiOrgRendererOptions;
  setScrollHost = vi.fn();
  setFieldView = vi.fn();
  renderTeams = vi.fn();
  fitToContent = vi.fn();
  invalidateFitCache = vi.fn();
  focusCompany = vi.fn(() => Promise.resolve());
  focusDepartment = vi.fn(() => Promise.resolve());
  focusTeamCamera = vi.fn(() => Promise.resolve());
  playFocusRing = vi.fn();
  getZoomScale = vi.fn(() => 1.5);
  focusRingActive = true;
  constructor(options: PixiOrgRendererOptions) {
    super();
    this.options = options;
  }
}

class Host extends EventTarget {
  clientWidth = 720;
  clientHeight = 360;
  scrollLeft = 0;
  scrollTop = 0;
  dataset: Record<string, string> = {};
  scrollHost: Host | null = null;
  closest = vi.fn(() => this.scrollHost);
}

class Observer {
  static all: Observer[] = [];
  observe = vi.fn();
  disconnect = vi.fn();
  constructor(readonly notify: () => void) {
    Observer.all.push(this);
  }
}

const boards: BoardRenderer[] = [];
const departments: DeptRenderer[] = [];
const organizations: OrgRenderer[] = [];
const attachedRefs = new Set<RefObject<Host | null>>();

function unmount() {
  for (const ref of attachedRefs) ref.current = null;
  for (const slot of hooks.slots) slot.cleanup?.();
  attachedRefs.clear();
  hooks.slots = [];
  hooks.effects = [];
  hooks.layoutEffects = [];
  hooks.cursor = 0;
}

function mountComponent<P>(
  render: (props: P) => ReactNode,
  initial: P,
  scrollHost: Host | null = null,
) {
  let props = initial;
  let tree: ReactNode;
  const hosts = new Map<string, Host>();
  const connectRefs = (node: ReactNode) => {
    for (const child of Children.toArray(node)) {
      if (
        !isValidElement<{
          ref?: RefObject<Host | null>;
          children?: ReactNode;
          'data-testid'?: string;
        }>(child)
      )
        continue;
      if (child.props.ref) {
        const id = child.props['data-testid']!;
        let host = hosts.get(id);
        if (!host) {
          host = new Host();
          host.scrollHost = scrollHost;
          hosts.set(id, host);
        }
        child.props.ref.current = host;
        attachedRefs.add(child.props.ref);
      }
      connectRefs(child.props.children);
    }
  };
  const flush = () => {
    hooks.cursor = 0;
    tree = render(props);
    connectRefs(tree);
    for (const effect of hooks.layoutEffects.splice(0)) effect();
    for (const effect of hooks.effects.splice(0)) effect();
  };
  flush();
  return {
    get tree() {
      return tree;
    },
    host(id: string) {
      const host = hosts.get(id);
      if (!host) throw new Error(`描画領域が見つかりません: ${id}`);
      return host;
    },
    update(next: Partial<P>) {
      props = { ...props, ...next };
      flush();
    },
    unmount,
  };
}

function boardProps(overrides: Partial<BoardPixiLayerProps> = {}): BoardPixiLayerProps {
  return { scene: planBoardScene([]), effects: [], auras: [], ...overrides };
}

function makeTeam(id: string, overrides: Partial<Team> = {}): Team {
  return {
    id,
    deptId: 'product',
    name: id,
    gridX: 0,
    gridY: 0,
    shipping: 0,
    aiDependency: 20,
    reviewQueue: 0,
    incidents: 0,
    morale: 80,
    techDebt: 0,
    engineers: 5,
    aiAssignedCount: 1,
    health: 'healthy',
    isPlayer: false,
    isActive: false,
    ...overrides,
  };
}

function makeDept(overrides: Partial<DepartmentState> = {}): DepartmentState {
  return {
    def: { id: 'product', name: 'プロダクト', color: '#112233', teamCount: 2 },
    teams: [makeTeam('active', { isActive: true }), makeTeam('idle', { gridX: 1 })],
    shipping: 0,
    aiDependency: 20,
    reviewResilience: 80,
    techDebt: 0,
    morale: 80,
    onFire: 0,
    health: 'healthy',
    ...overrides,
  };
}

function mountOrg(overrides: Partial<OrgPixiFieldProps> = {}, scrollHost: Host | null = null) {
  const ref: RefObject<OrgPixiFieldHandle | null> = { current: null };
  const component = OrgPixiField as unknown as {
    render(props: OrgPixiFieldProps, ref: RefObject<OrgPixiFieldHandle | null>): ReactNode;
  };
  const props: OrgPixiFieldProps = {
    teams: makeDept().teams,
    departments: [],
    zoom: { level: 'company', deptId: null, teamId: null },
    onFocusTeam: vi.fn(),
    deptColor: () => '#112233',
    ...overrides,
  };
  return { ...mountComponent((input) => component.render(input, ref), props, scrollHost), ref };
}

async function flushPromises() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

async function ready(...renderers: RendererLifecycle[]) {
  for (const renderer of renderers) renderer.initialization.resolve();
  await flushPromises();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', {
    setTimeout: (callback: () => void, delay: number) => setTimeout(callback, delay),
  });
  vi.stubGlobal('ResizeObserver', Observer);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  boundary.reducedMotion = null;
  boundary.board.mockReset().mockImplementation(function (options: PixiBoardRendererOptions) {
    const renderer = new BoardRenderer(options);
    boards.push(renderer);
    return renderer;
  });
  boundary.department.mockReset().mockImplementation(function (options: PixiDeptRendererOptions) {
    const renderer = new DeptRenderer(options);
    departments.push(renderer);
    return renderer;
  });
  boundary.organization.mockReset().mockImplementation(function (options: PixiOrgRendererOptions) {
    const renderer = new OrgRenderer(options);
    organizations.push(renderer);
    return renderer;
  });
});

afterEach(() => {
  unmount();
  boards.length = 0;
  departments.length = 0;
  organizations.length = 0;
  Observer.all = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BoardPixiLayer のライフサイクル', () => {
  it('二層の初期化完了後に最新入力と停止状態を適用して ready を通知する', async () => {
    const oldReady = vi.fn();
    const onReady = vi.fn();
    const layer = mountComponent(BoardPixiLayer, boardProps({ onReady: oldReady }));
    const [base, effects] = boards;
    expect(boards.map((renderer) => renderer.options.stratum)).toEqual(['base', 'effects']);
    expect(base.init).toHaveBeenCalledWith(layer.host('board-pixi-mount'));
    expect(effects.init).toHaveBeenCalledWith(layer.host('board-pixi-effects-mount'));
    Observer.all[0].notify();
    expect(base.resize).not.toHaveBeenCalled();

    const next = boardProps({ dragTaskId: 3, draggableTaskIds: new Set([3]) });
    layer.update({ ...next, animationsPaused: true, onReady });
    await ready(base);
    expect(onReady).not.toHaveBeenCalled();
    expect(base.render).not.toHaveBeenCalled();
    await ready(effects);
    for (const renderer of boards) {
      expect(renderer.resize).toHaveBeenLastCalledWith(720, 360);
      expect(renderer.render).toHaveBeenLastCalledWith({ ...next, reducedMotion: false });
      expect(renderer.setAnimationsPaused).toHaveBeenLastCalledWith(true);
      expect(renderer.render.mock.invocationCallOrder.at(-1)).toBeLessThan(
        onReady.mock.invocationCallOrder[0],
      );
    }
    expect(oldReady).not.toHaveBeenCalled();
    expect(onReady).toHaveBeenCalledOnce();

    boundary.reducedMotion = true;
    layer.update({ dragTaskId: null, animationsPaused: false });
    for (const renderer of boards) {
      expect(renderer.render).toHaveBeenLastCalledWith(
        expect.objectContaining({ dragTaskId: null, reducedMotion: true }),
      );
      expect(renderer.setAnimationsPaused).toHaveBeenLastCalledWith(false);
    }
    expect(boundary.board).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('resize は各層の直近入力を保ち、メトリクスと撮影フックを接続・解除する', async () => {
    const layer = mountComponent(BoardPixiLayer, boardProps());
    const [base, effects] = boards;
    await ready(base, effects);
    const currentBase = { ...base.lastInput!, dragTaskId: 4 };
    const currentEffects = { ...effects.lastInput!, dragTaskId: 5 };
    base.lastInput = currentBase;
    effects.lastInput = currentEffects;
    const mount = layer.host('board-pixi-mount');
    mount.clientWidth = 900;
    mount.clientHeight = 450;
    Observer.all[0].notify();
    expect(base.render).toHaveBeenLastCalledWith(currentBase);
    expect(effects.render).toHaveBeenLastCalledWith(currentEffects);
    expect(effects.resize).toHaveBeenLastCalledWith(900, 450);

    const baseMetrics = emptyBoardRenderMetrics();
    Object.assign(baseMetrics, {
      dots: 4,
      actors: 5,
      assets: 6,
      reviewTrails: 7,
      reviewHeat: 8,
      auras: 9,
    });
    baseMetrics.resources.dots.dropped = 2;
    baseMetrics.resources.reviewTrails.dropped = 3;
    base.options.onRenderMetrics?.(baseMetrics);
    const effectMetrics = emptyBoardRenderMetrics();
    effectMetrics.effects = 10;
    effectMetrics.resources.effects.dropped = 11;
    effectMetrics.resources.effects.suppressed = 12;
    effects.options.onRenderMetrics?.(effectMetrics);
    expect(mount.dataset).toEqual({
      boardDots: '4',
      boardActors: '5',
      boardAssets: '6',
      boardReviewTrails: '7',
      boardReviewHeat: '8',
      boardEffects: '10',
      boardAuras: '9',
      boardDotDropped: '2',
      boardDotCreated: '0',
      boardDotReused: '0',
      boardTrailDropped: '3',
    });
    expect(layer.host('board-pixi-effects-mount').dataset).toEqual({
      boardEffects: '10',
      boardEffectDropped: '11',
      boardEffectSuppressed: '12',
      boardEffectCreated: '0',
      boardEffectReused: '0',
    });
    expect(window.__boardPixiTest?.getMetrics()).toEqual({
      base: baseMetrics,
      effects: effectMetrics,
    });
    window.__boardPixiTest?.freezeForScreenshot();
    expect(base.freezeForScreenshot).toHaveBeenCalledOnce();
    expect(effects.freezeForScreenshot).toHaveBeenCalledOnce();
    const observer = Observer.all[0];
    layer.unmount();
    expect(window.__boardPixiTest).toBeUndefined();
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(base.dispose).toHaveBeenCalledOnce();
    expect(effects.dispose).toHaveBeenCalledOnce();
    const renders = base.render.mock.calls.length;
    observer.notify();
    base.options.onRenderMetrics?.(emptyBoardRenderMetrics());
    expect(base.render).toHaveBeenCalledTimes(renders);
    expect(mount.dataset.boardDots).toBe('4');
  });

  it('初期化失敗は最新の fallback callback だけに通知する', async () => {
    const oldError = vi.fn();
    const onWebglError = vi.fn();
    const onReady = vi.fn();
    const layer = mountComponent(BoardPixiLayer, boardProps({ onWebglError: oldError, onReady }));
    layer.update({ onWebglError });
    boards[0].initialization.reject(new Error('WebGL unavailable'));
    await ready(boards[1]);
    expect(oldError).not.toHaveBeenCalled();
    expect(onWebglError).toHaveBeenCalledOnce();
    expect(onReady).not.toHaveBeenCalled();
    expect(boards[0].render).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)(
    '初期化中に離脱した後の %s で通知も描画も再開しない',
    async (outcome) => {
      const onWebglError = vi.fn();
      const onReady = vi.fn();
      const layer = mountComponent(BoardPixiLayer, boardProps({ onWebglError, onReady }));
      layer.unmount();
      if (outcome === 'reject') boards[0].initialization.reject(new Error('late failure'));
      await ready(...boards);
      expect(onWebglError).not.toHaveBeenCalled();
      expect(onReady).not.toHaveBeenCalled();
      expect(window.__boardPixiTest).toBeUndefined();
      for (const renderer of boards) {
        expect(renderer.render).not.toHaveBeenCalled();
        expect(renderer.dispose).toHaveBeenCalledOnce();
      }
    },
  );

  it('演出到着と指定遅延を待って初期化し、待機中の離脱では開始しない', async () => {
    window.__delayBoardPixiInit = { waitForEffects: true, delayMs: 20 };
    const layer = mountComponent(BoardPixiLayer, boardProps());
    await vi.advanceTimersByTimeAsync(16);
    expect(boards[0].init).not.toHaveBeenCalled();
    const effect: BoardPixiInput['effects'][number] = {
      source: 'fire',
      effect: { kind: 'ignite', taskId: 1, x: 10, y: 20 },
      sequence: 1,
      startedAtMs: 0,
      delayMs: 0,
      durationMs: 100,
      endsAtMs: 100,
    };
    layer.update({ effects: [effect] });
    await vi.advanceTimersByTimeAsync(35);
    expect(boards[0].init).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(boards[0].init).toHaveBeenCalledOnce();
    await ready(...boards);
    expect(boards[0].lastInput?.effects).toEqual([effect]);
    layer.unmount();

    const cancelled = mountComponent(BoardPixiLayer, boardProps());
    const pending = boards[2];
    cancelled.unmount();
    await vi.runAllTimersAsync();
    expect(pending.init).not.toHaveBeenCalled();
    expect(pending.dispose).toHaveBeenCalledOnce();
  });

  it('強制初期化失敗フックの遅延後に fallback へ移り、WebGL を起動しない', async () => {
    window.__forceBoardPixiInitFailure = { delayMs: 25 };
    const onWebglError = vi.fn();
    mountComponent(BoardPixiLayer, boardProps({ onWebglError }));
    await vi.advanceTimersByTimeAsync(24);
    expect(onWebglError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(onWebglError).toHaveBeenCalledOnce();
    expect(boards[0].init).not.toHaveBeenCalled();
    expect(boards[1].init).not.toHaveBeenCalled();
  });
});

describe('OrgPixiField のライフサイクル', () => {
  it('最新チームを初回 fit に使用し、スクロールと canvas の寸法を同期する', async () => {
    const scrollHost = new Host();
    scrollHost.scrollLeft = 25;
    scrollHost.scrollTop = 40;
    scrollHost.clientWidth = 1500;
    scrollHost.clientHeight = 1000;
    const field = mountOrg({}, scrollHost);
    const renderer = organizations[0];
    const teams = [makeTeam('new', { gridX: 2 })];
    field.update({ teams });
    expect(renderer.renderTeams).not.toHaveBeenCalled();
    await ready(renderer);
    expect(renderer.fitToContent).toHaveBeenCalledExactlyOnceWith(teams);
    expect(renderer.setScrollHost).toHaveBeenCalledExactlyOnceWith(scrollHost);
    expect(renderer.setFieldView).toHaveBeenLastCalledWith({
      scrollX: 25,
      scrollY: 40,
      width: 720,
      height: 360,
    });
    expect(renderer.renderTeams).toHaveBeenLastCalledWith(teams);
    expect(Observer.all[0].observe.mock.calls).toEqual([
      [field.host('org-pixi-mount')],
      [scrollHost],
    ]);

    scrollHost.scrollLeft = 100;
    const mount = field.host('org-pixi-mount');
    mount.clientWidth = 640;
    scrollHost.dispatchEvent(new Event('scroll'));
    expect(renderer.setFieldView).toHaveBeenLastCalledWith({
      scrollX: 100,
      scrollY: 40,
      width: 640,
      height: 360,
    });
    expect(renderer.resize).toHaveBeenLastCalledWith(640, 360);
    Observer.all[0].notify();
    renderer.options.onPlanMetrics?.({ sprites: [], culled: 3, overBudget: 4, total: 7 });
    renderer.options.onRenderMetrics?.({ avatarAssetsLoaded: 2, avatarAssetsRequired: 5 });
    expect(mount.dataset).toEqual({
      orgSprites: '0',
      orgCulled: '3',
      orgOverBudget: '4',
      orgTotal: '7',
      orgAvatarAssetsLoaded: '2',
      orgAvatarAssetsRequired: '5',
    });
    const removeScroll = vi.spyOn(scrollHost, 'removeEventListener');
    const observer = Observer.all[0];
    field.unmount();
    const renders = renderer.renderTeams.mock.calls.length;
    scrollHost.dispatchEvent(new Event('scroll'));
    observer.notify();
    renderer.options.onRenderMetrics?.({ avatarAssetsLoaded: 0, avatarAssetsRequired: 0 });
    expect(renderer.renderTeams).toHaveBeenCalledTimes(renders);
    expect(mount.dataset.orgAvatarAssetsLoaded).toBe('2');
    expect(removeScroll).toHaveBeenCalledWith('scroll', expect.any(Function));
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(field.ref.current).toBeNull();
    expect(window.__orgPixiTest).toBeUndefined();
  });

  it('指標だけの変化では fit を維持し、チーム配置変更時に再計算する', async () => {
    const teams = [makeTeam('one'), makeTeam('two', { gridX: 1 })];
    const field = mountOrg({ teams });
    const renderer = organizations[0];
    await ready(renderer);
    const metricsOnly = teams.map((team) => ({ ...team, shipping: 100 }));
    field.update({ teams: metricsOnly });
    expect(renderer.renderTeams).toHaveBeenLastCalledWith(metricsOnly);
    expect(renderer.invalidateFitCache).not.toHaveBeenCalled();
    expect(renderer.fitToContent).toHaveBeenCalledOnce();
    const moved = metricsOnly.map((team) => ({ ...team, gridY: 2 }));
    field.update({ teams: moved });
    expect(renderer.invalidateFitCache).toHaveBeenCalledOnce();
    expect(renderer.fitToContent).toHaveBeenLastCalledWith(moved);
    expect(renderer.setFieldView).toHaveBeenLastCalledWith({
      scrollX: 0,
      scrollY: 0,
      width: 720,
      height: 360,
    });
    expect(renderer.setScrollHost).toHaveBeenCalledWith(null);
    expect(boundary.organization).toHaveBeenCalledOnce();
  });

  it.each([
    { id: 'active', camera: 'focusTeamCamera', destination: 'active' },
    { id: 'idle', camera: 'focusDepartment', destination: 'product' },
  ] as const)(
    '$id チームは適切なカメラ移動を完了してから最新 callback へ遷移する',
    async ({ id, camera, destination }) => {
      const oldFocus = vi.fn();
      const onFocusTeam = vi.fn();
      const field = mountOrg({ onFocusTeam: oldFocus });
      const renderer = organizations[0];
      await ready(renderer);
      const movement = deferred<void>();
      renderer[camera].mockReturnValue(movement.promise);
      field.update({ deptColor: () => '#abcdef' });
      expect(renderer.options.deptColor?.('product')).toBe('#abcdef');
      renderer.options.onFocusTeam?.(id);
      expect(renderer.playFocusRing).toHaveBeenCalledWith(makeDept().teams, id);
      expect(renderer[camera]).toHaveBeenCalledWith(makeDept().teams, destination, true);
      const otherCamera = camera === 'focusDepartment' ? 'focusTeamCamera' : 'focusDepartment';
      expect(renderer[otherCamera]).not.toHaveBeenCalled();
      expect(onFocusTeam).not.toHaveBeenCalled();
      field.update({ onFocusTeam });
      movement.resolve();
      await flushPromises();
      expect(onFocusTeam).toHaveBeenCalledExactlyOnceWith(id);
      expect(oldFocus).not.toHaveBeenCalled();
    },
  );

  it('未初期化の選択は即時通知し、公開ハンドルと撮影フックは最新チームを使う', async () => {
    const onFocusTeam = vi.fn();
    const field = mountOrg({ onFocusTeam });
    const renderer = organizations[0];
    renderer.options.onFocusTeam?.('active');
    expect(onFocusTeam).toHaveBeenCalledExactlyOnceWith('active');
    expect(renderer.playFocusRing).not.toHaveBeenCalled();
    await ready(renderer);
    const teams = [makeTeam('new')];
    field.update({ teams });
    const handle = field.ref.current!;
    await handle.focusCompany();
    await handle.focusDepartment('product');
    await handle.focusTeam('new');
    expect(renderer.focusCompany).toHaveBeenLastCalledWith(teams, true);
    expect(renderer.focusDepartment).toHaveBeenLastCalledWith(teams, 'product', true);
    expect(renderer.focusTeamCamera).toHaveBeenLastCalledWith(teams, 'new', true);
    await window.__orgPixiTest?.focusTeamCamera('new');
    expect(renderer.focusTeamCamera).toHaveBeenLastCalledWith(teams, 'new', false);
    expect(window.__orgPixiTest?.getZoomScale()).toBe(1.5);
    expect(window.__orgPixiTest?.isFocusRingActive()).toBe(true);
    window.__orgPixiTest?.freezeForScreenshot();
    expect(renderer.freezeForScreenshot).toHaveBeenCalledOnce();
    field.unmount();
    await expect(handle.focusCompany()).resolves.toBeUndefined();
    await expect(handle.focusDepartment('product')).resolves.toBeUndefined();
    await expect(handle.focusTeam('new')).resolves.toBeUndefined();
    expect(renderer.focusCompany).toHaveBeenCalledOnce();
    expect(renderer.focusDepartment).toHaveBeenCalledOnce();
    expect(renderer.focusTeamCamera).toHaveBeenCalledTimes(2);
  });

  it('部署から全社へ戻るときだけカメラを全体 fit に戻す', async () => {
    const field = mountOrg();
    const renderer = organizations[0];
    await ready(renderer);
    field.update({ zoom: { level: 'company', deptId: null, teamId: null } });
    expect(renderer.focusCompany).not.toHaveBeenCalled();
    field.update({ zoom: { level: 'department', deptId: 'product', teamId: null } });
    expect(renderer.focusCompany).not.toHaveBeenCalled();
    field.update({ zoom: { level: 'company', deptId: null, teamId: null } });
    expect(renderer.focusCompany).toHaveBeenCalledExactlyOnceWith(makeDept().teams, true);
    field.update({ zoom: { level: 'company', deptId: null, teamId: null } });
    expect(renderer.focusCompany).toHaveBeenCalledOnce();
  });

  it.each(['mounted', 'unmounted'] as const)(
    '初期化失敗時は %s の状態に応じて最新 fallback callback を通知する',
    async (state) => {
      const oldError = vi.fn();
      const onWebglError = vi.fn();
      const field = mountOrg({ onWebglError: oldError });
      field.update({ onWebglError });
      if (state === 'unmounted') field.unmount();
      organizations[0].initialization.reject(new Error('WebGL unavailable'));
      await flushPromises();
      expect(oldError).not.toHaveBeenCalled();
      expect(onWebglError).toHaveBeenCalledTimes(state === 'mounted' ? 1 : 0);
      expect(organizations[0].renderTeams).not.toHaveBeenCalled();
    },
  );

  it('初期化完了前に離脱したら fit と撮影フックの登録を行わない', async () => {
    const field = mountOrg();
    const renderer = organizations[0];
    field.unmount();
    await ready(renderer);
    expect(renderer.fitToContent).not.toHaveBeenCalled();
    expect(renderer.renderTeams).not.toHaveBeenCalled();
    expect(window.__orgPixiTest).toBeUndefined();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});

describe('DeptPixiBoard のライフサイクル', () => {
  it('初期化中の部署更新を初回描画へ反映し、その後も renderer を再生成せず更新する', async () => {
    const props: DeptPixiBoardProps = { dept: makeDept(), onFocusTeam: vi.fn() };
    const board = mountComponent(DeptPixiBoard, props);
    const renderer = departments[0];
    const latest = makeDept({ shipping: 100, onFire: 1 });
    board.update({ dept: latest });
    Observer.all[0].notify();
    expect(renderer.render).not.toHaveBeenCalled();
    await ready(renderer);
    expect(renderer.render).toHaveBeenCalledExactlyOnceWith(latest);
    expect(renderer.resize).toHaveBeenLastCalledWith(720, 360);
    expect(
      isValidElement<{ className: string }>(board.tree) && board.tree.props.className,
    ).toContain('dept-hell');
    const changed = makeDept({ health: 'reviewHell' });
    board.update({ dept: changed });
    expect(renderer.render).toHaveBeenLastCalledWith(changed);
    expect(
      isValidElement<{ className: string }>(board.tree) && board.tree.props.className,
    ).toContain('dept-hell');
    board.update({ dept: makeDept() });
    expect(isValidElement<{ className: string }>(board.tree) && board.tree.props.className).toBe(
      'dept-board iso-dept',
    );
    expect(boundary.department).toHaveBeenCalledOnce();
  });

  it('resize は直近部署を再描画し、メトリクス・撮影フック・observer を解除する', async () => {
    const board = mountComponent(DeptPixiBoard, { dept: makeDept(), onFocusTeam: vi.fn() });
    const renderer = departments[0];
    await ready(renderer);
    const last = makeDept({ shipping: 200 });
    renderer.lastDept = last;
    const mount = board.host('dept-pixi-mount');
    mount.clientWidth = 900;
    Observer.all[0].notify();
    expect(renderer.render).toHaveBeenLastCalledWith(last);
    expect(renderer.resize).toHaveBeenLastCalledWith(900, 360);
    renderer.options.onRenderMetrics?.({ teams: 2, flows: 4, assets: 6 });
    expect(mount.dataset).toEqual({ deptTeams: '2', deptFlows: '4', deptAssets: '6' });
    window.__deptPixiTest?.freezeForScreenshot();
    expect(renderer.freezeForScreenshot).toHaveBeenCalledOnce();
    const observer = Observer.all[0];
    board.unmount();
    const renders = renderer.render.mock.calls.length;
    observer.notify();
    renderer.options.onRenderMetrics?.({ teams: 0, flows: 0, assets: 0 });
    expect(renderer.render).toHaveBeenCalledTimes(renders);
    expect(mount.dataset.deptTeams).toBe('2');
    expect(observer.disconnect).toHaveBeenCalledOnce();
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(window.__deptPixiTest).toBeUndefined();
  });

  it.each([true, false])(
    'アクティブチームのズーム結果 completed=%s に応じて最新 callback へ遷移する',
    async (completed) => {
      const oldFocus = vi.fn();
      const onFocusTeam = vi.fn();
      const board = mountComponent(DeptPixiBoard, { dept: makeDept(), onFocusTeam: oldFocus });
      const renderer = departments[0];
      await ready(renderer);
      const movement = deferred<boolean>();
      renderer.focusTeamZoom.mockReturnValue(movement.promise);
      renderer.options.onFocusTeam?.('active');
      expect(renderer.focusTeamZoom).toHaveBeenCalledExactlyOnceWith('active');
      expect(oldFocus).not.toHaveBeenCalled();
      board.update({ onFocusTeam });
      movement.resolve(completed);
      await flushPromises();
      expect(oldFocus).not.toHaveBeenCalled();
      expect(onFocusTeam.mock.calls).toEqual(completed ? [['active']] : []);
    },
  );

  it('非アクティブ・未知チームと初期化前の選択はズームせず即時通知する', async () => {
    const onFocusTeam = vi.fn();
    const board = mountComponent(DeptPixiBoard, { dept: makeDept(), onFocusTeam });
    const renderer = departments[0];
    renderer.options.onFocusTeam?.('active');
    await ready(renderer);
    renderer.options.onFocusTeam?.('idle');
    renderer.options.onFocusTeam?.('missing');
    board.update({ dept: makeDept({ teams: [makeTeam('active')] }) });
    renderer.options.onFocusTeam?.('active');
    expect(onFocusTeam.mock.calls).toEqual([['active'], ['idle'], ['missing'], ['active']]);
    expect(renderer.focusTeamZoom).not.toHaveBeenCalled();
  });

  it.each(['mounted', 'unmounted'] as const)(
    '初期化失敗時は %s の状態に応じて最新 fallback callback を通知する',
    async (state) => {
      const oldError = vi.fn();
      const onWebglError = vi.fn();
      const board = mountComponent(DeptPixiBoard, {
        dept: makeDept(),
        onFocusTeam: vi.fn(),
        onWebglError: oldError,
      });
      board.update({ onWebglError });
      if (state === 'unmounted') board.unmount();
      departments[0].initialization.reject(new Error('WebGL unavailable'));
      await flushPromises();
      expect(oldError).not.toHaveBeenCalled();
      expect(onWebglError).toHaveBeenCalledTimes(state === 'mounted' ? 1 : 0);
      expect(departments[0].render).not.toHaveBeenCalled();
    },
  );

  it('初期化完了前に離脱したら描画と撮影フックの登録を行わない', async () => {
    const board = mountComponent(DeptPixiBoard, { dept: makeDept(), onFocusTeam: vi.fn() });
    const renderer = departments[0];
    board.unmount();
    await ready(renderer);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(window.__deptPixiTest).toBeUndefined();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });
});
