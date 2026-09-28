import { Children, createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PersistenceNotice as PersistenceNoticeModel } from '../../../src/state/persistenceStatus';
import {
  persistenceExportMessage,
  persistenceExportMessages,
} from '../../../src/ui/downloadTextFile';
import { PersistenceNotice, PersistenceQuietChip } from '../../../src/ui/PersistenceNotice';

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

function render(
  notice: PersistenceNoticeModel,
  onRetry = vi.fn(),
  onExport = vi.fn(),
  exportMessage: string | null = null,
  quietPlacement: 'inline' | 'overlay' = 'overlay',
) {
  return createElement(PersistenceNotice, {
    notice,
    onRetry,
    onExport,
    exportMessage,
    quietPlacement,
  });
}

describe('PersistenceNotice', () => {
  it('平常時は出さず、失敗時は再試行と書き出しと読み上げ文を分ける', () => {
    const idle = expand(
      render({ ...base, state: 'idle', headline: '', detail: '', liveMessage: '' }),
    );
    expect(find(idle, 'persistence-live').props).toMatchObject({
      'aria-live': 'polite',
      className: 'visually-hidden persistence-live',
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
    expect(
      elements(find(tree, 'persistence-notice')).some(
        (element) => element.props['data-testid'] === 'persistence-live',
      ),
    ).toBe(false);
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
    expect(find(tree, 'persistence-notice').props['data-overlay-lock-exempt']).toBe('true');
    expect(find(quiet, 'persistence-live').props['data-overlay-lock-exempt']).toBe('true');
    expect(find(tree, 'persistence-live').props.children).toBe('保存できました。');
    expect(
      elements(tree).some((element) => element.props['data-testid'] === 'persistence-retry'),
    ).toBe(false);
  });

  it('HUD がある画面では復旧チップをヘッダー側に任せ、常駐バナーは残す', () => {
    const quiet = render(
      {
        ...base,
        state: 'saved',
        tone: 'quiet',
        headline: '保存済み',
        detail: '保存済みデータを読み直せました。',
        liveMessage: '保存済みデータを読み直せました。',
        showRetry: false,
        showExport: false,
        persistent: false,
      },
      vi.fn(),
      vi.fn(),
      null,
      'inline',
    );
    expect(
      elements(quiet).some((element) => element.props['data-testid'] === 'persistence-notice'),
    ).toBe(false);
    expect(find(quiet, 'persistence-live').props.children).toBe('保存済みデータを読み直せました。');

    const failed = render(base, vi.fn(), vi.fn(), null, 'inline');
    expect(find(failed, 'persistence-notice').props['data-persistent']).toBe('true');
    expect(find(failed, 'persistence-retry').props).toBeTruthy();
  });

  it('復旧チップは見出しと詳細を HUD の下へ出し、平常時と常駐中は出さない', () => {
    const saved: PersistenceNoticeModel = {
      ...base,
      state: 'saved',
      tone: 'quiet',
      headline: '保存済み',
      detail: '保存済みデータを読み直せました。',
      liveMessage: '保存済みデータを読み直せました。',
      showRetry: false,
      showExport: false,
      persistent: false,
    };
    const chip = expand(createElement(PersistenceQuietChip, { notice: saved, active: true }));
    expect(find(chip, 'persistence-quiet-slot').props.className).toBe('persistence-quiet-slot');
    expect(find(chip, 'persistence-notice').props).toMatchObject({
      'data-persistent': 'false',
      'data-quiet-placement': 'inline',
      'data-state': 'saved',
      className: 'persistence-notice persistence-notice-quiet',
    });
    expect(find(chip, 'persistence-notice-headline').props.children).toBe('保存済み');
    expect(find(chip, 'persistence-notice-detail').props.children).toBe(
      '保存済みデータを読み直せました。',
    );

    expect(
      expand(createElement(PersistenceQuietChip, { notice: saved, active: false })),
    ).toBeNull();
    expect(expand(createElement(PersistenceQuietChip, { notice: base, active: true }))).toBeNull();
    expect(
      expand(
        createElement(PersistenceQuietChip, {
          notice: { ...saved, state: 'idle', headline: '', detail: '', liveMessage: '' },
          active: true,
        }),
      ),
    ).toBeNull();
  });

  it('書き出し失敗はバナーと読み上げに出し、成功時は文を足さない', () => {
    expect(persistenceExportMessage(null, false)).toBe('書き出せる途中セーブがありません。');
    expect(persistenceExportMessage('{}', false)).toBe(
      '途中セーブをファイルに保存できませんでした。',
    );
    expect(persistenceExportMessage('{}', true)).toBeNull();
    expect(
      persistenceExportMessages([
        { text: '{}', downloaded: false, kind: 'run' },
        { text: '{}', downloaded: false, kind: 'replay' },
      ]),
    ).toBe(
      '途中セーブをファイルに保存できませんでした。リプレイをファイルに保存できませんでした。',
    );
    expect(persistenceExportMessages([{ text: '{}', downloaded: true, kind: 'run' }])).toBeNull();

    const message = '途中セーブをファイルに保存できませんでした。';
    const tree = render(base, vi.fn(), vi.fn(), message);
    expect(find(tree, 'persistence-export-error').props.children).toBe(message);
    expect(find(tree, 'persistence-live').props.children).toBe(`${base.liveMessage} ${message}`);
  });
});
