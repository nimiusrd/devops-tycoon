import { useEffect, type RefObject } from 'react';

export type ScrollOverflowAxis = 'auto' | 'x' | 'y';

function clearScrollOverflowDataset(host: HTMLElement): void {
  delete host.dataset.scrollOverflow;
  delete host.dataset.scrollOverflowStart;
  delete host.dataset.scrollOverflowEnd;
}

function applyScrollOverflowAxis(
  scroller: HTMLElement,
  host: HTMLElement,
  axis: 'x' | 'y',
): boolean {
  if (axis === 'x') {
    const overflowX = scroller.scrollWidth > scroller.clientWidth + 1;
    if (!overflowX) return false;
    host.dataset.scrollOverflow = 'x';
    const atStart = scroller.scrollLeft <= 1;
    const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
    host.dataset.scrollOverflowStart = atStart ? 'true' : 'false';
    host.dataset.scrollOverflowEnd = atEnd ? 'true' : 'false';
    return true;
  }

  const overflowY = scroller.scrollHeight > scroller.clientHeight + 1;
  if (!overflowY) return false;
  host.dataset.scrollOverflow = 'y';
  const atStart = scroller.scrollTop <= 1;
  const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
  host.dataset.scrollOverflowStart = atStart ? 'true' : 'false';
  host.dataset.scrollOverflowEnd = atEnd ? 'true' : 'false';
  return true;
}

/** スクロールの端フェードと続き合図（#981 / #1010）の状態を scroller から host へ写す。 */
export function applyScrollOverflowEdgeState(
  scroller: HTMLElement,
  host: HTMLElement,
  axis: ScrollOverflowAxis = 'auto',
): void {
  if (axis === 'x') {
    if (!applyScrollOverflowAxis(scroller, host, 'x')) clearScrollOverflowDataset(host);
    return;
  }
  if (axis === 'y') {
    if (!applyScrollOverflowAxis(scroller, host, 'y')) clearScrollOverflowDataset(host);
    return;
  }
  if (applyScrollOverflowAxis(scroller, host, 'x')) return;
  if (applyScrollOverflowAxis(scroller, host, 'y')) return;
  clearScrollOverflowDataset(host);
}

export function useScrollOverflowEdges(
  scrollerRef: RefObject<HTMLElement | null>,
  hostRef: RefObject<HTMLElement | null>,
  axis: ScrollOverflowAxis = 'auto',
): void {
  useEffect(() => {
    const scroller = scrollerRef.current;
    const host = hostRef.current;
    if (!scroller || !host) return;

    const update = () => applyScrollOverflowEdgeState(scroller, host, axis);

    update();
    scroller.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(scroller);
    const mutation = new MutationObserver(update);
    mutation.observe(scroller, { childList: true, subtree: true, attributes: true });

    return () => {
      scroller.removeEventListener('scroll', update);
      observer?.disconnect();
      mutation.disconnect();
    };
  }, [axis, hostRef, scrollerRef]);
}
