import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));

const hooks = vi.hoisted(() => ({
  cursor: 0,
  values: [] as unknown[],
  confirmRef: null as { current: HTMLDivElement | null } | null,
}));

vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    useState(initial: unknown) {
      const index = hooks.cursor++;
      if (!(index in hooks.values)) hooks.values[index] = initial;
      return [
        hooks.values[index],
        (update: unknown) => {
          hooks.values[index] =
            typeof update === 'function'
              ? (update as (previous: unknown) => unknown)(hooks.values[index])
              : update;
        },
      ];
    },
    useRef: () => {
      if (!hooks.confirmRef) hooks.confirmRef = { current: null };
      return hooks.confirmRef;
    },
  };
});

import { COMPANY_LEVERS } from '../../../src/data/levers';
import { OrgLeverList } from '../../../src/ui/OrgLeverList';
import { useDialogOverlayLock } from '../../../src/ui/useDialogOverlayLock';

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

function mountList(
  overrides: Partial<Parameters<typeof OrgLeverList>[0]> & { budget?: number } = {},
) {
  const onApply = vi.fn();
  let props = {
    levers: COMPANY_LEVERS,
    budget: 100,
    regionTestId: 'org-levers',
    regionLabel: '全社レバー',
    title: '全社レバー',
    onApply,
    ...overrides,
  };
  let tree: ReactNode;
  const render = () => {
    hooks.cursor = 0;
    tree = expand(OrgLeverList(props));
  };
  const find = (id: string) => {
    const node = elements(tree).find((node) => node.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  const has = (id: string) => elements(tree).some((node) => node.props['data-testid'] === id);
  const click = (id: string) => {
    const button = find(id);
    if (!button.props.disabled) (button.props.onClick as () => void)();
    render();
  };
  render();
  return {
    find,
    has,
    click,
    onApply,
    update(next: Partial<typeof props>) {
      props = { ...props, ...next };
      render();
    },
  };
}

afterEach(() => {
  hooks.values = [];
  hooks.cursor = 0;
  vi.mocked(useDialogOverlayLock).mockClear();
});

describe('OrgLeverList の支払リスク', () => {
  it('常に支払後残高を示し、枯渇しない操作はその場で適用する', () => {
    const screen = mountList({ budget: 61 });
    const lever = screen.find('lever-firefighters');
    expect(content(lever)).toContain('💰20→41');
    expect(content(lever)).not.toContain('予算枯渇でランが終了する');
    screen.click('lever-firefighters');
    expect(screen.onApply).toHaveBeenCalledExactlyOnceWith('firefighters');
    expect(screen.has('spend-confirm')).toBe(false);
  });

  it('支払後に予算が尽きる操作は確認を出し、取消では適用も予算も変えない', () => {
    const screen = mountList({ budget: 60 });
    screen.click('lever-recruitDraft');
    expect(screen.onApply).toHaveBeenCalledExactlyOnceWith('recruitDraft');
    screen.update({ budget: 20 });
    const firefighters = screen.find('lever-firefighters');
    expect(content(firefighters)).toContain('💰20→0');
    expect(content(firefighters)).toContain('予算枯渇でランが終了する');
    screen.click('lever-firefighters');
    expect(screen.onApply).toHaveBeenCalledTimes(1);
    expect(screen.has('spend-confirm')).toBe(true);
    expect(content(screen.find('spend-confirm'))).toContain('予算枯渇でランが終了する');
    expect(useDialogOverlayLock).toHaveBeenCalled();
    screen.click('spend-confirm-cancel');
    expect(screen.has('spend-confirm')).toBe(false);
    expect(screen.onApply).toHaveBeenCalledTimes(1);
    screen.click('lever-firefighters');
    screen.click('spend-confirm-accept');
    expect(screen.onApply).toHaveBeenLastCalledWith('firefighters');
    expect(screen.onApply).toHaveBeenCalledTimes(2);
  });

  it('確認を開いている間は他のレバーを押せない', () => {
    const screen = mountList({ budget: 20 });
    screen.click('lever-firefighters');
    expect(screen.find('lever-recruitDraft').props.disabled).toBe(true);
  });
});
