import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TabConflictNotice } from '../../../src/ui/TabConflictNotice';

type Props = Record<string, unknown> & { children?: ReactNode };

function expand(node: ReactNode): ReactNode {
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === 'function') {
    return expand((node.type as (props: Props) => ReactNode)(node.props));
  }
  return node;
}

function elements(node: ReactNode): ReactElement<Props>[] {
  const expanded = expand(node);
  if (!isValidElement<Props>(expanded)) return [];
  return [expanded, ...Children.toArray(expanded.props.children).flatMap(elements)];
}

describe('別タブ競合の案内', () => {
  it('理由と再読込を出し、再試行では書き戻さない', () => {
    const onTakeOver = vi.fn();
    const node = createElement(TabConflictNotice, { onTakeOver });
    const notice = elements(node).find(
      (element) => element.props['data-testid'] === 'tab-conflict-notice',
    );
    const button = elements(node).find(
      (element) => element.props['data-testid'] === 'tab-conflict-reload',
    );
    expect(notice?.props['data-tone']).toBe('warn');
    expect(notice?.props['data-persistent']).toBe('true');
    expect(elements(node).some((element) => element.props.children === '再試行')).toBe(false);
    expect(button?.type).toBe('button');
    (button?.props.onClick as () => void)();
    expect(onTakeOver).toHaveBeenCalledOnce();
  });
});
