import { useEffect, type RefObject } from 'react';

/** 横スクロールの端フェードと続き合図（#981 / #1010）の状態を scroller から host へ写す。 */
export function applyScrollOverflowEdgeState(scroller: HTMLElement, host: HTMLElement): void {
  const overflowX = scroller.scrollWidth > scroller.clientWidth + 1;
  if (!overflowX) {
    delete host.dataset.scrollOverflow;
    delete host.dataset.scrollOverflowStart;
    delete host.dataset.scrollOverflowEnd;
    return;
  }
  host.dataset.scrollOverflow = 'x';
  const atStart = scroller.scrollLeft <= 1;
  const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1;
  host.dataset.scrollOverflowStart = atStart ? 'true' : 'false';
  host.dataset.scrollOverflowEnd = atEnd ? 'true' : 'false';
}

export function useScrollOverflowEdges(
  scrollerRef: RefObject<HTMLElement | null>,
  hostRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const scroller = scrollerRef.current;
    const host = hostRef.current;
    if (!scroller || !host) return;

    const update = () => applyScrollOverflowEdgeState(scroller, host);

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
  }, [hostRef, scrollerRef]);
}
