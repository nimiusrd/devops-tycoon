import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// DOM のフォーカス管理と Context だけを代行し、カード・試算表示は実装を通す。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));
vi.mock('../../../src/ui/replayContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/replayContent')>();
  return { ...actual, useReplayContent: () => actual.createReplayContentResolver(null) };
});

import { DRAFT_MULLIGAN_COST } from '../../../src/sim/run/constants';
import type { WhatIfPreview } from '../../../src/sim/run/types';
import { DraftScreen, type DraftScreenProps } from '../../../src/ui/DraftScreen';

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

function mountDraft(overrides: Partial<DraftScreenProps> = {}) {
  const props: DraftScreenProps = {
    options: ['docs', 'copilot', 'devin'],
    sprintNumber: 2,
    budget: DRAFT_MULLIGAN_COST + 1,
    mulliganUsed: false,
    previews: {},
    onPick: vi.fn(),
    onSkip: vi.fn(),
    onMulligan: vi.fn(),
    ...overrides,
  };
  const tree = DraftScreen(props);
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    props,
    find,
    has: (id: string) => elements(tree).some((item) => item.props['data-testid'] === id),
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
    },
  };
}

const preview: WhatIfPreview = {
  trials: 5,
  delivered: { min: 3.2, max: 6.1, mean: 4.5 },
  spread: { min: 0, max: 1, mean: 0.2 },
};

describe('ドラフトの施策選択と引き直し', () => {
  it('提示カード・対象スプリント・発動コストを表示し、選んだ定義 ID を通知する', () => {
    const screen = mountDraft();
    expect(screen.find('draft').props).toMatchObject({
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': 'Card Draft',
    });
    expect(content(screen.find('draft-sprint-no'))).toBe('スプリント2 に向けて、施策を1枚選ぶ');
    expect(content(screen.find('draft-card-docs'))).toContain('発動 ⚡2');
    for (const id of screen.props.options) screen.click(`draft-card-${id}`);
    expect(screen.props.onPick).toHaveBeenNthCalledWith(1, 'docs');
    expect(screen.props.onPick).toHaveBeenNthCalledWith(2, 'copilot');
    expect(screen.props.onPick).toHaveBeenNthCalledWith(3, 'devin');
    expect(screen.has('what-if-draft-skip')).toBe(false);
    expect(screen.has('draft-exit-replay')).toBe(false);
    screen.click('draft-skip');
    expect(screen.props.onSkip).toHaveBeenCalledExactlyOnceWith();
  });

  it.each([
    { budget: DRAFT_MULLIGAN_COST - 1, used: false, allowed: false, reason: '予算が足りません' },
    { budget: DRAFT_MULLIGAN_COST, used: false, allowed: false, reason: '予算が足りません' },
    { budget: DRAFT_MULLIGAN_COST + 1, used: false, allowed: true, reason: '候補を引き直す' },
    {
      budget: DRAFT_MULLIGAN_COST + 1,
      used: true,
      allowed: false,
      reason: 'すでに引き直しています',
    },
  ])(
    '予算 $budget / 使用済み $used で引き直し可否と理由を出す',
    ({ budget, used, allowed, reason }) => {
      const screen = mountDraft({ budget, mulliganUsed: used });
      expect(screen.find('draft-mulligan').props.disabled).toBe(!allowed);
      expect(screen.find('draft-mulligan').props.title).toContain(reason);
      screen.click('draft-mulligan');
      expect(screen.props.onMulligan).toHaveBeenCalledTimes(allowed ? 1 : 0);
    },
  );

  it.each([false, true])(
    '読み取り専用では選択を止め、戻る callback の有無=%s を反映する',
    (withClose) => {
      const onClose = vi.fn();
      const screen = mountDraft({ readOnly: true, onClose: withClose ? onClose : undefined });
      expect(screen.find('draft').props['data-readonly']).toBe('true');
      expect(content(screen.find('draft-sprint-no'))).toBe(
        'スプリント2 に向けて、提示された施策を確認する',
      );
      for (const id of [
        'draft-card-docs',
        'draft-card-copilot',
        'draft-card-devin',
        'draft-skip',
        'draft-mulligan',
      ]) {
        expect(screen.find(id).props.disabled).toBe(true);
        expect(screen.find(id).props.title).toBe('リプレイ閲覧中は操作できません');
        screen.click(id);
      }
      expect(screen.find('draft-card-docs').props.className).toContain('card-readonly');
      expect(screen.find('draft-card-docs').props.className).not.toContain('card-disabled');
      expect(screen.props.onPick).not.toHaveBeenCalled();
      expect(screen.props.onSkip).not.toHaveBeenCalled();
      expect(screen.props.onMulligan).not.toHaveBeenCalled();
      expect(screen.has('draft-exit-replay')).toBe(withClose);
      if (withClose) {
        screen.click('draft-exit-replay');
        expect(onClose).toHaveBeenCalledExactlyOnceWith();
      }
    },
  );

  it('候補とスキップの予測を表示し、取得済みの予測は再試算中にも保持する', () => {
    const screen = mountDraft({
      previews: { docs: preview },
      skipPreview: preview,
      whatIfComputing: true,
    });
    for (const id of ['what-if-card-docs', 'what-if-draft-skip']) {
      expect(content(screen.find(id))).toContain('出荷 3〜7');
      expect(content(screen.find(id))).toContain('5回試算');
      expect(content(screen.find(id))).not.toContain('試算中');
    }
    expect(content(screen.find('what-if-draft-skip'))).toContain('スキップ時の予測');
    expect(content(screen.find('what-if-card-copilot'))).toContain('試算中…');
  });

  it('試算結果を待つ間はスキップにも計算中表示を出す', () => {
    const screen = mountDraft({ whatIfComputing: true });
    expect(screen.find('what-if-draft-skip').props['data-what-if-status']).toBe('computing');
    expect(content(screen.find('what-if-draft-skip'))).toContain('試算中…');
  });
});
