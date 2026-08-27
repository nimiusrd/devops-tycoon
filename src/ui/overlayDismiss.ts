/**
 * 閉じ可能な result-overlay の操作契約（Escape / 背景クリック）。
 *
 * ネイティブ `<dialog>` ではなく既存の `role="dialog"` overlay を使うため、
 * 閉じる操作は各 Screen がこのヘルパで揃える。遊び方（#361）とは独立して
 * メタショップ／カードコレクション（#371）から導入する。
 */
import { useEffect, type MouseEvent } from 'react';

/** overlay を閉じるキーか（一般的な dialog の Escape 契約）。 */
export function isOverlayDismissKey(key: string): boolean {
  return key === 'Escape';
}

/** オーバーレイ自身（背景）へのクリックか。パネル内クリックは false。 */
export function isOverlayBackdropTarget(
  target: EventTarget | null,
  currentTarget: EventTarget | null,
): boolean {
  return target === currentTarget;
}

export function useOverlayDismiss(onClose: () => void): {
  onBackdropClick: (event: MouseEvent<HTMLElement>) => void;
} {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isOverlayDismissKey(event.key)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return {
    onBackdropClick: (event) => {
      if (isOverlayBackdropTarget(event.target, event.currentTarget)) onClose();
    },
  };
}
