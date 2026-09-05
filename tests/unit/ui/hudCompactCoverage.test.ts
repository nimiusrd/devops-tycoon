import { describe, expect, it } from 'vitest';
import type {
  StatusMetricId,
  StatusMetricTone,
  StatusMetricView,
} from '../../../src/render/status';
import { pickCompactMetrics } from '../../../src/ui/hudCompact';

function metric(
  id: StatusMetricId,
  tone: StatusMetricTone = 'good',
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

describe('pickCompactMetrics の少数入力と同危険度の選択', () => {
  it('指標がなければ空の配列を返す', () => {
    expect(pickCompactMetrics([])).toEqual([]);
  });

  it.each([false, true])(
    '4件未満では出荷の有無=%sによらず全指標を既定順に並べ、入力を変更しない',
    (includeDelivery) => {
      const metrics = [metric('quality', 'danger'), metric('seniorHp', 'watch')];
      if (includeDelivery) metrics.push(metric('delivery'));
      const original = structuredClone(metrics);
      const picked = pickCompactMetrics(metrics);
      expect(picked.map(({ id }) => id)).toEqual(
        includeDelivery ? ['delivery', 'seniorHp', 'quality'] : ['seniorHp', 'quality'],
      );
      expect(picked).not.toBe(metrics);
      expect(picked.every((item) => metrics.includes(item))).toBe(true);
      expect(metrics).toEqual(original);
    },
  );

  it('出荷がなくても4枠を使い、同じ危険度では具体的な警告がある指標を優先する', () => {
    const metrics = [
      metric('seniorHp', 'danger'),
      metric('morale', 'danger'),
      metric('aiDependency', 'danger'),
      metric('techDebt', 'danger'),
      metric('security', 'danger', '脆弱性が増加'),
    ];
    const original = structuredClone(metrics);
    expect(pickCompactMetrics(metrics).map(({ id }) => id)).toEqual([
      'seniorHp',
      'morale',
      'aiDependency',
      'security',
    ]);
    expect(metrics).toEqual(original);
  });

  it('空の警告は優先せず、出荷を固定して残り3枠を選ぶ', () => {
    const metrics = [
      metric('delivery'),
      metric('seniorHp', 'watch'),
      metric('morale', 'watch'),
      metric('aiDependency', 'watch', ''),
      metric('security', 'watch', 'セキュリティ注意'),
    ];
    expect(pickCompactMetrics(metrics).map(({ id }) => id)).toEqual([
      'delivery',
      'seniorHp',
      'morale',
      'security',
    ]);
  });
});
