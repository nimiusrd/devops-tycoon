/**
 * ダイアログ相当オーバーレイのフォーカスロック。
 *
 * 背面兄弟を inert にしてクリック／Tab を遮断し、Tab はダイアログ内で循環させる。
 * 既定では閉じた後の背面へのフォーカス復帰はしない（次画面もオーバーレイのため）。
 * `restoreFocus` を渡すと、開く直前のフォーカスへ戻す。
 */
import { useEffect, type RefObject } from 'react';
import { listFocusable, lockBackgroundSiblings, wrapTabIfNeeded } from './dialogOverlayLock';

export function useDialogOverlayLock(
  dialogRef: RefObject<HTMLElement | null>,
  options?: { restoreFocus?: boolean },
): void {
  const restoreFocus = options?.restoreFocus === true;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      restoreFocus &&
      document.activeElement instanceof HTMLElement &&
      !dialog.contains(document.activeElement)
        ? document.activeElement
        : null;

    if (!dialog.contains(document.activeElement)) {
      dialog.focus({ preventScroll: true });
    }
    const unlock = lockBackgroundSiblings(dialog);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = wrapTabIfNeeded(listFocusable(dialog), active, event.shiftKey, dialog);
      if (!target) return;
      event.preventDefault();
      target.focus({ preventScroll: target === dialog });
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || dialog.contains(target)) return;
      const focusables = listFocusable(dialog);
      const next = focusables[0] ?? dialog;
      next.focus({ preventScroll: next === dialog });
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      unlock();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [dialogRef, restoreFocus]);
}
