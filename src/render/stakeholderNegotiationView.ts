/**
 * ステークホルダー別交渉の表示用導出（RI-130）。
 *
 * 既存7種を交渉相手で束ね、`trustDelta` 以外の提示条件（予算・次期目標・
 * 組織状態・次期予算上限・次四半期物理）を返す。並び替えだけで、除外条件と
 * 効果量は `availableAdjustments()` / 定義側のままにする（第22.2）。
 */
import {
  getGoalAdjustment,
  type AdjustmentNegotiator,
  type GoalAdjustmentDef,
} from '../data/goalAdjustments';
import type { GoalAdjustmentId, StakeholderTrust } from '../sim/run/types';

export type NegotiationStance = 'hardline' | 'cautious' | 'cooperative';

export type NegotiationTermKind =
  | 'budget'
  | 'nextGoal'
  | 'orgState'
  | 'nextBudgetCap'
  | 'nextQuarterPhysics';

export const NEGOTIATOR_LABELS: Record<AdjustmentNegotiator, string> = {
  management: '経営',
  customers: '顧客',
  team: 'チーム',
  all: '三者',
};

export const NEGOTIATION_PANEL_ORDER: readonly AdjustmentNegotiator[] = [
  'management',
  'customers',
  'team',
  'all',
];

export const NEGOTIATION_STANCE_LABELS: Record<NegotiationStance, string> = {
  hardline: '強硬',
  cautious: '慎重',
  cooperative: '協調',
};

export const NEGOTIATION_TERM_KIND_LABELS: Record<NegotiationTermKind, string> = {
  budget: '予算',
  nextGoal: '次期目標',
  orgState: '組織状態',
  nextBudgetCap: '次期予算上限',
  nextQuarterPhysics: '次四半期の現場',
};

const AVAILABILITY_DEMAND: Record<AdjustmentNegotiator, string> = {
  management: '交渉後も経営信頼が危機域を超え、予算が尽きないこと。',
  customers: '交渉後も顧客信頼が危機域を超えること。',
  team: '交渉後もチーム信頼が危機域を超え、組織が継続できること。',
  all: '交渉後も三者の信頼が危機域を超え、予算が尽きないこと。',
};

const DIALOGUE: Record<AdjustmentNegotiator, Record<NegotiationStance, string>> = {
  management: {
    hardline: '経営は期限と予算の説明を強く求めている。',
    cautious: '経営は条件付きで次期の組み直しに応じる。',
    cooperative: '経営は再挑戦の余地を残している。',
  },
  customers: {
    hardline: '顧客は約束した成果の維持を求めている。',
    cautious: '顧客は期待値の調整に慎重だ。',
    cooperative: '顧客は現実的な着地を探っている。',
  },
  team: {
    hardline: 'チームは再編と負荷増に反発している。',
    cautious: 'チームは条件次第で立て直しに応じる。',
    cooperative: 'チームは立て直しの余力を残している。',
  },
  all: {
    hardline: '三者とも信頼が薄く、説明責任を求めている。',
    cautious: '三者は条件付きで関係修復に応じる。',
    cooperative: '三者は説明と期待調整の余地を残している。',
  },
};

export interface StakeholderNegotiationOffer {
  id: GoalAdjustmentId;
  negotiator: AdjustmentNegotiator;
  negotiatorLabel: string;
  termKinds: NegotiationTermKind[];
  termKindLabels: string[];
}

export interface StakeholderNegotiationPanel {
  negotiator: AdjustmentNegotiator;
  label: string;
  stance: NegotiationStance;
  stanceLabel: string;
  dialogue: string;
  availabilityDemand: string;
  offers: StakeholderNegotiationOffer[];
}

export interface StakeholderNegotiationViewInput {
  availableAdjustments: readonly GoalAdjustmentId[];
  trust: StakeholderTrust;
}

/** HUD の信頼注意帯（<=25）に合わせ、交渉姿勢を決める。 */
export function negotiationStance(trustValue: number): NegotiationStance {
  if (trustValue <= 25) return 'hardline';
  if (trustValue <= 50) return 'cautious';
  return 'cooperative';
}

function counterpartTrust(negotiator: AdjustmentNegotiator, trust: StakeholderTrust): number {
  if (negotiator === 'all') {
    return Math.min(trust.management, trust.customers, trust.team);
  }
  return trust[negotiator];
}

function hasNextGoal(ge: GoalAdjustmentDef['goalEffects']): boolean {
  return (
    ge.deliveryMul !== undefined ||
    ge.deliveryAdd !== undefined ||
    ge.qualityAdd !== undefined ||
    ge.moraleAdd !== undefined ||
    ge.techDebtLimitAdd !== undefined ||
    ge.incidentLimitAdd !== undefined ||
    ge.aiAdoptionAdd !== undefined
  );
}

/** `trustDelta` 以外の提示条件の種類。 */
export function negotiationTermKinds(def: GoalAdjustmentDef): NegotiationTermKind[] {
  const kinds: NegotiationTermKind[] = [];
  if (def.budgetDelta !== 0) kinds.push('budget');
  if (hasNextGoal(def.goalEffects)) kinds.push('nextGoal');
  if (def.orgEffects !== undefined || def.reorgReset) kinds.push('orgState');
  if (def.nextBudgetCapDelta !== undefined && def.nextBudgetCapDelta !== 0) {
    kinds.push('nextBudgetCap');
  }
  if (def.nextQuarterEffects !== undefined || def.pauseAiDebuff) {
    kinds.push('nextQuarterPhysics');
  }
  return kinds;
}

function toOffer(id: GoalAdjustmentId, def: GoalAdjustmentDef): StakeholderNegotiationOffer {
  const termKinds = negotiationTermKinds(def);
  return {
    id,
    negotiator: def.negotiator,
    negotiatorLabel: NEGOTIATOR_LABELS[def.negotiator],
    termKinds,
    termKindLabels: termKinds.map((kind) => NEGOTIATION_TERM_KIND_LABELS[kind]),
  };
}

/**
 * 提示済みの目標修正を交渉相手ごとに束ねる。
 * 入力に無い ID は足さず、パネル内の順は `availableAdjustments` を保つ。
 */
export function planStakeholderNegotiation(
  input: StakeholderNegotiationViewInput,
): StakeholderNegotiationPanel[] {
  const offersByNegotiator = new Map<AdjustmentNegotiator, StakeholderNegotiationOffer[]>();
  for (const id of input.availableAdjustments) {
    const def = getGoalAdjustment(id);
    if (!def) continue;
    const offer = toOffer(id, def);
    const list = offersByNegotiator.get(def.negotiator);
    if (list) list.push(offer);
    else offersByNegotiator.set(def.negotiator, [offer]);
  }

  const panels: StakeholderNegotiationPanel[] = [];
  for (const negotiator of NEGOTIATION_PANEL_ORDER) {
    const offers = offersByNegotiator.get(negotiator);
    if (!offers || offers.length === 0) continue;
    const stance = negotiationStance(counterpartTrust(negotiator, input.trust));
    panels.push({
      negotiator,
      label: NEGOTIATOR_LABELS[negotiator],
      stance,
      stanceLabel: NEGOTIATION_STANCE_LABELS[stance],
      dialogue: DIALOGUE[negotiator][stance],
      availabilityDemand: AVAILABILITY_DEMAND[negotiator],
      offers,
    });
  }
  return panels;
}
