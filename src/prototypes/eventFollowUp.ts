import { getEvent, type EventOutcome } from '../data/events';
import { createOrgState } from '../sim/org';
import { createRng } from '../sim/rng';
import { SPRINTS_PER_QUARTER } from '../sim/run/constants';
import { foldPassives } from '../sim/run/effects';
import { applyEventOutcome } from '../sim/run/events';
import type { OrgState } from '../sim/types';

type OriginChoice = 0 | 1;
export interface GiantPrReservation {
  originChoice: OriginChoice;
  selectedAfter: number;
  dueAfter: number;
  resolvedAfter: number | null;
}

type FollowUpBeat =
  { kind: 'normal'; eventId: string } | { kind: 'follow-up'; eventId: 'giant-pr-follow-up' };

/** 既存の通常ビートID。休息とショップは新しい枠ではなく、この通常ビートに載せる。 */
export const FOLLOW_UP_USUAL_BEATS = [
  'ai-test-gen',
  'junior-awaken',
  'rest-offer',
  'shop-offer',
] as const;
export type FollowUpUsualBeat = (typeof FOLLOW_UP_USUAL_BEATS)[number];

/**
 * 資源不足と比較腕の固定係数。
 * 本番の休息回復量、ショップ価格、即時敗北判定は参照しない。
 */
export const FOLLOW_UP_PRESSURE = {
  restSeniorHp: 40,
  restMorale: 10,
  shopBudget: 12,
} as const;

/** 試作が定義する支払いは reject。fallback は比較腕で、既定の解決には使わない。 */
export type FollowUpPaymentPolicy = 'reject' | 'fallback';

const PROTOTYPE_USUAL_OUTCOMES: Partial<Record<FollowUpUsualBeat, readonly EventOutcome[]>> = {
  'rest-offer': [
    { seniorHp: FOLLOW_UP_PRESSURE.restSeniorHp, morale: FOLLOW_UP_PRESSURE.restMorale },
    {},
  ],
  'shop-offer': [{ budget: -FOLLOW_UP_PRESSURE.shopBudget }, {}],
};

/** RI-240: 巨大PR1件だけを覚える。四半期内番号で予約しない。 */
export interface EventFollowUpState {
  version: 1;
  seed: string | number;
  completedSprints: number;
  phase: 'between' | 'beat' | 'sprint';
  active: FollowUpBeat | null;
  deferredNormal: FollowUpBeat | null;
  reservation: GiantPrReservation | null;
  org: OrgState;
  budget: number;
  relics: string[];
  history: { afterSprint: number; eventId: string; choice: number; outcome: EventOutcome }[];
}

export function createEventFollowUpPrototype(
  seed: string | number,
  completedSprints = 0,
): EventFollowUpState {
  if (!Number.isSafeInteger(completedSprints) || completedSprints < 0)
    throw new Error('完了数は非負の整数');
  return {
    version: 1,
    seed,
    completedSprints,
    phase: 'between',
    active: null,
    deferredNormal: null,
    reservation: null,
    org: createOrgState('default', false),
    budget: 40,
    relics: [],
    history: [],
  };
}

/** 固定の起点イベントを提示する試作用入力。完了後に別起点を予約しない。 */
export function presentGiantPrOrigin(state: EventFollowUpState): EventFollowUpState {
  if (state.phase !== 'between') return state;
  return { ...state, phase: 'beat', active: { kind: 'normal', eventId: 'giant-pr' } };
}

/** 起点の選択前に、確定した当期費用と将来の追加相談の予告を分けて返す。 */
export function previewGiantPrOriginChoice(state: EventFollowUpState, choice: OriginChoice) {
  return {
    immediate: { ...getEvent('giant-pr')!.choices[choice].outcome },
    followUp: state.reservation
      ? null
      : {
          earliestAfter: state.completedSprints + 2,
          possibleCost: choice === 1 ? { seniorHp: 4, budget: 0 } : { seniorHp: 0, budget: 6 },
        },
  };
}

export function previewGiantPrFollowUp(state: EventFollowUpState) {
  return state.reservation
    ? {
        ...state.reservation,
        earliestAfter: state.reservation.dueAfter,
        // 選択前の予告は追加相談と費用の幅まで。具体的な相談は提示時に確定する。
        possibleCost: { seniorHp: 4, budget: 6 },
      }
    : null;
}

/** 同じ後日談1件の中で、覚えた選択に沿った2択を返す。通常イベント抽選には登録しない。 */
export function giantPrFollowUpOutcomes(choice: OriginChoice): readonly EventOutcome[] {
  return choice === 1
    ? [{ seniorHp: -4, morale: 8, quality: 4 }, { morale: -4 }]
    : [
        { budget: -6, seniorHp: 4, quality: 6 },
        { seniorHp: 2, quality: -3 },
      ];
}

/** 期限到達の後日談を優先し、その時点の通常イベントは次の既存ビートへ1件繰り延べる。 */
export function presentEventFollowUpBeat(
  state: EventFollowUpState,
  usualBeat?: FollowUpUsualBeat,
): EventFollowUpState {
  if (state.phase !== 'between') return state;
  // ボス終了直後は新四半期の準備へ直行する現行トラック。予約だけ保持する。
  if (state.completedSprints % SPRINTS_PER_QUARTER === 0) return state;
  const normal: FollowUpBeat = state.deferredNormal ?? {
    kind: 'normal',
    eventId:
      usualBeat ??
      (createRng(`${state.seed}:normal:${state.completedSprints}`)() < 0.5
        ? 'ai-test-gen'
        : 'junior-awaken'),
  };
  if (
    state.reservation &&
    state.reservation.resolvedAfter === null &&
    state.completedSprints >= state.reservation.dueAfter
  ) {
    return {
      ...state,
      phase: 'beat',
      active: { kind: 'follow-up', eventId: 'giant-pr-follow-up' },
      deferredNormal: normal,
    };
  }
  return { ...state, phase: 'beat', active: normal, deferredNormal: null };
}

/** 負の予算またはシニアHPだけを費用とみなす。足りない選択は適用しない。 */
export function canPayFollowUpChoice(state: EventFollowUpState, outcome: EventOutcome): boolean {
  const budgetCost = outcome.budget !== undefined && outcome.budget < 0 ? -outcome.budget : 0;
  const hpCost = outcome.seniorHp !== undefined && outcome.seniorHp < 0 ? -outcome.seniorHp : 0;
  return state.budget >= budgetCost && state.org.seniorHp >= hpCost;
}

function beatOutcomes(state: EventFollowUpState, active: FollowUpBeat): readonly EventOutcome[] {
  if (active.kind === 'follow-up') {
    return state.reservation && state.reservation.resolvedAfter === null
      ? giantPrFollowUpOutcomes(state.reservation.originChoice)
      : [];
  }
  // 休息とショップの資源効果はこの試作の固定係数。本番フェーズへは進まない。
  const scripted = PROTOTYPE_USUAL_OUTCOMES[active.eventId as FollowUpUsualBeat];
  if (scripted) return scripted;
  return getEvent(active.eventId)?.choices.map((entry) => entry.outcome) ?? [];
}

function selectPayableChoice(
  state: EventFollowUpState,
  outcomes: readonly EventOutcome[],
  choice: number,
  policy: FollowUpPaymentPolicy,
): { index: number; outcome: EventOutcome } | null {
  const direct = outcomes[choice];
  if (!direct) return null;
  if (canPayFollowUpChoice(state, direct)) return { index: choice, outcome: direct };
  if (policy !== 'fallback') return null;
  const other = choice === 0 ? 1 : 0;
  const alternative = outcomes[other];
  if (!alternative || !canPayFollowUpChoice(state, alternative)) return null;
  return { index: other, outcome: alternative };
}

/** 予約消費は提示時でなく解決時。支払えない選択は拒否し、資源も予約も変えない。 */
export function resolveEventFollowUpBeat(
  state: EventFollowUpState,
  choice: number,
  policy: FollowUpPaymentPolicy = 'reject',
): EventFollowUpState {
  if (state.phase !== 'beat' || !state.active || !Number.isInteger(choice)) return state;
  const active = state.active;
  const selected = selectPayableChoice(state, beatOutcomes(state, active), choice, policy);
  if (!selected) return state;
  const next = structuredClone(state);
  const result = applyEventOutcome(selected.outcome, next.org, foldPassives(next.relics));
  next.budget += result.budgetDelta;
  if (result.grantRelic && !next.relics.includes(result.grantRelic))
    next.relics.push(result.grantRelic);
  if (active.kind === 'follow-up') next.reservation!.resolvedAfter = state.completedSprints;
  else if (active.eventId === 'giant-pr' && !state.reservation)
    next.reservation = {
      originChoice: selected.index as OriginChoice,
      selectedAfter: state.completedSprints,
      dueAfter: state.completedSprints + 2,
      resolvedAfter: null,
    };
  next.history.push({
    afterSprint: state.completedSprints,
    eventId: active.eventId,
    choice: selected.index,
    outcome: { ...selected.outcome },
  });
  next.active = null;
  next.phase = 'sprint';
  return next;
}

/** 本試作はビートだけを評価し、スプリントの成果・自然回復を追加しない。 */
export function completeEventFollowUpSprint(state: EventFollowUpState): EventFollowUpState {
  if (state.phase !== 'sprint') return state;
  return { ...state, completedSprints: state.completedSprints + 1, phase: 'between' };
}

/** 四半期終盤からの同一条件比較。未経験／即時レビュー／分割の3方針。 */
export function compareEventFollowUpStrategies(seed: string | number) {
  return (['unseen', 'review', 'split'] as const).map((strategy) => {
    let state = createEventFollowUpPrototype(seed, SPRINTS_PER_QUARTER - 2);
    if (strategy !== 'unseen')
      state = resolveEventFollowUpBeat(presentGiantPrOrigin(state), strategy === 'split' ? 1 : 0);
    else state = { ...state, phase: 'sprint' };
    for (let period = 0; period < 4; period += 1) {
      state = completeEventFollowUpSprint(state);
      state = presentEventFollowUpBeat(state);
      if (state.phase === 'beat') state = resolveEventFollowUpBeat(state, 0);
      else state = { ...state, phase: 'sprint' };
    }
    return {
      strategy,
      completedSprints: state.completedSprints,
      reservation: state.reservation,
      seniorHp: state.org.seniorHp,
      morale: state.org.morale,
      quality: state.org.quality,
      budget: state.budget,
      relics: state.relics,
      history: state.history,
    };
  });
}

export interface FollowUpPressureCase {
  id: string;
  order: 'follow-up-first' | 'normal-first';
  policy: FollowUpPaymentPolicy;
  originChoice: OriginChoice;
  completedSprints: number;
  budget: number;
  seniorHp: number;
  morale: number;
  quality: number;
  usualBeat: FollowUpUsualBeat;
  beatChoices: readonly (readonly number[])[];
}

/** 支払える初期比較は繰り返さない。不足資源と、期限ちょうどに重なる通常ビートだけを入力にする。 */
export const FOLLOW_UP_PRESSURE_CASES: readonly FollowUpPressureCase[] = [
  {
    id: 'low-hp-consult-blocked',
    order: 'follow-up-first',
    policy: 'reject',
    originChoice: 1,
    completedSprints: SPRINTS_PER_QUARTER + 1,
    budget: 40,
    seniorHp: 3,
    morale: 70,
    quality: 60,
    usualBeat: 'rest-offer',
    beatChoices: [[0]],
  },
  {
    id: 'low-hp-rest-next-beat',
    order: 'follow-up-first',
    policy: 'reject',
    originChoice: 1,
    completedSprints: SPRINTS_PER_QUARTER + 1,
    budget: 40,
    seniorHp: 3,
    morale: 70,
    quality: 60,
    usualBeat: 'rest-offer',
    beatChoices: [[0, 1], [0]],
  },
  {
    id: 'low-hp-rest-first-arm',
    order: 'normal-first',
    policy: 'reject',
    originChoice: 1,
    completedSprints: SPRINTS_PER_QUARTER + 1,
    budget: 40,
    seniorHp: 3,
    morale: 70,
    quality: 60,
    usualBeat: 'rest-offer',
    beatChoices: [[0], [0]],
  },
  {
    id: 'shop-after-follow-up',
    order: 'follow-up-first',
    policy: 'reject',
    originChoice: 0,
    completedSprints: SPRINTS_PER_QUARTER + 1,
    budget: 16,
    seniorHp: 80,
    morale: 70,
    quality: 60,
    usualBeat: 'shop-offer',
    beatChoices: [[0], [0, 1]],
  },
  {
    id: 'shop-before-follow-up-arm',
    order: 'normal-first',
    policy: 'reject',
    originChoice: 0,
    completedSprints: SPRINTS_PER_QUARTER + 1,
    budget: 16,
    seniorHp: 80,
    morale: 70,
    quality: 60,
    usualBeat: 'shop-offer',
    beatChoices: [[0], [0, 1]],
  },
  {
    id: 'budget-short-reject',
    order: 'follow-up-first',
    policy: 'reject',
    originChoice: 0,
    completedSprints: SPRINTS_PER_QUARTER + 1,
    budget: 5,
    seniorHp: 80,
    morale: 70,
    quality: 60,
    usualBeat: 'shop-offer',
    beatChoices: [
      [0, 1],
      [0, 1],
    ],
  },
  {
    id: 'budget-short-fallback-arm',
    order: 'follow-up-first',
    policy: 'fallback',
    originChoice: 0,
    completedSprints: SPRINTS_PER_QUARTER + 1,
    budget: 5,
    seniorHp: 80,
    morale: 70,
    quality: 60,
    usualBeat: 'shop-offer',
    beatChoices: [[0], [0]],
  },
];

/** 起点の効果は適用済みとして、期限時点の資源だけを比較入力にする。 */
export function createDueFollowUpState(input: FollowUpPressureCase): EventFollowUpState {
  if (!Number.isSafeInteger(input.completedSprints) || input.completedSprints < 2)
    throw new Error('期限比較の完了数は2以上');
  if (
    !Number.isSafeInteger(input.budget) ||
    input.budget < 0 ||
    !Number.isSafeInteger(input.seniorHp) ||
    input.seniorHp < 0
  )
    throw new Error('予算とHPは非負の整数');
  const base = createEventFollowUpPrototype('RI-240-pressure', input.completedSprints);
  return {
    ...base,
    budget: input.budget,
    org: { ...base.org, seniorHp: input.seniorHp, morale: input.morale, quality: input.quality },
    reservation: {
      originChoice: input.originChoice,
      selectedAfter: input.completedSprints - 2,
      dueAfter: input.completedSprints,
      resolvedAfter: null,
    },
  };
}

function openPressureBeat(
  state: EventFollowUpState,
  input: FollowUpPressureCase,
): EventFollowUpState {
  if (state.phase !== 'between') return state;
  if (input.order === 'follow-up-first') return presentEventFollowUpBeat(state, input.usualBeat);
  const followDue =
    state.reservation !== null &&
    state.reservation.resolvedAfter === null &&
    state.completedSprints >= state.reservation.dueAfter;
  const usualPlayed = state.history.some((event) => event.eventId === input.usualBeat);
  // 比較腕は同じ2件の順序を入れ替えるだけで、3件目のビートは作らない。
  if (followDue && state.completedSprints % SPRINTS_PER_QUARTER !== 0) {
    if (!usualPlayed) {
      return {
        ...state,
        phase: 'beat',
        active: { kind: 'normal', eventId: input.usualBeat },
        deferredNormal: null,
      };
    }
    return {
      ...state,
      phase: 'beat',
      active: { kind: 'follow-up', eventId: 'giant-pr-follow-up' },
      deferredNormal: null,
    };
  }
  return presentEventFollowUpBeat(state, input.usualBeat);
}

function runFollowUpPressureCase(input: FollowUpPressureCase) {
  let state = createDueFollowUpState(input);
  const attempts: {
    afterSprint: number;
    eventId: string;
    requested: number;
    applied: number | null;
    rejected: boolean;
    budget: number;
    seniorHp: number;
    morale: number;
    quality: number;
  }[] = [];
  for (let beat = 0; beat < input.beatChoices.length; beat += 1) {
    state = openPressureBeat(state, input);
    for (const requested of input.beatChoices[beat] ?? []) {
      const active = state.active;
      if (state.phase !== 'beat' || !active) break;
      const next = resolveEventFollowUpBeat(state, requested, input.policy);
      const rejected = next === state;
      const applied = next.history[next.history.length - 1];
      attempts.push({
        afterSprint: state.completedSprints,
        eventId: active.eventId,
        requested,
        applied: rejected || !applied ? null : applied.choice,
        rejected,
        budget: next.budget,
        seniorHp: next.org.seniorHp,
        morale: next.org.morale,
        quality: next.org.quality,
      });
      state = next;
    }
    if (state.phase !== 'sprint') break;
    if (beat < input.beatChoices.length - 1) state = completeEventFollowUpSprint(state);
  }
  return {
    id: input.id,
    order: input.order,
    policy: input.policy,
    phase: state.phase,
    completedSprints: state.completedSprints,
    budget: state.budget,
    seniorHp: state.org.seniorHp,
    morale: state.org.morale,
    quality: state.org.quality,
    relics: state.relics,
    reservation: state.reservation,
    active: state.active?.eventId ?? null,
    deferred: state.deferredNormal?.eventId ?? null,
    shopPaid: state.history.some((event) => event.eventId === 'shop-offer' && event.choice === 0),
    restTaken: state.history.some((event) => event.eventId === 'rest-offer' && event.choice === 0),
    attempts,
    history: state.history,
  };
}

/** 資源不足・低HP・休息/ショップ重なりの固定戦略比較。人間のプレイ評価は含まない。 */
export function compareFollowUpResourcePressure() {
  const [reviewAccept, reviewDecline] = giantPrFollowUpOutcomes(0);
  const [splitAccept, splitDecline] = giantPrFollowUpOutcomes(1);
  return {
    seed: 'RI-240-pressure',
    humanPlay: false,
    definedPayment: 'reject' as const,
    definedPriority: 'follow-up-first' as const,
    productionLossCheck: false,
    note: '固定戦略の再計算であり、人間のプレイ評価はしていない。支払えない選択の定義は拒否。normal-first と fallback は比較腕で、提示と既定解決は後日談優先と拒否のまま。新しいビートは足していない。本番の即時敗北判定は実行しない。',
    nextUncertainty:
      '支払えない追加相談を拒否しているあいだは繰り延べた休息へ進まず、その相談を閉じないまま次の既存ビートの休息のあとへ戻せるかは未決。',
    coefficients: {
      restSeniorHp: FOLLOW_UP_PRESSURE.restSeniorHp,
      restMorale: FOLLOW_UP_PRESSURE.restMorale,
      shopBudget: FOLLOW_UP_PRESSURE.shopBudget,
      reviewAccept,
      reviewDecline,
      splitAccept,
      splitDecline,
    },
    inputs: FOLLOW_UP_PRESSURE_CASES,
    results: FOLLOW_UP_PRESSURE_CASES.map(runFollowUpPressureCase),
  };
}
