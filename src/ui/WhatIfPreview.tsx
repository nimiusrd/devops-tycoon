import type { WhatIfPreview as WhatIfPreviewData } from '../sim/run/types';

export function WhatIfPreview({
  preview,
  testId,
  compact = false,
}: {
  preview: WhatIfPreviewData;
  testId?: string;
  compact?: boolean;
}) {
  const deliveredMin = Math.floor(preview.delivered.min);
  const deliveredMax = Math.ceil(preview.delivered.max);
  const spreadMin = Math.floor(preview.spread.min);
  const spreadMax = Math.ceil(preview.spread.max);
  return (
    <div className={`what-if-preview${compact ? ' compact' : ''}`} data-testid={testId}>
      <span className="what-if-label">次スプリント予測</span>
      <span>
        出荷 {deliveredMin}〜{deliveredMax}
      </span>
      <span>
        延焼 {spreadMin}〜{spreadMax}
      </span>
      <span className="what-if-trials">{preview.trials}回試算</span>
    </div>
  );
}
