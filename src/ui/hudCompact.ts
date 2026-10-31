import type { StatusMetricId, StatusMetricTone, StatusMetricView } from '../render/status';

/** コンパクト KPI の数字幅。桁が増えてもチップ幅を変えない（#975）。 */
export type CompactValueSlot = 'delivery' | 'percent' | 'points' | 'grade' | 'risk';

/**
 * 数字スロットの最大文字数。
 *
 * 出荷はラン累計の 6 桁と単位 `pt`。百分率は `100%`。単位なしの点数は 4 桁。
 * グレードは 1 文字、炎上リスクは `HIGH`。
 */
export function compactValueSlot(metric: { id: string; unit?: string; value: string | number }): {
  slot: CompactValueSlot;
  glyphs: number;
} {
  if (metric.id === 'delivery') return { slot: 'delivery', glyphs: 8 };
  if (metric.id === 'fireRisk') return { slot: 'risk', glyphs: 4 };
  if (typeof metric.value === 'string') return { slot: 'grade', glyphs: 1 };
  if (metric.unit === '%') return { slot: 'percent', glyphs: 4 };
  return { slot: 'points', glyphs: 4 };
}

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
  // LOW のときは主要KPIを押し出さない。MED/HIGH は tone 優先で入る。
  'fireRisk',
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
