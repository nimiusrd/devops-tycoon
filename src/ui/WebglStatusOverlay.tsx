import { useRef, useSyncExternalStore } from 'react';
import { getWebglStatus, retryWebgl, subscribeWebglStatus } from '../render/webglStatus';
import { ResultOverlay } from './ResultOverlay';
import { useDialogOverlayLock } from './useDialogOverlayLock';

function StatusDialog({ failed }: { failed: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(ref, {
    restoreFocus: true,
    // 再試行が必要なため閉じず、Escape が背面のズーム操作へ伝わることだけを防ぐ。
    onDismiss: () => {},
  });
  return (
    <ResultOverlay
      ref={ref}
      className="webgl-status-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="webgl-status-title"
      tabIndex={-1}
      data-testid="webgl-status"
    >
      <div className="result-card">
        <h2 id="webgl-status-title">
          {failed ? '盤面を表示できませんでした' : 'オフィスを準備しています'}
        </h2>
        <p role="status">
          {failed
            ? '通信状態やブラウザのWebGL設定を確認して、再試行してください。'
            : '描画の準備ができるまでお待ちください。'}
        </p>
        <p>ゲームの自動進行は停止しています。</p>
        {failed && (
          <p>
            再読み込み後は「続きから」で保存済みのランを再開できます。保存後の進行は失われます。
          </p>
        )}
        {failed && (
          <div className="result-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                // 再試行ボタンが消えても、準備中ダイアログ内にフォーカスを保つ。
                ref.current?.focus({ preventScroll: true });
                retryWebgl();
              }}
              data-testid="webgl-retry"
            >
              再試行
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => window.location.reload()}
              data-testid="webgl-reload"
            >
              ページを再読み込み
            </button>
          </div>
        )}
      </div>
    </ResultOverlay>
  );
}

export function WebglStatusOverlay() {
  const status = useSyncExternalStore(subscribeWebglStatus, getWebglStatus, () => 'ready');
  return status === 'ready' ? null : <StatusDialog failed={status === 'failed'} />;
}
