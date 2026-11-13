import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useScrollOverflowEdges } from './scrollOverflowEdges';

export interface ScrollOverflowRowProps extends HTMLAttributes<HTMLDivElement> {
  scrollerClassName?: string;
  children: ReactNode;
}

/** 横スクロール列の端フェード・snap 用ラッパー（#981 / #1010）。 */
export function ScrollOverflowRow({
  className,
  scrollerClassName,
  children,
  ...scrollerProps
}: ScrollOverflowRowProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  useScrollOverflowEdges(scrollerRef, hostRef);

  const hostClass = ['scroll-overflow-host', className].filter(Boolean).join(' ');
  const scrollerClass = ['scroll-overflow-scroller', scrollerClassName].filter(Boolean).join(' ');

  return (
    <div ref={hostRef} className={hostClass}>
      <div ref={scrollerRef} className={scrollerClass} {...scrollerProps}>
        {children}
      </div>
    </div>
  );
}
