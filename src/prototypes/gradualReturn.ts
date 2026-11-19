/** RI-208: スプリント間回復で戻った1人の復帰プランを比較する試作。 */
import {
  applySprintGrowth,
  assignMember,
  createInitialRoster,
  recoverStamina,
  STAMINA_RECOVER_BETWEEN,
} from '../sim/member/roster';
import type { LaneAssignment, RosterState } from '../sim/member/types';
import { createOrgState } from '../sim/org';
import { createRng } from '../sim/rng';
import { runSprintSimulationFull } from '../sim/run/sprintBaseline';
import { buildSprintBaselineInput } from '../sim/run/sprintBaselineBuild';
import { resolveSprintConfig } from '../sim/sprint';

const GRADUAL_RETURN = { sprints: 2, contribution: 0.5, staminaDrain: 0.6 } as const;

type ReturnPlan = 'normal' | 'gradual';

interface FormationInput {
  assignment?: LaneAssignment;
  plan?: ReturnPlan;
}

interface SprintRecord {
  assignment: LaneAssignment;
  contributionMultiplier: number;
  drainMultiplier: number;
  codingSpeedMul: number;
  reviewEfficiencyMul: number;
  delivered: number;
  staminaAtStart: number;
  staminaAfterWork: number;
  staminaAfterRecovery: number;
  tookLeave: boolean;
}

interface ReturnTrial {
  seed: string;
  roster: RosterState;
  memberId: string;
  /** 最初に復帰したあとの編成でのみプランを選べる。 */
  returnSprint: number | null;
  /** 最終適用スプリント。終了後も選択記録として残す。 */
  gradualLastSprint: number | null;
  history: SprintRecord[];
}

export function createReturnTrial(seed: string): ReturnTrial {
  const base = createInitialRoster(createRng(`${seed}:roster`));
  const reviewer = base.members.find((member) => member.assignment === 'review')!;
  const substitute = base.members.find((member) => member.assignment === 'coding')!;
  const assigned = assignMember(base, substitute.id, 'review');
  return {
    seed,
    roster: {
      ...assigned,
      members: assigned.members.map((member) =>
        member.id === reviewer.id
          ? { ...member, assignment: 'bench', aiAssigned: false, stamina: 0, onLeave: true }
          : member,
      ),
    },
    memberId: reviewer.id,
    returnSprint: null,
    gradualLastSprint: null,
    history: [],
  };
}

export function advanceReturnTrial(state: ReturnTrial, input: FormationInput = {}): ReturnTrial {
  const sprint = state.history.length + 1;
  const roster =
    input.assignment === undefined
      ? state.roster
      : assignMember(state.roster, state.memberId, input.assignment);
  const person = roster.members.find((member) => member.id === state.memberId)!;
  const gradualLastSprint =
    input.plan === 'gradual' && sprint === state.returnSprint && !person.onLeave
      ? sprint + GRADUAL_RETURN.sprints - 1
      : state.gradualLastSprint;
  const restricted =
    gradualLastSprint !== null &&
    sprint <= gradualLastSprint &&
    !person.onLeave &&
    person.assignment !== 'bench';
  const contributionMultiplier = restricted ? GRADUAL_RETURN.contribution : 1;
  const drainMultiplier = restricted ? GRADUAL_RETURN.staminaDrain : 1;
  // 一時的な能力は編成の集約にだけ渡し、成長・回復には元のロスターを渡す。
  const boardRoster = restricted
    ? {
        ...roster,
        members: roster.members.map((member) =>
          member.id === state.memberId
            ? {
                ...member,
                stats: {
                  ...member.stats,
                  implementation: member.stats.implementation * contributionMultiplier,
                  review: member.stats.review * contributionMultiplier,
                },
              }
            : member,
        ),
      }
    : roster;
  const org = createOrgState('default', false);
  const baseline = buildSprintBaselineInput(
    {
      relics: [],
      evolution: { points: 0, unlocked: {} },
      difficulty: 'normal',
      trials: [],
      bossId: '',
      quarterNumber: 1,
      baseConfig: resolveSprintConfig('default', { maxTicks: 100 }),
    },
    {
      roster: boardRoster,
      org,
      kind: 'normal',
      modifiers: {},
      seed: `${state.seed}:sprint:${sprint}`,
    },
  );
  const { delivered, done } = runSprintSimulationFull(baseline);
  const growth = applySprintGrowth(
    roster,
    {
      delivered,
      done,
      staminaDrainMultipliers: restricted
        ? new Map([[state.memberId, drainMultiplier]])
        : undefined,
    },
    createRng(`${state.seed}:growth:${sprint}`),
  );
  const justLeft = new Set(growth.outcome.wentOnLeave.map(({ id }) => id));
  const recovered = recoverStamina(growth.roster, STAMINA_RECOVER_BETWEEN, justLeft);
  const afterWork = growth.roster.members.find((member) => member.id === state.memberId)!;
  const afterRecovery = recovered.members.find((member) => member.id === state.memberId)!;
  const returned = person.onLeave && !afterRecovery.onLeave;
  return {
    ...state,
    roster: recovered,
    returnSprint: state.returnSprint ?? (returned ? sprint + 1 : null),
    gradualLastSprint,
    history: [
      ...state.history,
      {
        assignment: person.assignment,
        contributionMultiplier,
        drainMultiplier,
        codingSpeedMul: baseline.cardEffects.codingSpeedMul,
        reviewEfficiencyMul: baseline.cardEffects.reviewEfficiencyMul,
        delivered,
        staminaAtStart: person.stamina,
        staminaAfterWork: afterWork.stamina,
        staminaAfterRecovery: afterRecovery.stamina,
        tookLeave: justLeft.has(state.memberId),
      },
    ],
  };
}

export function compareReturnPlans(seed: string, assignment: 'coding' | 'review') {
  const firstReturn = advanceReturnTrial(advanceReturnTrial(createReturnTrial(seed)));
  return (['normal', 'gradual'] as const).map((plan) => {
    let state = advanceReturnTrial(firstReturn, { plan, assignment });
    for (let next = 0; next < 3; next++) state = advanceReturnTrial(state);
    return { plan, history: state.history };
  });
}
