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
import {
  QUARTER_REVIEW_LOAD_SLOW_MS,
  loadQuarterReviewScreenModule,
  resetQuarterReviewScreenChunk,
  waitForQuarterReviewScreenModule,
} from './quarterReviewChunk';
import {
  noteAnnouncedQuarterReviewLoadSpeech,
  readAnnouncedQuarterReviewLoadSpeech,
} from './quarterReviewLoadSpeech';

export interface QuarterReviewLazyMountProps {
  state: RunState;
  onAcknowledge: () => void;
  onChooseAdjustment: (id: GoalAdjustmentId) => void;
  runEpoch: number;
}

const FAILURE_MESSAGE = '読み込めませんでした';

function QuarterReviewFailureSpeech({ speechKey }: { speechKey: string }) {
  const [spoken, setSpoken] = useState(() =>
    readAnnouncedQuarterReviewLoadSpeech(speechKey) === FAILURE_MESSAGE ? FAILURE_MESSAGE : '',
  );

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      if (cancelled) return;
      if (readAnnouncedQuarterReviewLoadSpeech(speechKey) !== FAILURE_MESSAGE) {
        noteAnnouncedQuarterReviewLoadSpeech(speechKey, FAILURE_MESSAGE);
      }
      setSpoken(FAILURE_MESSAGE);
    };
    if (typeof requestAnimationFrame !== 'function') {
      queueMicrotask(publish);
      return () => {
        cancelled = true;
      };
    }
    const frame = requestAnimationFrame(publish);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [speechKey]);

  return (
    <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {spoken}
    </p>
  );
}

function QuarterReviewLoadStatus({
  mode,
  runEpoch,
  onRetry,
}: {
  mode: 'loading' | 'failed';
  runEpoch: number;
  onRetry: () => void;
}) {
  const failureRef = useRef<HTMLParagraphElement>(null);
  const speechKey = `quarter-review-chunk:${runEpoch}`;

  useLayoutEffect(() => {
    if (mode !== 'failed') return;
    failureRef.current?.focus({ preventScroll: true });
  }, [mode]);

  return (
    <div
      className="result-overlay overlay-contained quarter-review-load"
      data-testid="quarter-review-load"
      data-mode={mode}
    >
      <div className="result-card quarter-review-load-card">
        {mode === 'loading' ? (
          <p role="status" data-testid="quarter-review-load-message">
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
            <QuarterReviewFailureSpeech key={speechKey} speechKey={speechKey} />
            <div className="result-actions">
              <button
                type="button"
                className="btn btn-primary"
                data-testid="quarter-review-retry"
                onClick={onRetry}
              >
                もう一度読み込む
              </button>
            </div>
          </>
        )}
      </div>
    </div>
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
  runEpoch,
  onRetry,
}: {
  screenProps: QuarterReviewScreenProps;
  runEpoch: number;
  onRetry: () => void;
}) {
  const [showSlowLoading, setShowSlowLoading] = useState(false);
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
    return <QuarterReviewLoadStatus mode="failed" runEpoch={runEpoch} onRetry={onRetry} />;
  }

  if (loadState === 'loading') {
    return showSlowLoading ? (
      <QuarterReviewLoadStatus mode="loading" runEpoch={runEpoch} onRetry={onRetry} />
    ) : null;
  }

  return <QuarterReviewLazyScreen screenProps={screenProps} onRenderError={onRenderError} />;
}

export function QuarterReviewLazyMount({
  state,
  onAcknowledge,
  onChooseAdjustment,
  runEpoch,
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
      runEpoch={runEpoch}
      onRetry={retry}
    />
  );
}
