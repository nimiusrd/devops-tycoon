/** RI-211: 巨大PRの既存二択に、トレイトに沿う提案者を付ける試作。 */
import { getEvent } from '../data/events';
import { RECRUIT_ARCHETYPES } from '../data/members';
import type { TraitId } from '../data/traits';
import { INTERRUPT_REVIEW_COUNT } from '../sim/actions';
import { createInitialRoster, recruitMember, type Member, type RosterState } from '../sim/member';
import { createOrgState } from '../sim/org';
import { createRng } from '../sim/rng';
import { foldPassives } from '../sim/run/effects';
import { applyEventOutcome } from '../sim/run/events';
import { createSprintFromBaselineInput, withTeamBoardPressure } from '../sim/run/sprintBaseline';
import {
  buildSprintBaselineInput,
  recoverSeniorHpBetweenSprints,
} from '../sim/run/sprintBaselineBuild';
import { resolveSprintConfig, reviewOne, stepSprint } from '../sim/sprint';

const GIANT_PR = getEvent('giant-pr')!;
const CHOICES = [
  { id: 'review', trait: 'reviewDemon' },
  { id: 'split', trait: 'docMaster' },
] as const;
type ChoiceId = (typeof CHOICES)[number]['id'];
type Proposer = Pick<Member, 'id' | 'name'> & { trait: TraitId };

interface MemberProposal {
  readonly eventId: 'giant-pr';
  readonly proposers: Readonly<Record<ChoiceId, Readonly<Proposer> | null>>;
}

function pickProposer(seed: string, trait: TraitId, candidates: Member[]): Proposer | null {
  if (candidates.length === 0) return null;
  const rng = createRng(`${seed}:giant-pr:proposer:${trait}`);
  const member = candidates[Math.floor(rng() * candidates.length)];
  return { id: member.id, name: member.name, trait };
}

/** イベント発生時に話者を確定する。配置可能な控えも候補に含める。 */
export function openMemberProposal(seed: string, roster: RosterState): MemberProposal {
  const available = roster.members
    .filter((member) => !member.onLeave)
    .sort((a, b) => (a.id < b.id ? -1 : Number(a.id > b.id)));
  const reviewers = available.filter((member) => member.traits.includes(CHOICES[0].trait));
  const splitters = available.filter((member) => member.traits.includes(CHOICES[1].trait));
  const reviewersWithOtherSplitter = reviewers.filter((reviewer) =>
    splitters.some((splitter) => splitter.id !== reviewer.id),
  );
  const review = pickProposer(
    seed,
    CHOICES[0].trait,
    reviewersWithOtherSplitter.length ? reviewersWithOtherSplitter : reviewers,
  );
  const split = pickProposer(
    seed,
    CHOICES[1].trait,
    splitters.filter((splitter) => splitter.id !== review?.id),
  );
  return { eventId: 'giant-pr', proposers: { review, split } };
}

/** 表示は確定済みの話者を参照する。該当者のいない選択肢は無記名で提示する。 */
export function viewMemberProposal(proposal: MemberProposal) {
  return {
    eventId: proposal.eventId,
    title: GIANT_PR.title,
    prompt: GIANT_PR.prompt,
    choices: CHOICES.map(({ id }, index) => {
      const { label, description } = GIANT_PR.choices[index];
      const proposer = proposal.proposers[id];
      return { id, label, description, proposer: proposer ? { ...proposer } : null };
    }),
  };
}

const CASES = [
  { id: 'deadline', reviewQueue: 12, techDebt: 8, maxTicks: 5 },
  { id: 'light-queue', reviewQueue: 1, techDebt: 8, maxTicks: 5 },
  { id: 'high-debt', reviewQueue: 12, techDebt: 44, maxTicks: 5 },
  { id: 'more-time', reviewQueue: 12, techDebt: 8, maxTicks: 40 },
] as const;
const BUDGET = 40;

export function compareMemberProposal(seed: string) {
  const rosterRng = createRng(`${seed}:roster`);
  const starter = createInitialRoster(rosterRng);
  const roster = recruitMember(
    starter,
    RECRUIT_ARCHETYPES.find((arch) => arch.id === 'recruit-doc')!,
    rosterRng,
  );
  const proposal = viewMemberProposal(openMemberProposal(seed, roster));
  const initialOrg = createOrgState('default', true);
  const baseConfig = resolveSprintConfig('default');
  return {
    seed,
    initialOrg,
    budget: BUDGET,
    roster,
    proposal,
    cases: CASES.map((scenario) => ({
      ...scenario,
      results: CHOICES.map(({ id }, index) => {
        const org = { ...initialOrg, techDebt: scenario.techDebt };
        const { budgetDelta, grantRelic, nextSprint } = applyEventOutcome(
          GIANT_PR.choices[index].outcome,
          org,
          foldPassives([]),
        );
        const afterEvent = { seniorHp: org.seniorHp, morale: org.morale, quality: org.quality };
        org.seniorHp = recoverSeniorHpBetweenSprints(org.seniorHp);
        const baseline = buildSprintBaselineInput(
          {
            relics: grantRelic ? [grantRelic] : [],
            evolution: { points: 0, unlocked: {} },
            difficulty: 'normal',
            trials: [],
            bossId: '',
            quarterNumber: 1,
            baseConfig,
          },
          { roster, org, kind: 'normal', modifiers: nextSprint ?? {}, seed: `${seed}:sprint` },
        );
        // 長さだけを変え、同じ仕事と編成を使う比較用の期限。
        baseline.config = { ...baseline.config, maxTicks: scenario.maxTicks, minCompleteTick: 0 };
        const { sprint, rng } = createSprintFromBaselineInput(
          withTeamBoardPressure(baseline, scenario),
          org,
        );
        // 既存の割り込みレビューと同じ上限で先に着手する。通常の事故・手戻り判定とHP消費が掛かる。
        if (id === 'review') {
          const queue = sprint.tasks
            .filter((task) => task.lane === 'review')
            .slice(0, INTERRUPT_REVIEW_COUNT);
          for (const task of queue) reviewOne(task, sprint, org, rng, 0);
        }
        for (let tick = 0; !sprint.complete; tick += 1) stepSprint(sprint, org, rng, tick);
        return {
          choice: id,
          afterEvent,
          budget: BUDGET + budgetDelta,
          relic: grantRelic ?? null,
          reviewEfficiencyMul: sprint.cardEffects.reviewEfficiencyMul,
          delivered: sprint.metrics.delivered,
          done: sprint.metrics.doneCount,
          reviewQueueLeft: sprint.tasks.filter((task) => task.lane === 'review').length,
          rework: sprint.metrics.reworkCount,
          spread: sprint.metrics.spread,
          techDebt: org.techDebt,
          seniorHp: Number(org.seniorHp.toFixed(2)),
          morale: Number(org.morale.toFixed(2)),
        };
      }),
    })),
  };
}
