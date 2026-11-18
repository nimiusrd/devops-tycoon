/** RI-298の有限な固定方針比較。人間のプレイ・適応行動を表さない。 */
import { getEvent } from '../data/events';
import {
  challengeRuleset,
  openChallenge,
  type ChallengeCode,
  type ChallengeInput,
  type ChallengeSession,
} from './challengeCode';

export function challengeFixture(
  seed: string,
  minimum = 5,
  cardId = 'ai-guideline',
): ChallengeCode {
  return {
    format: 'devops-tycoon-challenge',
    version: 1,
    ruleset: challengeRuleset(),
    recipe: {
      schemaVersion: 1,
      seed,
      difficulty: 'easy',
      trials: [],
      scenario: 'default',
      preferredCardIds: [cardId],
    },
    restrictions: [{ kind: 'forbid-activation', cardIds: [cardId] }],
    objective: { kind: 'successful-interventions', minimum },
  };
}

export function challengeAct(session: ChallengeSession, input: ChallengeInput) {
  return session.act(JSON.stringify(input));
}

/** 一つの公開APIだけから進行。試行した禁止発動は履歴・費用・乱数を消費しない。 */
export function advanceChallenge(session: ChallengeSession, intervene = false, eventCard = false) {
  const { state: s } = session.view();
  switch (s.phase) {
    case 'setup':
      return challengeAct(session, { type: 'begin' });
    case 'sprint': {
      for (const deckIndex of [...(s.sprint?.cardPiles.hand ?? [])]) {
        challengeAct(session, { type: 'playCard', deckIndex });
      }
      if (intervene) challengeAct(session, { type: 'dispatch', actionId: 'pairReview' });
      if (session.view().state.status !== 'playing') return { ok: true };
      return challengeAct(session, { type: 'tick' });
    }
    case 'result':
      return challengeAct(session, { type: 'result' });
    case 'draft':
      return s.draft?.length
        ? challengeAct(session, { type: 'chooseCard', cardId: s.draft[0] })
        : challengeAct(session, { type: 'skipDraft' });
    case 'evolution':
      return challengeAct(session, { type: 'finishEvolution' });
    case 'beat': {
      const event = getEvent(s.beat!.eventId)!;
      let choiceIndex = event.choices.findIndex(
        ({ outcome }) => !outcome.grantRecruit && !outcome.forceLose,
      );
      if (choiceIndex < 0 || s.beat?.kind === 'judgment') choiceIndex = 0;
      if (eventCard && event.id === 'junior-awaken') choiceIndex = 1;
      return challengeAct(session, { type: 'beat', choiceIndex });
    }
    case 'shop':
      return challengeAct(session, { type: 'leaveShop' });
    case 'rest':
      return challengeAct(session, { type: 'rest', option: 'heal' });
    case 'recruit':
      return challengeAct(session, { type: 'recruit', option: 'skip' });
    case 'quarterReview':
      return s.quarterReview?.outcome === 'missed_adjustable'
        ? challengeAct(session, {
            type: 'adjust',
            adjustmentId: s.quarterReview.availableAdjustments[0],
          })
        : challengeAct(session, { type: 'review' });
    default:
      throw new Error(`完了後の進行: ${s.phase}`);
  }
}

export function finishChallenge(session: ChallengeSession, intervene = false) {
  let guard = 0;
  while (session.view().state.status === 'playing' && guard++ < 3000) {
    const applied = advanceChallenge(session, intervene);
    if (!applied.ok) throw new Error(`比較の進行失敗: ${JSON.stringify(applied)}`);
  }
  if (session.view().state.status === 'playing') throw new Error('比較上限');
  return session.view();
}

export function evaluateChallengeCodes() {
  return ['ri298-1', 'ri298-2', 'ri298-3', 'ri298-4', 'ri298-5'].flatMap((seed) =>
    [1, 5, 10].flatMap((minimum) =>
      [false, true].map((intervene) => {
        const code = challengeFixture(seed, minimum);
        const opened = openChallenge(JSON.stringify(code));
        if (!opened.ok) throw new Error(opened.reason);
        const initial = opened.value.view().state;
        const final = finishChallenge(opened.value, intervene);
        return {
          seed,
          minimum,
          strategy: intervene ? 'pair-review-when-available' : 'cards-only',
          initial: {
            org: initial.org,
            budget: initial.budget,
            roster: initial.roster,
            goal: initial.quarterGoal,
          },
          final: {
            costs: final.costs,
            objective: final.objective,
            result: final.result,
            totals: final.state.totals,
            budget: final.state.budget,
            org: final.state.org,
            sprints: final.state.sprintsPlayed,
          },
          // code・全受理入力・RNGチェックポイントを含むJSON。後からそのまま再計算できる。
          save: JSON.parse(opened.value.save()) as unknown,
        };
      }),
    ),
  );
}
