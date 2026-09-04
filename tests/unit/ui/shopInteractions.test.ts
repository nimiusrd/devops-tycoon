import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Node では provider 接続だけを代行し、カード・レリック解決と効果の導出は実装を通す。
vi.mock('../../../src/ui/replayContent', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/ui/replayContent')>();
  return { ...actual, useReplayContent: () => actual.createReplayContentResolver(null) };
});

import { ROSTER_CAP } from '../../../src/sim/member';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunState, ShopOffer } from '../../../src/sim/run/types';
import { ShopScreen } from '../../../src/ui/ShopScreen';
import { directRoster } from '../helpers/whatIfFixtures';

type Props = Record<string, unknown> & { children?: ReactNode };

function expand(node: ReactNode): ReactNode {
  if (!isValidElement<Props>(node)) return node;
  if (typeof node.type === 'function') {
    return expand((node.type as (props: Props) => ReactNode)(node.props));
  }
  return cloneElement(node, {}, ...Children.toArray(node.props.children).map(expand));
}

function elements(node: ReactNode): ReactElement<Props>[] {
  if (!isValidElement<Props>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<Props>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}

function makeShop(overrides: Partial<ShopOffer> = {}): ShopOffer {
  return {
    cards: [{ defId: 'docs', cost: 15, bought: false }],
    relic: { id: 'psych-safety', cost: 15, bought: false },
    recruit: { cost: 15, bought: false },
    ...overrides,
  };
}

function mountShop(overrides: Partial<RunState> = {}) {
  const engine = new RunEngine({ seed: 'shop-interactions' });
  engine.startRun();
  const state: RunState = {
    ...engine.snapshot(),
    phase: 'shop',
    budget: 15,
    roster: structuredClone(directRoster),
    shop: makeShop(),
    ...overrides,
  };
  const onBuyCard = vi.fn();
  const onBuyRelic = vi.fn();
  const onBuyRecruit = vi.fn();
  const onLeave = vi.fn();
  const tree = expand(ShopScreen({ state, onBuyCard, onBuyRelic, onBuyRecruit, onLeave }));
  const nodes = elements(tree);
  const find = (id: string) => {
    const node = nodes.find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    state,
    tree,
    onBuyCard,
    onBuyRelic,
    onBuyRecruit,
    onLeave,
    find,
    has: (id: string) => nodes.some((item) => item.props['data-testid'] === id),
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
    },
  };
}

describe('ショップの購入条件', () => {
  it('価格と同額の予算でカード・レリック・採用を選べ、各操作を通知する', () => {
    const screen = mountShop();
    const original = structuredClone(screen.state);
    expect(content(screen.find('shop-budget'))).toBe('💰15');
    expect(content(screen.find('shop-card-docs'))).toContain('ドキュメント整備');
    expect(content(screen.find('shop-card-docs'))).toContain(
      '💰15 / 発動 ⚡2 / 次スプ手札・導入支援',
    );
    expect(content(screen.find('shop-relic-psych-safety'))).toContain('心理的安全性');
    expect(content(screen.find('shop-recruit'))).toContain('未来の主力候補を1人迎える');
    for (const id of ['shop-card-docs', 'shop-relic-psych-safety', 'shop-recruit']) {
      expect(screen.find(id).props.disabled).toBe(false);
      screen.click(id);
    }
    for (const id of [
      'shop-card-effect-tags-docs',
      'shop-relic-effect-tags-psych-safety',
      'shop-recruit-effect-tags',
    ]) {
      expect(content(screen.find(id))).not.toBe('');
    }
    expect(screen.onBuyCard).toHaveBeenCalledExactlyOnceWith('docs');
    expect(screen.onBuyRelic).toHaveBeenCalledExactlyOnceWith();
    expect(screen.onBuyRecruit).toHaveBeenCalledExactlyOnceWith();
    expect(screen.state).toEqual(original);
  });

  it('予算が価格より 1 少ないとすべて購入できず、採用の必要額を示す', () => {
    const screen = mountShop({ budget: 14 });
    for (const id of ['shop-card-docs', 'shop-relic-psych-safety', 'shop-recruit']) {
      expect(screen.find(id).props.disabled).toBe(true);
      screen.click(id);
    }
    expect(content(screen.find('shop-recruit'))).toContain('予算が足りません（💰15 必要）');
    expect(screen.onBuyCard).not.toHaveBeenCalled();
    expect(screen.onBuyRelic).not.toHaveBeenCalled();
    expect(screen.onBuyRecruit).not.toHaveBeenCalled();
  });

  it.each([0, 100])(
    '予算 %s でも購入済み商品は再購入できず、採用済みの理由を優先する',
    (budget) => {
      const screen = mountShop({
        budget,
        shop: makeShop({
          cards: [{ defId: 'docs', cost: 15, bought: true }],
          relic: { id: 'psych-safety', cost: 15, bought: true },
          recruit: { cost: 15, bought: true },
        }),
      });
      for (const id of ['shop-card-docs', 'shop-relic-psych-safety', 'shop-recruit']) {
        expect(screen.find(id).props.disabled).toBe(true);
        expect(screen.find(id).props.className).toContain('bought');
        expect(content(screen.find(id))).toContain('購入済み');
        screen.click(id);
      }
      expect(content(screen.find('shop-card-docs'))).not.toContain('導入支援');
      expect(content(screen.find('shop-recruit'))).toContain('採用済み');
      expect(content(screen.find('shop-recruit'))).not.toContain('予算が足りません');
      expect(screen.onBuyCard).not.toHaveBeenCalled();
      expect(screen.onBuyRelic).not.toHaveBeenCalled();
      expect(screen.onBuyRecruit).not.toHaveBeenCalled();
    },
  );

  it.each([ROSTER_CAP - 1, ROSTER_CAP])('ロスター人数 %s では採用上限に従う', (count) => {
    const screen = mountShop({
      roster: {
        members: Array.from({ length: count }, (_, i) => ({
          ...directRoster.members[0],
          id: `m${i}`,
        })),
        nextId: count,
      },
    });
    expect(screen.find('shop-recruit').props.disabled).toBe(count === ROSTER_CAP);
    screen.click('shop-recruit');
    if (count === ROSTER_CAP) {
      expect(content(screen.find('shop-recruit'))).toContain('ロスターが満員です');
      expect(screen.onBuyRecruit).not.toHaveBeenCalled();
    } else {
      expect(screen.onBuyRecruit).toHaveBeenCalledExactlyOnceWith();
    }
  });

  it('導入支援の付与後は次スプリント手札だけを案内し、ショップを退出できる', () => {
    const screen = mountShop({ shop: makeShop({ introSupportGranted: true }) });
    expect(content(screen.find('shop-card-docs'))).toContain('/ 次スプ手札');
    expect(content(screen.find('shop-card-docs'))).not.toContain('導入支援');
    screen.click('shop-leave');
    expect(screen.onLeave).toHaveBeenCalledExactlyOnceWith();
  });

  it('ショップがなければ表示せず、レリックと採用が未陳列なら操作を表示しない', () => {
    expect(mountShop({ shop: null }).tree).toBeNull();
    const screen = mountShop({ shop: { cards: [] } });
    expect(screen.has('shop-relic-psych-safety')).toBe(false);
    expect(screen.has('shop-recruit')).toBe(false);
    screen.click('shop-leave');
    expect(screen.onLeave).toHaveBeenCalledExactlyOnceWith();
  });
});
