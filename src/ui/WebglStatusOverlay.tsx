import { useRef, useSyncExternalStore } from 'react';
import { getWebglStatus, retryWebgl, subscribeWebglStatus } from '../render/webglStatus';
import { ResultOverlay } from './ResultOverlay';
import { useDialogOverlayLock } from './useDialogOverlayLock';

function StatusDialog({ failed }: { failed: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogOverlayLock(ref, { restoreFocus: true });
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
            ? 'WebGLを初期化できませんでした。ブラウザのハードウェアアクセラレーションを有効にして、もう一度お試しください。'
            : '描画の準備ができるまでお待ちください。'}
        </p>
        <p>ゲームの自動進行は停止しています。</p>
        {failed && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={retryWebgl}
            data-testid="webgl-retry"
          >
            再試行
          </button>
        )}
      </div>
    </ResultOverlay>
  );
}

export function WebglStatusOverlay() {
  const status = useSyncExternalStore(subscribeWebglStatus, getWebglStatus, () => 'ready');
  return status === 'ready' ? null : <StatusDialog failed={status === 'failed'} />;
}
