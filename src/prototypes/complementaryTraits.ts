/** RI-204: 二人の Coding → Review の組み合わせを比較する隔離試作。 */
import {
  applySprintGrowth,
  assignMember,
  createMember,
  foldFormationEffects,
} from '../sim/member/roster';
import type { RosterState } from '../sim/member/types';
import { IDENTITY_CARD_EFFECTS } from '../sim/model';
import { createOrgState } from '../sim/org';
import { createRng } from '../sim/rng';
import { createSprint, resolveSprintConfig, stepSprint } from '../sim/sprint';

const MAKER = 'maker';
const REVIEWER = 'reviewer';
const BASE_CONFIG = resolveSprintConfig('default', { taskCount: 16, codingSlots: 3, maxTicks: 55 });

type Layout = 'paired' | 'swapped';
type WorkMix = 0 | 2 | 4;

export function createComplementaryRoster(layout: Layout): RosterState {
  const maker = createMember(
    {
      id: MAKER,
      rank: 'middle',
      stats: { implementation: 52, review: 47, aiMastery: 44 },
      traits: ['megaPrMaker'],
      preferred: 'coding',
    },
    '作り手',
    MAKER,
  );
  const reviewer = createMember(
    {
      id: REVIEWER,
      rank: 'middle',
      stats: { implementation: 76, review: 52, aiMastery: 44 },
      traits: ['reviewDemon'],
      preferred: 'review',
    },
    '見直し役',
    REVIEWER,
  );
  const roster = { members: [{ ...maker, aiAssigned: false }, reviewer], nextId: 2 };
  return layout === 'paired'
    ? roster
    : assignMember(assignMember(roster, MAKER, 'review'), REVIEWER, 'coding');
}

function hasComplementaryHandoff(roster: RosterState): boolean {
  // 現行 sim はタスクの個人担当を追跡しない。担当が一意なレーン間だけを対象にする。
  const working = roster.members.filter(
    (member) => !member.onLeave && member.assignment !== 'bench',
  );
  const coder = working.find((member) => member.assignment === 'coding');
  const reviewer = working.find((member) => member.assignment === 'review');
  return (
    working.length === 2 &&
    coder?.traits.includes('megaPrMaker') === true &&
    reviewer?.traits.includes('reviewDemon') === true
  );
}

export function createComplementarySprint(
  roster: RosterState,
  seed: string,
  complexPerFour: WorkMix,
  bonusEnabled: boolean,
) {
  const org = createOrgState('default', false);
  const rng = createRng(seed);
  const formation = foldFormationEffects(roster);
  const cardEffects = { ...IDENTITY_CARD_EFFECTS, ...formation.effects };
  const sprint = createSprint(
    {
      ...BASE_CONFIG,
      codingSlots: Math.max(0, BASE_CONFIG.codingSlots + formation.codingSlotBonus),
      focusMax: BASE_CONFIG.focusMax + formation.focusBonus,
    },
    org,
    rng,
    cardEffects,
    formation.aiAdoptionShare,
    formation.aiMasteryNorm,
  );
  const hasBonus = bonusEnabled && hasComplementaryHandoff(roster);
  const affectedTaskIds: number[] = [];
  for (const task of sprint.tasks) {
    task.kind = task.id % 4 < complexPerFour ? 'complex' : 'normal';
    if (hasBonus && task.kind === 'complex') {
      // 無介入の試作内では split フラグを既存のタスク別手戻り補正にだけ使う。
      task.split = true;
      affectedTaskIds.push(task.id);
    }
  }
  return { org, rng, sprint, affectedTaskIds };
}

export function runComplementarySprint(
  roster: RosterState,
  seed: string,
  complexPerFour: WorkMix,
  bonusEnabled: boolean,
) {
  const { org, rng, sprint, affectedTaskIds } = createComplementarySprint(
    roster,
    seed,
    complexPerFour,
    bonusEnabled,
  );
  let ticks = 0;
  while (!sprint.complete) {
    stepSprint(sprint, org, rng, ticks);
    ticks += 1;
  }
  const {
    delivered,
    doneCount: done,
    reworkCount: rework,
    incidentCount: incidents,
  } = sprint.metrics;
  const growth = applySprintGrowth(roster, { delivered, done }, createRng(`${seed}:growth`));
  return {
    affectedTaskIds,
    ticks,
    delivered,
    done,
    rework,
    incidents,
    reviewQueueMax: sprint.metrics.reviewQueueMax,
    timedOut: sprint.metrics.timedOut === true,
    staminaRemaining: growth.roster.members.map(({ stamina }) => stamina),
  };
}
