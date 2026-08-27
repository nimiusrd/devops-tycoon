/**
 * ダイアログ相当オーバーレイのフォーカスロック。
 *
 * 背面兄弟を inert にしてクリック／Tab を遮断し、Tab はダイアログ内で循環させる。
 * 次画面もオーバーレイのため、閉じた後の背面へのフォーカス復帰はしない。
 */
import { useEffect, type RefObject } from 'react';
import { listFocusable, lockBackgroundSiblings, wrapTabIfNeeded } from './dialogOverlayLock';

export function useDialogOverlayLock(dialogRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!dialog.contains(document.activeElement)) {
      dialog.focus();
    }
    const unlock = lockBackgroundSiblings(dialog);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const target = wrapTabIfNeeded(listFocusable(dialog), active, event.shiftKey, dialog);
      if (!target) return;
      event.preventDefault();
      target.focus();
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || dialog.contains(target)) return;
      const focusables = listFocusable(dialog);
      (focusables[0] ?? dialog).focus();
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      unlock();
    };
  }, [dialogRef]);
}
