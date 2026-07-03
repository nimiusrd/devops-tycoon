/**
 * イベント結果（`EventOutcome`）から UI 用効果タグを生成する（RI-43）。
 * カード/レリック/進化ノードの係数表示も同じ `EffectTag` 型で扱う（RI-44）。
 *
 * 数値デルタ・付与・次スプリント効果・画面遷移を、色分け可能な
 * 表示タグへ変換する純関数。sim 層は知らず、後続 RI-45 以降も
 * 共通 `EffectTag` 型を再利用する。
 */
import type { EventChoice, EventOutcome } from '../data/events';
import { getCard } from '../data/cards';
import type { EvolutionNodeDef } from '../data/evolution';
import type { RelicDef } from '../data/relics';
import { getRelic } from '../data/relics';
import type { CardEffects, CardDef } from '../sim/types';
import type { LoseReason, RunPassives, SprintModifierDelta } from '../sim/run/types';
import { scaleEffects } from '../sim/cards';

export type EffectTagTone = 'positive' | 'negative' | 'neutral';

/** 画面に並べる 1 件の効果タグ。 */
export interface EffectTag {
  label: string;
  tone: EffectTagTone;
}

const NUMERIC_OUTCOME_KEYS = [
  'delivered',
  'morale',
  'seniorHp',
  'techDebt',
  'budget',
  'quality',
  'testCoverage',
  'aiLiteracy',
  'aiDependency',
] as const satisfies readonly (keyof EventOutcome)[];

const NUMERIC_LABELS: Record<(typeof NUMERIC_OUTCOME_KEYS)[number], string> = {
  delivered: '出荷',
  morale: '士気',
  seniorHp: 'シニアHP',
  techDebt: 'Tech Debt',
  budget: '予算',
  quality: '品質',
  testCoverage: 'Test Coverage',
  aiLiteracy: 'AI Literacy',
  aiDependency: 'AI依存度',
};

const TRUST_LABELS = {
  management: '経営信頼',
  customers: '顧客信頼',
  team: 'チーム信頼',
} as const;

const LOSE_LABELS: Record<LoseReason, string> = {
  seniorBurnout: 'シニア燃え尽きでラン終了',
  techDebt: 'Tech Debt 限界でラン終了',
  moraleCollapse: '士気崩壊でラン終了',
  reviewFreeze: 'レビュー停止でラン終了',
  bossFailed: 'ボス失敗でラン終了',
  trustExhausted: '信頼枯渇でラン終了',
  reorgRequired: '再編必要でラン終了',
};

/** 値が増えるほど悪化する指標（符号ではなく増減方向で tone を反転する）。 */
const INVERSE_METRICS = new Set<(typeof NUMERIC_OUTCOME_KEYS)[number]>([
  'techDebt',
  'aiDependency',
]);

function formatSignedDelta(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function formatPercentDelta(value: number): string {
  const pct = Math.round(value * 100);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

function toneFromDelta(value: number): EffectTagTone {
  if (value > 0) return 'positive';
  if (value < 0) return 'negative';
  return 'neutral';
}

function toneFromMetricDelta(
  key: (typeof NUMERIC_OUTCOME_KEYS)[number],
  value: number,
): EffectTagTone {
  const signTone = toneFromDelta(value);
  if (signTone === 'neutral') return 'neutral';
  if (INVERSE_METRICS.has(key)) {
    return signTone === 'positive' ? 'negative' : 'positive';
  }
  return signTone;
}

function pushTag(tags: EffectTag[], label: string, tone: EffectTagTone): void {
  tags.push({ label, tone });
}

function formatSprintModifierTags(mod: SprintModifierDelta): EffectTag[] {
  const tags: EffectTag[] = [];
  if (mod.reviewLoadAdd && mod.reviewLoadAdd !== 0) {
    pushTag(tags, `次スプリント レビュー負荷 ${formatSignedDelta(mod.reviewLoadAdd)}`, 'negative');
  }
  if (mod.reworkRateAdd && mod.reworkRateAdd !== 0) {
    pushTag(tags, `次スプリント 手戻り率 ${formatPercentDelta(mod.reworkRateAdd)}`, 'negative');
  }
  if (mod.taskCountMul !== undefined && mod.taskCountMul !== 1) {
    const pct = Math.round((mod.taskCountMul - 1) * 100);
    const tone: EffectTagTone = pct >= 0 ? 'positive' : 'negative';
    pushTag(tags, `次スプリント 出荷 ${pct >= 0 ? '+' : ''}${pct}%`, tone);
  }
  return tags;
}

/** `EventOutcome` から効果タグ一覧を生成する。 */
export function formatEventOutcomeTags(outcome: EventOutcome): EffectTag[] {
  const tags: EffectTag[] = [];

  for (const key of NUMERIC_OUTCOME_KEYS) {
    const value = outcome[key];
    if (typeof value === 'number' && value !== 0) {
      pushTag(
        tags,
        `${NUMERIC_LABELS[key]} ${formatSignedDelta(value)}`,
        toneFromMetricDelta(key, value),
      );
    }
  }

  if (outcome.trust) {
    for (const [key, delta] of Object.entries(outcome.trust)) {
      if (typeof delta === 'number' && delta !== 0) {
        const label = TRUST_LABELS[key as keyof typeof TRUST_LABELS] ?? key;
        pushTag(tags, `${label} ${formatSignedDelta(delta)}`, toneFromDelta(delta));
      }
    }
  }

  if (outcome.grantRelic) {
    const relic = getRelic(outcome.grantRelic);
    const name = relic?.name ?? outcome.grantRelic;
    pushTag(tags, `レリック獲得: ${name}`, 'positive');
  }

  if (outcome.grantCard) {
    const card = getCard(outcome.grantCard);
    const name = card?.name ?? outcome.grantCard;
    pushTag(tags, `カード獲得: ${name}`, 'positive');
  }

  if (outcome.nextSprint) {
    tags.push(...formatSprintModifierTags(outcome.nextSprint));
  }

  if (outcome.forceLose) {
    pushTag(tags, LOSE_LABELS[outcome.forceLose] ?? 'ラン終了', 'negative');
  }

  return tags;
}

/** 選択肢の outcome と画面遷移（`leadsTo`）を含めた効果タグ一覧。 */
export function formatEventChoiceTags(choice: EventChoice): EffectTag[] {
  const tags = formatEventOutcomeTags(choice.outcome);

  if (choice.leadsTo && choice.leadsTo !== 'sprint') {
    switch (choice.leadsTo) {
      case 'sprint-elite':
        pushTag(tags, '高負荷スプリント', 'neutral');
        break;
      case 'shop':
        pushTag(tags, 'ショップへ', 'neutral');
        break;
      case 'rest':
        pushTag(tags, '休息へ', 'neutral');
        break;
    }
  }

  return tags;
}

/** 乗算系カード効果の表示ラベル（1 で無効果）。 */
const CARD_MUL_EFFECTS = [
  { key: 'codingSpeedMul' as const, label: 'Coding速度' },
  { key: 'routineSpeedMul' as const, label: '定型タスク速度' },
  { key: 'reviewEfficiencyMul' as const, label: 'レビュー効率' },
  { key: 'reviewCapacityMul' as const, label: 'レビュー容量' },
  { key: 'incidentRateMul' as const, label: 'Incident率', inverse: true },
];

/** 加算系カード効果の表示ラベル（0 で無効果）。 */
const CARD_ADD_EFFECTS = [
  { key: 'reworkRateAdd' as const, label: '手戻り率', percent: true, inverse: true },
  { key: 'aiLiteracyAdd' as const, label: 'AI Literacy' },
  { key: 'aiDependencyAdd' as const, label: 'AI依存度', inverse: true },
  { key: 'qualityAdd' as const, label: '品質' },
  { key: 'testCoverageAdd' as const, label: 'Test Coverage' },
];

function formatMulFactor(value: number): string {
  return `x${value.toFixed(2)}`;
}

function toneFromMul(value: number, inverse = false): EffectTagTone {
  if (value === 1) return 'neutral';
  const higherIsGood = !inverse;
  if (value > 1) return higherIsGood ? 'positive' : 'negative';
  if (value < 1) return higherIsGood ? 'negative' : 'positive';
  return 'neutral';
}

function toneFromAdd(value: number, inverse = false): EffectTagTone {
  if (value === 0) return 'neutral';
  const signTone = toneFromDelta(value);
  if (signTone === 'neutral') return 'neutral';
  if (inverse) return signTone === 'positive' ? 'negative' : 'positive';
  return signTone;
}

/** `Partial<CardEffects>` から効果タグ一覧を生成する（RI-44）。 */
export function formatCardEffectsTags(effects: Partial<CardEffects>): EffectTag[] {
  const tags: EffectTag[] = [];

  for (const spec of CARD_MUL_EFFECTS) {
    const value = effects[spec.key];
    if (typeof value !== 'number' || value === 1) continue;
    pushTag(
      tags,
      `${spec.label} ${formatMulFactor(value)}`,
      toneFromMul(value, 'inverse' in spec && spec.inverse),
    );
  }

  for (const spec of CARD_ADD_EFFECTS) {
    const value = effects[spec.key];
    if (typeof value !== 'number' || value === 0) continue;
    const label = spec.percent
      ? `${spec.label} ${formatPercentDelta(value)}`
      : `${spec.label} ${formatSignedDelta(value)}`;
    pushTag(tags, label, toneFromAdd(value, 'inverse' in spec && spec.inverse));
  }

  return tags;
}

/** カード定義の `base` 効果からタグ一覧を生成する。 */
export function formatCardDefTags(def: CardDef): EffectTag[] {
  return formatCardTagsAtLevel(def, 1);
}

/** 強化レベルを反映したカード効果タグ一覧。 */
export function formatCardTagsAtLevel(def: CardDef, level = 1): EffectTag[] {
  return formatCardEffectsTags(scaleEffects(def.base, level));
}

/** レリックの恒久パッシブからタグ一覧を生成する。 */
export function formatRelicPassiveTags(passives: Partial<RunPassives>): EffectTag[] {
  const tags: EffectTag[] = [];

  if (passives.moraleDamageMul !== undefined && passives.moraleDamageMul !== 1) {
    pushTag(
      tags,
      `Morale ダメージ ${formatMulFactor(passives.moraleDamageMul)}`,
      toneFromMul(passives.moraleDamageMul, true),
    );
  }
  if (passives.restHealBonus !== undefined && passives.restHealBonus !== 0) {
    pushTag(
      tags,
      `休息回復 ${formatSignedDelta(passives.restHealBonus)}`,
      toneFromDelta(passives.restHealBonus),
    );
  }
  if (passives.shopDiscount !== undefined && passives.shopDiscount !== 0) {
    const pct = Math.round(passives.shopDiscount * 100);
    pushTag(tags, `ショップ割引 ${pct}%`, 'positive');
  }
  if (passives.relicSlots !== undefined) {
    pushTag(tags, `レリック枠 ${passives.relicSlots}`, 'neutral');
  }

  return tags;
}

/** レリック定義の効果・パッシブからタグ一覧を生成する。 */
export function formatRelicDefTags(relic: RelicDef): EffectTag[] {
  return [
    ...formatCardEffectsTags(relic.effects ?? {}),
    ...formatRelicPassiveTags(relic.passives ?? {}),
  ];
}

/** 進化ノードの効果・ボーナスからタグ一覧を生成する。 */
export function formatEvolutionNodeTags(node: EvolutionNodeDef): EffectTag[] {
  const tags = formatCardEffectsTags(node.effects ?? {});

  if (node.focusBonus !== undefined && node.focusBonus !== 0) {
    pushTag(
      tags,
      `集中力上限 ${formatSignedDelta(node.focusBonus)}`,
      toneFromDelta(node.focusBonus),
    );
  }
  if (node.codingSlotBonus !== undefined && node.codingSlotBonus !== 0) {
    pushTag(
      tags,
      `Coding枠 ${formatSignedDelta(node.codingSlotBonus)}`,
      toneFromDelta(node.codingSlotBonus),
    );
  }

  return tags;
}

/** ツールチップ等に並べる効果タグ文字列。 */
export function effectTagsToTooltip(tags: EffectTag[]): string {
  return tags.map((t) => t.label).join(' · ');
}

function joinTooltip(tagLine: string, flavor: string): string {
  if (tagLine && flavor) return `${tagLine} — ${flavor}`;
  return tagLine || flavor;
}

/** カードの効果タグとフレーバー文を合成したツールチップ文字列。 */
export function formatCardTooltip(def: CardDef, level = 1): string {
  return joinTooltip(
    effectTagsToTooltip(formatCardTagsAtLevel(def, level)),
    def.description.join(' / '),
  );
}

/** レリックの効果タグとフレーバー文を合成したツールチップ文字列。 */
export function formatRelicTooltip(relic: RelicDef): string {
  return joinTooltip(effectTagsToTooltip(formatRelicDefTags(relic)), relic.description);
}
