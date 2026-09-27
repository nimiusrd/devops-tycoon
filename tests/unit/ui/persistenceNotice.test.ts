import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PersistenceNotice as PersistenceNoticeModel } from '../../../src/state/persistenceStatus';
import { PersistenceNotice } from '../../../src/ui/PersistenceNotice';

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

function find(node: ReactNode, testId: string): ReactElement<Props> {
  const found = elements(node).find((element) => element.props['data-testid'] === testId);
  if (!found) throw new Error(`要素がありません: ${testId}`);
  return found;
}

const base: PersistenceNoticeModel = {
  state: 'failed',
  tone: 'danger',
  headline: '保存失敗',
  detail: '容量が不足しています。',
  liveMessage: '容量が不足して保存できません。再試行できます。',
  showRetry: true,
  showExport: true,
  persistent: true,
};

function render(notice: PersistenceNoticeModel, onRetry = vi.fn(), onExport = vi.fn()) {
  return createElement(PersistenceNotice, { notice, onRetry, onExport });
}

describe('PersistenceNotice', () => {
  it('平常時は出さず、失敗時は再試行と書き出しと読み上げ文を分ける', () => {
    const idle = expand(
      render({ ...base, state: 'idle', headline: '', detail: '', liveMessage: '' }),
    );
    expect(find(idle, 'persistence-live').props).toMatchObject({
      'aria-live': 'polite',
      children: '',
    });
    expect(
      elements(idle).some((element) => element.props['data-testid'] === 'persistence-notice'),
    ).toBe(false);

    const onRetry = vi.fn();
    const onExport = vi.fn();
    const tree = render(base, onRetry, onExport);
    expect(find(tree, 'persistence-notice').props).toMatchObject({
      'data-state': 'failed',
      'data-persistent': 'true',
      'data-overlay-lock-exempt': 'true',
    });
    expect(find(tree, 'persistence-notice').props.role).toBeUndefined();
    expect(find(tree, 'persistence-live').props).toMatchObject({
      'aria-live': 'polite',
      children: base.liveMessage,
    });
    (find(tree, 'persistence-retry').props.onClick as () => void)();
    (find(tree, 'persistence-export').props.onClick as () => void)();
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('平常時の保存済みは出さず、復旧後は常駐バナーにしない', () => {
    const quiet = expand(
      render({
        ...base,
        state: 'saved',
        tone: 'quiet',
        headline: '保存済み',
        detail: '最後に端末へ保存できた時刻は 12:00 です。',
        liveMessage: '',
        showRetry: false,
        showExport: false,
        persistent: false,
      }),
    );
    expect(
      elements(quiet).some((element) => element.props['data-testid'] === 'persistence-notice'),
    ).toBe(false);
    expect(find(quiet, 'persistence-live').props.children).toBe('');

    const tree = render({
      ...base,
      state: 'saved',
      tone: 'quiet',
      headline: '保存済み',
      detail: '最後に端末へ保存できた時刻は 12:00 です。',
      liveMessage: '保存できました。',
      showRetry: false,
      showExport: false,
      persistent: false,
    });
    expect(find(tree, 'persistence-notice').props['data-persistent']).toBe('false');
    expect(find(tree, 'persistence-notice').props['data-overlay-lock-exempt']).toBeUndefined();
    expect(find(tree, 'persistence-live').props.children).toBe('保存できました。');
    expect(
      elements(tree).some((element) => element.props['data-testid'] === 'persistence-retry'),
    ).toBe(false);
  });
});
