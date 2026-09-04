import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[] }));

// Node 環境では ref の接続と effect の開始・解除だけを代行する。
// JSX と入力判定・スクロール処理は実装をそのまま実行する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));

import { registerBoardDragHitTest } from '../../../src/render/boardDragHit';
import type { SprintEvent } from '../../../src/sim/types';
import { EventTicker, type EventTickerProps } from '../../../src/ui/EventTicker';

type ElementProps = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<ElementProps>(node)) return '';
  return Children.toArray(node.props.children).map(content).join('');
}

const cleanups: (() => void)[] = [];
const sampleEvents: SprintEvent[] = [{ tick: 1, kind: 'ignite', taskId: 1, source: 'review' }];

class BrowserEvents extends EventTarget {
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ) {
    // Node 24 の EventTarget でも boolean の capture をブラウザと同じ意味で解除する。
    super.removeEventListener(
      type,
      callback,
      typeof options === 'boolean' ? { capture: options } : options,
    );
  }
}

function mountTicker(props: EventTickerProps = { events: sampleEvents }) {
  const parent = {
    clientHeight: 150,
    scrollHeight: 150,
    scrollTop: 0,
    getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 300 }),
  };
  const list = {
    clientHeight: 100,
    scrollHeight: 300,
    scrollTop: 0,
    parentElement: parent as typeof parent | null,
    getBoundingClientRect: () => ({ left: 20, right: 280, top: 20, bottom: 200 }),
    closest: vi.fn((_selector: string): unknown => null),
    focus: vi.fn(),
  };
  const frames: FrameRequestCallback[] = [];
  const browser = Object.assign(new BrowserEvents(), {
    getComputedStyle: () => ({ lineHeight: '18px' }),
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    }),
  });
  const addListener = vi.spyOn(browser, 'addEventListener');
  const removeListener = vi.spyOn(browser, 'removeEventListener');
  const elementFromPoint = vi.fn((): unknown => null);
  vi.stubGlobal('window', browser);
  vi.stubGlobal('document', { elementFromPoint });

  const tree = EventTicker(props);
  const nodes = elements(tree);
  const find = (id: string) => {
    const node = nodes.find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  const listProps = find('event-ticker-list').props;
  (listProps.ref as { current: unknown }).current = list;
  const mountedCleanups = hooks.effects.splice(0).map((effect) => effect());
  const unmount = () => mountedCleanups.splice(0).forEach((cleanup) => cleanup?.());
  cleanups.push(unmount);

  function dispatch(type: string, fields: Record<string, unknown> = {}, cancelable = true) {
    const { defaultPrevented, ...eventFields } = fields;
    const event = Object.assign(new Event(type, { cancelable }), {
      clientX: 80,
      clientY: 100,
      pointerId: 1,
      pointerType: 'pen',
      isPrimary: true,
      ctrlKey: false,
      metaKey: false,
      deltaY: 24,
      deltaMode: 0,
      ...eventFields,
    });
    if (defaultPrevented) event.preventDefault();
    browser.dispatchEvent(event);
    return event;
  }

  function key(key: string) {
    const event = { currentTarget: list, key, preventDefault: vi.fn() };
    (listProps.onKeyDown as (event: unknown) => void)(event);
    return event;
  }

  return {
    list,
    parent,
    tree,
    nodes,
    find,
    key,
    frames,
    dispatch,
    unmount,
    addListener,
    removeListener,
    elementFromPoint,
  };
}

function touches(...ys: number[]) {
  return { touches: ys.map((clientY, identifier) => ({ identifier, clientX: 80, clientY })) };
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  hooks.effects = [];
  registerBoardDragHitTest(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('EventTicker の表示とフォーカス', () => {
  it('履歴が空なら見出しを無効化し、リストをフォーカス順と入力監視から外す', () => {
    const ticker = mountTicker({ events: [] });

    expect(ticker.find('event-ticker-heading').props.disabled).toBe(true);
    expect(ticker.find('event-ticker-list').props.tabIndex).toBeUndefined();
    expect(ticker.nodes.some((node) => node.props['data-testid'] === 'event-ticker-now')).toBe(
      false,
    );
    expect(ticker.addListener).not.toHaveBeenCalled();
    expect(ticker.dispatch('wheel').defaultPrevented).toBe(false);
  });

  it.each([false, true])(
    'frozen=%s でも直近5件を新しい順に表示し、現在のコンボを併記する',
    (frozen) => {
      const events: SprintEvent[] = Array.from({ length: 6 }, (_, index) => ({
        tick: index + 1,
        kind: 'contain',
        taskId: index,
        combo: index + 1,
      }));
      events.push({ tick: 7, kind: 'combo-break', reason: 'rework' });
      const ticker = mountTicker({ events, liveCombo: 8, frozen });
      const rows = ticker.nodes.filter((node) =>
        String(node.props['data-testid']).startsWith('event-ticker-row-'),
      );

      expect(rows.map(content)).toEqual([
        '💔コンボ途切れ: 手戻り発生',
        '🚒鎮火成功 → コンボ x6 継続',
        '🚒鎮火成功 → コンボ x5 継続',
        '🚒鎮火成功 → コンボ x4 継続',
        '🚒鎮火成功 → コンボ x3 継続',
      ]);
      expect(rows[0].props.className).toBe('event-ticker-row tone-bad');
      expect(rows[0].props.initial).toEqual(frozen ? undefined : { opacity: 0, x: 16 });
      expect(content(ticker.find('event-ticker-now'))).toBe('現在 COMBO ×8');
      expect(ticker.find('event-ticker-heading').props.disabled).toBe(false);
      expect(ticker.find('event-ticker-list').props.tabIndex).toBe(0);
      expect(ticker.find('event-ticker-list').props['aria-labelledby']).toBe(
        ticker.find('event-ticker-heading').props.id,
      );
      (ticker.find('event-ticker-heading').props.onClick as () => void)();
      expect(ticker.list.focus).toHaveBeenCalledWith({ preventScroll: true });
    },
  );
});

describe('EventTicker に接続されたホイール操作', () => {
  it.each([
    [0, 24, 24],
    [1, 2, 36],
    [2, 1, 100],
  ])('deltaMode=%s を表示寸法に換算してスクロールする', (deltaMode, deltaY, expected) => {
    const ticker = mountTicker();

    const event = ticker.dispatch('wheel', { deltaMode, deltaY });

    expect(ticker.list.scrollTop).toBe(expected);
    expect(ticker.parent.scrollTop).toBe(0);
    expect(event.defaultPrevented).toBe(true);
    expect(ticker.frames).toHaveLength(0);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Meta', { metaKey: true }],
    ['領域外', { clientX: 301 }],
    ['横スクロール', { deltaY: 0 }],
  ])('%s のホイールはブラウザへ渡す', (_label, fields) => {
    const ticker = mountTicker();

    expect(ticker.dispatch('wheel', fields).defaultPrevented).toBe(false);
    expect(ticker.list.scrollTop).toBe(0);
    expect(ticker.frames).toHaveLength(0);
  });

  it('リストに収まる場合は親のスクロール領域を利用し、取消不可でも位置を更新する', () => {
    const ticker = mountTicker();
    ticker.list.scrollHeight = 100;
    ticker.parent.scrollHeight = 400;

    expect(ticker.dispatch('wheel', { clientY: 10 }, false).defaultPrevented).toBe(false);
    expect(ticker.list.scrollTop).toBe(0);
    expect(ticker.parent.scrollTop).toBe(24);
  });

  it('溢れない一覧では抑止せず、境界では抑止を維持して次フレームに再試行する', () => {
    const ticker = mountTicker();
    ticker.list.scrollHeight = 100;
    expect(ticker.dispatch('wheel').defaultPrevented).toBe(false);
    expect(ticker.frames).toHaveLength(0);

    ticker.list.scrollHeight = 300;
    ticker.list.scrollTop = 200;
    expect(ticker.dispatch('wheel').defaultPrevented).toBe(true);
    expect(ticker.frames).toHaveLength(1);
    ticker.list.scrollTop = 170;
    ticker.frames[0](0);
    expect(ticker.list.scrollTop).toBe(194);
  });
});

describe('EventTicker に接続されたポインターとタッチ操作', () => {
  it.each(['pointerup', 'pointercancel'])('pen は開始地点からパンし、%s で終了する', (end) => {
    const ticker = mountTicker();
    expect(ticker.dispatch('pointerdown').defaultPrevented).toBe(true);
    expect(ticker.dispatch('pointermove', { pointerId: 2, clientY: 30 }).defaultPrevented).toBe(
      false,
    );
    expect(ticker.list.scrollTop).toBe(0);
    expect(ticker.dispatch('pointermove', { clientY: 60 }).defaultPrevented).toBe(true);
    expect(ticker.list.scrollTop).toBe(40);
    ticker.dispatch(end, { pointerId: 2 });
    ticker.dispatch('pointermove', { clientY: 50 });
    expect(ticker.list.scrollTop).toBe(50);
    ticker.dispatch(end);
    expect(ticker.dispatch('pointermove', { clientY: 20 }).defaultPrevented).toBe(false);
    expect(ticker.list.scrollTop).toBe(50);
  });

  it('主タッチの開始は抑止せず、二つ目の接触でパンを解除する', () => {
    const ticker = mountTicker();
    expect(ticker.dispatch('pointerdown', { pointerType: 'touch' }).defaultPrevented).toBe(false);
    expect(ticker.dispatch('pointermove', { clientY: 80 }).defaultPrevented).toBe(true);
    expect(ticker.list.scrollTop).toBe(20);

    ticker.dispatch('pointerdown', { pointerType: 'touch', pointerId: 2, isPrimary: false });
    expect(ticker.dispatch('pointermove', { clientY: 60 }).defaultPrevented).toBe(false);
    expect(ticker.list.scrollTop).toBe(20);
  });

  it.each(['touchend', 'touchcancel'])('単接触の touchmove だけ処理し、%s で解除する', (end) => {
    const ticker = mountTicker();
    expect(ticker.dispatch('touchmove', touches(60)).defaultPrevented).toBe(false);
    expect(ticker.dispatch('touchstart', touches(100)).defaultPrevented).toBe(false);
    expect(ticker.dispatch('touchmove', touches(70)).defaultPrevented).toBe(true);
    expect(ticker.list.scrollTop).toBe(30);

    ticker.dispatch(end, touches(70));
    ticker.dispatch('touchmove', touches(60), false);
    expect(ticker.list.scrollTop).toBe(40);
    ticker.dispatch(end, touches());
    expect(ticker.dispatch('touchmove', touches(30)).defaultPrevented).toBe(false);
    expect(ticker.list.scrollTop).toBe(40);
  });

  it.each(['touchstart', 'touchmove'])(
    '%s で複数接触になったら単接触に戻ってもパンしない',
    (type) => {
      const ticker = mountTicker();
      ticker.dispatch('touchstart', touches(100));
      expect(ticker.dispatch(type, touches(90, 110)).defaultPrevented).toBe(false);
      expect(ticker.dispatch('touchmove', touches(50)).defaultPrevented).toBe(false);
      expect(ticker.list.scrollTop).toBe(0);
    },
  );

  it.each([
    ['mouse', { pointerType: 'mouse' }],
    ['開始済みの操作', { defaultPrevented: true }],
    ['リスト外', { clientX: 10 }],
  ])('%s ではポインターパンを開始しない', (_label, fields) => {
    const ticker = mountTicker();
    ticker.dispatch('pointerdown', fields);
    expect(ticker.dispatch('pointermove', { clientY: 50 }).defaultPrevented).toBe(false);
    expect(ticker.list.scrollTop).toBe(0);
  });

  it('リスト外から始まる touch は後から一覧へ入っても奪わない', () => {
    const ticker = mountTicker();
    ticker.dispatch('touchstart', touches(10));
    expect(ticker.dispatch('touchmove', touches(50)).defaultPrevented).toBe(false);
    expect(ticker.list.scrollTop).toBe(0);
  });

  it.each(['DOM', 'Pixi'])('%s のドラッグ可能な粒に重なるタッチは盤面へ渡す', (renderer) => {
    const ticker = mountTicker();
    if (renderer === 'DOM') {
      ticker.elementFromPoint.mockReturnValue({
        closest: (selector: string) =>
          selector === '[data-task-id][data-draggable="true"]' ? {} : null,
      });
    } else {
      registerBoardDragHitTest((x, y) => x === 80 && y === 100);
    }

    ticker.dispatch('touchstart', touches(100));
    expect(ticker.dispatch('touchmove', touches(50)).defaultPrevented).toBe(false);
    expect(ticker.list.scrollTop).toBe(0);
  });

  it.each(['inert', 'overlay'])('%s の背面ではホイールもタッチも処理しない', (mode) => {
    const ticker = mountTicker();
    if (mode === 'inert') ticker.list.closest.mockReturnValue({});
    else ticker.elementFromPoint.mockReturnValue({ closest: () => ({}) });

    expect(ticker.dispatch('wheel').defaultPrevented).toBe(false);
    ticker.dispatch('touchstart', touches(100));
    expect(ticker.dispatch('touchmove', touches(50)).defaultPrevented).toBe(false);
    expect(ticker.list.scrollTop).toBe(0);
  });
});

describe('EventTicker のキーボード操作と解除', () => {
  it('矢印・ページ・端移動で全履歴に到達し、端でも外側へのスクロールを抑止する', () => {
    const ticker = mountTicker();
    for (const [key, top] of [
      ['ArrowDown', 24],
      ['PageDown', 124],
      ['End', 200],
      ['ArrowDown', 200],
      ['PageUp', 100],
      ['ArrowUp', 76],
      ['Home', 0],
      ['ArrowUp', 0],
    ] as const) {
      expect(ticker.key(key).preventDefault).toHaveBeenCalledOnce();
      expect(ticker.list.scrollTop).toBe(top);
    }
    expect(ticker.key('Tab').preventDefault).not.toHaveBeenCalled();
  });

  it('親が溢れる場合は親を動かし、溢れなくなれば既定のキー操作を許す', () => {
    const ticker = mountTicker();
    ticker.list.scrollHeight = 100;
    ticker.parent.scrollHeight = 400;
    expect(ticker.key('PageDown').preventDefault).toHaveBeenCalledOnce();
    expect(ticker.parent.scrollTop).toBe(150);
    expect(ticker.list.scrollTop).toBe(0);

    ticker.parent.scrollHeight = 150;
    expect(ticker.key('ArrowDown').preventDefault).not.toHaveBeenCalled();
  });

  it('解除後は全てのグローバル入力が一覧を動かさず、既定動作も奪わない', () => {
    const ticker = mountTicker();
    // Node の単一 EventTarget では伝播順を再現しないため、capture と抑止許可も確認する。
    for (const type of ['wheel', 'pointerdown', 'touchstart', 'touchmove']) {
      expect(ticker.addListener).toHaveBeenCalledWith(type, expect.any(Function), {
        capture: true,
        passive: false,
      });
    }
    ticker.dispatch('pointerdown');
    ticker.unmount();

    expect(ticker.removeListener).toHaveBeenCalledTimes(9);
    for (const type of [
      'wheel',
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel',
    ]) {
      expect(ticker.dispatch(type, { ...touches(50), clientY: 50 }).defaultPrevented).toBe(false);
    }
    expect(ticker.list.scrollTop).toBe(0);
    expect(ticker.frames).toHaveLength(0);
  });
});
