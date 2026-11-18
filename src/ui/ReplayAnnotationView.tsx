import { useReplayContent } from './replayContent';

/** モーダル内でも既存のフォーカス範囲に含め、記録値とは別に読む。 */
export function ReplayAnnotationView() {
  const { annotationText } = useReplayContent();
  if (!annotationText) return null;
  return (
    <details className="replay-annotation-view" data-testid="replay-annotation-view">
      <summary>作者の理由（記録値とは別のメモ）</summary>
      <p tabIndex={0} role="region" aria-label="作者の理由本文">
        {annotationText}
      </p>
    </details>
  );
}
