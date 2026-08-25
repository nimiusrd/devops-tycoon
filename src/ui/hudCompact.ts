import type { StatusMetricId, StatusMetricTone, StatusMetricView } from '../render/status';

/**
 * 平常時に人が一度に追う KPI の上限。
 * 出荷を1枠固定し、残り3枠を危険度順に入れ替える。
 */
const COMPACT_CHIP_LIMIT = 4;
const COMPACT_PRIORITY_IDS: StatusMetricId[] = [
  'delivery',
  'seniorHp',
  'morale',
  'aiDependency',
  'techDebt',
  'quality',
  'security',
  'devSpeed',
  'reviewCapacity',
];
const TONE_RANK: Record<StatusMetricTone, number> = {
  danger: 0,
  watch: 1,
  good: 2,
};

export function pickCompactMetrics(metrics: StatusMetricView[]): StatusMetricView[] {
  const byId = new Map(metrics.map((metric) => [metric.id, metric]));
  const picked: StatusMetricView[] = [];
  const seen = new Set<StatusMetricId>();

  // 出荷は tone が常に good なので、危険トーン優先だけで埋めると落ちる。先に確保する。
  const delivery = byId.get('delivery');
  if (delivery) {
    picked.push(delivery);
    seen.add('delivery');
  }

  const ranked = metrics
    .filter((metric) => !seen.has(metric.id))
    .sort((a, b) => {
      // danger を最優先し、同じ危険度の中で凍結・燃え尽きなどの具体的な警告を先に出す。
      const toneDiff = TONE_RANK[a.tone] - TONE_RANK[b.tone];
      if (toneDiff !== 0) return toneDiff;
      const warningDiff = Number(Boolean(b.warningChip)) - Number(Boolean(a.warningChip));
      if (warningDiff !== 0) return warningDiff;
      return COMPACT_PRIORITY_IDS.indexOf(a.id) - COMPACT_PRIORITY_IDS.indexOf(b.id);
    });
  for (const metric of ranked) {
    if (picked.length >= COMPACT_CHIP_LIMIT) break;
    picked.push(metric);
    seen.add(metric.id);
  }
  // 危険が少ないときは主要指標で埋める。
  for (const id of COMPACT_PRIORITY_IDS) {
    if (picked.length >= COMPACT_CHIP_LIMIT) break;
    if (seen.has(id)) continue;
    const metric = byId.get(id);
    if (!metric) continue;
    picked.push(metric);
    seen.add(id);
  }
  return picked.sort(
    (a, b) => COMPACT_PRIORITY_IDS.indexOf(a.id) - COMPACT_PRIORITY_IDS.indexOf(b.id),
  );
}
