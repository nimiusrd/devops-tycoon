import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DeckBar, type DeckBarProps } from '../../../src/ui/DeckBar';

// リプレイ Context のみ代行し、カード定義・発動コスト・CardView は実装を通す。
vi.mock('../../../src/ui/replayContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/replayContent')>();
  return { ...actual, useReplayContent: () => actual.createReplayContentResolver(null) };
});

type Props = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  if (typeof node.type === 'function') {
    return elements((node.type as (props: Props) => ReactNode)(node.props));
  }
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<Props>(node)) return '';
  if (typeof node.type === 'function') {
    return content((node.type as (props: Props) => ReactNode)(node.props));
  }
  return Children.toArray(node.props.children).map(content).join('');
}

function mountDeck(props: DeckBarProps) {
  const tree = DeckBar(props);
  const all = (id: string) => elements(tree).filter((node) => node.props['data-testid'] === id);
  const find = (id: string, index = 0) => {
    const node = all(id)[index];
    if (!node) throw new Error(`要素がありません: ${id}[${index}]`);
    return node;
  };
  return {
    all,
    find,
    text: () => content(tree),
    click(id: string, index = 0) {
      const node = find(id, index);
      if (!node.props.disabled) (node.props.onClick as () => void)();
    },
  };
}

describe('DeckBar の閲覧と手札発動', () => {
  it('空コレクションには獲得方法を示し、カードがあればレベル付きで閲覧表示する', () => {
    const empty = mountDeck({ deck: [] });
    expect(empty.find('deck').props['data-mode']).toBe('collection');
    expect(empty.text()).toContain('まだカードがありません（スプリント後のドラフトで獲得）');
    const collection = mountDeck({ deck: [{ defId: 'docs', level: 3 }] });
    expect(collection.find('deck-card-docs').type).toBe('div');
    expect(content(collection.find('deck-card-docs'))).toContain('ドキュメント整備★★');
    expect(collection.all('hand-card-docs')).toHaveLength(0);
  });

  it.each([
    { hand: [0], playable: false, onPlay: vi.fn() },
    { hand: [0], playable: true },
    { playable: true, onPlay: vi.fn() },
  ])('手札発動の前提が揃わない場合はコレクション表示に留まる: %j', (options) => {
    const screen = mountDeck({ deck: [{ defId: 'docs', level: 1 }], ...options });
    expect(screen.find('deck').props['data-mode']).toBe('collection');
    expect(screen.all('deck-card-docs')).toHaveLength(1);
    expect(screen.all('hand-card-docs')).toHaveLength(0);
  });

  it('手札が空でも総デッキ枚数を保持して空の案内を出す', () => {
    const screen = mountDeck({
      deck: [{ defId: 'docs', level: 1 }],
      hand: [],
      playable: true,
      onPlay: vi.fn(),
    });
    expect(screen.find('deck').props).toMatchObject({
      'data-mode': 'hand',
      'data-paused': 'false',
    });
    expect(screen.text()).toContain('手札がありません');
    expect(content(screen.find('deck-size'))).toBe('デッキ 1');
  });

  it('同名カードを手札位置でなく元の deckIndex で発動し、不正な位置を無視する', () => {
    const deck = [
      { defId: 'docs', level: 1 },
      { defId: 'copilot', level: 1 },
      { defId: 'docs', level: 3 },
    ];
    const onPlay = vi.fn(() => ({ ok: true }));
    const screen = mountDeck({ deck, hand: [2, 99, 0, -1], focus: 2, playable: true, onPlay });
    expect(screen.all('hand-card-docs')).toHaveLength(2);
    expect(screen.all('hand-card-copilot')).toHaveLength(0);
    expect(content(screen.find('hand-card-docs', 0))).toContain('⚡1');
    expect(content(screen.find('hand-card-docs', 1))).toContain('⚡2');
    screen.click('hand-card-docs', 0);
    screen.click('hand-card-docs', 1);
    expect(onPlay.mock.calls).toEqual([[2], [0]]);
    expect(deck.map((card) => card.level)).toEqual([1, 1, 3]);
  });

  it.each([
    { focus: 1, paused: false, disabled: true },
    { focus: 2, paused: false, disabled: false },
    { focus: 3, paused: false, disabled: false },
    { focus: 3, paused: true, disabled: true },
  ])('集中力 $focus / Pause $paused のとき発動可否を示す', ({ focus, paused, disabled }) => {
    const onPlay = vi.fn(() => ({ ok: true }));
    const screen = mountDeck({
      deck: [{ defId: 'docs', level: 1 }],
      hand: [0],
      playable: true,
      focus,
      paused,
      onPlay,
    });
    const card = screen.find('hand-card-docs');
    expect(card.props.disabled).toBe(disabled);
    expect(screen.find('deck').props['data-paused']).toBe(String(paused));
    expect(String(card.props.title).includes('一時停止中はカードを発動できない')).toBe(paused);
    screen.click('hand-card-docs');
    expect(onPlay).toHaveBeenCalledTimes(disabled ? 0 : 1);
  });

  it('集中力が省略された手札はゼロ扱いで発動できない', () => {
    const screen = mountDeck({
      deck: [{ defId: 'docs', level: 1 }],
      hand: [0],
      playable: true,
      onPlay: vi.fn(),
    });
    expect(screen.find('hand-card-docs').props.disabled).toBe(true);
  });
});
