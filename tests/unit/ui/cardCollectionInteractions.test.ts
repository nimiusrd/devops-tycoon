import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as {
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: [] as (() => void)[],
  sameDependencies(previous: readonly unknown[] | undefined, next: readonly unknown[]) {
    return (
      previous?.length === next.length && next.every((value, i) => Object.is(value, previous[i]))
    );
  },
}));

// Node で hook の再描画と keydown の接続を代行する。選択・絞り込み・更新処理は実装を使う。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= {
      value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
    };
    const slot = hooks.slots[index];
    return [
      slot.value,
      (update: unknown) => {
        slot.value =
          typeof update === 'function'
            ? (update as (previous: unknown) => unknown)(slot.value)
            : update;
      },
    ];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
  useMemo(factory: () => unknown, dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    if (!hooks.sameDependencies(hooks.slots[index]?.dependencies, dependencies)) {
      hooks.slots[index] = { value: factory(), dependencies };
    }
    return hooks.slots[index].value;
  },
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (hooks.sameDependencies(previous?.dependencies, dependencies)) return;
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() ?? undefined;
    });
  },
}));
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));

import { CARD_DEFS } from '../../../src/data/cards';
import { defaultMeta, MAX_PREFERRED_CARDS } from '../../../src/state/meta';
import {
  CardCollectionScreen,
  type CardCollectionScreenProps,
} from '../../../src/ui/CardCollectionScreen';
import { CardView } from '../../../src/ui/CardView';

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

class FocusTarget {
  constructor(private readonly inList = false) {}

  closest(selector: string) {
    return selector === '[data-testid="card-collection-list"]' && this.inList ? this : null;
  }
}

const keyboard = new EventTarget();
let page: { body: FocusTarget; activeElement: FocusTarget | null };

function mountCollection(initial: Partial<CardCollectionScreenProps> = {}) {
  let props: CardCollectionScreenProps = {
    meta: defaultMeta(),
    onChangePreferred: vi.fn(),
    onClose: vi.fn(),
    ...initial,
  };
  let nodes: ReactElement<ElementProps>[] = [];
  const render = () => {
    hooks.cursor = 0;
    nodes = elements(CardCollectionScreen(props));
    for (const effect of hooks.effects.splice(0)) effect();
  };
  const query = (id: string) => nodes.find((node) => node.props['data-testid'] === id);
  const find = (id: string) => {
    const node = query(id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  render();
  return {
    props,
    query,
    find,
    get cards() {
      return nodes.filter((node) =>
        String(node.props['data-testid']).startsWith('card-collection-item-'),
      );
    },
    get detailCard() {
      return elements(find('card-collection-detail')).find((node) => node.type === CardView)?.props
        .def;
    },
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
      render();
    },
    update(next: Partial<CardCollectionScreenProps>) {
      props = { ...props, ...next };
      render();
    },
    key(key: string) {
      const event = new Event('keydown', { cancelable: true });
      Object.defineProperty(event, 'key', { value: key });
      keyboard.dispatchEvent(event);
      render();
      return event;
    },
    unmount() {
      for (const slot of hooks.slots) slot.cleanup?.();
      hooks.slots = [];
    },
  };
}

beforeEach(() => {
  const body = new FocusTarget();
  page = { body, activeElement: body };
  vi.stubGlobal('window', keyboard);
  vi.stubGlobal('document', page);
  vi.stubGlobal('HTMLElement', FocusTarget);
});

afterEach(() => {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.cursor = 0;
  hooks.slots = [];
  hooks.effects = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('カードコレクションの閲覧', () => {
  it('解放数とレアリティ順の一覧を表示し、カード選択を詳細へ反映する', () => {
    const screen = mountCollection();
    expect(content(screen.find('card-collection-count'))).toBe(`9/${CARD_DEFS.length}`);
    expect(screen.cards.map((node) => node.props['data-rarity'])).toEqual([
      ...Array<string>(7).fill('common'),
      ...Array<string>(5).fill('rare'),
      'legendary',
    ]);
    expect(screen.find('card-collection-item-copilot').props['data-unlocked']).toBe('true');
    expect(screen.find('card-collection-item-claude-code').props['data-unlocked']).toBe('false');
    expect(screen.detailCard).toMatchObject({ id: 'copilot' });

    screen.click('card-collection-item-docs');

    expect(screen.find('card-collection-item-docs').props['aria-pressed']).toBe(true);
    expect(screen.find('card-collection-item-copilot').props['aria-pressed']).toBe(false);
    expect(screen.detailCard).toMatchObject({ id: 'docs' });
  });

  it('フィルタ外の選択を先頭へ切り替え、選択が残る場合は維持する', () => {
    const screen = mountCollection();
    screen.click('card-collection-filter-rare');
    expect(screen.cards).toHaveLength(5);
    expect(screen.cards.every((node) => node.props['data-rarity'] === 'rare')).toBe(true);
    expect(screen.find('card-collection-filter-rare').props['aria-pressed']).toBe(true);
    expect(screen.find('card-collection-filter-all').props['aria-pressed']).toBe(false);
    expect(screen.find('card-collection-item-claude-code').props['aria-pressed']).toBe(true);

    screen.click('card-collection-item-ai-guideline');
    screen.click('card-collection-filter-all');
    expect(screen.detailCard).toMatchObject({ id: 'ai-guideline' });
    screen.click('card-collection-filter-legendary');
    expect(screen.cards).toHaveLength(1);
    expect(screen.find('card-collection-item-devin').props['aria-pressed']).toBe(true);
    screen.click('card-collection-filter-common');
    expect(screen.detailCard).toMatchObject({ id: 'copilot' });
  });

  it('未解放カードでは必要ポイントと実績を示し、購入済みになると詳細操作を表示する', () => {
    const screen = mountCollection();
    screen.click('card-collection-item-claude-code');
    expect(content(screen.find('card-collection-unlock-condition'))).toBe(
      '解放条件: メタショップで 25 pt',
    );
    expect(screen.query('card-collection-prefer')).toBeUndefined();
    screen.click('card-collection-item-devin');
    expect(content(screen.find('card-collection-unlock-condition'))).toBe(
      '解放条件: メタショップで 50 pt / 実績「超過達成クリア」が必要',
    );
    expect(screen.key('Enter').defaultPrevented).toBe(true);
    expect(screen.props.onChangePreferred).not.toHaveBeenCalled();

    screen.update({ meta: { ...defaultMeta(), unlockedCards: ['devin'] } });
    expect(content(screen.find('card-collection-count'))).toBe(`10/${CARD_DEFS.length}`);
    expect(screen.detailCard).toMatchObject({ id: 'devin' });
    expect(screen.query('card-collection-unlock-condition')).toBeUndefined();
    screen.click('card-collection-prefer');
    expect(screen.props.onChangePreferred).toHaveBeenCalledExactlyOnceWith(['devin']);
  });

  it.each(['card-collection-close', 'card-collection-backdrop'])('%s で閉じる', (id) => {
    const screen = mountCollection();
    screen.click(id);
    expect(screen.props.onClose).toHaveBeenCalledExactlyOnceWith();
  });
});

describe('カードコレクションの研修方針', () => {
  it('追加・解除を順序を保った新しい配列で通知し、親からの更新を表示へ反映する', () => {
    const meta = { ...defaultMeta(), preferredCardIds: ['docs'] };
    const screen = mountCollection({ meta });
    screen.click('card-collection-prefer');
    expect(screen.props.onChangePreferred).toHaveBeenLastCalledWith(['docs', 'copilot']);
    expect(meta.preferredCardIds).toEqual(['docs']);

    screen.update({ meta: { ...meta, preferredCardIds: ['docs', 'copilot'] } });
    expect(screen.find('card-collection-prefer').props['aria-pressed']).toBe(true);
    expect(content(screen.find('card-collection-item-copilot'))).toContain('優先中');
    expect(content(screen.find('card-collection-prefer-count'))).toBe(
      `優先 2 / ${MAX_PREFERRED_CARDS}`,
    );
    screen.click('card-collection-prefer');
    expect(screen.props.onChangePreferred).toHaveBeenLastCalledWith(['docs']);
  });

  it('上限では未選択の追加をボタンと Enter で防ぎ、選択済みカードの解除を許す', () => {
    const preferredCardIds = ['docs', 'auto-test'];
    expect(preferredCardIds).toHaveLength(MAX_PREFERRED_CARDS);
    const screen = mountCollection({ meta: { ...defaultMeta(), preferredCardIds } });
    expect(screen.find('card-collection-prefer').props.disabled).toBe(true);
    expect(content(screen.find('card-collection-prefer'))).toBe('優先は上限に達しています');
    screen.click('card-collection-prefer');
    screen.key('Enter');
    expect(screen.props.onChangePreferred).not.toHaveBeenCalled();

    screen.click('card-collection-item-docs');
    expect(screen.find('card-collection-prefer').props.disabled).toBe(false);
    screen.click('card-collection-prefer');
    expect(screen.props.onChangePreferred).toHaveBeenCalledExactlyOnceWith(['auto-test']);
  });
});

describe('カードコレクションのキーボード操作', () => {
  it('矢印キーでレアリティ順に選択し、端で止まり、フィルタ変更後も新しい一覧を使う', () => {
    const screen = mountCollection();
    expect(screen.key('ArrowUp').defaultPrevented).toBe(true);
    expect(screen.detailCard).toMatchObject({ id: 'copilot' });
    screen.key('ArrowRight');
    expect(screen.detailCard).toMatchObject({ id: 'auto-test' });
    screen.key('ArrowDown');
    expect(screen.detailCard).toMatchObject({ id: 'pr-size-limit' });
    screen.key('ArrowLeft');
    expect(screen.detailCard).toMatchObject({ id: 'auto-test' });

    screen.click('card-collection-filter-rare');
    screen.key('ArrowDown');
    expect(screen.detailCard).toMatchObject({ id: 'ai-guideline' });
    screen.click('card-collection-item-code-owners');
    screen.key('ArrowRight');
    expect(screen.detailCard).toMatchObject({ id: 'code-owners' });
    expect(screen.key('Escape').defaultPrevented).toBe(false);
  });

  it('Enter は本文と一覧のフォーカス時だけ優先を切り替え、他の操作のフォーカスを奪わない', () => {
    const screen = mountCollection();
    expect(screen.key('Enter').defaultPrevented).toBe(true);
    expect(screen.props.onChangePreferred).toHaveBeenCalledExactlyOnceWith(['copilot']);

    screen.update({ meta: { ...defaultMeta(), preferredCardIds: ['copilot', 'docs'] } });
    page.activeElement = new FocusTarget(true);
    expect(screen.key('Enter').defaultPrevented).toBe(true);
    expect(screen.props.onChangePreferred).toHaveBeenLastCalledWith(['docs']);
    expect(screen.props.onChangePreferred).toHaveBeenCalledTimes(2);

    page.activeElement = new FocusTarget();
    expect(screen.key('Enter').defaultPrevented).toBe(false);
    expect(screen.props.onChangePreferred).toHaveBeenCalledTimes(2);
    screen.unmount();
    const afterUnmount = new Event('keydown', { cancelable: true });
    Object.defineProperty(afterUnmount, 'key', { value: 'Enter' });
    keyboard.dispatchEvent(afterUnmount);
    expect(afterUnmount.defaultPrevented).toBe(false);
    expect(screen.props.onChangePreferred).toHaveBeenCalledTimes(2);
  });
});
