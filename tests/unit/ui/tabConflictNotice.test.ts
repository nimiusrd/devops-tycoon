import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PersistenceNotice as PersistenceNoticeModel } from '../../../src/state/persistenceStatus';
import { PersistenceNotice } from '../../../src/ui/PersistenceNotice';
import { TabConflictNotice, TabConflictNoticePanel } from '../../../src/ui/TabConflictNotice';

type Props = Record<string, unknown> & { children?: ReactNode };

function expand(node: ReactNode): ReactNode {
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === 'function') {
    if (node.type === TabConflictNotice) return node;
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
  it('理由と操作を出し、再試行では書き戻さない', () => {
    const onAcknowledge = vi.fn();
    const onTakeOver = vi.fn();
    const node = createElement(TabConflictNoticePanel, { onAcknowledge, onTakeOver });
    const notice = elements(node).find(
      (element) => element.props['data-testid'] === 'tab-conflict-notice',
    );
    const continueButton = elements(node).find(
      (element) => element.props['data-testid'] === 'tab-conflict-continue',
    );
    const reload = elements(node).find(
      (element) => element.props['data-testid'] === 'tab-conflict-reload',
    );
    expect(notice?.props['data-tone']).toBe('warn');
    expect(notice?.props['data-persistent']).toBe('true');
    expect(notice?.props['data-layout']).toBe('overlay');
    expect(notice?.props.role).toBeUndefined();
    expect(notice?.props['aria-live']).toBeUndefined();
    expect(notice?.props['data-overlay-lock-exempt']).toBeUndefined();
    expect(elements(node).some((element) => element.props.children === '再試行')).toBe(false);
    expect(continueButton?.type).toBe('button');
    (continueButton?.props.onClick as () => void)();
    expect(onAcknowledge).toHaveBeenCalledOnce();
    expect(reload?.type).toBe('button');
    (reload?.props.onClick as () => void)();
    expect(onTakeOver).toHaveBeenCalledOnce();
  });

  it('保存失敗の再試行とは重ねず、常駐バナーとして高さを測れる', () => {
    const notice: PersistenceNoticeModel = {
      state: 'failed',
      tone: 'danger',
      headline: '保存失敗',
      detail: '容量が不足しています。',
      liveMessage: '容量が不足して保存できません。',
      showRetry: true,
      showExport: true,
      persistent: true,
    };
    const node = createElement(PersistenceNotice, {
      notice,
      onRetry: vi.fn(),
      onExport: vi.fn(),
      tabConflictModalOpen: true,
      onAcknowledgeTabConflict: vi.fn(),
      onTakeOver: vi.fn(),
    });
    const conflict = elements(node).find((element) => element.type === TabConflictNotice);
    expect(conflict?.props.bannerRef).toEqual(expect.any(Function));
    expect(conflict?.props.showExport).toBe(true);
    expect(
      elements(node).some((element) => element.props['data-testid'] === 'persistence-retry'),
    ).toBe(false);
    expect(conflict?.props.onExport).toEqual(expect.any(Function));
  });

  it('書き出し失敗の一文を競合案内と読み上げに残す', () => {
    const notice: PersistenceNoticeModel = {
      state: 'idle',
      tone: 'quiet',
      headline: '',
      detail: '',
      liveMessage: '',
      showRetry: false,
      showExport: true,
      persistent: false,
    };
    const node = createElement(PersistenceNotice, {
      notice,
      onRetry: vi.fn(),
      onExport: vi.fn(),
      exportMessage: 'ファイルを書き出せませんでした。',
      tabConflictModalOpen: true,
      onAcknowledgeTabConflict: vi.fn(),
      onTakeOver: vi.fn(),
    });
    const live = elements(node).find(
      (element) => element.props['data-testid'] === 'persistence-live',
    );
    expect(live?.props['aria-live']).toBe('polite');
    expect(String(live?.props.children)).toContain('ファイルを書き出せませんでした。');
    expect(String(live?.props.children)).toContain('別のタブが記録を更新しました');
    const conflict = elements(node).find((element) => element.type === TabConflictNotice);
    expect(conflict?.props.exportMessage).toBe('ファイルを書き出せませんでした。');
  });
});
