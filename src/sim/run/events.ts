/**
 * スプリント間イベント（ビート）の効果適用と重み付け抽選（SPEC 第9章 / 第4節）。
 *
 * 選択結果（`EventOutcome`）を組織状態へ破壊的に反映する純TS。Morale の
 * マイナスはレリックのパッシブ（心理的安全性等）で緩和される（第8章）。
 * 予算・付与・出荷・信頼・次スプリント効果・ハード敗北は、呼び出し側（engine）が
 * 反映する差分として返す。組織状態による重み付けは `weightedEventPool`（純関数）。
 */
import type { EventDef, EventOutcome } from '../../data/events';
import { RUN_BALANCE } from '../../data/balance/run';
import { effectiveKind } from '../../data/events';
import { TECH_DEBT_CAP } from '../outcome';
import type { OrgState } from '../types';
import type {
  EventSignal,
  LoseReason,
  RunPassives,
  RunTotals,
  SprintModifierDelta,
  StakeholderTrust,
} from './types';
import { clamp } from '../clamp';

/** イベント適用後に engine が処理する差分（予算・付与・出荷・信頼・敗北・次スプリント）。 */
export interface EventApplyResult {
  /** 予算の増減。 */
  budgetDelta: number;
  /** 付与レリック ID（あれば）。 */
  grantRelic?: string;
  /** 付与カード定義 ID（あれば）。 */
  grantCard?: string;
  /** 個体採用を試みる（あれば。RI-26）。 */
  grantRecruit?: boolean;
  /** 出荷ポイント（当期 quarterTotals.delivered + 通算 totals.delivered へ加算）。 */
  delivered: number;
  /** ステークホルダー信頼の増減（あれば）。 */
  trust?: Partial<StakeholderTrust>;
  /** ハード敗北の理由（あれば即敗北）。 */
  forceLose?: LoseReason;
  /** 次スプリント限定の一時効果（あれば pendingSprintModifiers へ積む）。 */
  nextSprint?: SprintModifierDelta;
}

/**
 * イベント結果を org へ適用する。Morale 減少は `passives.moraleDamageMul`
 * で緩和する。出荷ポイントは org.deliveryScore へ加算し、当期/通算への加算は
 * 返り値の `delivered` を通じて engine が行う。
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
  // soft judgment: resolveBeat 直後の evaluateLose（seniorHp/morale <= 1）を回避する。
  if (outcome.preserveAboveLose) {
    if (org.seniorHp <= RUN_BALANCE.softOutcomeLoseThreshold.value) {
      org.seniorHp = RUN_BALANCE.softOutcomeSurvivalFloor.value;
    }
    if (org.morale <= RUN_BALANCE.softOutcomeLoseThreshold.value) {
      org.morale = RUN_BALANCE.softOutcomeSurvivalFloor.value;
    }
  }

  return {
    budgetDelta: outcome.budget ?? 0,
    grantRelic: outcome.grantRelic,
    grantCard: outcome.grantCard,
    grantRecruit: outcome.grantRecruit,
    delivered: outcome.delivered ?? 0,
    trust: outcome.trust,
    forceLose: outcome.forceLose,
    nextSprint: outcome.nextSprint,
  };
}

/**
 * 組織状態から各信号の強度（0..1）を算出する純関数。
 * 値が高いほど、その信号をトリガにするイベントの重みが上がる。
 */
export function eventSignals(org: OrgState): Record<EventSignal, number> {
  const c01 = (v: number): number => clamp(v, 0, 1);
  return {
    techDebtHigh: c01(org.techDebt / TECH_DEBT_CAP),
    aiDependencyHigh: c01(org.aiDependency / 100),
    aiLiteracyLow: c01((100 - org.aiLiteracy) / 100),
    seniorHpLow: c01((100 - org.seniorHp) / 100),
    moraleLow: c01((100 - org.morale) / 100),
    qualityLow: c01((100 - org.quality) / 100),
    testCoverageHigh: c01(org.testCoverage / 100),
    documentationHigh: c01(org.documentation / 100),
  };
}

export interface EventMinSignalFactor {
  signal: EventSignal;
  threshold: number;
  actual: number;
  satisfied: boolean;
}

/**
 * `minSignal` の資格判定と playtest の発火要因分類で共有する下限要因。
 * 定義に書かれた順序を保ち、同じ信号値を両方の利用者へ渡す。
 */
export function eventMinSignalFactors(
  def: EventDef,
  signals: Record<EventSignal, number>,
): EventMinSignalFactor[] {
  return Object.entries(def.minSignal ?? {}).map(([signal, threshold]) => {
    const typedSignal = signal as EventSignal;
    const actual = signals[typedSignal];
    return {
      signal: typedSignal,
      threshold,
      actual,
      satisfied: actual >= threshold,
    };
  });
}

/** 定義から指定信号の `minSignal` 閾値を取得する。 */
export function eventMinSignalThreshold(def: EventDef, signal: EventSignal): number | undefined {
  return def.minSignal?.[signal];
}

/** イベント 1 件の有効重み（ベース × Π(1 + trigger × 信号強度)）。 */
export function effectiveEventWeight(def: EventDef, signals: Record<EventSignal, number>): number {
  const base = def.weight ?? 1;
  let mul = 1;
  if (def.triggers) {
    for (const [sig, factor] of Object.entries(def.triggers) as [EventSignal, number][]) {
      mul *= 1 + factor * signals[sig];
    }
  }
  return base * mul;
}

/**
 * 組織状態で重み付けしたイベントプールを返す純関数（決定論・GPU 不要）。
 * `totals` は将来のチューニング用に受け取るが、現状は org の信号のみで重み付けする。
 */
export function weightedEventPool(
  org: OrgState,
  _totals: RunTotals,
  pool: EventDef[],
): { def: EventDef; weight: number }[] {
  const signals = eventSignals(org);
  return pool.map((def) => ({ def, weight: effectiveEventWeight(def, signals) }));
}

/** 重み付きプールから 0..1 の乱数で 1 件選ぶ（重み合計 0 のときは先頭）。 */
export function pickWeighted(
  weighted: { def: EventDef; weight: number }[],
  r: number,
): EventDef | undefined {
  if (weighted.length === 0) return undefined;
  const total = weighted.reduce((s, w) => s + w.weight, 0);
  if (total <= 0) return weighted[0].def;
  let acc = r * total;
  for (const w of weighted) {
    acc -= w.weight;
    if (acc < 0) return w.def;
  }
  return weighted[weighted.length - 1].def;
}

/** 種別でイベント定義を絞り込む（既定解決後の種別で分類する）。 */
export function eventsOfKind(pool: EventDef[], kind: 'judgment' | 'decision'): EventDef[] {
  return pool.filter((def) => effectiveKind(def) === kind);
}

/**
 * イベントが現在の組織状態で抽選対象になるか（`minSignal` / `maxSignal` を満たすか）。
 * ハード敗北など、健全な組織では起きてはならない事象をプールから除外するために使う。
 */
export function eventEligible(def: EventDef, signals: Record<EventSignal, number>): boolean {
  if (eventMinSignalFactors(def, signals).some((factor) => !factor.satisfied)) return false;
  if (def.maxSignal) {
    for (const [sig, max] of Object.entries(def.maxSignal) as [EventSignal, number][]) {
      if (signals[sig] > max) return false;
    }
  }
  return true;
}
