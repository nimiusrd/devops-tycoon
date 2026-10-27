/**
 * 編成画面の用語パネルを、開いたチップを動かさずに画面内へ収める（#950）。
 *
 * 狭幅ではパネルをチップ行の下へ絶対配置し、行の高さは
 * `--setup-term-panel-reserve` で確保する。広い幅はフロー内のまま触らない。
 */

/** フロー内パネルの上余白（`.term-tip-panel` の margin-top）と同じ間隔。 */
export const SETUP_TERM_PANEL_GAP_PX = 6;

export const SETUP_TERM_PANEL_RESERVE = '--setup-term-panel-reserve';

const VIEW_SLACK_PX = 1;

export interface TermPanelBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** サブピクセルを切り上げ、パネルの下端が次の要素に重ならない余白にする。 */
export function termPanelReserve(height: number): string {
  return `${Math.ceil(height + SETUP_TERM_PANEL_GAP_PX)}px`;
}

export function isTermPanelFullyVisible(
  panel: TermPanelBox,
  bounds: readonly TermPanelBox[],
  slack = VIEW_SLACK_PX,
): boolean {
  return bounds.every(
    (bound) =>
      panel.top >= bound.top - slack &&
      panel.left >= bound.left - slack &&
      panel.bottom <= bound.bottom + slack &&
      panel.right <= bound.right + slack,
  );
}

function clipsAxis(value: string): boolean {
  return value === 'auto' || value === 'scroll' || value === 'hidden' || value === 'clip';
}

function clippingBounds(panel: HTMLElement): TermPanelBox[] {
  const view = panel.ownerDocument.defaultView;
  const bounds: TermPanelBox[] = [];
  if (view) {
    bounds.push({ top: 0, left: 0, right: view.innerWidth, bottom: view.innerHeight });
  }
  let parent = panel.parentElement;
  const root = panel.ownerDocument.documentElement;
  while (parent && parent !== root) {
    const style = getComputedStyle(parent);
    if (clipsAxis(style.overflowX) || clipsAxis(style.overflowY)) {
      const rect = parent.getBoundingClientRect();
      bounds.push({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left });
    }
    parent = parent.parentElement;
  }
  return bounds;
}

/**
 * 開いている編成用語のパネルを行の下へ置き、画面外なら最小限スクロールする。
 * 編成以外の用語チップ、および広い幅のフロー内パネルでは余白を消すだけ。
 */
function isHtmlElement(value: unknown): value is HTMLElement {
  return typeof HTMLElement !== 'undefined' && value instanceof HTMLElement;
}

/** `toggle` は状態変更より遅れることがあるため、開閉は `.open` を見る。 */
function openTermPanel(host: ParentNode): HTMLElement | null {
  if (typeof HTMLDetailsElement === 'undefined') return null;
  for (const details of host.querySelectorAll('details.term-tip')) {
    if (!(details instanceof HTMLDetailsElement) || !details.open) continue;
    const panel = details.querySelector('.term-tip-panel');
    if (panel instanceof HTMLElement) return panel;
  }
  return null;
}

export function revealSetupTermPanel(details: HTMLElement): void {
  if (typeof details.closest !== 'function') return;
  const host = details.closest('.setup-term-tips');
  if (!isHtmlElement(host)) return;
  const panel = openTermPanel(host);
  if (!panel || getComputedStyle(panel).position !== 'absolute') {
    host.style.removeProperty(SETUP_TERM_PANEL_RESERVE);
    return;
  }
  host.style.setProperty(
    SETUP_TERM_PANEL_RESERVE,
    termPanelReserve(panel.getBoundingClientRect().height),
  );
  const rect = panel.getBoundingClientRect();
  if (!isTermPanelFullyVisible(toBox(rect), clippingBounds(panel))) {
    panel.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}

function toBox(rect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>): TermPanelBox {
  return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
}
