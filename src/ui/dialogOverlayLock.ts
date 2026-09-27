/**
 * モーダル相当のオーバーレイが背面をフォーカス／クリックから外すための DOM 操作。
 *
 * React は知らない。dialog 要素を渡して、兄弟を inert にし Tab を内部へ閉じる。
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function listFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.closest('[inert]')) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    if (el.getAttribute('aria-disabled') === 'true') return false;
    return el.getClientRects().length > 0;
  });
}

/**
 * Tab がダイアログ外や端で抜けないよう、ラップ先を返す。
 * ブラウザ既定で足りる（ダイアログ内の途中）ときは null。
 */
export function wrapTabIfNeeded<T extends object>(
  focusables: readonly T[],
  active: T | null,
  shift: boolean,
  dialog: T,
): T | null {
  if (focusables.length === 0) return dialog;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!first || !last) return dialog;

  const activeInside = active === dialog || (active !== null && focusables.includes(active));
  if (shift) {
    if (!activeInside || active === first || active === dialog) return last;
    return null;
  }
  if (!activeInside || active === last) return first;
  return null;
}

function isOverlayLockExempt(element: HTMLElement): boolean {
  return element.getAttribute('data-overlay-lock-exempt') !== null;
}

/** ダイアログの外でも操作を残す保存案内などのフォーカス対象。 */
export function listOverlayExemptFocusables(): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLElement>('[data-overlay-lock-exempt]')).flatMap(
    (root) => listFocusable(root),
  );
}

/**
 * Tab の端を、ダイアログとロック免除の操作で一つの輪にする。
 * 免除が無いときはダイアログ内だけの循環に戻す。
 */
export function trapTabTarget<T extends object>(
  dialogItems: readonly T[],
  exemptItems: readonly T[],
  active: T | null,
  shift: boolean,
  dialog: T,
): T | null {
  const firstExempt = exemptItems[0];
  const lastExempt = exemptItems[exemptItems.length - 1];
  if (!firstExempt || !lastExempt) return wrapTabIfNeeded(dialogItems, active, shift, dialog);

  const firstDialog = dialogItems[0];
  const lastDialog = dialogItems[dialogItems.length - 1];
  const inDialogList = active !== null && dialogItems.includes(active);
  const inExempt = active !== null && exemptItems.includes(active);
  const onDialog = active === dialog || inDialogList;

  if (shift) {
    if (inExempt && active === firstExempt) return lastDialog ?? dialog;
    if (onDialog && (!inDialogList || active === firstDialog || active === dialog))
      return lastExempt;
    if (!onDialog && !inExempt) return lastExempt;
    return null;
  }
  if (inExempt && active === lastExempt) return firstDialog ?? dialog;
  if (onDialog && lastDialog && active === lastDialog) return firstExempt;
  if (onDialog && !inDialogList) return firstExempt;
  if (!onDialog && !inExempt) return firstDialog ?? firstExempt;
  return null;
}

/** ダイアログの兄弟を inert / aria-hidden にし、解除関数を返す。 */
export function lockBackgroundSiblings(dialog: HTMLElement): () => void {
  const parent = dialog.parentElement;
  if (!parent) return () => {};

  const restores: Array<() => void> = [];
  for (const sibling of Array.from(parent.children)) {
    if (sibling === dialog || !(sibling instanceof HTMLElement)) continue;
    if (isOverlayLockExempt(sibling)) continue;
    const targets = [sibling];
    // ResultOverlay は body へ portal されるため、React root の直下にある
    // 実画面にも inert を付けて、従来の同階層 overlay と同じ契約を保つ。
    // ロック免除の案内はクリックと Tab を残す。
    if (parent === document.body && sibling.id === 'root') {
      targets.push(
        ...Array.from(sibling.children).filter(
          (child): child is HTMLElement =>
            child instanceof HTMLElement && !isOverlayLockExempt(child),
        ),
      );
    }
    for (const target of targets) {
      const previousInert = target.inert;
      const previousAriaHidden = target.getAttribute('aria-hidden');
      target.inert = true;
      target.setAttribute('aria-hidden', 'true');
      restores.push(() => {
        target.inert = previousInert;
        if (previousAriaHidden === null) target.removeAttribute('aria-hidden');
        else target.setAttribute('aria-hidden', previousAriaHidden);
      });
    }
  }

  return () => {
    for (const restore of restores) restore();
  };
}
