import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[],
}));

// Node の最小 hook / DOM harness。シーン計画、フォーカス移譲、子アクターは実装を使う。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: initial };
    const slot = hooks.slots[index];
    return [
      slot.value,
      (update: unknown) => {
        const value =
          typeof update === 'function'
            ? (update as (previous: unknown) => unknown)(slot.value)
            : update;
        if (!Object.is(value, slot.value)) {
          slot.value = value;
          hooks.dirty = true;
        }
      },
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useLayoutEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (
      previous?.dependencies?.length === dependencies.length &&
      dependencies.every((value, i) => Object.is(value, previous.dependencies![i]))
    )
      return;
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() ?? undefined;
    });
  },
}));

import { ORG_VIEW } from '../../../src/render/orgBoardScene';
import { orgBoardCompactMaxWidthPx, VISUAL_TOKENS } from '../../../src/render/visualTokens';
import { createOrgState } from '../../../src/sim/org';
import { generateOrgScale } from '../../../src/sim/orgscale';
import type { Team } from '../../../src/sim/orgscale/types';
import { OrgBoard, type OrgBoardProps } from '../../../src/ui/OrgBoard';
import { emptyRunTotals } from '../helpers/whatIfFixtures';

type Props = Record<string, unknown> & { children?: ReactNode };

function expand(node: ReactNode): ReactNode {
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === 'function') {
    return expand((node.type as (props: Props) => ReactNode)(node.props));
  }
  return cloneElement(node, {}, ...Children.toArray(node.props.children).map(expand));
}

function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<Props>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}

function mountBoard(width: number = ORG_VIEW.w) {
  const domDocument: { activeElement: unknown; body: object; documentElement: object } = {
    activeElement: null,
    body: {},
    documentElement: {},
  };
  const dock = {
    scrollTop: 0,
    scrollLeft: 0,
    getBoundingClientRect: () => ({ top: 0, bottom: 100, left: 0, right: 200 }),
  };
  class Element {
    constructor(public props: Props) {}
    focus = vi.fn((_options: FocusOptions) => {
      domDocument.activeElement = this;
      (this.props.onFocus as (() => void) | undefined)?.();
    });
    closest(selector: string): Element | typeof dock | null {
      if (selector === '[data-team-id]') return this.props['data-team-id'] ? this : null;
      return selector === '.org-island-badge-dock' ? dock : null;
    }
    getAttribute(name: string) {
      return this.props[name] ?? null;
    }
    getBoundingClientRect() {
      return { top: 120, bottom: 160, left: 0, right: 160 };
    }
  }
  let currentNodes = new Map<string, Element>();
  const root = {
    clientWidth: width,
    style: { setProperty: vi.fn() },
    querySelector(selector: string) {
      const id = selector.match(/data-team-id="([^"]+)"/)?.[1];
      const isDock = selector.startsWith('.org-island-badge-dock-hit');
      return currentNodes.get(`${isDock ? 'dock' : 'island'}:${id}`) ?? null;
    },
  };
  let resize = () => {};
  const observe = vi.fn();
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  vi.stubGlobal('HTMLElement', Element);
  vi.stubGlobal('document', domDocument);
  vi.stubGlobal('CSS', { escape: (value: string) => value });

  let props: OrgBoardProps = {
    org: generateOrgScale({
      seed: 'org-board-interactions',
      org: createOrgState('default', true),
      totals: emptyRunTotals(),
      diagnosis: 'healthyAcceleration',
      budget: 100,
    }),
    onFocusTeam: vi.fn(),
  };
  let tree: ReactNode;
  const render = () => {
    let attempts = 0;
    do {
      if (++attempts > 20) throw new Error('OrgBoard の更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = expand(OrgBoard(props));
      const nextNodes = new Map<string, Element>();
      for (const node of elements(tree)) {
        if (node.props['data-testid'] === 'org-board') {
          (node.props.ref as { current: unknown }).current = root;
        }
        if (node.type !== 'button' || !node.props['data-team-id']) continue;
        const isDock = String(node.props.className).includes('org-island-badge-dock-hit');
        const key = `${isDock ? 'dock' : 'island'}:${node.props['data-team-id']}`;
        const element = currentNodes.get(key) ?? new Element(node.props);
        element.props = node.props;
        nextNodes.set(key, element);
      }
      if (
        [...currentNodes.values()].includes(domDocument.activeElement as Element) &&
        ![...nextNodes.values()].includes(domDocument.activeElement as Element)
      ) {
        domDocument.activeElement = domDocument.body;
      }
      currentNodes = nextNodes;
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  const query = (id: string) => elements(tree).find((node) => node.props['data-testid'] === id);
  const find = (id: string) => {
    const node = query(id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  render();
  return {
    get props() {
      return props;
    },
    get activeElement() {
      return domDocument.activeElement;
    },
    root,
    dock,
    observe,
    disconnect,
    query,
    find,
    node: (key: string) => currentNodes.get(key)!,
    all: () => elements(tree),
    update(next: Partial<OrgBoardProps>) {
      props = { ...props, ...next };
      render();
    },
    resize(width: number) {
      root.clientWidth = width;
      resize();
      render();
    },
    blurToDocument() {
      domDocument.activeElement = domDocument.body;
    },
    focusOutside() {
      domDocument.activeElement = new Element({});
    },
    focus(key: string) {
      currentNodes.get(key)!.focus({ preventScroll: true });
      render();
    },
    event(id: string, event: 'onClick' | 'onMouseDown', value?: unknown) {
      (find(id).props[event] as (value?: unknown) => void)(value);
      render();
    },
    imageEvent(image: ReactElement<Props>, event: 'onLoad' | 'onError') {
      (image.props[event] as () => void)();
      render();
    },
    unmount() {
      for (const slot of hooks.slots) {
        slot.cleanup?.();
        slot.cleanup = undefined;
      }
    },
  };
}

afterEach(() => {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('OrgBoard の選択と compact 表示', () => {
  it('広い盤面では島と状態バッジを表示し、クリックしたチームを通知する', () => {
    const board = mountBoard();
    const dept = board.props.org.departments[0];
    const team = dept.teams[0];
    expect(board.find('org-board').props['data-compact']).toBe('false');
    expect(board.root.style.setProperty).toHaveBeenLastCalledWith('--org-board-scale', '1');
    expect(board.observe).toHaveBeenCalledExactlyOnceWith(board.root);
    expect(board.find(`team-${team.id}`).props.title).toContain(dept.def.name);
    expect(board.find(`team-${team.id}`).props.title).toContain(team.name);
    expect(board.find(`team-${team.id}`).props.tabIndex).toBeUndefined();
    expect(content(board.find(`island-badge-${team.id}`))).toContain(`${team.engineers}人`);
    const preventDefault = vi.fn();
    board.event(`team-${team.id}`, 'onMouseDown', { preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    board.event(`team-${team.id}`, 'onClick');
    expect(board.props.onFocusTeam).toHaveBeenCalledExactlyOnceWith(team.id);
    board.unmount();
    expect(board.disconnect).toHaveBeenCalledOnce();
  });

  it('幅の境界で島からドックへフォーカスを移し、再拡大時に同じ島へ戻す', () => {
    const board = mountBoard();
    const team = board.props.org.departments[0].teams[0];
    board.focus(`island:${team.id}`);
    board.resize(orgBoardCompactMaxWidthPx());
    expect(board.find('org-board').props['data-compact']).toBe('true');
    expect(board.find(`team-${team.id}`).props.tabIndex).toBe(-1);
    expect(board.activeElement).toBe(board.node(`dock:${team.id}`));
    expect(board.node(`dock:${team.id}`).focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(board.dock.scrollTop).toBe(60);
    expect(board.find(`island-badge-${team.id}`).props['aria-label']).toContain(
      `${team.engineers}人`,
    );
    expect(board.find(`island-badge-${team.id}`).props['aria-current']).toBe(
      team.isPlayer || undefined,
    );
    const sections = board.all().filter((node) => node.type === 'section');
    expect(sections).toHaveLength(board.props.org.departments.length);
    expect(sections.every((node) => typeof node.props['aria-labelledby'] === 'string')).toBe(true);
    board.event(`island-badge-${team.id}`, 'onClick');
    expect(board.props.onFocusTeam).toHaveBeenCalledExactlyOnceWith(team.id);

    board.resize(orgBoardCompactMaxWidthPx() + 1);
    expect(board.find('org-board').props['data-compact']).toBe('false');
    expect(board.activeElement).toBe(board.node(`island:${team.id}`));
    expect(board.node(`island:${team.id}`).focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(board.query('org-island-badge-dock')).toBeUndefined();
  });

  it('compact の島を押すとドックへ寄せ、既にドックにあるフォーカスを重複操作しない', () => {
    const board = mountBoard(0);
    const team = board.props.org.departments[0].teams[1];
    expect(board.root.style.setProperty).toHaveBeenLastCalledWith('--org-board-scale', '1');
    const preventDefault = vi.fn();
    board.event(`team-${team.id}`, 'onMouseDown', { preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    board.event(`team-${team.id}`, 'onClick');
    expect(board.activeElement).toBe(board.node(`dock:${team.id}`));
    expect(board.props.onFocusTeam).toHaveBeenCalledExactlyOnceWith(team.id);
    board.event(`team-${team.id}`, 'onClick');
    expect(board.node(`dock:${team.id}`).focus).toHaveBeenCalledOnce();
    board.focus(`island:${team.id}`);
    expect(board.activeElement).toBe(board.node(`dock:${team.id}`));
  });

  it('document へ落ちたフォーカスは復元するが、盤面外へ移ったフォーカスは奪わない', () => {
    const board = mountBoard();
    const team = board.props.org.departments[0].teams[0];
    board.focus(`island:${team.id}`);
    board.blurToDocument();
    board.resize(400);
    expect(board.activeElement).toBe(board.node(`dock:${team.id}`));
    board.focusOutside();
    const external = board.activeElement;
    board.resize(ORG_VIEW.w);
    expect(board.activeElement).toBe(external);
    board.resize(ORG_VIEW.w + 100);
    expect(board.activeElement).toBe(external);
    expect(board.root.style.setProperty).toHaveBeenLastCalledWith(
      '--org-board-scale',
      String((ORG_VIEW.w + 100) / ORG_VIEW.w),
    );
  });

  it('幅に余裕があってもチーム数が容量を超えれば全チームをドックに載せる', () => {
    const board = mountBoard();
    const org = board.props.org;
    const teams = Array.from({ length: 30 }, (_, index) => ({
      ...org.departments[0].teams[0],
      id: `large-team-${index}`,
    }));
    board.update({
      org: {
        ...org,
        departments: org.departments.map((dept, index) =>
          index === 0 ? { ...dept, teams } : dept,
        ),
      },
    });
    expect(board.find('org-board').props['data-compact']).toBe('true');
    for (const team of teams) {
      expect(board.find(`island-badge-${team.id}`).type).toBe('button');
    }
    board.event('island-badge-large-team-29', 'onClick');
    expect(board.props.onFocusTeam).toHaveBeenCalledExactlyOnceWith('large-team-29');
  });
});

describe('OrgBoard のアクター表示', () => {
  it.each([
    ['neutral', { health: 'healthy', morale: 80, incidents: 0 }],
    ['sad', { health: 'healthy', morale: 20, incidents: 0 }],
    ['tired', { health: 'congested', morale: 80, incidents: 0 }],
    ['panic', { health: 'reviewHell', morale: 80, incidents: 2 }],
  ] satisfies [string, Partial<Team>][])(
    '%s の画像を読み込むまで代替人物を表示し、失敗時も人物を残す',
    (mood, teamPatch) => {
      const board = mountBoard();
      const org = board.props.org;
      const target = org.departments[0].teams[0];
      board.update({
        org: {
          ...org,
          onFire: teamPatch.incidents ?? 0,
          departments: org.departments.map((dept, index) =>
            index === 0
              ? {
                  ...dept,
                  teams: dept.teams.map((team, teamIndex) =>
                    teamIndex === 0
                      ? {
                          ...team,
                          ...teamPatch,
                          engineers: 4,
                          aiAssignedCount: 3,
                          aiDependency: 90,
                        }
                      : team,
                  ),
                }
              : dept,
          ),
        },
      });
      const actor = () => elements(board.find(`team-${target.id}`));
      const images = () => actor().filter((node) => node.type === 'image');
      const skins = () =>
        actor().filter(
          (node) => node.type === 'circle' && node.props.fill === VISUAL_TOKENS.colors.actor.skin,
        );
      expect(images()).toHaveLength(4);
      expect(
        images().every((image) => image.props.className === `org-game-asset mood-${mood}`),
      ).toBe(true);
      expect(images().every((image) => image.props.opacity === 0)).toBe(true);
      expect(skins()).toHaveLength(4);
      expect(
        actor().filter(
          (node) => node.type === 'circle' && node.props.fill === `url(#aip-${target.id})`,
        ),
      ).toHaveLength(3);
      if (mood === 'panic') {
        expect(content(board.find(`team-${target.id}`))).toContain('🔥');
        expect(board.find('org-board').props.className).toContain('org-hell');
      }
      board.imageEvent(images()[0], 'onLoad');
      expect(images()[0].props.opacity).toBeGreaterThan(0);
      expect(skins()).toHaveLength(3);
      board.imageEvent(images()[1], 'onError');
      expect(images()[1].props.opacity).toBe(0);
      expect(skins()).toHaveLength(3);
      const markers = actor().filter((node) => node.props.className === 'org-game-asset-marker');
      expect(markers).toHaveLength(mood === 'neutral' ? 0 : 1);
    },
  );
});
