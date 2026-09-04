import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as {
    value?: unknown;
    dependencies?: readonly unknown[];
    cleanup?: () => void;
  }[],
  effects: [] as (() => void)[],
}));

// Node 上で ref/effect の再描画を代行する。フォーカストラップの layout effect は
// useDialogOverlayLock.test.ts が担当し、ここでは確認画面自身の操作と初期 focus を検証する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useId() {
    return `daily-confirm-${hooks.cursor++}`;
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: { current: initial } };
    return hooks.slots[index].value;
  },
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
  useLayoutEffect() {},
}));

import type { RunSaveSummary } from '../../../src/state/runPersistence';
import {
  StartDailyConfirmDialog,
  type StartDailyConfirmDialogProps,
} from '../../../src/ui/StartDailyConfirmDialog';

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

const summary: RunSaveSummary = {
  seed: 'daily-save',
  difficulty: 'hard',
  trials: [],
  runKind: 'daily',
  dailyDate: '2026-09-04',
  phase: 'shop',
  quarterNumber: 3,
  sprintIndexInQuarter: 1,
  sprintsPlayed: 10,
  status: 'playing',
};

let documentStub: EventTarget & { activeElement: unknown };

function keyDown(key: string) {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key });
  documentStub.dispatchEvent(event);
  return event;
}

function mountDialog(
  overrides: Partial<StartDailyConfirmDialogProps> = {},
  missingRefs: readonly string[] = [],
) {
  let props: StartDailyConfirmDialogProps = {
    summary,
    canResume: true,
    onCancel: vi.fn(),
    onResume: vi.fn(),
    onDiscardAndStart: vi.fn(),
    ...overrides,
  };
  let tree: ReactNode;
  const targets = new Map<string, { focus: () => void }>();
  const render = () => {
    hooks.cursor = 0;
    tree = StartDailyConfirmDialog(props);
    for (const node of elements(tree)) {
      const ref = node.props.ref as { current: unknown } | undefined;
      const id = node.props['data-testid'];
      if (!ref || typeof id !== 'string') continue;
      if (!targets.has(id)) {
        targets.set(id, { focus: () => (documentStub.activeElement = targets.get(id)) });
      }
      ref.current = missingRefs.includes(id) ? null : targets.get(id);
    }
    for (const effect of hooks.effects.splice(0)) effect();
  };
  render();
  return {
    targets,
    get tree() {
      return tree;
    },
    get props() {
      return props;
    },
    click(label: string) {
      const button = elements(tree).find(
        (node) => node.type === 'button' && content(node) === label,
      );
      expect(button, `${label} が選択できること`).toBeDefined();
      (button?.props.onClick as () => void)();
    },
    update(next: Partial<StartDailyConfirmDialogProps>) {
      props = { ...props, ...next };
      render();
    },
  };
}

function unmount() {
  for (const slot of hooks.slots) slot?.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
}

beforeEach(() => {
  documentStub = Object.assign(new EventTarget(), { activeElement: null as unknown });
  vi.stubGlobal('document', documentStub);
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
});

describe('StartDailyConfirmDialog', () => {
  it('再開可能なら再開へフォーカスし、保存済みランと上書きリスクを関連付けて示す', () => {
    const dialog = mountDialog();
    expect(documentStub.activeElement).toBe(dialog.targets.get('start-daily-confirm-resume'));
    const root = elements(dialog.tree)[0];
    expect(root.props).toMatchObject({ role: 'dialog', 'aria-modal': 'true', tabIndex: -1 });
    const title = elements(dialog.tree).find(
      (node) => node.props.id === root.props['aria-labelledby'],
    );
    const description = elements(dialog.tree).find(
      (node) => node.props.id === root.props['aria-describedby'],
    );
    expect(content(title)).toBe('中断中のランがあります');
    expect(content(description)).toContain('このランは続きから再開できなくなります');
    expect(content(dialog.tree)).toContain('Hard / Q3 ショップ');
    expect(content(dialog.tree)).toContain('スプリント 10 完了 · デイリー 2026-09-04');

    dialog.click('続きから再開');
    expect(dialog.props.onResume).toHaveBeenCalledOnce();
    expect(dialog.props.onCancel).not.toHaveBeenCalled();
    expect(dialog.props.onDiscardAndStart).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    '戻る操作と破棄して開始する操作を取り違えない（再開可: %s）',
    (canResume) => {
      const dialog = mountDialog({ canResume });
      dialog.click('戻る');
      expect(dialog.props.onCancel).toHaveBeenCalledOnce();
      expect(dialog.props.onResume).not.toHaveBeenCalled();
      expect(dialog.props.onDiscardAndStart).not.toHaveBeenCalled();

      dialog.click('中断ランを捨ててデイリーを始める');
      expect(dialog.props.onDiscardAndStart).toHaveBeenCalledOnce();
      expect(dialog.props.onResume).not.toHaveBeenCalled();
      expect(dialog.props.onCancel).toHaveBeenCalledOnce();
    },
  );

  it('再開できないセーブでは戻るへフォーカスし、再開ボタンを提供しない', () => {
    const dialog = mountDialog({ canResume: false });
    expect(documentStub.activeElement).toBe(dialog.targets.get('start-daily-confirm-cancel'));
    const labels = elements(dialog.tree)
      .filter((node) => node.type === 'button')
      .map(content);
    expect(labels).toEqual(['戻る', '中断ランを捨ててデイリーを始める']);
    expect(content(dialog.tree)).toContain('再開できないセーブがあります');
    expect(content(dialog.tree)).toContain('このセーブは残らなくなります');
  });

  it('再開可否と戻る操作の更新を反映し、閉じた後に Escape で再度操作しない', () => {
    const originalCancel = vi.fn();
    const nextCancel = vi.fn();
    const dialog = mountDialog({ onCancel: originalCancel });
    expect(keyDown('Enter').defaultPrevented).toBe(false);
    expect(originalCancel).not.toHaveBeenCalled();
    expect(keyDown('Escape').defaultPrevented).toBe(true);
    expect(originalCancel).toHaveBeenCalledOnce();

    dialog.update({ canResume: false, onCancel: nextCancel });
    expect(documentStub.activeElement).toBe(dialog.targets.get('start-daily-confirm-cancel'));
    expect(keyDown('Escape').defaultPrevented).toBe(true);
    expect(originalCancel).toHaveBeenCalledOnce();
    expect(nextCancel).toHaveBeenCalledOnce();
    dialog.update({});
    expect(keyDown('Escape').defaultPrevented).toBe(true);
    expect(nextCancel).toHaveBeenCalledTimes(2);

    unmount();
    expect(keyDown('Escape').defaultPrevented).toBe(false);
    expect(nextCancel).toHaveBeenCalledTimes(2);
  });

  it.each([
    [true, 'start-daily-confirm-resume'],
    [false, 'start-daily-confirm-cancel'],
  ] as const)(
    '初期ボタンの ref が無いときも本体へフォーカスする（再開可: %s）',
    (canResume, missingRef) => {
      const dialog = mountDialog({ canResume }, [missingRef]);
      expect(documentStub.activeElement).toBe(dialog.targets.get('start-daily-confirm'));
    },
  );

  it('本体がマウントされなければフォーカスや Escape の処理を始めない', () => {
    const dialog = mountDialog({}, ['start-daily-confirm']);
    expect(documentStub.activeElement).toBeNull();
    expect(keyDown('Escape').defaultPrevented).toBe(false);
    expect(dialog.props.onCancel).not.toHaveBeenCalled();
  });
});
