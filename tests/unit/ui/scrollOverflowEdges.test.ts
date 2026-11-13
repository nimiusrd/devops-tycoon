import { describe, expect, it } from 'vitest';
import { applyScrollOverflowEdgeState } from '../../../src/ui/scrollOverflowEdges';

function createHost(initial: Record<string, string> = {}): HTMLElement {
  const dataset = { ...initial };
  return {
    dataset: dataset as DOMStringMap,
  } as HTMLElement;
}

describe('applyScrollOverflowEdgeState', () => {
  it('横オーバーフローが無いとき data 属性を消す', () => {
    const scroller = {
      scrollWidth: 120,
      clientWidth: 120,
      scrollLeft: 0,
    } as HTMLElement;
    const host = createHost({
      scrollOverflow: 'x',
      scrollOverflowStart: 'false',
      scrollOverflowEnd: 'false',
    });

    applyScrollOverflowEdgeState(scroller, host);

    expect(host.dataset.scrollOverflow).toBeUndefined();
    expect(host.dataset.scrollOverflowStart).toBeUndefined();
    expect(host.dataset.scrollOverflowEnd).toBeUndefined();
  });

  it('端位置に応じて start/end を付ける', () => {
    const host = createHost();
    const atStart = {
      scrollWidth: 320,
      clientWidth: 200,
      scrollLeft: 0,
    } as HTMLElement;
    applyScrollOverflowEdgeState(atStart, host);
    expect(host.dataset.scrollOverflow).toBe('x');
    expect(host.dataset.scrollOverflowStart).toBe('true');
    expect(host.dataset.scrollOverflowEnd).toBe('false');

    const middle = { ...atStart, scrollLeft: 60 } as HTMLElement;
    applyScrollOverflowEdgeState(middle, host);
    expect(host.dataset.scrollOverflowStart).toBe('false');
    expect(host.dataset.scrollOverflowEnd).toBe('false');

    const atEnd = { ...atStart, scrollLeft: 120 } as HTMLElement;
    applyScrollOverflowEdgeState(atEnd, host);
    expect(host.dataset.scrollOverflowStart).toBe('false');
    expect(host.dataset.scrollOverflowEnd).toBe('true');
  });
});
