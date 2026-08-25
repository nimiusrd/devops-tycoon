import { describe, expect, it } from 'vitest';
import type {
  StatusMetricId,
  StatusMetricTone,
  StatusMetricView,
} from '../../../src/render/status';
import { pickCompactMetrics } from '../../../src/ui/hudCompact';

function metric(
  id: StatusMetricId,
  tone: StatusMetricTone,
  warningChip?: string,
): StatusMetricView {
  return {
    id,
    label: id,
    icon: '',
    value: 0,
    direction: 'higher-better',
    directionLabel: '高いほど良い',
    tone,
    detail: '',
    help: '',
    warningChip,
  };
}

describe('pickCompactMetrics', () => {
  it('watch警告が複数あってもdanger指標を優先する', () => {
    const picked = pickCompactMetrics([
      metric('delivery', 'good'),
      metric('security', 'watch', 'セキュリティ注意'),
      metric('seniorHp', 'watch', '体力注意'),
      metric('aiDependency', 'watch', 'AI依存注意'),
      metric('techDebt', 'danger'),
      metric('morale', 'danger'),
    ]);

    expect(picked).toHaveLength(4);
    expect(picked.map(({ id }) => id)).toEqual(
      expect.arrayContaining(['delivery', 'techDebt', 'morale']),
    );
    expect(picked.filter(({ tone }) => tone === 'watch')).toHaveLength(1);
  });
});
