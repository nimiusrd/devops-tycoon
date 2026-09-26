/** data-testid を持つ操作へフォーカスを戻す。Node の単体テストでは何もしない。 */
export function focusByTestId(testId: string): void {
  if (typeof document === 'undefined') return;
  const element = document.querySelector(`[data-testid="${CSS.escape(testId)}"]`);
  if (element instanceof HTMLElement) element.focus();
}
