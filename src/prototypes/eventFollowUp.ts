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
  | { kind: 'normal'; eventId: string }
  | { kind: 'follow-up'; eventId: 'giant-pr-follow-up' };

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
export function presentEventFollowUpBeat(state: EventFollowUpState): EventFollowUpState {
  if (state.phase !== 'between') return state;
  // ボス終了直後は新四半期の準備へ直行する現行トラック。予約だけ保持する。
  if (state.completedSprints % SPRINTS_PER_QUARTER === 0) return state;
  const normal: FollowUpBeat = state.deferredNormal ?? {
    kind: 'normal',
    eventId:
      createRng(`${state.seed}:normal:${state.completedSprints}`)() < 0.5
        ? 'ai-test-gen'
        : 'junior-awaken',
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

/** 予約消費は提示時でなく解決時。失敗した入力では予約・効果を変えない。 */
export function resolveEventFollowUpBeat(
  state: EventFollowUpState,
  choice: number,
): EventFollowUpState {
  if (state.phase !== 'beat' || !state.active || !Number.isInteger(choice)) return state;
  const active = state.active;
  const outcomes =
    active.kind === 'follow-up'
      ? state.reservation && state.reservation.resolvedAfter === null
        ? giantPrFollowUpOutcomes(state.reservation.originChoice)
        : []
      : (getEvent(active.eventId)?.choices.map((entry) => entry.outcome) ?? []);
  const outcome = outcomes[choice];
  if (!outcome) return state;
  const next = structuredClone(state);
  const result = applyEventOutcome(outcome, next.org, foldPassives(next.relics));
  next.budget += result.budgetDelta;
  if (result.grantRelic && !next.relics.includes(result.grantRelic))
    next.relics.push(result.grantRelic);
  if (active.kind === 'follow-up') next.reservation!.resolvedAfter = state.completedSprints;
  else if (active.eventId === 'giant-pr' && !state.reservation)
    next.reservation = {
      originChoice: choice as OriginChoice,
      selectedAfter: state.completedSprints,
      dueAfter: state.completedSprints + 2,
      resolvedAfter: null,
    };
  next.history.push({
    afterSprint: state.completedSprints,
    eventId: active.eventId,
    choice,
    outcome: { ...outcome },
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
