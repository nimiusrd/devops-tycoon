/**
 * コンパクトドック内のフォーカス移動。ページ全体は動かさず、溢れたドックだけ対象を見せる。
 */

export type ScrollBox = { top: number; right: number; bottom: number; left: number };

export type DockScroller = {
  scrollTop: number;
  scrollLeft: number;
  getBoundingClientRect(): ScrollBox;
};

/**
 * 子が祖先の可視矩形から外れているとき、祖先の scrollTop/Left を進める量。
 */
export function dockScrollDelta(
  child: ScrollBox,
  container: ScrollBox,
): { dTop: number; dLeft: number } {
  let dTop = 0;
  let dLeft = 0;
  if (child.top < container.top) dTop = child.top - container.top;
  else if (child.bottom > container.bottom) dTop = child.bottom - container.bottom;
  if (child.left < container.left) dLeft = child.left - container.left;
  else if (child.right > container.right) dLeft = child.right - container.right;
  return { dTop, dLeft };
}

export function applyDockScroll(container: DockScroller, child: ScrollBox): boolean {
  const { dTop, dLeft } = dockScrollDelta(child, container.getBoundingClientRect());
  if (dTop === 0 && dLeft === 0) return false;
  container.scrollTop += dTop;
  container.scrollLeft += dLeft;
  return true;
}

/** ページ全体は preventScroll のまま、ドック内だけ対象へスクロールする。 */
export function focusOrgDockHit(hit: HTMLElement): void {
  hit.focus({ preventScroll: true });
  const dock = hit.closest<HTMLElement>('.org-island-badge-dock');
  if (!dock) return;
  applyDockScroll(dock, hit.getBoundingClientRect());
}
