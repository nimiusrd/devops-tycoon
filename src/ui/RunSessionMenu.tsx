/**
 * ラン中の遊び方・音切替（RI-148）。
 *
 * タイトルの HowToPlay とミュート設定を別実装にせず、ランバーから開く。
 * 常時は「メニュー」だけを置き、盤面と介入を覆わない。
 */
import type { KeyboardEvent, RefObject } from 'react';
import { listFocusable, wrapTabIfNeeded } from './dialogOverlayLock';

export interface RunSessionMenuProps {
  soundMuted: boolean;
  onOpenHelp: () => void;
  onToggleSoundMuted: () => void;
  /** 遊び方を開く直前にフォーカスを戻し、ヘルプ閉鎖後の起点にする。 */
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RunSessionMenu({
  soundMuted,
  onOpenHelp,
  onToggleSoundMuted,
  menuButtonRef,
  open,
  onOpenChange,
}: RunSessionMenuProps) {
  const close = () => {
    onOpenChange(false);
    menuButtonRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const panel = event.currentTarget.querySelector<HTMLElement>('#run-session-menu');
    if (!panel) return;
    const items = listFocusable(panel);
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const target = wrapTabIfNeeded(items, active, event.shiftKey, panel);
    if (!target || target === panel) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <div className="run-session-menu" onKeyDown={onKeyDown}>
      <button
        ref={menuButtonRef}
        type="button"
        className="pill run-session-menu-btn"
        data-testid="run-menu"
        aria-expanded={open}
        aria-controls="run-session-menu"
        onClick={() => onOpenChange(!open)}
      >
        メニュー
      </button>
      {open && (
        <div
          id="run-session-menu"
          className="run-session-menu-panel"
          data-testid="run-session-menu-panel"
          role="group"
          aria-label="ランのメニュー"
        >
          <button
            type="button"
            className="pill run-session-menu-btn"
            data-testid="run-open-help"
            autoFocus
            onClick={() => {
              menuButtonRef.current?.focus();
              onOpenChange(false);
              onOpenHelp();
            }}
          >
            遊び方
          </button>
          <button
            type="button"
            className="pill run-session-menu-btn"
            data-testid="run-sound-mute"
            aria-pressed={soundMuted}
            onClick={onToggleSoundMuted}
          >
            {soundMuted ? 'ミュート中' : '音あり'}
          </button>
        </div>
      )}
    </div>
  );
}
