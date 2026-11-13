import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useScrollOverflowEdges } from './scrollOverflowEdges';

export interface ScrollOverflowColumnProps extends HTMLAttributes<HTMLUListElement> {
  hostClassName?: string;
  children: ReactNode;
}

/** 縦スクロール一覧の端フェード用ラッパー（#981）。横スクロール用部品は壊さない。 */
export function ScrollOverflowColumn({
  className,
  hostClassName,
  children,
  ...listProps
}: ScrollOverflowColumnProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLUListElement>(null);
  useScrollOverflowEdges(scrollerRef, hostRef, 'y');

  const hostClass = ['scroll-overflow-host', hostClassName].filter(Boolean).join(' ');
  const listClass = ['scroll-overflow-scroller', 'action-target-picker-list', className]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={hostRef} className={hostClass} data-testid="action-target-picker-list-host">
      <ul ref={scrollerRef} className={listClass} {...listProps}>
        {children}
      </ul>
    </div>
  );
}
