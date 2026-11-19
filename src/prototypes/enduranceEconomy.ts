import { getEvent } from '../data/events';
import { canRecruit, RECRUIT_COST, type LaneAssignment } from '../sim/member';
import { companyOrgFromTeams } from '../sim/orgscale';
import { RunEngine } from '../sim/run/engine';
import { canUnlock } from '../sim/run/evolution';
import type { CounterfactualFrame } from '../sim/run/persist';
import { canAcknowledgeWin } from '../sim/run/quarterReview';
import type { GoalAdjustmentId, RunState } from '../sim/run/types';
import type { ActionId } from '../sim/types';
import { computeRunRewardBreakdown } from '../state/meta';

export const ENDURANCE_RULES = { quarters: 6, quarterlyGrant: 12, minimumWorking: 2 } as const;
export const ENDURANCE_SEEDS = ['ri268:10', 'ri75j-easy-7', 'ri268:26', 'ri268:2'] as const;

type EndurancePolicy = 'delivery' | 'reserve';

/** 通常の勝利承認は元エンジンで実行し、耐久側だけ同じレビュー状態から分岐する。 */
class EnduranceEngine extends RunEngine {
  startAfterSuccess(): void {
    const state = this.snapshot();
    if (
      state.status !== 'playing' ||
      state.phase !== 'quarterReview' ||
      !state.quarterReview ||
      !canAcknowledgeWin(state.quarterReview.outcome)
    ) {
      throw new Error('耐久で目標を更新するには達成した四半期レビューが必要');
    }
    // 達成後は目標修正と違い、次のボスの初期目標を新たに採用する。
    this.startNextQuarter(false);
  }

  protected override grantBossRelic(): undefined {
    return undefined;
  }
}

function resources(state: RunState) {
  const org = companyOrgFromTeams(state.teams, state.org);
  return {
    budget: state.budget,
    trust: state.stakeholderTrust,
    quality: org.quality,
    morale: org.morale,
    seniorHp: org.seniorHp,
    techDebt: org.techDebt,
    aiDependency: org.aiDependency,
    deckSize: state.deck.length,
    evolution: state.evolution,
    working: state.roster.members.filter((m) => !m.onLeave && m.assignment !== 'bench').length,
    relics: state.relics,
    roster: state.roster.members.map(({ id, assignment, aiAssigned, onLeave, stamina }) => ({
      id,
      assignment,
      aiAssigned,
      onLeave,
      stamina,
    })),
  };
}

type Input =
  | ['assign', string, LaneAssignment]
  | ['card', number]
  | ['step', number]
  | ['dispatch', ActionId]
  | ['evolve', string]
  | ['draft', string | null]
  | ['begin' | 'result' | 'finishEvolution' | 'leaveShop']
  | ['event', number]
  | ['rest', 'heal' | 'repay' | 'upgrade' | 'recruit']
  | ['recruit', 'hire' | 'skip'];

function setupRoster(engine: RunEngine, state: RunState, inputs: Input[]): void {
  const healthy = state.roster.members.filter(({ onLeave }) => !onLeave);
  const coder = healthy.find(({ assignment }) => assignment === 'coding') ?? healthy[0];
  for (const member of healthy) {
    if (member.assignment !== 'bench' && member !== coder) continue;
    const lane =
      member === coder || member.stats.implementation > member.stats.review ? 'coding' : 'review';
    if (lane === member.assignment) continue;
    engine.assignMember(member.id, lane);
    inputs.push(['assign', member.id, lane]);
  }
}

function chooseRecruitment(state: RunState, policy: EndurancePolicy): boolean {
  const working = state.roster.members.filter(({ onLeave }) => !onLeave).length;
  const reserve = policy === 'reserve' ? RECRUIT_COST : 0;
  return (
    state.budget > RECRUIT_COST + reserve &&
    canRecruit(state.roster) &&
    (policy === 'delivery' || working <= 2)
  );
}

function summarizeQuarter(
  start: RunState,
  end: RunState,
  inputs: Input[],
  bossInfraCharge: number | null,
) {
  const review = end.quarterReview;
  const closingResources = resources(end);
  return {
    quarter: start.quarterNumber,
    boss: start.bossId,
    goal: start.quarterGoal,
    start: resources(start),
    end: closingResources,
    status: end.status,
    loseReason: end.loseReason ?? null,
    outcome: review?.outcome ?? null,
    bossCleared: review?.bossCleared ?? false,
    bossInfraCharge,
    stable:
      review !== null &&
      canAcknowledgeWin(review.outcome) &&
      end.budget >= RECRUIT_COST &&
      closingResources.working >= ENDURANCE_RULES.minimumWorking,
    bossRelicReward: end.bossRelicReward ?? null,
    totals: end.quarterTotals,
    missedKpis:
      review?.progress.filter(({ status }) => status === 'missed').map(({ id }) => id) ?? [],
    sprintsCompleted: end.sprintsPlayed - start.sprintsPlayed,
    inputs,
  };
}

function playSprint(engine: RunEngine, inputs: Input[]): void {
  for (let round = 0; round < 500; round += 1) {
    const state = engine.snapshot();
    if (state.phase !== 'sprint' || !state.sprint) return;
    for (const deckIndex of state.sprint.cardPiles.hand) {
      if (engine.playCard(deckIndex).ok) inputs.push(['card', deckIndex]);
    }
    if (engine.currentPhase() !== 'sprint') return;

    const reviewLength = state.sprint.tasks.filter(({ lane }) => lane === 'review').length;
    const urgentFire = state.sprint.tasks.some(
      ({ incident, lane, burnTicksLeft }) =>
        lane === 'rework' && incident && (burnTicksLeft ?? Infinity) <= 15,
    );
    const dispatch = (id: ActionId) => {
      if (engine.dispatch(id).ok) inputs.push(['dispatch', id]);
    };
    dispatch('pairReview');
    if (reviewLength >= 6) dispatch('interruptReview');
    if (urgentFire) dispatch('firefight');
    // 介入・カードの間に連続したstepだけを合算する。
    const previous = inputs[inputs.length - 1];
    if (previous?.[0] === 'step') previous[1] += 1_000;
    else inputs.push(['step', 1_000]);
    engine.step(1_000);
  }
  throw new Error('スプリント比較の進行上限');
}

function playQuarter(engine: RunEngine, policy: EndurancePolicy) {
  const start = engine.snapshot();
  const inputs: Input[] = [];
  let bossInfraCharge = null;
  for (let iteration = 0; iteration < 150; iteration += 1) {
    const state = engine.snapshot();
    if (state.status !== 'playing' || state.phase === 'quarterReview') {
      return summarizeQuarter(start, state, inputs, bossInfraCharge);
    }
    switch (state.phase) {
      case 'setup':
        setupRoster(engine, state, inputs);
        engine.beginSetupSprint();
        inputs.push(['begin']);
        if (state.sprintIndexInQuarter + 1 === state.sprintsPerQuarter) {
          bossInfraCharge = state.budget - engine.snapshot().budget;
        }
        break;
      case 'sprint':
        playSprint(engine, inputs);
        break;
      case 'result':
        engine.acknowledgeResult();
        inputs.push(['result']);
        break;
      case 'draft': {
        const cardId = state.draft?.[0] ?? null;
        if (cardId !== null) engine.chooseCard(cardId);
        else engine.skipDraft();
        inputs.push(['draft', cardId]);
        break;
      }
      case 'evolution':
        for (const node of ['review-1', 'quality-1', 'review-2']) {
          if (!canUnlock(engine.snapshot().evolution, node)) continue;
          engine.unlockEvolution(node);
          inputs.push(['evolve', node]);
        }
        engine.finishEvolution();
        inputs.push(['finishEvolution']);
        break;
      case 'beat': {
        const beat = state.beat;
        if (!beat) throw new Error('イベントの入力にはビートが必要');
        const index =
          beat.kind === 'judgment'
            ? 0
            : (getEvent(beat.eventId)?.choices ?? []).findIndex(
                ({ outcome }) => !outcome.grantRecruit && !outcome.forceLose,
              );
        const choice = Math.max(0, index);
        engine.resolveBeat(choice);
        inputs.push(['event', choice]);
        break;
      }
      case 'shop':
        engine.leaveShop();
        inputs.push(['leaveShop']);
        break;
      case 'rest': {
        let option: 'heal' | 'repay' | 'upgrade' | 'recruit';
        if (chooseRecruitment(state, policy)) option = 'recruit';
        else if (policy === 'delivery') option = 'upgrade';
        else option = state.org.techDebt >= 15 && state.org.seniorHp >= 60 ? 'repay' : 'heal';
        engine.restChoose(option);
        inputs.push(['rest', option]);
        break;
      }
      case 'recruit': {
        const option = chooseRecruitment(state, policy) ? 'hire' : 'skip';
        engine.recruitChoose(option);
        inputs.push(['recruit', option]);
        break;
      }
      default:
        throw new Error(`固定方針で進められないフェーズ ${state.phase}`);
    }
  }
  throw new Error('四半期比較の進行上限');
}

function compare(checkpoint: CounterfactualFrame, policy: EndurancePolicy, quarterlyGrant: number) {
  const engine = new EnduranceEngine();
  engine.hydrateCounterfactualFrame(checkpoint);
  engine.startAfterSuccess();
  const quarters = [];
  const desired = policy === 'reserve' ? 'quality_pivot' : 'cut_scope';
  let stableStreak = 0;
  let longestStableStreak = 0;
  for (let elapsed = 0; elapsed < ENDURANCE_RULES.quarters; elapsed += 1) {
    const setup = engine.exportCounterfactualFrame();
    if (!setup || setup.persist.phase !== 'setup')
      throw new Error('期首予算の計上には編成状態が必要');
    // 期首条件として一度だけ計上。実simのフレーム復元は繰越のみの対照群でも行う。
    setup.persist.budget += quarterlyGrant;
    engine.hydrateCounterfactualFrame(setup);
    const quarter = playQuarter(engine, policy);
    const current = engine.snapshot();
    const review = current.quarterReview;
    const moreQuarters = elapsed + 1 < ENDURANCE_RULES.quarters;
    let adjustment: GoalAdjustmentId | null = null;
    if (current.status === 'playing') {
      if (!review) throw new Error('四半期レビューまたは敗北が必要');
      if (canAcknowledgeWin(review.outcome)) {
        if (moreQuarters) engine.startAfterSuccess();
      } else if (review.outcome === 'missed_adjustable') {
        if (moreQuarters) {
          adjustment = review.availableAdjustments.includes(desired)
            ? desired
            : review.availableAdjustments[0];
          if (!adjustment) throw new Error('目標修正可能なレビューの候補が空');
          engine.chooseGoalAdjustment(adjustment);
        }
      } else {
        engine.acknowledgeQuarterReview();
      }
    }
    stableStreak = quarter.stable ? stableStreak + 1 : 0;
    longestStableStreak = Math.max(longestStableStreak, stableStreak);
    quarters.push({ ...quarter, adjustment });
    if (engine.currentPhase() === 'lost') break;
  }
  const finished = engine.snapshot();
  return {
    policy,
    quarterlyGrant,
    quarters,
    completedQuarters: quarters.filter(({ outcome }) => outcome !== null).length,
    longestStableStreak,
    stoppedBy: finished.status === 'lost' ? ('lost' as const) : ('horizon' as const),
    loseReason: finished.loseReason ?? null,
    metaPoints: 0 as const,
  };
}

export function evaluateEndurance(seed: string) {
  const normal = new RunEngine({ seed, difficulty: 'easy' });
  normal.startRun();
  const preVictory = [];
  for (let index = 0; index < ENDURANCE_RULES.quarters; index += 1) {
    const quarter = playQuarter(normal, 'reserve');
    const state = normal.snapshot();
    const review = state.quarterReview;
    if (state.status === 'lost') {
      preVictory.push({ ...quarter, adjustment: null });
      break;
    }
    if (!review) throw new Error('通常ランの四半期レビューが必要');
    if (review.outcome === 'missed_adjustable') {
      if (index + 1 === ENDURANCE_RULES.quarters) {
        preVictory.push({ ...quarter, adjustment: null });
        break;
      }
      const adjustment = review.availableAdjustments[0];
      if (!adjustment) throw new Error('目標修正可能なレビューの候補が空');
      normal.chooseGoalAdjustment(adjustment);
      preVictory.push({ ...quarter, adjustment });
      if (normal.currentPhase() === 'lost') break;
      continue;
    }
    preVictory.push({ ...quarter, adjustment: null });
    const checkpoint = normal.exportCounterfactualFrame();
    normal.acknowledgeQuarterReview();
    const final = normal.snapshot();
    if (final.status !== 'won') break;
    if (!checkpoint || !final.winType) throw new Error('通常勝利のレビュー状態と勝利種別が必要');
    const firstVictory = {
      quarter: final.quarterNumber,
      winType: final.winType,
      bossRelicReward: final.bossRelicReward ?? null,
      ordinaryMetaPoints: computeRunRewardBreakdown({
        won: true,
        difficulty: final.difficulty,
        winType: final.winType,
        bossId: final.bossId,
        score: final.totals.delivered,
        scoreMul: 1,
        maxCombo: final.totals.maxCombo,
        quarterReviews: final.reviewHistory,
        diagnosis: final.diagnosis,
      }).total,
    };
    const comparisons = [0, ENDURANCE_RULES.quarterlyGrant].flatMap((grant) =>
      (['delivery', 'reserve'] as const).map((policy) => compare(checkpoint, policy, grant)),
    );
    return { seed, preVictory, normalStatus: final.status, firstVictory, comparisons };
  }
  return {
    seed,
    preVictory,
    normalStatus: normal.snapshot().status,
    firstVictory: null,
    comparisons: [],
  };
}
