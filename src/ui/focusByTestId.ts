/** data-testid を持つ操作へフォーカスを戻す。Node の単体テストでは何もしない。 */
export function focusByTestId(testId: string): void {
  if (typeof document === 'undefined') return;
  const element = document.querySelector(`[data-testid="${CSS.escape(testId)}"]`);
  if (element instanceof HTMLElement) element.focus();
}

/** GAME OVER の主操作。枯渇確定で起点が消えたあとに移す。 */
const GAME_OVER_PRIMARY_TEST_ID = 'new-run';
const GAME_OVER_FOCUS_RETRY_MS = 50;
const GAME_OVER_FOCUS_LIMIT_MS = 3_000;

/**
 * 支払確定でランが終わったあと、GAME OVER の主操作へフォーカスを移す。
 * 画面切替はポーリングと遅延読み込みのあとなので、ボタンが有効になるまで再試行する。
 * Node の単体テストでは何もしない。
 */
export function focusGameOverPrimaryAction(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const started = Date.now();
  const attempt = () => {
    const primary = document.querySelector(`[data-testid="${GAME_OVER_PRIMARY_TEST_ID}"]`);
    if (primary instanceof HTMLButtonElement && !primary.disabled) {
      primary.focus();
      if (document.activeElement === primary) return;
    }
    if (Date.now() - started >= GAME_OVER_FOCUS_LIMIT_MS) return;
    window.setTimeout(attempt, GAME_OVER_FOCUS_RETRY_MS);
  };
  window.setTimeout(attempt, 0);
}
