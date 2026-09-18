import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
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
    expect(content(summary)).toBe('手戻り');
    expect(content(panel)).toBe(GLOSSARY.rework.definition);
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
});
