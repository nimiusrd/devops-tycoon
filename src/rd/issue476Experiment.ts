/**
 * Issue #476 R&D プロトタイプ。本番バランスの正本は書き換えない。
 *
 * 切り替えは `?rd=baseline|threshold|pace`（再ビルド不要）。
 * 未指定・未知値は baseline（現行ライブ値）。
 */
import { PACING_BALANCE } from '../data/balance/pacing';
import { SPRINT_BALANCE } from '../data/balance/sprint';

export const ISSUE_476_PARAM = 'rd';

export const ISSUE_476_VARIANTS = ['baseline', 'threshold', 'pace'] as const;

export type Issue476Variant = (typeof ISSUE_476_VARIANTS)[number];

/** threshold-only / pace-only など、PROTO に書いた別名。 */
const VARIANT_ALIASES: Record<string, Issue476Variant> = {
  baseline: 'baseline',
  off: 'baseline',
  live: 'baseline',
  threshold: 'threshold',
  'threshold-only': 'threshold',
  pace: 'pace',
  'pace-only': 'pace',
};

/**
 * 実験値。3 スプリントで S 率が動く大きさにする。
 * Easy を Hard（床 42 / mul 1.4）へ寄せない。
 */
export const ISSUE_476_EXPERIMENT = {
  gradeThresholdS: 0.99,
  easyNormalTaskFloor: PACING_BALANCE.normalTaskFloorNormal.value,
  easyTaskCountMul: 1.65,
} as const;

export interface Issue476Knobs {
  variant: Issue476Variant;
  gradeThresholdS: number;
  easyNormalTaskFloor: number;
  easyTaskCountMul: number;
}

export function baselineIssue476Knobs(): Issue476Knobs {
  return {
    variant: 'baseline',
    gradeThresholdS: SPRINT_BALANCE.gradeThresholdS.value,
    easyNormalTaskFloor: PACING_BALANCE.normalTaskFloorEasy.value,
    easyTaskCountMul: 1.85,
  };
}

/** クエリ文字列から実験バリアントを解決する。純関数。 */
export function resolveIssue476Variant(search: string): Issue476Variant {
  const raw = new URLSearchParams(search).get(ISSUE_476_PARAM);
  if (!raw) return 'baseline';
  return VARIANT_ALIASES[raw.trim().toLowerCase()] ?? 'baseline';
}

export function resolveIssue476VariantFromLocation(): Issue476Variant {
  if (typeof window === 'undefined') return 'baseline';
  return resolveIssue476Variant(window.location.search);
}

export function issue476Knobs(
  variant: Issue476Variant = resolveIssue476VariantFromLocation(),
): Issue476Knobs {
  const baseline = baselineIssue476Knobs();
  if (variant === 'threshold') {
    return { ...baseline, variant, gradeThresholdS: ISSUE_476_EXPERIMENT.gradeThresholdS };
  }
  if (variant === 'pace') {
    return {
      ...baseline,
      variant,
      easyNormalTaskFloor: ISSUE_476_EXPERIMENT.easyNormalTaskFloor,
      easyTaskCountMul: ISSUE_476_EXPERIMENT.easyTaskCountMul,
    };
  }
  return baseline;
}

export function resolveGradeThresholdS(baseline: number): number {
  const knobs = issue476Knobs();
  return knobs.variant === 'threshold' ? knobs.gradeThresholdS : baseline;
}

export function resolveEasyNormalTaskFloor(baseline: number): number {
  const knobs = issue476Knobs();
  return knobs.variant === 'pace' ? knobs.easyNormalTaskFloor : baseline;
}

export function resolveEasyTaskCountMul(baseline: number): number {
  const knobs = issue476Knobs();
  return knobs.variant === 'pace' ? knobs.easyTaskCountMul : baseline;
}

/** タイトルのピッカー用。`baseline` は `rd` を外して本番相当の URL にする。 */
export function writeIssue476VariantToLocation(variant: Issue476Variant): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (variant === 'baseline') {
    url.searchParams.delete(ISSUE_476_PARAM);
  } else {
    url.searchParams.set(ISSUE_476_PARAM, variant);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', next);
}

export function issue476VariantLabel(variant: Issue476Variant): string {
  if (variant === 'threshold') return 'threshold-only';
  if (variant === 'pace') return 'pace-only';
  return 'baseline';
}
