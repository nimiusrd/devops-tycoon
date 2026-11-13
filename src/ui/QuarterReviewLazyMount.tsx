import {
  Component,
  Suspense,
  createElement,
  lazy,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { GoalAdjustmentId, RunState } from '../sim/run/types';
import type { QuarterReviewScreenProps } from './QuarterReviewScreen';
import { ResultOverlay } from './ResultOverlay';
import { useDialogOverlayLock } from './useDialogOverlayLock';
import {
  QUARTER_REVIEW_LOAD_SLOW_MS,
  loadQuarterReviewScreenModule,
  resetQuarterReviewScreenChunk,
  waitForQuarterReviewScreenModule,
} from './quarterReviewChunk';
export interface QuarterReviewLazyMountProps {
  state: RunState;
  onAcknowledge: () => void;
  onChooseAdjustment: (id: GoalAdjustmentId) => void;
  runEpoch: number;
}

const FAILURE_MESSAGE = '読み込めませんでした';

function QuarterReviewLoadStatus({
  mode,
  onRetry,
}: {
  mode: 'loading' | 'failed';
  onRetry: () => void;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const failureRef = useRef<HTMLParagraphElement>(null);
  useDialogOverlayLock(overlayRef, { onDismiss: () => {} });

  useLayoutEffect(() => {
    if (mode !== 'failed') return;
    failureRef.current?.focus({ preventScroll: true });
  }, [mode]);

  return (
    <ResultOverlay
      ref={overlayRef}
      className="overlay-contained quarter-review-load"
      data-testid="quarter-review-load"
      data-mode={mode}
      role="dialog"
      aria-modal="true"
      aria-labelledby={
        mode === 'failed' ? 'quarter-review-load-failed' : 'quarter-review-load-message'
      }
      tabIndex={-1}
    >
      <div className="result-card quarter-review-load-card">
        {mode === 'loading' ? (
          <p
            id="quarter-review-load-message"
            role="status"
            data-testid="quarter-review-load-message"
          >
            四半期レビューを読み込み中…
          </p>
        ) : (
          <>
            <p
              ref={failureRef}
              id="quarter-review-load-failed"
              data-testid="quarter-review-load-failed"
              tabIndex={-1}
            >
              {FAILURE_MESSAGE}
            </p>
            <div className="result-actions">
              <button
                type="button"
                className="btn btn-primary quarter-review-retry"
                data-testid="quarter-review-retry"
                onClick={onRetry}
              >
                もう一度読み込む
              </button>
            </div>
          </>
        )}
      </div>
    </ResultOverlay>
  );
}

class QuarterReviewRenderBoundary extends Component<
  { onError: () => void; children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('Quarter review screen could not be rendered', error);
    this.props.onError();
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

class QuarterReviewLazyScreen extends Component<{
  screenProps: QuarterReviewScreenProps;
  onRenderError: () => void;
}> {
  private readonly Screen;

  constructor(props: QuarterReviewLazyScreen['props']) {
    super(props);
    this.Screen = lazy(() =>
      loadQuarterReviewScreenModule().then((module) => ({
        default: module.QuarterReviewScreen,
      })),
    );
  }

  render() {
    return (
      <QuarterReviewRenderBoundary onError={this.props.onRenderError}>
        <Suspense fallback={null}>{createElement(this.Screen, this.props.screenProps)}</Suspense>
      </QuarterReviewRenderBoundary>
    );
  }
}

function QuarterReviewLoadAttempt({
  screenProps,
  loadGeneration,
  onRetry,
}: {
  screenProps: QuarterReviewScreenProps;
  loadGeneration: number;
  onRetry: () => void;
}) {
  const [showSlowLoading, setShowSlowLoading] = useState(loadGeneration > 0);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const onRenderError = () => setLoadState('failed');

  useEffect(() => {
    const signal = { cancelled: false };
    const slowTimer = setTimeout(() => {
      if (!signal.cancelled) setShowSlowLoading(true);
    }, QUARTER_REVIEW_LOAD_SLOW_MS);
    void waitForQuarterReviewScreenModule(signal).then((result) => {
      if (!signal.cancelled) setLoadState(result);
    });
    return () => {
      signal.cancelled = true;
      clearTimeout(slowTimer);
    };
  }, []);

  if (loadState === 'failed') {
    return <QuarterReviewLoadStatus mode="failed" onRetry={onRetry} />;
  }

  if (loadState === 'loading') {
    return showSlowLoading ? <QuarterReviewLoadStatus mode="loading" onRetry={onRetry} /> : null;
  }

  return <QuarterReviewLazyScreen screenProps={screenProps} onRenderError={onRenderError} />;
}

export function QuarterReviewLazyMount({
  state,
  onAcknowledge,
  onChooseAdjustment,
}: QuarterReviewLazyMountProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    resetQuarterReviewScreenChunk();
    setAttempt((value) => value + 1);
  };
  const screenProps: QuarterReviewScreenProps = {
    state,
    onAcknowledge,
    onChooseAdjustment,
  };

  return (
    <QuarterReviewLoadAttempt
      key={attempt}
      screenProps={screenProps}
      loadGeneration={attempt}
      onRetry={retry}
    />
  );
}
