import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameHandle } from '../../../src/game';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  slots: [] as { value?: unknown; dependencies?: readonly unknown[]; cleanup?: () => void }[],
  effects: [] as (() => void)[],
}));

// Node 環境では状態更新と effect の接続だけを代行し、公開ボタンの callback を操作する。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.cursor++;
    hooks.slots[index] ??= { value: initial };
    const slot = hooks.slots[index];
    return [
      slot.value,
      (update: (current: unknown) => unknown) => {
        slot.value = update(slot.value);
      },
    ];
  },
  useEffect(setup: () => void | (() => void), dependencies: readonly unknown[]) {
    const index = hooks.cursor++;
    const previous = hooks.slots[index];
    if (
      previous?.dependencies?.length === dependencies.length &&
      dependencies.every((value, i) => Object.is(value, previous.dependencies?.[i]))
    )
      return;
    const slot = { dependencies, cleanup: undefined as (() => void) | undefined };
    hooks.slots[index] = slot;
    hooks.effects.push(() => {
      previous?.cleanup?.();
      slot.cleanup = setup() ?? undefined;
    });
  },
}));

import { TutorialGuide } from '../../../src/ui/TutorialGuide';
import { TUTORIAL_STEPS } from '../../../src/ui/tutorial';

type NodeProps = {
  children?: ReactNode;
  'data-testid'?: string;
  'data-step'?: string;
  role?: string;
  'aria-label'?: string;
  onClick?: () => void;
};

function nodes(tree: ReactNode): ReactElement<NodeProps>[] {
  return Children.toArray(tree).flatMap((child) =>
    isValidElement<NodeProps>(child) ? [child, ...nodes(child.props.children)] : [],
  );
}

function textContent(tree: ReactNode): string {
  return Children.toArray(tree)
    .map((child) =>
      isValidElement<NodeProps>(child) ? textContent(child.props.children) : String(child),
    )
    .join('');
}

function gameHandle(paused = false) {
  let epoch = 0;
  const boundary = {
    isPaused: vi.fn(() => paused),
    getPauseEpoch: vi.fn(() => epoch),
    pause: vi.fn(() => {
      paused = true;
      epoch++;
    }),
    resume: vi.fn(() => {
      paused = false;
    }),
  };
  return { ...boundary, handle: boundary as unknown as GameHandle };
}

function unmount() {
  for (const slot of hooks.slots) slot.cleanup?.();
  hooks.slots = [];
  hooks.effects = [];
  hooks.cursor = 0;
}

function mount(game: GameHandle) {
  const onDismiss = vi.fn();
  let tree: ReactNode;
  const update = (nextGame = game) => {
    game = nextGame;
    hooks.cursor = 0;
    tree = TutorialGuide({ game, onDismiss });
    for (const effect of hooks.effects.splice(0)) effect();
  };
  const find = (id: string) => {
    const node = nodes(tree).find((node) => node.props['data-testid'] === id);
    if (!node) throw new Error(`ガイド要素が見つかりません: ${id}`);
    return node;
  };
  update();
  return {
    onDismiss,
    find,
    update,
    click(id: string) {
      find(id).props.onClick?.();
      update();
    },
  };
}

describe('TutorialGuide の操作と停止所有権', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { body: { dataset: {} } });
  });

  afterEach(() => {
    unmount();
    vi.unstubAllGlobals();
  });

  it('全ステップで案内とハイライトを切り替え、最後の「始める」で閉じる', () => {
    const game = gameHandle();
    const guide = mount(game.handle);

    expect(guide.find('tutorial-guide').props).toMatchObject({
      role: 'dialog',
      'aria-label': '初回ガイド',
    });
    for (const [index, step] of TUTORIAL_STEPS.entries()) {
      expect(guide.find('tutorial-guide').props['data-step']).toBe(step.id);
      expect(guide.find(`tutorial-step-${step.id}`).props.children).toBe(step.title);
      expect(textContent(guide.find('tutorial-guide'))).toContain(step.body);
      expect(textContent(guide.find('tutorial-guide'))).toContain(
        `初回ガイド ${index + 1}/${TUTORIAL_STEPS.length}`,
      );
      expect(document.body.dataset.tutorialStep).toBe(step.id);
      expect(guide.find('tutorial-next').props.children).toBe(
        index === TUTORIAL_STEPS.length - 1 ? '始める' : '次へ',
      );
      expect(guide.onDismiss).not.toHaveBeenCalled();
      guide.click('tutorial-next');
    }

    expect(guide.onDismiss).toHaveBeenCalledOnce();
    expect(game.pause).toHaveBeenCalledOnce();
    expect(game.resume).not.toHaveBeenCalled();
    unmount();
    expect(game.resume).toHaveBeenCalledOnce();
    expect(document.body.dataset).not.toHaveProperty('tutorialStep');
  });

  it('途中のスキップはステップを進めず、アンマウント時に停止を解除する', () => {
    const game = gameHandle();
    const guide = mount(game.handle);
    guide.click('tutorial-next');
    guide.click('tutorial-skip');

    expect(guide.onDismiss).toHaveBeenCalledOnce();
    expect(guide.find('tutorial-guide').props['data-step']).toBe('senior-hp');
    expect(game.isPaused()).toBe(true);
    unmount();
    expect(game.isPaused()).toBe(false);
  });

  it('表示前に停止済みのゲームは停止・再開を所有しない', () => {
    const game = gameHandle(true);
    mount(game.handle);
    unmount();

    expect(game.pause).not.toHaveBeenCalled();
    expect(game.resume).not.toHaveBeenCalled();
    expect(game.isPaused()).toBe(true);
  });

  it('別の所有者が再停止した場合はアンマウントしても再開しない', () => {
    const game = gameHandle();
    mount(game.handle);
    game.pause();
    unmount();

    expect(game.resume).not.toHaveBeenCalled();
    expect(game.isPaused()).toBe(true);
  });

  it('ゲームの差し替えでは以前の停止を解除し、新しいゲームを停止する', () => {
    const previous = gameHandle();
    const next = gameHandle();
    const guide = mount(previous.handle);
    guide.update(next.handle);

    expect(previous.resume).toHaveBeenCalledOnce();
    expect(next.pause).toHaveBeenCalledOnce();
    expect(next.resume).not.toHaveBeenCalled();
    unmount();
    expect(next.resume).toHaveBeenCalledOnce();
  });
});
