import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Node では ref とブラウザのフォーカスロックだけを代行する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));

import { defaultMeta, type MetaState } from '../../../src/state/meta';
import { MetaShopScreen } from '../../../src/ui/MetaShopScreen';

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

function mountShop(meta: MetaState = defaultMeta()) {
  const onPurchase = vi.fn();
  const onClose = vi.fn();
  const nodes = elements(MetaShopScreen({ meta, onPurchase, onClose }));
  const find = (id: string) => {
    const node = nodes.find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    onPurchase,
    onClose,
    find,
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
    },
  };
}

describe('メタショップの購入条件', () => {
  it('ポイント不足と未達成実績を区別し、どちらも購入できない', () => {
    const screen = mountShop({ ...defaultMeta(), points: 24 });
    expect(content(screen.find('meta-shop-points'))).toBe('24');
    const ordinary = screen.find('meta-unlock-unlock-claude-code');
    expect(ordinary.props.disabled).toBe(true);
    expect(content(ordinary)).toContain('カード');
    expect(content(ordinary)).toContain('Claude Code解禁');
    expect(content(ordinary)).toContain('25 pt — ポイント不足');
    const gated = screen.find('meta-unlock-unlock-devin');
    expect(gated.props.disabled).toBe(true);
    expect(content(gated)).toContain('50 pt — 🔒 実績「超過達成クリア」が必要');
    expect(content(screen.find('meta-unlock-unlock-hire-senior'))).toContain(
      '実績「目標修正からの生還」が必要',
    );
    screen.click('meta-unlock-unlock-claude-code');
    screen.click('meta-unlock-unlock-devin');
    expect(screen.onPurchase).not.toHaveBeenCalled();
  });

  it('ちょうど購入価格があればカードとレリックを購入でき、解放エントリ ID を通知する', () => {
    const meta = { ...defaultMeta(), points: 25 };
    const screen = mountShop(meta);
    const card = screen.find('meta-unlock-unlock-claude-code');
    expect(card.props.disabled).toBe(false);
    expect(card.props.className).toContain('affordable');
    expect(content(card)).toContain('25 pt — 購入可能');
    const relic = screen.find('meta-unlock-unlock-no-friday-deploy');
    expect(relic.props.disabled).toBe(false);
    expect(content(relic)).toContain('レリック');
    expect(content(relic)).toContain('金曜デプロイ禁止');
    screen.click('meta-unlock-unlock-claude-code');
    screen.click('meta-unlock-unlock-no-friday-deploy');
    expect(screen.onPurchase.mock.calls).toEqual([
      ['unlock-claude-code'],
      ['unlock-no-friday-deploy'],
    ]);
    expect(meta.points).toBe(25);
    expect(meta.unlockedCards).toEqual([]);
    expect(meta.unlockedRelics).toEqual([]);
  });

  it('実績を達成していても価格未満なら購入できない', () => {
    const screen = mountShop({
      ...defaultMeta(),
      points: 49,
      achievements: ['review-exceeded'],
    });
    expect(screen.find('meta-unlock-unlock-devin').props.disabled).toBe(true);
    expect(content(screen.find('meta-unlock-unlock-devin'))).toContain('50 pt — ポイント不足');
    screen.click('meta-unlock-unlock-devin');
    expect(screen.onPurchase).not.toHaveBeenCalled();
  });

  it('必要ポイントと実績がそろった対象のみ購入可能になる', () => {
    const screen = mountShop({
      ...defaultMeta(),
      points: 50,
      achievements: ['review-exceeded'],
    });
    expect(screen.find('meta-unlock-unlock-devin').props.disabled).toBe(false);
    expect(content(screen.find('meta-unlock-unlock-devin'))).toContain('50 pt — 購入可能');
    expect(screen.find('meta-unlock-unlock-hire-senior').props.disabled).toBe(true);
    screen.click('meta-unlock-unlock-devin');
    expect(screen.onPurchase).toHaveBeenCalledExactlyOnceWith('unlock-devin');
  });

  it('カードとレリックの購入済み状態はポイントと実績より優先され、再購入を防ぐ', () => {
    const screen = mountShop({
      ...defaultMeta(),
      unlockedCards: ['devin'],
      unlockedRelics: ['psych-safety'],
    });
    for (const id of ['devin', 'psych-safety']) {
      const item = screen.find(`meta-unlock-unlock-${id}`);
      expect(item.props.disabled).toBe(true);
      expect(item.props.className).toContain('owned');
      expect(item.props.className).not.toContain('affordable');
      expect(content(item)).toContain('✓ 購入済み');
      expect(content(item)).not.toContain('ポイント不足');
      expect(content(item)).not.toContain('実績「');
      screen.click(`meta-unlock-unlock-${id}`);
    }
    expect(screen.onPurchase).not.toHaveBeenCalled();
  });

  it.each(['meta-shop-close', 'meta-shop-backdrop'])('%s でショップを閉じる', (id) => {
    const screen = mountShop();
    screen.click(id);
    expect(screen.onClose).toHaveBeenCalledExactlyOnceWith();
  });
});
