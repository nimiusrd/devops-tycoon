/** RI-279/280: 実測状態と既存効果タグだけから作る観察の入口。ルールや予測を変更しない。 */
import type { CardDef } from '../sim/types';
import type { RunState } from '../sim/run/types';
import { playCost } from '../sim/cards';
import { formatCardDefTags } from './eventOutcomeView';
import { seniorHpHudCopy } from './status';
import { clampSeniorHpDisplay } from './seniorHpDisplay';

export type CompanyGuidanceState = Pick<RunState, 'roster' | 'org' | 'budget'>;

export function draftCompanyGuidance(def: CardDef, state: CompanyGuidanceState): string | null {
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
      ? `AI依存度${state.org.aiDependency}・セキュリティ${state.org.securityLevel}`
      : `品質${state.org.quality}・セキュリティ${state.org.securityLevel}`;
  const budget =
    state.budget < def.cost
      ? `取得は無料（ショップ価格${def.cost}には予算不足、現在${state.budget}）`
      : '取得は無料';
  return `今の会社: ${target}、${current} / 発動時の助け: ${benefit ?? '追加の有利効果なし'} / 代償: ${costs.join('・') || '不利効果なし'}、集中力${playCost(def.focusCost, 1)}（Lv1）。${budget}。出荷の見込みは予測。`;
}

export interface SetupObservation {
  id: 'senior-hp' | 'review-staff';
  text: string;
}

/** HUD の体力警告を優先し、次に Review 担当不在。健全状態では表示しない。 */
export function setupObservation(state: CompanyGuidanceState): SetupObservation | null {
  const hp = clampSeniorHpDisplay(state.org.seniorHp);
  const warning = seniorHpHudCopy(hp, {
    firefightUrgent: false,
    reviewCongested: false,
  }).warningChip;
  if (warning) {
    return {
      id: 'senior-hp',
      text: `今回見る一点: シニア体力 ${hp}%（${warning}）。Reviewを支える余力が低下しています。開始後はHUDのシニア体力とReview待ちを観察し、他の課題と合わせて介入を判断できます。`,
    };
  }
  const active = state.roster.members.filter((m) => !m.onLeave);
  const coders = active.filter((m) => m.assignment === 'coding').length;
  const reviewers = active.filter((m) => m.assignment === 'review').length;
  if (coders > 0 && reviewers === 0) {
    return {
      id: 'review-staff',
      text: `今回見る一点: Review担当 ${reviewers}人 / Coding担当 ${coders}人（休職中を除く）。実装に対してレビューの配置支援がありません。配置を見直すか、開始後にReview待ちを観察できます。渋滞の発生を断定する案内ではありません。`,
    };
  }
  return null;
}
