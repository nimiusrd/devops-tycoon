/** RI-279/280: 実測状態と既存効果タグだけから作る観察の入口。ルールや予測を変更しない。 */
import type { CardDef } from '../sim/types';
import { getRelic, type RelicDef } from '../data/relics';
import type { RunState } from '../sim/run/types';
import { playCost } from '../sim/cards';
import { foldPassives } from '../sim/run/effects';
import { discountedShopPrice } from '../sim/run/shopPrice';
import { formatCardDefTags } from './eventOutcomeView';
import { seniorHpHudCopy } from './status';
import { clampSeniorHpDisplay } from './seniorHpDisplay';

export type CompanyGuidanceState = Pick<RunState, 'roster' | 'org' | 'budget' | 'relics'>;

export function draftCompanyGuidance(
  def: CardDef,
  state: CompanyGuidanceState,
  resolveRelic: (id: string) => RelicDef | undefined = getRelic,
): string | null {
  if (def.id !== 'copilot' && def.id !== 'auto-test') return null;
  const coders = state.roster.members.filter((m) => !m.onLeave && m.assignment === 'coding');
  const tags = formatCardDefTags(def);
  const benefits = tags.filter((tag) => tag.tone === 'positive').map((tag) => tag.label);
  const primary = def.id === 'copilot' ? 'Coding速度' : '手戻り率';
  const benefit = benefits.find((label) => label.startsWith(primary)) ?? benefits[0];
  const costs = tags.filter((tag) => tag.tone === 'negative').map((tag) => tag.label);
  const target =
    coders.length > 0 ? `Coding担当${coders.length}人` : 'Coding担当0人（配置対象なし）';
  const current =
    def.id === 'copilot'
      ? `AI依存度${Math.round(state.org.aiDependency)}・セキュリティ${Math.round(state.org.securityLevel)}`
      : `品質${Math.round(state.org.quality)}・セキュリティ${Math.round(state.org.securityLevel)}`;
  const price = discountedShopPrice(
    def.cost,
    foldPassives(state.relics, resolveRelic).shopDiscount,
  );
  const budget =
    state.budget < price
      ? `取得は無料（ショップ価格${price}には予算不足、現在${state.budget}）`
      : '取得は無料';
  return `今の会社: ${target}、${current} / 発動時の助け: ${benefit ?? '追加の有利効果なし'} / 代償: ${costs.join('・') || '不利効果なし'}、集中力${playCost(def.focusCost, 1)}（Lv1）。${budget}。出荷の見込みは予測。`;
}

export interface SetupObservation {
  id: 'coding-staff' | 'senior-hp' | 'review-staff';
  text: string;
}

/** Coding担当不在を最優先し、次にHUDの体力警告、Review担当不在。 */
export function setupObservation(state: CompanyGuidanceState): SetupObservation | null {
  const hp = clampSeniorHpDisplay(state.org.seniorHp);
  const warning = seniorHpHudCopy(hp, {
    firefightUrgent: false,
    reviewCongested: false,
  }).warningChip;
  const active = state.roster.members.filter((m) => !m.onLeave);
  const coders = active.filter((m) => m.assignment === 'coding').length;
  const reviewers = active.filter((m) => m.assignment === 'review').length;
  const codingStaff: SetupObservation = {
    id: 'coding-staff',
    text: 'コーダー0人。出荷できません',
  };
  const seniorHp: SetupObservation = {
    id: 'senior-hp',
    text: `シニア体力 ${hp}%（${warning ?? '体力注意'}）`,
  };
  const reviewStaff: SetupObservation = {
    id: 'review-staff',
    text: 'レビュー0人。配置を見直そう',
  };
  return coders === 0 ? codingStaff : warning ? seniorHp : reviewers === 0 ? reviewStaff : null;
}
