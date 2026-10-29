import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { GLOSSARY } from '../../../src/data/glossary';
import { TermTip } from '../../../src/ui/TermTip';

type Props = Record<string, unknown> & { children?: ReactNode };

function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!isValidElement<Props>(node)) return '';
  return Children.toArray(node.props.children).map(content).join('');
}

describe('TermTip', () => {
  it('見出しと定義を出し、Escape で開いているチップを閉じて summary へ戻す', () => {
    const tree = TermTip({ termId: 'rework' });
    const nodes = elements(tree);
    const details = nodes.find((node) => node.props['data-testid'] === 'term-tip-rework');
    const summary = nodes.find((node) => node.type === 'summary');
    const panel = nodes.find((node) => node.props['data-testid'] === 'term-tip-rework-panel');
    expect(details?.type).toBe('details');
    expect(details?.props.name).toBe('glossary-term-tip');
    expect(details?.props['data-placement']).toBe('inline');
    expect(content(summary)).toBe('手戻り');
    expect(content(panel)).toBe(`手戻り：${GLOSSARY.rework.definition}`);
    expect(content(nodes.find((node) => node.props.className === 'term-tip-term'))).toBe(
      '手戻り：',
    );
    expect(panel?.props.role).toBe('note');

    const focus = vi.fn();
    const root = {
      open: true,
      querySelector: vi.fn(() => ({ focus })),
    };
    const event = {
      key: 'Escape',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: root,
    };
    (details?.props.onKeyDown as (next: typeof event) => void)(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(root.open).toBe(false);
    expect(focus).toHaveBeenCalledOnce();
  });

  it('閉じているときは Escape を無視し、カスタムラベルを使える', () => {
    const tree = TermTip({ termId: 'pr', children: 'プルリクエスト', testId: 'tutorial-term-pr' });
    const nodes = elements(tree);
    const details = nodes.find((node) => node.props['data-testid'] === 'tutorial-term-pr');
    const summary = nodes.find((node) => node.type === 'summary');
    expect(content(summary)).toBe('プルリクエスト');
    const root = { open: false, querySelector: vi.fn() };
    const event = {
      key: 'Escape',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      currentTarget: root,
    };
    (details?.props.onKeyDown as (next: typeof event) => void)(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(root.querySelector).not.toHaveBeenCalled();
  });

  it('定義の先頭に用語名を置き、同じ句でも Fragment の key に index を含める（#949 #950）', () => {
    const tree = TermTip({ termId: 'aiLiteracy' });
    const nodes = elements(tree);
    const fragments = nodes.filter((node) => node.type === Fragment);
    const phrases = GLOSSARY.aiLiteracy.phrases ?? [];
    // Children.toArray は key の `:` を `=2` に逃がす。index が残っていれば句が重複しても衝突しない。
    expect(fragments.map((node) => String(node.key))).toEqual(
      phrases.map((phrase, index) => expect.stringContaining(`$${index}=2${phrase}`)),
    );
    expect(new Set(fragments.map((node) => node.key)).size).toBe(phrases.length);
  });

  it('AIリテラシーは句の境だけで折り返し、定義の全文を保つ（#941）', () => {
    const tree = TermTip({ termId: 'aiLiteracy' });
    const nodes = elements(tree);
    const panel = nodes.find((node) => node.props['data-testid'] === 'term-tip-aiLiteracy-panel');
    const phrases = nodes.filter((node) => node.props.className === 'setup-text-phrase');
    expect(content(panel)).toBe(`AIリテラシー：${GLOSSARY.aiLiteracy.definition}`);
    expect(phrases.map((node) => content(node))).toEqual(GLOSSARY.aiLiteracy.phrases);
    expect(GLOSSARY.aiLiteracy.definition).toContain('かつ');
    expect(GLOSSARY.aiLiteracy.definition).not.toContain('依存が高いと敗北');
  });

  it('開いた定義を画面内へ寄せ、閉じたときは動かさない（#950）', () => {
    const tree = TermTip({ termId: 'aiLiteracy', revealOnOpen: true });
    const nodes = elements(tree);
    const details = nodes.find((node) => node.props['data-testid'] === 'term-tip-aiLiteracy');
    const scrollIntoView = vi.fn();
    const openRoot = {
      open: true,
      closest: () => null,
      querySelector: vi.fn(() => ({ scrollIntoView })),
    };
    (details?.props.onToggle as (event: { currentTarget: typeof openRoot }) => void)({
      currentTarget: openRoot,
    });
    expect(openRoot.querySelector).toHaveBeenCalledWith('.term-tip-panel');
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', inline: 'nearest' });

    scrollIntoView.mockClear();
    const closedRoot = {
      open: false,
      closest: () => null,
      querySelector: vi.fn(() => ({ scrollIntoView })),
    };
    (details?.props.onToggle as (event: { currentTarget: typeof closedRoot }) => void)({
      currentTarget: closedRoot,
    });
    expect(closedRoot.querySelector).toHaveBeenCalledWith('summary');
    expect(closedRoot.querySelector).not.toHaveBeenCalledWith('.term-tip-panel');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('開閉を summary の aria-expanded に写す（#950）', () => {
    const tree = TermTip({ termId: 'pr', revealOnOpen: true });
    const nodes = elements(tree);
    const details = nodes.find((node) => node.props['data-testid'] === 'term-tip-pr');
    const summary = { setAttribute: vi.fn() };
    const root = {
      open: true,
      closest: () => null,
      querySelector: vi.fn((selector: string) => (selector === 'summary' ? summary : null)),
    };
    (details?.props.onToggle as (event: { currentTarget: typeof root }) => void)({
      currentTarget: root,
    });
    expect(summary.setAttribute).toHaveBeenCalledWith('aria-expanded', 'true');

    summary.setAttribute.mockClear();
    root.open = false;
    (details?.props.onToggle as (event: { currentTarget: typeof root }) => void)({
      currentTarget: root,
    });
    expect(summary.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');

    const mounted = { open: false, querySelector: vi.fn(() => summary) } as HTMLDetailsElement;
    (details?.props.ref as (node: HTMLDetailsElement) => void)(mounted);
    expect(summary.setAttribute).toHaveBeenCalledWith('aria-expanded', 'false');
  });

  it('画面内へ寄せないチップは開いてもスクロールしない', () => {
    const tree = TermTip({ termId: 'focus', placement: 'up' });
    const nodes = elements(tree);
    const details = nodes.find((node) => node.props['data-testid'] === 'term-tip-focus');
    const scrollIntoView = vi.fn();
    (details?.props.onToggle as (event: { currentTarget: { open: boolean } }) => void)({
      currentTarget: { open: true },
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('介入バー向けは上向き配置を付け、同じ name で排他開閉する', () => {
    const tree = TermTip({ termId: 'focus', placement: 'up' });
    const nodes = elements(tree);
    const details = nodes.find((node) => node.props['data-testid'] === 'term-tip-focus');
    expect(details?.props.name).toBe('glossary-term-tip');
    expect(details?.props['data-placement']).toBe('up');
  });
});
