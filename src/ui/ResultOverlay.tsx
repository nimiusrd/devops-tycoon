/**
 * タイトルなど文書がビューポートより高い画面でも、ダイアログを画面内に固定する。
 *
 * `position: fixed` は祖先の transform / filter / overflow で包含ブロックが変わり、
 * ページ先頭へ開いて見えないことがある。`document.body` へ portal し、背面スクロールを止める。
 * Escape で閉じる契約はここでは扱わない（#361 / #371）。
 */
import { useLayoutEffect, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

let lockCount = 0;
let previousBodyOverflow = '';
let previousRootOverflow = '';

function lockDocumentScroll(): void {
  if (typeof document === 'undefined') return;
  if (lockCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    previousRootOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function unlockDocumentScroll(): void {
  if (typeof document === 'undefined') return;
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = previousBodyOverflow;
    document.documentElement.style.overflow = previousRootOverflow;
  }
}

export interface ResultOverlayProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function ResultOverlay({ children, className, ...rest }: ResultOverlayProps) {
  useLayoutEffect(() => {
    lockDocumentScroll();
    return () => {
      unlockDocumentScroll();
    };
  }, []);

  if (typeof document === 'undefined' || !document.body) return null;

  const overlayClass = className ? `result-overlay ${className}` : 'result-overlay';
  return createPortal(
    <div className={overlayClass} {...rest}>
      {children}
    </div>,
    document.body,
  );
}
