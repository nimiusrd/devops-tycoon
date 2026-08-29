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

  it('炎上リスクは士気と別チップとして選び、士気goodでもMEDを落とさない', () => {
    const picked = pickCompactMetrics([
      metric('delivery', 'good'),
      metric('seniorHp', 'watch', '体力注意'),
      metric('morale', 'good'),
      metric('fireRisk', 'watch'),
      metric('techDebt', 'good'),
      metric('aiDependency', 'good'),
    ]);

    expect(picked.map(({ id }) => id)).toEqual(['delivery', 'seniorHp', 'morale', 'fireRisk']);
    expect(picked.find((m) => m.id === 'morale')?.tone).toBe('good');
    expect(picked.find((m) => m.id === 'fireRisk')?.tone).toBe('watch');
  });

  it('炎上リスクLOWは要約4枠から外し主要KPIを残す', () => {
    const picked = pickCompactMetrics([
      metric('delivery', 'good'),
      metric('seniorHp', 'good'),
      metric('morale', 'good'),
      metric('fireRisk', 'good'),
      metric('aiDependency', 'good'),
      metric('techDebt', 'good'),
    ]);

    expect(picked.map(({ id }) => id)).toEqual(['delivery', 'seniorHp', 'morale', 'aiDependency']);
  });
});
