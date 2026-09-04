import { type ForwardedRef, type ReactElement, type ReactPortal } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[] }));

// React のマウント・アンマウントだけを代行し、portal と scroll lock は実物を使う。
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useLayoutEffect(effect: () => void | (() => void)) {
    hooks.effects.push(effect);
  },
}));

import { ResultOverlay, type ResultOverlayProps } from '../../../src/ui/ResultOverlay';

const activeCleanups = new Set<() => void>();
let documentStub: {
  body: { nodeType: number; style: { overflow: string } };
  documentElement: { style: { overflow: string } };
};

function mountOverlay(props: ResultOverlayProps = {}, ref: ForwardedRef<HTMLDivElement> = null) {
  const render = (
    ResultOverlay as unknown as {
      render: (props: ResultOverlayProps, ref: ForwardedRef<HTMLDivElement>) => ReactPortal | null;
    }
  ).render;
  const portal = render(props, ref);
  const cleanups = hooks.effects.splice(0).map((effect) => effect());
  const unmount = () => {
    if (!activeCleanups.delete(unmount)) return;
    for (const cleanup of cleanups) cleanup?.();
  };
  activeCleanups.add(unmount);
  return { portal, unmount };
}

beforeEach(() => {
  documentStub = {
    body: { nodeType: 1, style: { overflow: 'auto' } },
    documentElement: { style: { overflow: 'scroll' } },
  };
  vi.stubGlobal('document', documentStub);
});

afterEach(() => {
  for (const cleanup of activeCleanups) cleanup();
  hooks.effects = [];
  vi.unstubAllGlobals();
});

describe('ResultOverlay', () => {
  it('body の portal に子要素とダイアログ属性、追加クラス、ref を渡す', () => {
    const ref = { current: null };
    const click = vi.fn();
    const { portal } = mountOverlay(
      {
        children: '確認内容',
        className: 'confirmation',
        role: 'dialog',
        'aria-modal': true,
        'aria-label': 'デイリー開始',
        tabIndex: -1,
        onClick: click,
      },
      ref,
    );

    expect(portal).toMatchObject({ containerInfo: documentStub.body });
    const element = portal?.children as ReactElement<Record<string, unknown>>;
    expect(element.type).toBe('div');
    expect(element.props).toMatchObject({
      className: 'result-overlay confirmation',
      children: '確認内容',
      role: 'dialog',
      'aria-modal': true,
      'aria-label': 'デイリー開始',
      tabIndex: -1,
      onClick: click,
      ref,
    });
  });

  it.each([false, true])(
    '重ねたダイアログは最後の一枚が閉じるまでスクロールを止める（逆順: %s）',
    (reverse) => {
      const first = mountOverlay();
      expect((first.portal?.children as ReactElement<{ className: string }>).props.className).toBe(
        'result-overlay',
      );
      expect(documentStub.body.style.overflow).toBe('hidden');
      expect(documentStub.documentElement.style.overflow).toBe('hidden');
      const second = mountOverlay();

      const [earlier, later] = reverse ? [second, first] : [first, second];
      earlier.unmount();
      expect(documentStub.body.style.overflow).toBe('hidden');
      expect(documentStub.documentElement.style.overflow).toBe('hidden');
      later.unmount();
      expect(documentStub.body.style.overflow).toBe('auto');
      expect(documentStub.documentElement.style.overflow).toBe('scroll');
    },
  );

  it('再び開いたときのスクロール設定を保存し、空の inline style も元どおりにする', () => {
    mountOverlay().unmount();
    documentStub.body.style.overflow = '';
    documentStub.documentElement.style.overflow = 'clip';
    const reopened = mountOverlay();

    expect(documentStub.body.style.overflow).toBe('hidden');
    expect(documentStub.documentElement.style.overflow).toBe('hidden');
    reopened.unmount();
    expect(documentStub.body.style.overflow).toBe('');
    expect(documentStub.documentElement.style.overflow).toBe('clip');
  });

  it('document のない環境では描画せず、終了処理も安全に完了する', () => {
    vi.stubGlobal('document', undefined);
    const overlay = mountOverlay({ children: '表示しない内容' });
    expect(overlay.portal).toBeNull();
    expect(() => overlay.unmount()).not.toThrow();
  });
});
