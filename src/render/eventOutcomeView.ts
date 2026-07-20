/**
 * イベント結果（`EventOutcome`）から UI 用効果タグを生成する（RI-43）。
 * カード/レリック/進化ノードの係数表示も同じ `EffectTag` 型で扱う（RI-44）。
 *
 * 数値デルタ・付与・次スプリント効果・画面遷移を、色分け可能な
 * 共通 `EffectTag` へ変換する純関数。sim層は表示を知らない。
 */
import type { EventChoice, EventOutcome } from '../data/events';
import type { GoalAdjustmentDef } from '../data/goalAdjustments';
import { getCard } from '../data/cards';
import type { EvolutionNodeDef } from '../data/evolution';
import type { RelicDef } from '../data/relics';
import { getRelic } from '../data/relics';
import {
  ANDON_TICKS,
  ASSIGN_MORALE_COST,
  ASSIGN_PROGRESS,
  FIREFIGHT_HP_COST,
  INTERRUPT_HP_COST,
  INTERRUPT_REVIEW_COUNT,
  OVERTIME_HP_COST,
  OVERTIME_MORALE_COST,
  OVERTIME_TICKS,
  PAIR_LITERACY_GAIN,
  PAIR_REVIEW_COUNT,
  SPLIT_PROGRESS_PENALTY,
  THROTTLE_TICKS,
  type ActionDef,
} from '../sim/actions';
import { OVERTIME_CODING_MUL, OVERTIME_REVIEW_MUL } from '../sim/model/process';
import {
  PAUSE_AI_DEBUFF_MUL,
  REORG_RESET_SENIOR_HP,
  REORG_RESET_TECH_DEBT,
} from '../sim/run/quarterReview';
import { RECRUIT_COST, REST_STAMINA_RECOVER } from '../sim/member/roster';
import { REST_HEAL, REST_MORALE_HEAL, REST_REPAY } from '../sim/run/engine';
import type { CardEffects, CardDef } from '../sim/types';
import type { LeverDef, OrgAdjust } from '../sim/orgscale/types';
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
  incidentCascade: '障害連鎖でリリース停止',
  aiDependency: 'AI 依存過多でラン終了',
  budgetExhausted: '予算枯渇でラン終了',
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

  if (outcome.grantRecruit) {
    pushTag(tags, `予算 -${RECRUIT_COST}`, 'negative');
    pushTag(tags, 'メンバー +1', 'positive');
    pushTag(tags, '編成へ', 'neutral');
    if (outcome.onRecruitFail) {
      const failTags = formatEventOutcomeTags(outcome.onRecruitFail);
      for (const tag of failTags) {
        pushTag(tags, `失敗時 ${tag.label}`, tag.tone);
      }
    }
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
      case 'recruit':
        pushTag(tags, '採用へ', 'neutral');
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

/** レバー効果（OrgAdjust）の表示ラベル。 */
const ORG_ADJUST_SPECS = [
  { key: 'aiDependencyDelta' as const, label: 'AI依存度', inverse: true },
  { key: 'reviewQueueDelta' as const, label: 'レビュー行列', inverse: true },
  { key: 'incidentDelta' as const, label: '炎上', inverse: true },
  { key: 'moraleDelta' as const, label: '士気', inverse: false },
  { key: 'techDebtDelta' as const, label: 'Tech Debt', inverse: true },
  { key: 'extraTeams' as const, label: 'チーム', inverse: false },
  { key: 'infraBoost' as const, label: '共通基盤', inverse: false },
] as const;

/** `OrgAdjust` 部分効果からタグ一覧を生成する（RI-45）。 */
export function formatOrgAdjustTags(effect: Partial<OrgAdjust>): EffectTag[] {
  const tags: EffectTag[] = [];
  for (const spec of ORG_ADJUST_SPECS) {
    const value = effect[spec.key];
    if (typeof value !== 'number' || value === 0) continue;
    pushTag(tags, `${spec.label} ${formatSignedDelta(value)}`, toneFromAdd(value, spec.inverse));
  }
  return tags;
}

/** レバー定義の効果タグ一覧（RI-45）。 */
export function formatLeverDefTags(lever: LeverDef): EffectTag[] {
  return formatOrgAdjustTags(lever.effect);
}

/** 目標 KPI への加算: 上がるほど達成が難しくなる（代償）。 */
function toneFromGoalTargetAdd(value: number): EffectTagTone {
  if (value > 0) return 'negative';
  if (value < 0) return 'positive';
  return 'neutral';
}

/** reorgReset 時の追加 org 効果（`applyGoalAdjustment` と一致）。 */
const PAUSE_AI_DEBUFF_PCT = Math.round((1 - PAUSE_AI_DEBUFF_MUL) * 100);

export interface FormatGoalAdjustmentOptions {
  /** 次期目標に AI Adoption KPI がある場合のみ true。 */
  hasAiAdoptionTarget?: boolean;
}

/** 目標修正の goalEffects からタグ一覧を生成する。 */
function formatGoalEffectTags(
  goalEffects: GoalAdjustmentDef['goalEffects'],
  opts?: FormatGoalAdjustmentOptions,
): EffectTag[] {
  const tags: EffectTag[] = [];
  if (goalEffects.deliveryMul !== undefined && goalEffects.deliveryMul !== 1) {
    const pct = Math.round(goalEffects.deliveryMul * 100);
    pushTag(tags, `Delivery目標 ${pct}%`, goalEffects.deliveryMul < 1 ? 'positive' : 'negative');
  }
  if (goalEffects.deliveryAdd !== undefined && goalEffects.deliveryAdd !== 0) {
    pushTag(
      tags,
      `Delivery目標 ${formatSignedDelta(goalEffects.deliveryAdd)}`,
      goalEffects.deliveryAdd < 0 ? 'positive' : 'negative',
    );
  }
  if (goalEffects.qualityAdd !== undefined && goalEffects.qualityAdd !== 0) {
    pushTag(
      tags,
      `品質目標 ${formatSignedDelta(goalEffects.qualityAdd)}`,
      toneFromGoalTargetAdd(goalEffects.qualityAdd),
    );
  }
  if (goalEffects.moraleAdd !== undefined && goalEffects.moraleAdd !== 0) {
    pushTag(
      tags,
      `士気目標 ${formatSignedDelta(goalEffects.moraleAdd)}`,
      toneFromGoalTargetAdd(goalEffects.moraleAdd),
    );
  }
  if (goalEffects.techDebtLimitAdd !== undefined && goalEffects.techDebtLimitAdd !== 0) {
    pushTag(
      tags,
      `Tech Debt上限 ${formatSignedDelta(goalEffects.techDebtLimitAdd)}`,
      toneFromDelta(goalEffects.techDebtLimitAdd),
    );
  }
  if (goalEffects.incidentLimitAdd !== undefined && goalEffects.incidentLimitAdd !== 0) {
    pushTag(
      tags,
      `Incident上限 ${formatSignedDelta(goalEffects.incidentLimitAdd)}`,
      toneFromDelta(goalEffects.incidentLimitAdd),
    );
  }
  if (
    opts?.hasAiAdoptionTarget &&
    goalEffects.aiAdoptionAdd !== undefined &&
    goalEffects.aiAdoptionAdd !== 0
  ) {
    pushTag(
      tags,
      `AI Adoption目標 ${formatSignedDelta(goalEffects.aiAdoptionAdd)}`,
      toneFromGoalTargetAdd(goalEffects.aiAdoptionAdd),
    );
  }
  return tags;
}

/** 目標修正の orgEffects からタグ一覧を生成する。 */
function formatGoalOrgEffectTags(
  orgEffects: NonNullable<GoalAdjustmentDef['orgEffects']>,
): EffectTag[] {
  const tags: EffectTag[] = [];
  if (orgEffects.deliveryScoreMul !== undefined && orgEffects.deliveryScoreMul !== 1) {
    const pct = Math.round(orgEffects.deliveryScoreMul * 100);
    pushTag(tags, `出荷評価 ${pct}%`, orgEffects.deliveryScoreMul < 1 ? 'negative' : 'positive');
  }
  if (orgEffects.techDebtDelta !== undefined && orgEffects.techDebtDelta !== 0) {
    pushTag(
      tags,
      `Tech Debt ${formatSignedDelta(orgEffects.techDebtDelta)}`,
      toneFromAdd(orgEffects.techDebtDelta, true),
    );
  }
  if (orgEffects.moraleDelta !== undefined && orgEffects.moraleDelta !== 0) {
    pushTag(
      tags,
      `士気 ${formatSignedDelta(orgEffects.moraleDelta)}`,
      toneFromDelta(orgEffects.moraleDelta),
    );
  }
  if (orgEffects.seniorHpDelta !== undefined && orgEffects.seniorHpDelta !== 0) {
    pushTag(
      tags,
      `シニアHP ${formatSignedDelta(orgEffects.seniorHpDelta)}`,
      toneFromDelta(orgEffects.seniorHpDelta),
    );
  }
  if (orgEffects.qualityDelta !== undefined && orgEffects.qualityDelta !== 0) {
    pushTag(
      tags,
      `品質 ${formatSignedDelta(orgEffects.qualityDelta)}`,
      toneFromDelta(orgEffects.qualityDelta),
    );
  }
  return tags;
}

/** 目標修正定義から効果タグ一覧を生成する（RI-45）。 */
export function formatGoalAdjustmentTags(
  def: GoalAdjustmentDef,
  opts?: FormatGoalAdjustmentOptions,
): EffectTag[] {
  const tags: EffectTag[] = [];

  for (const [key, delta] of Object.entries(def.trustDelta)) {
    if (typeof delta === 'number' && delta !== 0) {
      const label = TRUST_LABELS[key as keyof typeof TRUST_LABELS] ?? key;
      pushTag(tags, `${label} ${formatSignedDelta(delta)}`, toneFromDelta(delta));
    }
  }

  if (def.budgetDelta !== 0) {
    pushTag(tags, `予算 ${formatSignedDelta(def.budgetDelta)}`, toneFromDelta(def.budgetDelta));
  }

  tags.push(...formatGoalEffectTags(def.goalEffects, opts));

  if (def.orgEffects || def.reorgReset) {
    const orgEffects = { ...def.orgEffects };
    if (def.reorgReset) {
      orgEffects.seniorHpDelta = (orgEffects.seniorHpDelta ?? 0) + REORG_RESET_SENIOR_HP;
      orgEffects.techDebtDelta = (orgEffects.techDebtDelta ?? 0) + REORG_RESET_TECH_DEBT;
    }
    tags.push(...formatGoalOrgEffectTags(orgEffects));
  }

  if (def.nextBudgetCapDelta !== undefined && def.nextBudgetCapDelta !== 0) {
    pushTag(
      tags,
      `次期予算上限 ${formatSignedDelta(def.nextBudgetCapDelta)}`,
      toneFromDelta(def.nextBudgetCapDelta),
    );
  }

  if (def.pauseAiDebuff) {
    pushTag(tags, `次四半期 出荷速度 -${PAUSE_AI_DEBUFF_PCT}%`, 'negative');
  }

  if (def.reorgReset) {
    pushTag(tags, 'レビュー詰まり・属人化リセット', 'positive');
  }

  return tags;
}

/** 介入アクション定義から効果タグ一覧を生成する（RI-45）。 */
export function formatActionDefTags(def: ActionDef): EffectTag[] {
  const tags: EffectTag[] = [];

  switch (def.id) {
    case 'interruptReview':
      pushTag(tags, `Review 最大${INTERRUPT_REVIEW_COUNT}件処理`, 'positive');
      pushTag(tags, `シニアHP -${INTERRUPT_HP_COST}`, 'negative');
      break;
    case 'splitPr':
      pushTag(tags, '巨大PRを分割', 'positive');
      pushTag(tags, `進捗 -${Math.round(SPLIT_PROGRESS_PENALTY * 100)}%`, 'negative');
      break;
    case 'firefight':
      pushTag(tags, '炎上1件鎮火', 'positive');
      pushTag(tags, `シニアHP -${FIREFIGHT_HP_COST}`, 'negative');
      break;
    case 'assignTask':
      pushTag(tags, `Coding +${Math.round(ASSIGN_PROGRESS * 100)}%`, 'positive');
      pushTag(tags, `士気 -${ASSIGN_MORALE_COST}`, 'negative');
      break;
    case 'aiThrottle':
      pushTag(tags, `AI流入停止 ${THROTTLE_TICKS}tick`, 'positive');
      pushTag(tags, '出荷速度一時低下', 'negative');
      break;
    case 'pairReview':
      pushTag(tags, `Review 最大${PAIR_REVIEW_COUNT}件処理`, 'positive');
      pushTag(tags, `AI Literacy +${PAIR_LITERACY_GAIN}`, 'positive');
      break;
    case 'overtime':
      pushTag(tags, `スループット↑ ${OVERTIME_TICKS}tick`, 'positive');
      pushTag(tags, `Coding x${OVERTIME_CODING_MUL}`, 'positive');
      pushTag(tags, `Review x${OVERTIME_REVIEW_MUL}`, 'positive');
      pushTag(tags, `士気 -${OVERTIME_MORALE_COST}`, 'negative');
      pushTag(tags, `シニアHP -${OVERTIME_HP_COST}`, 'negative');
      break;
    case 'andon':
      pushTag(tags, `流入停止 ${ANDON_TICKS}tick`, 'neutral');
      pushTag(tags, '出荷機会損失', 'negative');
      break;
  }

  if (def.gauge > 0) {
    pushTag(tags, `連携 +${Math.round(def.gauge * 100)}%`, 'positive');
  }

  return tags;
}

export type RestOptionId = 'heal' | 'repay' | 'upgrade' | 'recruit';

/** 休息選択肢の効果タグ一覧（RI-45）。 */
export function formatRestOptionTags(
  option: RestOptionId,
  opts?: { restHealBonus?: number },
): EffectTag[] {
  const tags: EffectTag[] = [];
  const bonus = opts?.restHealBonus ?? 0;

  switch (option) {
    case 'heal': {
      const healTotal = REST_HEAL + bonus;
      pushTag(
        tags,
        bonus > 0 ? `シニアHP +${healTotal} (基本+${REST_HEAL})` : `シニアHP +${healTotal}`,
        'positive',
      );
      pushTag(tags, `士気 +${REST_MORALE_HEAL}`, 'positive');
      pushTag(tags, `スタミナ +${REST_STAMINA_RECOVER}`, 'positive');
      break;
    }
    case 'repay':
      pushTag(tags, `Tech Debt -${REST_REPAY}`, 'positive');
      break;
    case 'upgrade':
      pushTag(tags, 'デッキ先頭 +1Lv', 'positive');
      break;
    case 'recruit':
      pushTag(tags, `予算 -${RECRUIT_COST}`, 'negative');
      pushTag(tags, 'メンバー +1', 'positive');
      break;
  }

  return tags;
}

/** レバーの効果タグとフレーバー文を合成したツールチップ文字列。 */
export function formatLeverTooltip(lever: LeverDef): string {
  return joinTooltip(effectTagsToTooltip(formatLeverDefTags(lever)), lever.description);
}

/** 介入アクションの効果タグと説明文を合成したツールチップ文字列。 */
export function formatActionTooltip(def: ActionDef): string {
  return joinTooltip(
    effectTagsToTooltip(formatActionDefTags(def)),
    `${def.description}（副作用: ${def.sideEffect}）`,
  );
}
