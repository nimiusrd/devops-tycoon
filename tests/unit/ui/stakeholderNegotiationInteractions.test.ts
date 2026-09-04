import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  slots: [] as {
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: [] as (() => void)[],
}));

// Node で state/effect の再描画だけを代行する。交渉・確定判定・効果タグは実装を通す。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: initial };
    const slot = hooks.slots[index];
    return [
      slot.value,
      (next: unknown) => {
        if (!Object.is(slot.value, next)) {
          slot.value = next;
          hooks.dirty = true;
        }
      },
    ];
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (
      previous?.dependencies?.length === dependencies.length &&
      dependencies.every((value, i) => Object.is(value, previous.dependencies?.[i]))
    ) {
      return;
    }
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = effect() ?? undefined;
    });
  },
}));

import { allGoalAdjustmentIds } from '../../../src/data/goalAdjustments';
import type { GoalAdjustmentId } from '../../../src/sim/run/types';
import {
  StakeholderNegotiationList,
  type StakeholderNegotiationListProps,
} from '../../../src/ui/StakeholderNegotiationList';

type ElementProps = Record<string, unknown> & { children?: ReactNode };
type Interaction = 'onClick' | 'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur';

function expand(node: ReactNode): ReactNode {
  if (!isValidElement<ElementProps>(node)) return node;
  if (typeof node.type === 'function') {
    return expand((node.type as (props: ElementProps) => ReactNode)(node.props));
  }
  return cloneElement(node, {}, ...Children.toArray(node.props.children).map(expand));
}

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement<ElementProps>(node)) return [];
  return [node, ...Children.toArray(node.props.children).flatMap(elements)];
}

function content(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement<ElementProps>(node)
    ? Children.toArray(node.props.children).map(content).join('')
    : '';
}

function mountNegotiation(
  overrides: Partial<StakeholderNegotiationListProps> = {},
  hoverCapable = true,
) {
  const listeners = new Set<() => void>();
  const media = {
    matches: hoverCapable,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  };
  const matchMedia = vi.fn(() => media);
  vi.stubGlobal('window', { matchMedia });
  let props: StakeholderNegotiationListProps = {
    availableAdjustments: allGoalAdjustmentIds(),
    trust: { management: 20, customers: 45, team: 80 },
    hasAiAdoptionTarget: true,
    currentDeliveryTarget: 3_000,
    onChooseAdjustment: vi.fn(),
    onPreviewAdjustment: vi.fn(),
    ...overrides,
  };
  let tree: ReactNode;
  const render = () => {
    let renders = 0;
    do {
      if (++renders > 10) throw new Error('交渉一覧の更新が収束しませんでした');
      hooks.cursor = 0;
      hooks.dirty = false;
      tree = expand(StakeholderNegotiationList(props));
      for (const effect of hooks.effects.splice(0)) effect();
    } while (hooks.dirty);
  };
  const find = (attribute: string, value: string) => {
    const node = elements(tree).find((item) => item.props[attribute] === value);
    if (!node) throw new Error(`要素がありません: ${attribute}=${value}`);
    return node;
  };
  const act = (node: ReactElement<ElementProps>, interaction: Interaction) => {
    (node.props[interaction] as () => void)();
    render();
  };
  render();
  return {
    media,
    matchMedia,
    get tree() {
      return tree;
    },
    get props() {
      return props;
    },
    nodes: () => elements(tree),
    find: (id: string) => find('data-testid', id),
    card: (id: GoalAdjustmentId) => find('data-adjustment', id),
    actCard: (id: GoalAdjustmentId, interaction: Interaction) =>
      act(find('data-adjustment', id), interaction),
    actPreview: (id: GoalAdjustmentId, interaction: 'onClick' | 'onMouseEnter') =>
      act(find('data-testid', `roadmap-preview-${id}`), interaction),
    update(next: Partial<StakeholderNegotiationListProps>) {
      props = { ...props, ...next };
      render();
    },
    changeHover(matches: boolean) {
      media.matches = matches;
      for (const listener of listeners) listener();
      render();
    },
    unmount() {
      for (const slot of hooks.slots) {
        slot.cleanup?.();
        slot.cleanup = undefined;
      }
    },
  };
}

afterEach(() => {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
  hooks.dirty = false;
  vi.unstubAllGlobals();
});

describe('StakeholderNegotiationList の提示条件', () => {
  it('候補がなければ交渉一覧を表示しない', () => {
    const screen = mountNegotiation({ availableAdjustments: [] });
    expect(screen.tree).toBeNull();
    expect(screen.props.onChooseAdjustment).not.toHaveBeenCalled();
  });

  it('提示された候補を交渉相手別に並べ、信頼に応じた姿勢と代償を表示する', () => {
    const screen = mountNegotiation();
    const panels = screen.nodes().filter((node) => node.type === 'section');
    expect(panels.map((node) => node.props['aria-label'])).toEqual([
      '経営との交渉',
      '顧客との交渉',
      'チームとの交渉',
      '三者との交渉',
    ]);
    expect(panels.map((node) => node.props['data-stance'])).toEqual([
      'hardline',
      'cautious',
      'cooperative',
      'hardline',
    ]);
    expect(screen.nodes().filter((node) => node.props['data-adjustment'])).toHaveLength(7);
    expect(content(screen.find('negotiation-terms-cut_scope'))).toBe('相手の条件: 次期目標');
    expect(content(screen.find('negotiation-terms-request_budget'))).toBe(
      '相手の条件: 予算 / 次期目標 / 次期予算上限 / 次四半期の現場',
    );
    expect(content(screen.find('adjustment-tags-cut_scope'))).toContain('次期Delivery 2280');
    expect(content(screen.find('adjustment-tags-pause_ai_rollout'))).toContain(
      'AI Adoption目標 -15',
    );
    screen.update({ availableAdjustments: ['pause_ai_rollout'], hasAiAdoptionTarget: false });
    expect(screen.nodes().filter((node) => node.type === 'section')).toHaveLength(1);
    expect(content(screen.find('adjustment-tags-pause_ai_rollout'))).not.toContain(
      'AI Adoption目標',
    );
  });
});

describe('StakeholderNegotiationList のプレビューと確定', () => {
  it('マウスとキーボードで見通しを出入りし、カードのクリックだけで確定する', () => {
    const screen = mountNegotiation();
    screen.actCard('cut_scope', 'onMouseEnter');
    screen.actCard('cut_scope', 'onMouseLeave');
    screen.actCard('cut_scope', 'onFocus');
    screen.actCard('cut_scope', 'onBlur');
    screen.actPreview('request_budget', 'onMouseEnter');
    screen.actPreview('extend_deadline', 'onClick');
    expect(screen.props.onPreviewAdjustment).toHaveBeenNthCalledWith(1, 'cut_scope');
    expect(screen.props.onPreviewAdjustment).toHaveBeenNthCalledWith(2, null);
    expect(screen.props.onPreviewAdjustment).toHaveBeenNthCalledWith(3, 'cut_scope');
    expect(screen.props.onPreviewAdjustment).toHaveBeenNthCalledWith(4, null);
    expect(screen.props.onPreviewAdjustment).toHaveBeenNthCalledWith(5, 'request_budget');
    expect(screen.props.onPreviewAdjustment).toHaveBeenNthCalledWith(6, 'extend_deadline');
    expect(screen.props.onChooseAdjustment).not.toHaveBeenCalled();
    screen.actCard('cut_scope', 'onClick');
    expect(screen.props.onChooseAdjustment).toHaveBeenCalledExactlyOnceWith('cut_scope');
    expect(screen.props.onPreviewAdjustment).toHaveBeenCalledTimes(6);
  });

  it('タッチでは一度目をプレビューにし、別カードへ移った後も同じカードの再選択で確定する', () => {
    const screen = mountNegotiation({}, false);
    for (const interaction of ['onMouseEnter', 'onMouseLeave', 'onFocus', 'onBlur'] as const) {
      screen.actCard('cut_scope', interaction);
    }
    screen.actPreview('cut_scope', 'onMouseEnter');
    expect(screen.props.onPreviewAdjustment).not.toHaveBeenCalled();

    screen.actCard('cut_scope', 'onClick');
    expect(screen.props.onPreviewAdjustment).toHaveBeenCalledExactlyOnceWith('cut_scope');
    expect(screen.props.onChooseAdjustment).not.toHaveBeenCalled();
    screen.update({ previewedAdjustmentId: 'cut_scope' });
    expect(screen.card('cut_scope').props['data-previewing']).toBe('true');
    expect(screen.card('cut_scope').props.className).toContain('is-previewing');

    screen.actCard('request_budget', 'onClick');
    expect(screen.props.onPreviewAdjustment).toHaveBeenLastCalledWith('request_budget');
    expect(screen.props.onChooseAdjustment).not.toHaveBeenCalled();
    screen.update({ previewedAdjustmentId: 'request_budget' });
    expect(screen.card('cut_scope').props['data-previewing']).toBeUndefined();
    expect(screen.card('cut_scope').props.className).not.toContain('is-previewing');
    screen.actCard('request_budget', 'onClick');
    expect(screen.props.onChooseAdjustment).toHaveBeenCalledExactlyOnceWith('request_budget');
    expect(screen.props.onPreviewAdjustment).toHaveBeenCalledTimes(2);

    screen.actPreview('extend_deadline', 'onClick');
    expect(screen.props.onPreviewAdjustment).toHaveBeenLastCalledWith('extend_deadline');
    expect(screen.props.onChooseAdjustment).toHaveBeenCalledTimes(1);
  });

  it('ポインター特性の変更を次の操作へ反映し、アンマウントで購読を解除する', () => {
    const screen = mountNegotiation();
    expect(screen.matchMedia).toHaveBeenCalledExactlyOnceWith('(hover: hover) and (pointer: fine)');
    screen.changeHover(false);
    screen.actCard('cut_scope', 'onClick');
    expect(screen.props.onChooseAdjustment).not.toHaveBeenCalled();
    expect(screen.props.onPreviewAdjustment).toHaveBeenCalledExactlyOnceWith('cut_scope');
    screen.changeHover(true);
    screen.actCard('cut_scope', 'onClick');
    expect(screen.props.onChooseAdjustment).toHaveBeenCalledExactlyOnceWith('cut_scope');
    expect(screen.media.addEventListener).toHaveBeenCalledOnce();
    const listener = screen.media.addEventListener.mock.calls[0][1];
    screen.unmount();
    expect(screen.media.removeEventListener).toHaveBeenCalledExactlyOnceWith('change', listener);
  });

  it('プレビュー通知を省略してもマウス操作と確定を利用できる', () => {
    const screen = mountNegotiation({ onPreviewAdjustment: undefined });
    for (const interaction of ['onMouseEnter', 'onMouseLeave', 'onFocus', 'onBlur'] as const) {
      screen.actCard('cut_scope', interaction);
    }
    screen.actPreview('cut_scope', 'onMouseEnter');
    screen.actPreview('cut_scope', 'onClick');
    screen.actCard('cut_scope', 'onClick');
    expect(screen.props.onChooseAdjustment).toHaveBeenCalledExactlyOnceWith('cut_scope');
  });
});
