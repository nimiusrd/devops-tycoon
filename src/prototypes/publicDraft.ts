import { BOSS_DEFS } from '../data/bosses';
import { getCard } from '../data/cards';
import { applyAction, isFirefightUrgent, tasksInLane } from '../sim/actions';
import { playCardFromHand, playCost } from '../sim/cards';
import { IDENTITY_CARD_EFFECTS } from '../sim/model';
import { createOrgState } from '../sim/org';
import { evaluateBoss } from '../sim/outcome';
import { createRng, createRngFromState, getRngState } from '../sim/rng';
import { createSprint, resolveSprintConfig, stepSprint, summarizeSprint } from '../sim/sprint';
import type { CardInstance, OrgState, SprintState } from '../sim/types';

/** RI-269: 通常ドラフト・メタ・報酬・リプレイへ接続しない公開構築。 */
export const PUBLIC_DRAFT_RULESET = 'ri269-public-draft-v1';
export const PUBLIC_DRAFT_BUDGET = 6;
export const PUBLIC_DRAFT_OFFERS = [
  { id: 'hire-senior', acquisitionCost: 6 },
  { id: 'auto-test', acquisitionCost: 5 },
  { id: 'docs', acquisitionCost: 3 },
  { id: 'review-bot', acquisitionCost: 3 },
  { id: 'pr-size-limit', acquisitionCost: 2 },
  { id: 'copilot', acquisitionCost: 1 },
] as const;
export type PublicDraftCard = (typeof PUBLIC_DRAFT_OFFERS)[number]['id'];
export type PublicDraftCondition = 'control' | 'quality-pressure' | 'short-deadline';
export const PUBLIC_DRAFT_CONDITIONS = {
  control: { quality: 45, maxTicks: 60 },
  'quality-pressure': { quality: 40, maxTicks: 60 },
  'short-deadline': { quality: 45, maxTicks: 24 },
} as const;
const BOSS = BOSS_DEFS.find((boss) => boss.id === 'security-audit')!;

export type PublicDraftInput =
  | { type: 'buy'; id: PublicDraftCard }
  | { type: 'cancel'; id: PublicDraftCard }
  | { type: 'play'; id: PublicDraftCard }
  | { type: 'replace'; ids: PublicDraftCard[] }
  | { type: 'start' }
  | { type: 'tick'; action: 'none' | 'firefight' | 'interruptReview' };

export interface PublicDraftState {
  version: 1;
  ruleset: typeof PUBLIC_DRAFT_RULESET;
  seed: string;
  condition: PublicDraftCondition;
  selected: PublicDraftCard[];
  current: {
    deck: CardInstance[];
    org: OrgState;
    sprint: SprintState;
    tick: number;
    rngState: number;
  } | null;
  /** 成立した入力のみ。試作の保存再構築用で、通常リプレイの入力ではない。 */
  inputs: PublicDraftInput[];
}

export function createPublicDraft(
  seed: string,
  condition: PublicDraftCondition = 'control',
): PublicDraftState {
  return {
    version: 1,
    ruleset: PUBLIC_DRAFT_RULESET,
    seed,
    condition,
    selected: [],
    current: null,
    inputs: [],
  };
}

function selectionCost(ids: readonly PublicDraftCard[]): number {
  return ids.reduce(
    (total, id) => total + PUBLIC_DRAFT_OFFERS.find((offer) => offer.id === id)!.acquisitionCost,
    0,
  );
}

function validSelection(ids: readonly PublicDraftCard[]): boolean {
  return (
    new Set(ids).size === ids.length &&
    ids.every((id) => PUBLIC_DRAFT_OFFERS.some((offer) => offer.id === id)) &&
    selectionCost(ids) <= PUBLIC_DRAFT_BUDGET
  );
}

/** 選択順では手札順・乱数を操作できない。全取得札（最大3枚）を確定で配る。 */
function normalize(ids: readonly PublicDraftCard[]): PublicDraftCard[] {
  return PUBLIC_DRAFT_OFFERS.filter((offer) => ids.includes(offer.id)).map((offer) => offer.id);
}

/** 不成立は同じ参照を返し、費用・乱数・入力履歴を変えない。 */
export function applyPublicDraft(
  state: PublicDraftState,
  input: PublicDraftInput,
): PublicDraftState {
  if (
    state.ruleset !== PUBLIC_DRAFT_RULESET ||
    state.version !== 1 ||
    !validSelection(state.selected)
  )
    return state;
  if (input.type === 'buy' || input.type === 'cancel' || input.type === 'replace') {
    if (state.current) return state;
    let selected: PublicDraftCard[];
    if (input.type === 'replace') selected = input.ids;
    else if (input.type === 'buy') selected = [...state.selected, input.id];
    else {
      if (!state.selected.includes(input.id)) return state;
      selected = state.selected.filter((id) => id !== input.id);
    }
    if (!validSelection(selected)) return state;
    selected = normalize(selected);
    if (selected.join() === state.selected.join()) return state;
    return { ...state, selected, inputs: [...state.inputs, structuredClone(input)] };
  }
  if (input.type === 'start') {
    if (state.current) return state;
    const org = createOrgState('default', true);
    const spec = PUBLIC_DRAFT_CONDITIONS[state.condition];
    org.quality = spec.quality;
    const rng = createRng(`${state.ruleset}:${state.seed}:sprint`);
    const sprint = createSprint(
      resolveSprintConfig('default', {
        taskCount: 16 * BOSS.taskCountMul,
        focusMax: 8,
        minCompleteTick: 0,
        maxTicks: spec.maxTicks,
      }),
      org,
      rng,
      { ...IDENTITY_CARD_EFFECTS, incidentRateMul: BOSS.incidentMul },
    );
    // 実simのBacklog流入・仕事のseed分布を保持する。監査の倍率と突破判定は既存定義。
    const deck = state.selected.map((defId) => ({ defId, level: 1 }));
    sprint.cardPiles.hand = deck.map((_, index) => index);
    return {
      ...state,
      current: { deck, org, sprint, tick: 0, rngState: getRngState(rng) },
      inputs: [...state.inputs, structuredClone(input)],
    };
  }
  if (!state.current || state.current.sprint.complete) return state;
  const next = structuredClone(state);
  const current = next.current!;
  if (input.type === 'play') {
    const index = current.deck.findIndex((card) => card.defId === input.id);
    if (
      !playCardFromHand(current.sprint, current.org, current.deck, index, {
        ...IDENTITY_CARD_EFFECTS,
        incidentRateMul: BOSS.incidentMul,
      }).ok
    )
      return state;
  } else {
    const rng = createRngFromState(current.rngState);
    current.tick += 1;
    if (input.action !== 'none')
      applyAction(input.action, current.sprint, current.org, rng, current.tick);
    stepSprint(current.sprint, current.org, rng, current.tick);
    current.rngState = getRngState(rng);
  }
  next.inputs.push(structuredClone(input));
  return next;
}

/** 全候補と2種類の費用は開始前から取得可能。閲覧は状態・乱数を消費しない。 */
export function viewPublicDraft(state: PublicDraftState) {
  const acquisitionSpent = selectionCost(state.selected);
  return {
    ruleset: state.ruleset,
    seed: state.seed,
    condition: state.condition,
    boss: structuredClone(BOSS),
    budget: PUBLIC_DRAFT_BUDGET,
    acquisitionSpent,
    budgetRemaining: PUBLIC_DRAFT_BUDGET - acquisitionSpent,
    changesAllowed: state.current === null,
    cancellationFee: 0,
    loanPolicy: 'all-offers-including-meta-locked' as const,
    offers: PUBLIC_DRAFT_OFFERS.map((offer) => ({
      ...offer,
      level: 1,
      playFocusCost: playCost(getCard(offer.id)!.focusCost, 1),
      effects: { ...getCard(offer.id)!.base },
      selected: state.selected.includes(offer.id),
    })),
  };
}

/** 保存は入力列と乱数チェックポイント。現在のsimは同rulesetから再構築する。 */
export function savePublicDraft(state: PublicDraftState): string {
  return JSON.stringify({
    version: state.version,
    ruleset: state.ruleset,
    seed: state.seed,
    condition: state.condition,
    inputs: state.inputs,
    rngState: state.current?.rngState ?? null,
  });
}

function isInput(value: unknown): value is PublicDraftInput {
  if (!value || typeof value !== 'object') return false;
  const input = value as Record<string, unknown>;
  const isCard = (id: unknown) => PUBLIC_DRAFT_OFFERS.some((offer) => offer.id === id);
  if (input.type === 'start') return true;
  if (input.type === 'replace') return Array.isArray(input.ids) && input.ids.every(isCard);
  if (input.type === 'tick')
    return (
      input.action === 'none' || input.action === 'firefight' || input.action === 'interruptReview'
    );
  return (
    (input.type === 'buy' || input.type === 'cancel' || input.type === 'play') && isCard(input.id)
  );
}

/** 旧ruleset、無効入力、二重購入/発動/開始、完了後tick、乱数破損は復元しない。 */
export function restorePublicDraft(json: string): PublicDraftState | null {
  try {
    const value = JSON.parse(json);
    if (
      !value ||
      value.version !== 1 ||
      value.ruleset !== PUBLIC_DRAFT_RULESET ||
      typeof value.seed !== 'string' ||
      typeof value.condition !== 'string' ||
      !Object.prototype.hasOwnProperty.call(PUBLIC_DRAFT_CONDITIONS, value.condition) ||
      !Array.isArray(value.inputs)
    )
      return null;
    let state = createPublicDraft(value.seed, value.condition);
    for (const input of value.inputs) {
      if (!isInput(input)) return null;
      const next = applyPublicDraft(state, input);
      if (next === state) return null;
      state = next;
    }
    return (state.current?.rngState ?? null) === value.rngState ? state : null;
  } catch {
    return null;
  }
}

export function summarizePublicDraft(state: PublicDraftState) {
  const current = state.current;
  if (!current?.sprint.complete) return null;
  const result = summarizeSprint(current.sprint, current.org);
  return {
    acquisitionSpent: selectionCost(state.selected),
    budgetRemaining: PUBLIC_DRAFT_BUDGET - selectionCost(state.selected),
    played: current.sprint.cardPiles.played.map((i) => current.deck[i].defId),
    ticks: current.tick,
    delivered: result.delivered,
    completed: result.done,
    timedOut: result.timedOut ?? false,
    bossCleared: evaluateBoss({ boss: BOSS, result, org: current.org, bossTargetMul: 1 }),
    quality: current.org.quality,
    techDebt: current.org.techDebt,
    seniorHp: current.org.seniorHp,
    incidents: result.incidents,
    spread: result.spread,
    focusSpent: current.sprint.metrics.focusSpent,
    focusRemaining: current.sprint.focus,
    actionCounts: result.actionCounts,
    rngState: current.rngState,
  };
}

export const PUBLIC_DRAFT_BUILDS = {
  concentrated: ['hire-senior'],
  diversified: ['docs', 'pr-size-limit', 'copilot'],
  testing: ['auto-test', 'copilot'],
  throughput: ['review-bot', 'pr-size-limit', 'copilot'],
  unprepared: [],
} as const;

/** 固定方針の比較。人間の適応行動・楽しさの証拠にはしない。 */
export function comparePublicDraft(seed: string, condition: PublicDraftCondition = 'control') {
  return Object.entries(PUBLIC_DRAFT_BUILDS).map(([build, ids]) => {
    const initial = createPublicDraft(seed, condition);
    let state = applyPublicDraft(initial, { type: 'replace', ids: [...ids] });
    state = applyPublicDraft(state, { type: 'start' });
    const org = structuredClone(state.current!.org);
    const config = { ...state.current!.sprint.config };
    for (const id of ids) state = applyPublicDraft(state, { type: 'play', id });
    while (!state.current!.sprint.complete) {
      const sprint = state.current!.sprint;
      const action = isFirefightUrgent(sprint)
        ? 'firefight'
        : tasksInLane(sprint, 'review').length >= 4
          ? 'interruptReview'
          : 'none';
      state = applyPublicDraft(state, { type: 'tick', action });
    }
    return {
      seed,
      condition,
      build,
      selected: state.selected,
      initial: { org, config },
      inputs: state.inputs,
      result: summarizePublicDraft(state)!,
    };
  });
}
