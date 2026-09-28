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

function paintedZIndex(element: HTMLElement): number {
  if (typeof getComputedStyle !== 'function') return 0;
  const value = Number(getComputedStyle(element).zIndex);
  return Number.isFinite(value) ? value : 0;
}

function rectsOverlap(a: DOMRect, b: DOMRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * 保存案内がダイアログより前面か、ダイアログの矩形に覆われていない。
 * WebGL 案内は z-index が高いが、上端は保存バナーの下から始まる。見えている操作は残す。
 */
function exemptIsOperable(root: HTMLElement, front: HTMLElement): boolean {
  if (paintedZIndex(root) >= paintedZIndex(front)) return true;
  if (
    typeof root.getBoundingClientRect !== 'function' ||
    typeof front.getBoundingClientRect !== 'function'
  ) {
    return false;
  }
  const rootRect = root.getBoundingClientRect();
  const frontRect = front.getBoundingClientRect();
  if (
    rootRect.width <= 0 ||
    rootRect.height <= 0 ||
    frontRect.width <= 0 ||
    frontRect.height <= 0
  ) {
    return false;
  }
  return !rectsOverlap(rootRect, frontRect);
}

/** ダイアログの外でも操作を残す保存案内などのフォーカス対象。背面の案内は含めない。 */
export function listOverlayExemptFocusables(front?: HTMLElement): HTMLElement[] {
  if (typeof document === 'undefined') return [];
  return Array.from(document.querySelectorAll<HTMLElement>('[data-overlay-lock-exempt]')).flatMap(
    (root) => {
      if (front && !exemptIsOperable(root, front)) return [];
      return listFocusable(root);
    },
  );
}

const authoredAriaModal = new WeakMap<HTMLElement, string | null>();

/**
 * ダイアログより前面に、保存案内が出ている。
 * 再試行ボタンが無い復旧チップも、閉じるまでは案内として扱う。
 * 読み上げだけの領域は、常時マウントしても案内にはしない。
 */
export function hasOverlayExemptNotice(front: HTMLElement): boolean {
  if (typeof document === 'undefined') return false;
  return Array.from(document.querySelectorAll<HTMLElement>('[data-overlay-lock-exempt]')).some(
    (root) => {
      if (front.contains(root)) return false;
      if (!exemptIsOperable(root, front)) return false;
      if (listFocusable(root).length > 0) return true;
      return root.getAttribute('data-testid') === 'persistence-notice';
    },
  );
}

/**
 * 前面に保存案内がある間は、aria-modal でダイアログ外を利用不能にしない。
 * 操作のない復旧通知が残っている間も戻さない。案内が無い、または背面なら、開いたときの値へ戻す。
 */
export function syncAriaModalWithExemptControls(dialog: HTMLElement): void {
  if (!authoredAriaModal.has(dialog)) {
    authoredAriaModal.set(dialog, dialog.getAttribute('aria-modal'));
  }
  if (authoredAriaModal.get(dialog) !== 'true') return;
  dialog.setAttribute('aria-modal', hasOverlayExemptNotice(dialog) ? 'false' : 'true');
}

/** ダイアログを閉じるとき、aria-modal を開く前の値へ戻す。 */
export function restoreAuthoredAriaModal(dialog: HTMLElement): void {
  if (!authoredAriaModal.has(dialog)) return;
  const authored = authoredAriaModal.get(dialog) ?? null;
  authoredAriaModal.delete(dialog);
  if (authored === null) dialog.removeAttribute('aria-modal');
  else dialog.setAttribute('aria-modal', authored);
}

/** ダイアログより前面のロック免除に含まれるときだけ true。 */
export function isOverlayExemptInFront(target: Node, front: HTMLElement): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  const root = target.closest('[data-overlay-lock-exempt]');
  if (!(root instanceof HTMLElement)) return false;
  return exemptIsOperable(root, front);
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
