/**
 * 分岐選択イベントの効果適用（SPEC 第9.4）。
 *
 * 選択結果（`EventOutcome`）を組織状態へ破壊的に反映する純TS。Morale の
 * マイナスはレリックのパッシブ（心理的安全性等）で緩和される（第8章）。
 * 予算・レリック/カード付与は呼び出し側（engine）が反映する差分として返す。
 */
import type { EventOutcome } from '../../data/events';
import type { OrgState } from '../types';
import type { RunPassives } from './types';

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** イベント適用後に engine が処理する差分（予算・付与）。 */
export interface EventApplyResult {
  /** 予算の増減。 */
  budgetDelta: number;
  /** 付与レリック ID（あれば）。 */
  grantRelic?: string;
  /** 付与カード定義 ID（あれば）。 */
  grantCard?: string;
}

/**
 * イベント結果を org へ適用する。Morale 減少は `passives.moraleDamageMul`
 * で緩和する。出荷ポイントは org.deliveryScore へ加算する。
 */
export function applyEventOutcome(
  outcome: EventOutcome,
  org: OrgState,
  passives: RunPassives,
): EventApplyResult {
  if (outcome.delivered) org.deliveryScore += outcome.delivered;
  if (outcome.morale) {
    const m = outcome.morale < 0 ? outcome.morale * passives.moraleDamageMul : outcome.morale;
    org.morale = clamp(org.morale + m, 0, 100);
  }
  if (outcome.seniorHp) org.seniorHp = clamp(org.seniorHp + outcome.seniorHp, 0, 100);
  if (outcome.quality) org.quality = clamp(org.quality + outcome.quality, 0, 100);
  if (outcome.testCoverage)
    org.testCoverage = clamp(org.testCoverage + outcome.testCoverage, 0, 100);
  if (outcome.aiLiteracy) org.aiLiteracy = clamp(org.aiLiteracy + outcome.aiLiteracy, 0, 100);
  if (outcome.aiDependency)
    org.aiDependency = clamp(org.aiDependency + outcome.aiDependency, 0, 100);
  if (outcome.techDebt) org.techDebt = Math.max(0, org.techDebt + outcome.techDebt);

  return {
    budgetDelta: outcome.budget ?? 0,
    grantRelic: outcome.grantRelic,
    grantCard: outcome.grantCard,
  };
}
