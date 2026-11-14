/**
 * ダイアログ相当オーバーレイのフォーカスロック。
 *
 * 背面兄弟を inert にしてクリック／Tab を遮断し、Tab はダイアログ内で循環させる。
 * 既定では閉じた後の背面へのフォーカス復帰はしない（次画面もオーバーレイのため）。
 * `restoreFocus` を渡すと、開く直前のフォーカスへ戻す。
 * `onDismiss` を渡すと Escape でそれを呼び、呼び出し側が open 状態を取り消す。
 * 新しいフォーカストラップは増やさず、このフックに閉じる経路を載せる。
 */
import { useLayoutEffect, useRef, type RefObject } from 'react';
import {
  isOverlayExemptInFront,
  listFocusable,
  listOverlayExemptFocusables,
  lockBackgroundSiblings,
  restoreAuthoredAriaModal,
  syncAriaModalWithExemptControls,
  trapTabTarget,
} from './dialogOverlayLock';

export interface DialogOverlayLockOptions {
  restoreFocus?: boolean;
  onDismiss?: () => void;
  /**
   * 保存案内や競合チップを Tab の輪から外し、aria-modal を維持する。
   * 遊び方など読む専用のモーダル向け。
   */
  strictModal?: boolean;
  /** false のときロックを外し、前面の別モーダルへ譲る。 */
  enabled?: boolean;
  /**
   * enabled の再開時、ロック停止直前のダイアログ内操作へ戻す。
   * 前面の競合モーダルなどへ一時的に譲るダイアログ向け。
   */
  resumeIntraDialogFocus?: boolean;
}

export function useDialogOverlayLock(
  dialogRef: RefObject<HTMLElement | null>,
  options?: DialogOverlayLockOptions,
): void {
  const restoreFocus = options?.restoreFocus === true;
  const strictModal = options?.strictModal === true;
  const enabled = options?.enabled !== false;
  const resumeIntraDialogFocus = options?.resumeIntraDialogFocus === true;
  const onDismissRef = useRef(options?.onDismiss);
  onDismissRef.current = options?.onDismiss;
  const suspendedIntraDialogFocusRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const previouslyFocused =
      restoreFocus &&
      document.activeElement instanceof HTMLElement &&
      !dialog.contains(document.activeElement)
        ? document.activeElement
        : null;

    let lastIntraDialogTestId: string | null = null;
    const onDialogFocusIn = resumeIntraDialogFocus
      ? (event: FocusEvent) => {
          const target = event.target;
          if (!(target instanceof HTMLElement) || !dialog.contains(target) || target === dialog) {
            return;
          }
          const testId = target.dataset.testid;
          if (testId) lastIntraDialogTestId = testId;
        }
      : undefined;
    if (onDialogFocusIn) dialog.addEventListener('focusin', onDialogFocusIn);

    const suspendedTestId = suspendedIntraDialogFocusRef.current;
    if (resumeIntraDialogFocus && suspendedTestId) {
      const target = dialog.querySelector<HTMLElement>(
        `[data-testid="${CSS.escape(suspendedTestId)}"]`,
      );
      suspendedIntraDialogFocusRef.current = null;
      if (target) target.focus({ preventScroll: true });
      else dialog.focus({ preventScroll: true });
    } else if (!dialog.contains(document.activeElement)) {
      dialog.focus({ preventScroll: true });
    }
    const unlock = lockBackgroundSiblings(dialog, strictModal ? { inertExempt: true } : undefined);
    if (!strictModal) syncAriaModalWithExemptControls(dialog);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!strictModal) syncAriaModalWithExemptControls(dialog);
      if (event.key === 'Escape') {
        const dismiss = onDismissRef.current;
        if (!dismiss) return;
        event.preventDefault();
        event.stopPropagation();
        dismiss();
        return;
      }
      if (event.key !== 'Tab') return;
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const exempt = strictModal
        ? []
        : listOverlayExemptFocusables(dialog).filter((element) => !dialog.contains(element));
      const target = trapTabTarget(listFocusable(dialog), exempt, active, event.shiftKey, dialog);
      if (!target) return;
      event.preventDefault();
      target.focus({ preventScroll: target === dialog });
    };

    let lastExemptFocus: Node | null = null;

    const onFocusIn = (event: FocusEvent) => {
      if (!strictModal) syncAriaModalWithExemptControls(dialog);
      const target = event.target;
      if (!(target instanceof Node) || dialog.contains(target)) {
        if (target instanceof Node && dialog.contains(target)) lastExemptFocus = null;
        return;
      }
      if (!strictModal && isOverlayExemptInFront(target, dialog)) {
        lastExemptFocus = target;
        return;
      }
      const focusables = listFocusable(dialog);
      const next = focusables[0] ?? dialog;
      next.focus({ preventScroll: next === dialog });
    };

    const restoreFocusFromDisconnectedExempt = () => {
      const lost = lastExemptFocus;
      if (!lost || lost.isConnected || !dialog.isConnected) return;
      const active = document.activeElement;
      const focusFellAway =
        active == null ||
        active === document.body ||
        active === document.documentElement ||
        active === lost ||
        (active instanceof Node && !active.isConnected);
      if (!focusFellAway) return;
      lastExemptFocus = null;
      const focusables = listFocusable(dialog);
      const next = focusables[0] ?? dialog;
      next.focus({ preventScroll: next === dialog });
    };

    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    let observer: MutationObserver | undefined;
    if (typeof MutationObserver === 'function') {
      try {
        observer = new MutationObserver(() => {
          if (!strictModal) syncAriaModalWithExemptControls(dialog);
          restoreFocusFromDisconnectedExempt();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      } catch {
        observer = undefined;
      }
    }
    return () => {
      observer?.disconnect();
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      if (onDialogFocusIn) dialog.removeEventListener('focusin', onDialogFocusIn);
      if (resumeIntraDialogFocus) {
        const preserved = lastIntraDialogTestId ?? suspendedIntraDialogFocusRef.current;
        if (preserved) suspendedIntraDialogFocusRef.current = preserved;
      }
      restoreAuthoredAriaModal(dialog);
      unlock();
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [dialogRef, restoreFocus, strictModal, enabled, resumeIntraDialogFocus]);
}
