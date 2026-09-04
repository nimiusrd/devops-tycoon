import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

// Node では ref とブラウザのフォーカスロックだけを代行する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock('../../../src/ui/useDialogOverlayLock', () => ({ useDialogOverlayLock: vi.fn() }));

import { defaultMeta, type MetaState } from '../../../src/state/meta';
import { DeckPolicyScreen } from '../../../src/ui/DeckPolicyScreen';

type Props = Record<string, unknown> & { children?: ReactNode };

// Portal の外枠は保持し、研修カードは実 CardView まで展開する。
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

function mountPolicy(initial: MetaState = defaultMeta()) {
  let meta = initial;
  const onChange = vi.fn();
  const onClose = vi.fn();
  let tree = expand(DeckPolicyScreen({ meta, onChange, onClose }));
  const find = (id: string) => {
    const node = elements(tree).find((item) => item.props['data-testid'] === id);
    if (!node) throw new Error(`要素がありません: ${id}`);
    return node;
  };
  return {
    onChange,
    onClose,
    find,
    has: (id: string) => elements(tree).some((item) => item.props['data-testid'] === id),
    update(next: MetaState) {
      meta = next;
      tree = expand(DeckPolicyScreen({ meta, onChange, onClose }));
    },
    click(id: string) {
      const node = find(id);
      if (!node.props.disabled) (node.props.onClick as () => void)();
    },
  };
}

describe('研修方針の優先施策選択', () => {
  it('解放済みカードを候補として表示し、未解放カードは購入後に選べる', () => {
    const screen = mountPolicy();
    expect(content(screen.find('deck-policy-count'))).toBe('0');
    expect(content(screen.find('deck-policy-docs'))).toContain('ドキュメント整備');
    expect(content(screen.find('deck-policy-docs'))).toContain('優先に加える');
    expect(screen.find('deck-policy-docs').props['aria-pressed']).toBe(false);
    expect(screen.has('deck-policy-claude-code')).toBe(false);
    screen.update({ ...defaultMeta(), unlockedCards: ['claude-code'] });
    expect(content(screen.find('deck-policy-claude-code'))).toContain('Claude Code解禁');
    screen.click('deck-policy-claude-code');
    expect(screen.onChange).toHaveBeenCalledExactlyOnceWith(['claude-code']);
  });

  it('選択順を保って 2 枚まで追加し、上限では未選択カードだけを無効にする', () => {
    const initial = { ...defaultMeta(), preferredCardIds: ['docs'] };
    const screen = mountPolicy(initial);
    screen.click('deck-policy-auto-test');
    expect(screen.onChange).toHaveBeenCalledExactlyOnceWith(['docs', 'auto-test']);
    expect(initial.preferredCardIds).toEqual(['docs']);
    screen.update({ ...initial, preferredCardIds: ['docs', 'auto-test'] });
    expect(content(screen.find('deck-policy-count'))).toBe('2');
    for (const id of ['docs', 'auto-test']) {
      expect(screen.find(`deck-policy-${id}`).props['aria-pressed']).toBe(true);
      expect(screen.find(`deck-policy-${id}`).props.disabled).toBe(false);
      expect(content(screen.find(`deck-policy-${id}`))).toContain('✓ 優先中');
    }
    expect(screen.find('deck-policy-copilot').props.disabled).toBe(true);
    expect(content(screen.find('deck-policy-copilot'))).toContain('上限に達しています');
    screen.click('deck-policy-copilot');
    expect(screen.onChange).toHaveBeenCalledTimes(1);
  });

  it('上限でも既存の選択を解除でき、残りの選択を保って別のカードを追加できる', () => {
    const meta = { ...defaultMeta(), preferredCardIds: ['docs', 'auto-test'] };
    const screen = mountPolicy(meta);
    screen.click('deck-policy-docs');
    expect(screen.onChange).toHaveBeenCalledExactlyOnceWith(['auto-test']);
    expect(meta.preferredCardIds).toEqual(['docs', 'auto-test']);
    screen.update({ ...meta, preferredCardIds: ['auto-test'] });
    expect(screen.find('deck-policy-docs').props['aria-pressed']).toBe(false);
    expect(screen.find('deck-policy-copilot').props.disabled).toBe(false);
    screen.click('deck-policy-copilot');
    expect(screen.onChange).toHaveBeenLastCalledWith(['auto-test', 'copilot']);
  });

  it('最後の優先施策を解除でき、閉じる操作は選択変更を通知しない', () => {
    const screen = mountPolicy({ ...defaultMeta(), preferredCardIds: ['docs'] });
    screen.click('deck-policy-docs');
    expect(screen.onChange).toHaveBeenCalledExactlyOnceWith([]);
    screen.click('deck-policy-close');
    expect(screen.onClose).toHaveBeenCalledExactlyOnceWith();
    expect(screen.onChange).toHaveBeenCalledTimes(1);
  });
});
