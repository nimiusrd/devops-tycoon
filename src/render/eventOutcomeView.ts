/**
 * イベント結果（`EventOutcome`）から UI 用効果タグを生成する（RI-43）。
 *
 * 数値デルタ・付与・次スプリント効果・画面遷移を、色分け可能な
 * 表示タグへ変換する純関数。sim 層は知らず、後続 RI-44 以降も
 * 共通 `EffectTag` 型を再利用する。
 */
import type { EventChoice, EventOutcome } from '../data/events';
import { getCard } from '../data/cards';
import { getRelic } from '../data/relics';
import type { LoseReason, SprintModifierDelta } from '../sim/run/types';

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
      pushTag(tags, `${NUMERIC_LABELS[key]} ${formatSignedDelta(value)}`, toneFromDelta(value));
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
