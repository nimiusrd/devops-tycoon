/**
 * 危険状態の反実仮想評価（RI-101 / SPEC 第19.1 F-8・F-9）。
 *
 * 同一乱数状態から無介入と適用可能介入、および無介入ドライブ上で出会う
 * 戦略フェーズの代替肢を分岐し、敗北遅延・回避・危険域離脱・敗因変化だけを
 * 有効手として集計する。what-if の同 seed 再実行とは別系統。
 */
import { LEVER_DEFS } from '../../data/levers';
import { getCard } from '../../data/cards';
import { getEvent } from '../../data/events';
import { canApplyAction } from '../actions';
import { assignableTasks, splitPrCandidates } from '../assignTask';
import { playCost } from '../cards';
import { canRecruit, RECRUIT_COST, type LaneAssignment } from '../member';
import { isAwaitingMinCompleteTick } from '../sprint';
import type { ActionId, ActionTarget, SprintState } from '../types';
import { activeDangerReasons, listApplicableActions, type DangerLoseReason } from './dangerZone';
import { foldPassives } from './effects';
import { RunEngine, DRAFT_MULLIGAN_COST } from './engine';
import { unlockableNodes, unlockNode } from './evolution';
import type { CounterfactualFrame } from './persist';
import type { GoalAdjustmentId, LoseReason, RunStatus, RunState } from './types';

type RestChoice = 'heal' | 'repay' | 'upgrade' | 'recruit';

/** 無介入 1 + スプリント介入ブランチの上限。超過分は評価せず skipped に残す。 */
export const DEFAULT_MAX_ACTION_BRANCHES = 8;
/** 同一 tick の 2 手組合せブランチ上限。超過分および 3 手以上は sameTickCombo として skipped に残す。 */
export const DEFAULT_MAX_COMBO_BRANCHES = 8;
/** 戦略フェーズの代替肢ブランチ上限。スプリント介入とは別に数える。 */
export const DEFAULT_MAX_STRATEGIC_BRANCHES = 8;
/** フォーク後に進める追加スプリント数の既定。 */
export const DEFAULT_MAX_SPRINTS = 4;

const REST_ALTERNATIVES: readonly RestChoice[] = ['heal', 'repay'];
const RECRUIT_LANES: readonly LaneAssignment[] = ['coding', 'review', 'bench'];
const STRATEGIC_KIND_ORDER = [
  'beat',
  'rest',
  'shop',
  'draft',
  'setup',
  'evolution',
  'goal',
  'recruit',
] as const;
const SETUP_LANES: readonly LaneAssignment[] = ['coding', 'review', 'bench'];

export interface CounterfactualOrigin {
  sprintsPlayed: number;
  quarter: number;
  index: number;
}

export interface CounterfactualBranchResult {
  /**
   * `null` は無介入ベースライン。
   * スプリント介入は ActionId、戦略肢は `beat:1` / `rest:repay` / `draft:copilot` など。
   */
  actionId: string | null;
  sprintsToLose: number | null;
  leftDanger: boolean;
  loseReason: LoseReason | null;
  status: RunStatus;
  truncated: boolean;
}

export interface CounterfactualEvaluation {
  origin: CounterfactualOrigin;
  originDangers: DangerLoseReason[];
  applicableActions: ActionId[];
  skippedActions: string[];
  skippedStrategic: string[];
  baseline: CounterfactualBranchResult;
  branches: CounterfactualBranchResult[];
  /** 無介入ドライブが強制選択フェーズで実際に選んだ肢。 */
  idlePinnedIds?: string[];
}

export interface CounterfactualEvaluateOptions {
  maxSprints?: number;
  maxActionBranches?: number;
  /** 同一 tick で 2 手を続けて打つ組合せの上限。省略時は DEFAULT_MAX_COMBO_BRANCHES。 */
  maxComboBranches?: number;
  maxStrategicBranches?: number;
  /** 省略時はフレーム復元時点の機械的発動可能手。 */
  actions?: readonly ActionId[];
  /**
   * 戦略フェーズの代替肢を分岐するか。
   * `actions` を明示したときは既定 false、省略時は true。
   */
  includeStrategic?: boolean;
  /** 危険域離脱の判定対象。省略時は起源の危険理由のいずれかが消えたら離脱。 */
  focusReason?: DangerLoseReason;
}

export interface CounterfactualFrameSample {
  sprintsPlayed: number;
  quarter: number;
  index: number;
  /** その位置で最初に取ったフレーム。 */
  frame: CounterfactualFrame;
  /** 同一スプリント位置の追加フレーム（新しい順ではなく時系列）。 */
  frames?: CounterfactualFrame[];
}

interface SprintChoice {
  id: string;
  actionId: ActionId | null;
  target?: ActionTarget;
  cardIndex?: number;
  leverId?: string;
  deptId?: string;
  teamId?: string;
}

type ShopStep =
  | { mode: 'card'; defId: string }
  | { mode: 'relic' }
  | { mode: 'recruit'; assignment: LaneAssignment };

type StrategicOverride =
  | { kind: 'draft'; cardId: string; mulligan?: boolean }
  | { kind: 'evolution'; nodeIds: string[] }
  | { kind: 'beat'; index: number; assignment?: LaneAssignment }
  | { kind: 'rest'; option: RestChoice; deckIndex?: number; assignment?: LaneAssignment }
  | { kind: 'shop'; steps: ShopStep[] }
  | { kind: 'recruit'; assignment?: LaneAssignment; skip?: boolean }
  | { kind: 'goal'; id: GoalAdjustmentId }
  | {
      kind: 'setup';
      memberId?: string;
      assignment?: LaneAssignment;
      aiAssigned?: boolean;
      enterTeamId?: string;
      steps?: SetupChange[];
    };

type SetupChange = {
  memberId?: string;
  assignment?: LaneAssignment;
  aiAssigned?: boolean;
  enterTeamId?: string;
};

export interface StrategicChoice {
  id: string;
  kind: StrategicOverride['kind'];
  override: StrategicOverride;
  /** 無介入ドライブ上でこの種別のフェーズが何回目か（0始まり）。 */
  visit?: number;
  /** ビート選択が開く直後の shop / rest / recruit への後続 override。 */
  followup?: StrategicOverride;
}

export function restoreCounterfactualEngine(frame: CounterfactualFrame): RunEngine {
  const engine = new RunEngine({
    seed: frame.persist.seed,
    difficulty: frame.persist.difficulty,
    trials: frame.persist.trials,
  });
  engine.hydrateCounterfactualFrame(frame);
  return engine;
}

function applyChoice(engine: RunEngine, id: ActionId, target?: ActionTarget): void {
  const s = engine.snapshot();
  if (s.phase !== 'sprint' || !s.sprint) return;
  if (target) {
    engine.dispatch(id, target);
    return;
  }
  if (id === 'assignTask' && !canApplyAction('assignTask', s.sprint, s.org, s.sprintTick).ok) {
    const task = assignableTasks(s.sprint)[0];
    if (task) {
      engine.dispatch('assignTask', { taskId: task.id, lane: 'coding' });
    }
    return;
  }
  engine.dispatch(id);
}

function canPlayHandCard(sprint: SprintState, deck: RunState['deck'], deckIndex: number): boolean {
  if (sprint.complete || isAwaitingMinCompleteTick(sprint)) return false;
  if (!sprint.cardPiles.hand.includes(deckIndex)) return false;
  const inst = deck[deckIndex];
  if (!inst) return false;
  const def = getCard(inst.defId);
  if (!def) return false;
  return sprint.focus >= playCost(def.focusCost, inst.level);
}

function applySprintChoice(engine: RunEngine, choice: SprintChoice): void {
  if (choice.leverId) {
    engine.applyOrgLever(choice.leverId, choice.deptId, choice.teamId);
    return;
  }
  if (choice.cardIndex != null) {
    engine.playCard(choice.cardIndex);
    return;
  }
  if (choice.actionId) applyChoice(engine, choice.actionId, choice.target);
}

function listSprintChoices(engine: RunEngine): SprintChoice[] {
  const s = engine.snapshot();
  if (s.phase !== 'sprint' || !s.sprint) return [];
  const sprint = s.sprint;
  const out: SprintChoice[] = [];
  const targeted: SprintChoice[] = [];
  for (const id of listApplicableActions(engine)) {
    if (id === 'assignTask') {
      for (const task of assignableTasks(sprint)) {
        const lane = task.lane === 'backlog' ? ('coding' as const) : undefined;
        for (const assignee of ['ai', 'senior'] as const) {
          const target: ActionTarget = lane
            ? { taskId: task.id, lane, assignee }
            : { taskId: task.id, assignee };
          if (canApplyAction('assignTask', sprint, s.org, s.sprintTick, target).ok) {
            targeted.push({
              id: `assignTask:${task.id}:${assignee}`,
              actionId: 'assignTask',
              target,
            });
          }
        }
      }
      if (targeted.some((choice) => choice.actionId === 'assignTask')) continue;
    }
    if (id === 'splitPr') {
      for (const task of splitPrCandidates(sprint)) {
        const target: ActionTarget = { taskId: task.id };
        if (canApplyAction('splitPr', sprint, s.org, s.sprintTick, target).ok) {
          targeted.push({ id: `splitPr:${task.id}`, actionId: 'splitPr', target });
        }
      }
      if (targeted.some((choice) => choice.actionId === 'splitPr')) continue;
    }
    out.push({ id, actionId: id });
  }
  for (const deckIndex of sprint.cardPiles.hand) {
    if (!canPlayHandCard(sprint, s.deck, deckIndex)) continue;
    const defId = s.deck[deckIndex]?.defId ?? String(deckIndex);
    out.push({ id: `card:${defId}:${deckIndex}`, actionId: null, cardIndex: deckIndex });
  }
  out.push(...listOrgLeverChoices(engine));
  out.push(...targeted);
  return out;
}

function operableTeamsForLevers(s: RunState): RunState['teams'] {
  const locked = s.sprintsPlayed < s.teamLockUntilSprint;
  const preferred = [s.activeTeamId, s.zoom.teamId].filter((id): id is string => !!id);
  return s.teams
    .filter((team) => !locked || team.id === s.activeTeamId)
    .slice()
    .sort((a, b) => {
      const ap = preferred.indexOf(a.id);
      const bp = preferred.indexOf(b.id);
      const aRank = ap === -1 ? preferred.length : ap;
      const bRank = bp === -1 ? preferred.length : bp;
      if (aRank !== bRank) return aRank - bRank;
      return b.reviewQueue - a.reviewQueue || a.id.localeCompare(b.id);
    });
}

function listOrgLeverChoices(engine: RunEngine): SprintChoice[] {
  const s = engine.snapshot();
  if (s.phase !== 'sprint' || !s.sprint || isAwaitingMinCompleteTick(s.sprint)) return [];
  const out: SprintChoice[] = [];
  const depts = [...new Set(s.teams.map((team) => team.deptId).filter(Boolean))];
  const teams = operableTeamsForLevers(s);
  for (const def of LEVER_DEFS) {
    if (s.budget < def.cost) continue;
    if (def.scope === 'company') {
      out.push({ id: `lever:${def.id}`, actionId: null, leverId: def.id });
      continue;
    }
    if (def.scope === 'department') {
      for (const deptId of depts) {
        out.push({
          id: `lever:${def.id}:${deptId}`,
          actionId: null,
          leverId: def.id,
          deptId,
        });
      }
      continue;
    }
    for (const team of teams) {
      out.push({
        id: `lever:${def.id}:${team.id}`,
        actionId: null,
        leverId: def.id,
        teamId: team.id,
      });
    }
  }
  return out;
}

/** 起源の危険理由が現在の危険域から消えたか。focus があればその敗因だけを見る。 */
export function isDangerLeft(
  origin: ReadonlySet<DangerLoseReason>,
  current: readonly DangerLoseReason[],
  focusReason?: DangerLoseReason,
): boolean {
  if (origin.size === 0) return false;
  if (focusReason) return origin.has(focusReason) && !current.includes(focusReason);
  return [...origin].some((reason) => !current.includes(reason));
}

function originDangersLeft(
  origin: ReadonlySet<DangerLoseReason>,
  engine: RunEngine,
  focusReason?: DangerLoseReason,
): boolean {
  return isDangerLeft(origin, activeDangerReasons(engine), focusReason);
}

function playTargetCardIfAble(engine: RunEngine, deckIndex: number): void {
  const snap = engine.snapshot();
  if (snap.phase !== 'sprint' || !snap.sprint || snap.status !== 'playing') return;
  if (!canPlayHandCard(snap.sprint, snap.deck, deckIndex)) return;
  engine.playCard(deckIndex);
}

function memberIdsOf(snapshot: RunState): Set<string> {
  return new Set(snapshot.roster.members.map((member) => member.id));
}

function assignHiredMember(
  engine: RunEngine,
  beforeIds: ReadonlySet<string>,
  assignment: LaneAssignment,
): void {
  const hired = engine.snapshot().roster.members.find((member) => !beforeIds.has(member.id));
  if (hired) engine.assignMember(hired.id, assignment);
}

function visitKey(kind: string, snapshot: RunState): string {
  return `visit:${kind}:${snapshot.sprintsPlayed}:${snapshot.quarterNumber}:${snapshot.sprintIndexInQuarter}`;
}

function beginVisit(seen: Set<string>, kind: string, snapshot: RunState): number | null {
  const key = visitKey(kind, snapshot);
  if (seen.has(key)) return null;
  const nth = [...seen].filter((item) => item.startsWith(`visit:${kind}:`)).length;
  seen.add(key);
  return nth;
}

function withVisit(choices: StrategicChoice[], nth: number): StrategicChoice[] {
  return choices.map((choice) => ({
    ...choice,
    id: nth === 0 ? choice.id : `${choice.id}@${nth}`,
    visit: nth,
  }));
}

function phaseMatchesOverride(snapshot: RunState, override: StrategicOverride): boolean {
  if (override.kind === 'beat') {
    return snapshot.phase === 'beat' && snapshot.beat?.kind === 'decision';
  }
  if (override.kind === 'goal') return snapshot.phase === 'quarterReview';
  return snapshot.phase === override.kind;
}

function applyIdleStep(
  engine: RunEngine,
  snapshot: RunState,
  playAcquiredCards: readonly number[] = [],
): boolean {
  switch (snapshot.phase) {
    case 'setup':
      engine.beginSetupSprint();
      return true;
    case 'sprint': {
      for (const deckIndex of playAcquiredCards) playTargetCardIfAble(engine, deckIndex);
      const snap = engine.snapshot();
      if (snap.phase === 'sprint' && snap.status === 'playing') {
        engine.step(1_000_000);
      }
      return true;
    }
    case 'result':
      engine.acknowledgeResult();
      return true;
    case 'draft':
      engine.skipDraft();
      return true;
    case 'evolution':
      engine.finishEvolution();
      return true;
    case 'beat':
      if (snapshot.beat?.kind === 'decision') {
        const n = getEvent(snapshot.beat.eventId)?.choices.length ?? 1;
        engine.resolveBeat(Math.max(0, n - 1));
      } else {
        engine.resolveBeat(0);
      }
      return true;
    case 'shop':
      engine.leaveShop();
      return true;
    case 'rest':
      engine.restChoose('repay');
      return true;
    case 'recruit':
      engine.recruitChoose('skip');
      return true;
    case 'quarterReview': {
      const review = snapshot.quarterReview;
      if (review?.outcome === 'missed_adjustable') {
        const pick =
          review.availableAdjustments[review.availableAdjustments.length - 1] ?? 'cut_scope';
        engine.chooseGoalAdjustment(pick);
      } else {
        engine.acknowledgeQuarterReview();
      }
      return true;
    }
    default:
      return false;
  }
}

function setupChangeOf(override: StrategicOverride): SetupChange {
  if (override.kind !== 'setup') return {};
  return override;
}

function applySetupChanges(engine: RunEngine, change: SetupChange): void {
  if (change.enterTeamId) engine.enterTeam(change.enterTeamId);
  if (change.memberId) {
    if (change.assignment) engine.assignMember(change.memberId, change.assignment);
    if (change.aiAssigned !== undefined) engine.setMemberAi(change.memberId, change.aiAssigned);
  }
}

function idlePinnedId(snapshot: RunState): string | null {
  if (snapshot.phase === 'beat' && snapshot.beat?.kind === 'decision') {
    const n = getEvent(snapshot.beat.eventId)?.choices.length ?? 1;
    return `beat:${snapshot.beat.eventId}:${Math.max(0, n - 1)}`;
  }
  if (snapshot.phase === 'rest') return 'rest:repay';
  if (snapshot.phase === 'quarterReview') {
    const review = snapshot.quarterReview;
    if (review?.outcome !== 'missed_adjustable') return null;
    const pick = review.availableAdjustments[review.availableAdjustments.length - 1] ?? 'cut_scope';
    return `goal:${pick}`;
  }
  if (snapshot.phase === 'recruit') return 'recruit:skip';
  return null;
}

function recordAcquiredCards(
  engine: RunEngine,
  before: RunState,
  override: StrategicOverride,
  playAcquiredCards: number[],
): void {
  const deckAfter = engine.snapshot().deck.length;
  if (
    (override.kind === 'draft' ||
      override.kind === 'beat' ||
      (override.kind === 'shop' && override.steps.some((step) => step.mode === 'card'))) &&
    deckAfter > before.deck.length
  ) {
    for (let i = before.deck.length; i < deckAfter; i += 1) playAcquiredCards.push(i);
  }
}

function applyStrategicOverride(
  engine: RunEngine,
  snapshot: RunState,
  override: StrategicOverride,
): boolean {
  switch (override.kind) {
    case 'draft':
      if (snapshot.phase !== 'draft') return false;
      if (override.mulligan) engine.mulliganDraft();
      engine.chooseCard(override.cardId);
      return true;
    case 'evolution':
      if (snapshot.phase !== 'evolution') return false;
      for (const nodeId of override.nodeIds) engine.unlockEvolution(nodeId);
      engine.finishEvolution();
      return true;
    case 'beat':
      if (snapshot.phase !== 'beat' || snapshot.beat?.kind !== 'decision') return false;
      {
        const beforeIds = memberIdsOf(snapshot);
        engine.resolveBeat(override.index);
        if (override.assignment) assignHiredMember(engine, beforeIds, override.assignment);
      }
      return true;
    case 'rest':
      if (snapshot.phase !== 'rest') return false;
      {
        const beforeIds = memberIdsOf(snapshot);
        engine.restChoose(override.option, override.deckIndex);
        if (override.option === 'recruit' && override.assignment) {
          assignHiredMember(engine, beforeIds, override.assignment);
        }
      }
      return true;
    case 'shop':
      if (snapshot.phase !== 'shop') return false;
      {
        const beforeIds = memberIdsOf(snapshot);
        for (const step of override.steps) {
          if (step.mode === 'card') engine.buyShopCard(step.defId);
          else if (step.mode === 'relic') engine.buyShopRelic();
          else {
            engine.buyShopRecruit();
            assignHiredMember(engine, beforeIds, step.assignment);
          }
        }
      }
      engine.leaveShop();
      return true;
    case 'recruit':
      if (snapshot.phase !== 'recruit') return false;
      if (override.skip) {
        engine.recruitChoose('skip');
        return true;
      }
      if (!override.assignment) return false;
      {
        const beforeIds = memberIdsOf(snapshot);
        engine.recruitChoose('hire');
        assignHiredMember(engine, beforeIds, override.assignment);
      }
      return true;
    case 'goal':
      if (snapshot.phase !== 'quarterReview') return false;
      engine.chooseGoalAdjustment(override.id);
      return true;
    case 'setup':
      if (snapshot.phase !== 'setup') return false;
      {
        const changes = override.steps ?? [override];
        for (const change of changes) applySetupChanges(engine, change);
      }
      engine.beginSetupSprint();
      return true;
  }
}

function listSetupChoices(snapshot: RunState): StrategicChoice[] {
  const out: StrategicChoice[] = [];
  for (const member of snapshot.roster.members) {
    if (member.onLeave) continue;
    for (const assignment of SETUP_LANES) {
      if (assignment === member.assignment) continue;
      out.push({
        id: `setup:assign:${member.id}:${assignment}`,
        kind: 'setup',
        override: { kind: 'setup', memberId: member.id, assignment },
      });
    }
    if (member.assignment === 'coding') {
      out.push({
        id: `setup:ai:${member.id}:${member.aiAssigned ? 'off' : 'on'}`,
        kind: 'setup',
        override: { kind: 'setup', memberId: member.id, aiAssigned: !member.aiAssigned },
      });
    }
  }
  if (snapshot.sprintsPlayed >= snapshot.teamLockUntilSprint) {
    for (const team of operableTeamsForLevers(snapshot)) {
      if (team.id === snapshot.activeTeamId) continue;
      out.push({
        id: `setup:enter:${team.id}`,
        kind: 'setup',
        override: { kind: 'setup', enterTeamId: team.id },
      });
    }
  }
  return out;
}

function canMulliganDraft(snapshot: RunState): boolean {
  return (
    snapshot.phase === 'draft' &&
    !snapshot.draftMulliganUsed &&
    snapshot.budget > DRAFT_MULLIGAN_COST &&
    (snapshot.draft?.length ?? 0) > 0
  );
}

function shopStepId(step: ShopStep, relicId?: string): string {
  if (step.mode === 'card') return `card:${step.defId}`;
  if (step.mode === 'relic') return relicId ? `relic:${relicId}` : 'relic';
  return `recruit:${step.assignment}`;
}

function listShopChoices(snapshot: RunState): StrategicChoice[] {
  const shop = snapshot.shop;
  if (!shop) return [];
  type Node = {
    budget: number;
    bought: Set<string>;
    relicBought: boolean;
    recruitBought: boolean;
    path: ShopStep[];
  };
  const out: StrategicChoice[] = [];
  const seenSeqs = new Set<string>();
  const queue: Node[] = [
    {
      budget: snapshot.budget,
      bought: new Set(),
      relicBought: false,
      recruitBought: false,
      path: [],
    },
  ];
  const canHire = canRecruit(snapshot.roster);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const options: ShopStep[] = [];
    for (const card of shop.cards) {
      if (card.bought || cur.bought.has(card.defId) || cur.budget < card.cost) continue;
      options.push({ mode: 'card', defId: card.defId });
    }
    if (shop.relic && !shop.relic.bought && !cur.relicBought && cur.budget >= shop.relic.cost) {
      const slots = foldPassives(snapshot.relics).relicSlots;
      if (!snapshot.relics.includes(shop.relic.id) && snapshot.relics.length < slots) {
        options.push({ mode: 'relic' });
      }
    }
    if (
      shop.recruit &&
      !shop.recruit.bought &&
      !cur.recruitBought &&
      canHire &&
      cur.budget >= shop.recruit.cost
    ) {
      for (const assignment of RECRUIT_LANES) {
        options.push({ mode: 'recruit', assignment });
      }
    }
    for (const step of options) {
      const path = [...cur.path, step];
      const seqKey = path.map((item) => shopStepId(item, shop.relic?.id)).join('+');
      if (seenSeqs.has(seqKey)) continue;
      seenSeqs.add(seqKey);
      out.push({
        id: `shop:${seqKey}`,
        kind: 'shop',
        override: { kind: 'shop', steps: path },
      });
      const next: Node = {
        budget: cur.budget,
        bought: new Set(cur.bought),
        relicBought: cur.relicBought,
        recruitBought: cur.recruitBought,
        path,
      };
      if (step.mode === 'card') {
        const card = shop.cards.find((item) => item.defId === step.defId);
        if (!card) continue;
        next.budget -= card.cost;
        next.bought.add(step.defId);
      } else if (step.mode === 'relic' && shop.relic) {
        next.budget -= shop.relic.cost;
        next.relicBought = true;
      } else if (step.mode === 'recruit' && shop.recruit) {
        next.budget -= shop.recruit.cost;
        next.recruitBought = true;
      }
      queue.push(next);
    }
  }
  return out;
}

function collectDraftMulligan(engine: RunEngine): StrategicChoice[] {
  const snapshot = engine.snapshot();
  if (!canMulliganDraft(snapshot)) return [];
  const frame = engine.exportCounterfactualFrame();
  if (!frame) return [];
  const fork = restoreCounterfactualEngine(frame);
  fork.mulliganDraft();
  const next = fork.snapshot().draft ?? [];
  return next.map((cardId) => ({
    id: `draft:mulligan:${cardId}`,
    kind: 'draft' as const,
    override: { kind: 'draft' as const, cardId, mulligan: true },
  }));
}

/** 同一進化フェーズで連続解放できる到達集合。順序は解放可能なトポロジ順。 */
function listEvolutionChoices(evolution: RunState['evolution']): StrategicChoice[] {
  const out: StrategicChoice[] = [];
  const seenSets = new Set<string>();
  const queue: { evo: RunState['evolution']; path: string[] }[] = [{ evo: evolution, path: [] }];
  while (queue.length > 0) {
    const { evo, path } = queue.shift()!;
    for (const id of unlockableNodes(evo)) {
      const nextPath = [...path, id];
      const setKey = [...nextPath].sort().join('\0');
      if (seenSets.has(setKey)) continue;
      seenSets.add(setKey);
      out.push({
        id: `evo:${nextPath.join('+')}`,
        kind: 'evolution',
        override: { kind: 'evolution', nodeIds: nextPath },
      });
      queue.push({ evo: unlockNode(evo, id), path: nextPath });
    }
  }
  return out;
}

function collectStrategicAt(
  engine: RunEngine,
  snapshot: RunState,
  seen: Set<string>,
): StrategicChoice[] {
  if (snapshot.phase === 'draft' && snapshot.draft && snapshot.draft.length > 0) {
    const nth = beginVisit(seen, 'draft', snapshot);
    if (nth == null) return [];
    const out: StrategicChoice[] = snapshot.draft.map((cardId) => ({
      id: `draft:${cardId}`,
      kind: 'draft' as const,
      override: { kind: 'draft' as const, cardId },
    }));
    if (canMulliganDraft(snapshot)) out.push(...collectDraftMulligan(engine));
    return withVisit(out, nth);
  }
  if (snapshot.phase === 'evolution') {
    const nth = beginVisit(seen, 'evolution', snapshot);
    if (nth == null) return [];
    return withVisit(listEvolutionChoices(snapshot.evolution), nth);
  }
  if (snapshot.phase === 'beat' && snapshot.beat?.kind === 'decision') {
    const nth = beginVisit(seen, 'beat', snapshot);
    if (nth == null) return [];
    const eventId = snapshot.beat.eventId;
    const event = getEvent(eventId);
    const n = event?.choices.length ?? 0;
    const out: StrategicChoice[] = [];
    for (let index = 0; index < n; index += 1) {
      if (event?.choices[index]?.outcome.grantRecruit) {
        if (canRecruit(snapshot.roster) && snapshot.budget >= RECRUIT_COST) {
          for (const assignment of RECRUIT_LANES) {
            out.push({
              id: `beat:${eventId}:${index}:${assignment}`,
              kind: 'beat',
              override: { kind: 'beat', index, assignment },
            });
          }
        } else {
          out.push({
            id: `beat:${eventId}:${index}`,
            kind: 'beat',
            override: { kind: 'beat', index },
          });
        }
      } else {
        out.push({
          id: `beat:${eventId}:${index}`,
          kind: 'beat',
          override: { kind: 'beat', index },
        });
      }
    }
    const visited = withVisit(out, nth);
    const combined: StrategicChoice[] = [];
    for (const choice of visited) {
      if (choice.override.kind !== 'beat') continue;
      const leadsTo = event?.choices[choice.override.index]?.leadsTo;
      if (leadsTo !== 'shop' && leadsTo !== 'rest' && leadsTo !== 'recruit') continue;
      combined.push(...collectFollowupChoices(engine, snapshot, choice));
    }
    return [...visited, ...combined];
  }
  if (snapshot.phase === 'rest') {
    const nth = beginVisit(seen, 'rest', snapshot);
    if (nth == null) return [];
    const out: StrategicChoice[] = REST_ALTERNATIVES.map((option) => ({
      id: `rest:${option}`,
      kind: 'rest' as const,
      override: { kind: 'rest' as const, option },
    }));
    if (canRecruit(snapshot.roster) && snapshot.budget >= RECRUIT_COST) {
      for (const assignment of RECRUIT_LANES) {
        out.push({
          id: `rest:recruit:${assignment}`,
          kind: 'rest',
          override: { kind: 'rest', option: 'recruit', assignment },
        });
      }
    }
    for (let deckIndex = 0; deckIndex < snapshot.deck.length; deckIndex += 1) {
      const defId = snapshot.deck[deckIndex]?.defId ?? String(deckIndex);
      out.push({
        id: `rest:upgrade:${defId}:${deckIndex}`,
        kind: 'rest',
        override: { kind: 'rest', option: 'upgrade', deckIndex },
      });
    }
    return withVisit(out, nth);
  }
  if (snapshot.phase === 'shop' && snapshot.shop) {
    const nth = beginVisit(seen, 'shop', snapshot);
    if (nth == null) return [];
    return withVisit(listShopChoices(snapshot), nth);
  }
  if (snapshot.phase === 'recruit') {
    const nth = beginVisit(seen, 'recruit', snapshot);
    if (nth == null) return [];
    const out: StrategicChoice[] = [
      {
        id: 'recruit:skip',
        kind: 'recruit',
        override: { kind: 'recruit', skip: true },
      },
      ...RECRUIT_LANES.map((assignment) => ({
        id: `recruit:hire:${assignment}`,
        kind: 'recruit' as const,
        override: { kind: 'recruit' as const, assignment },
      })),
    ];
    return withVisit(out, nth);
  }
  if (snapshot.phase === 'quarterReview') {
    const nth = beginVisit(seen, 'goal', snapshot);
    if (nth == null) return [];
    const review = snapshot.quarterReview;
    if (review?.outcome !== 'missed_adjustable') return [];
    return withVisit(
      review.availableAdjustments.map((id) => ({
        id: `goal:${id}`,
        kind: 'goal' as const,
        override: { kind: 'goal' as const, id },
      })),
      nth,
    );
  }
  if (snapshot.phase === 'setup') {
    const nth = beginVisit(seen, 'setup', snapshot);
    if (nth == null) return [];
    return collectSetupSequences(engine, snapshot, nth);
  }
  return [];
}

const SETUP_SEQUENCE_CAP = 16;

function collectSetupSequences(
  engine: RunEngine,
  snapshot: RunState,
  nth: number,
): StrategicChoice[] {
  const firsts = withVisit(listSetupChoices(snapshot), nth);
  const out: StrategicChoice[] = [...firsts];
  let extra = 0;
  let truncated = false;
  let longerRemains = false;
  for (const first of firsts) {
    const frame = engine.exportCounterfactualFrame();
    if (!frame) continue;
    const fork = restoreCounterfactualEngine(frame);
    applySetupChanges(fork, setupChangeOf(first.override));
    if (fork.snapshot().phase !== 'setup') continue;
    const seconds = withVisit(listSetupChoices(fork.snapshot()), nth);
    for (const second of seconds) {
      if (extra >= SETUP_SEQUENCE_CAP) {
        truncated = true;
        break;
      }
      extra += 1;
      out.push({
        id: `${first.id}+${second.id}`,
        kind: 'setup',
        override: {
          kind: 'setup',
          steps: [setupChangeOf(first.override), setupChangeOf(second.override)],
        },
        visit: first.visit,
      });
      if (!longerRemains) {
        const probe = restoreCounterfactualEngine(frame);
        applySetupChanges(probe, setupChangeOf(first.override));
        applySetupChanges(probe, setupChangeOf(second.override));
        if (probe.snapshot().phase === 'setup' && listSetupChoices(probe.snapshot()).length > 0) {
          longerRemains = true;
        }
      }
    }
    if (truncated) break;
  }
  if (truncated || longerRemains) {
    out.push({
      id: nth === 0 ? 'setup:combo' : `setup:combo@${nth}`,
      kind: 'setup',
      override: { kind: 'setup' },
      visit: nth,
    });
  }
  return out;
}

function collectFollowupChoices(
  engine: RunEngine,
  snapshot: RunState,
  primary: StrategicChoice,
): StrategicChoice[] {
  const frame = engine.exportCounterfactualFrame();
  if (!frame) return [];
  const fork = restoreCounterfactualEngine(frame);
  if (!applyStrategicOverride(fork, snapshot, primary.override)) return [];
  const next = fork.snapshot();
  if (next.status !== 'playing') return [];
  if (next.phase === snapshot.phase) return [];
  return collectStrategicAt(fork, next, new Set()).map((follow) => ({
    id: `${primary.id}+${follow.id}`,
    kind: primary.kind,
    override: primary.override,
    visit: primary.visit,
    followup: follow.override,
  }));
}

/**
 * 無介入ドライブ上で出会う各戦略フェーズの代替肢。
 * ネストした全組合せは作らず、同一種別でも出現位置ごとに独立分岐する。
 */
export function listStrategicChoices(
  frame: CounterfactualFrame,
  maxSprints: number,
): StrategicChoice[] {
  const engine = restoreCounterfactualEngine(frame);
  const startPlayed = engine.snapshot().sprintsPlayed;
  const seen = new Set<string>();
  const found: StrategicChoice[] = [];
  let guard = 0;
  while (engine.snapshot().status === 'playing' && guard < 4_000) {
    guard += 1;
    const snapshot = engine.snapshot();
    if (snapshot.phase === 'setup' && snapshot.sprintsPlayed - startPlayed >= maxSprints) break;
    found.push(...collectStrategicAt(engine, snapshot, seen));
    if (!applyIdleStep(engine, snapshot)) break;
  }
  const rank = new Map(STRATEGIC_KIND_ORDER.map((kind, i) => [kind, i]));
  return found.sort(
    (a, b) => (rank.get(a.kind) ?? 99) - (rank.get(b.kind) ?? 99) || a.id.localeCompare(b.id),
  );
}

function drive(
  engine: RunEngine,
  originDangers: ReadonlySet<DangerLoseReason>,
  maxSprints: number,
  focusReason?: DangerLoseReason,
  override?: StrategicOverride,
  overrideVisit = 0,
  followup?: StrategicOverride,
  pinnedIds?: string[],
): Omit<CounterfactualBranchResult, 'actionId'> {
  const startPlayed = engine.snapshot().sprintsPlayed;
  let leftDanger = originDangersLeft(originDangers, engine, focusReason);
  let applied = override == null;
  let followApplied = followup == null;
  const playAcquiredCards: number[] = [];
  let kindHits = 0;
  const pinnedVisits = new Map<string, number>();
  let guard = 0;
  while (engine.snapshot().status === 'playing' && guard < 4_000) {
    guard += 1;
    const s = engine.snapshot();
    // 追加スプリントを始める直前だけ打ち切る。最後に許可したスプリントの
    // result / beat / quarterReview など終端遷移は処理する。
    if (s.phase === 'setup' && s.sprintsPlayed - startPlayed >= maxSprints) {
      if (originDangersLeft(originDangers, engine, focusReason)) leftDanger = true;
      return {
        sprintsToLose: null,
        leftDanger,
        loseReason: null,
        status: s.status,
        truncated: true,
      };
    }
    if (originDangersLeft(originDangers, engine, focusReason)) leftDanger = true;
    if (!applied && override && phaseMatchesOverride(s, override)) {
      if (kindHits === overrideVisit && applyStrategicOverride(engine, s, override)) {
        applied = true;
        recordAcquiredCards(engine, s, override, playAcquiredCards);
        continue;
      }
      kindHits += 1;
    }
    if (applied && !followApplied && followup && phaseMatchesOverride(s, followup)) {
      if (applyStrategicOverride(engine, s, followup)) {
        followApplied = true;
        recordAcquiredCards(engine, s, followup, playAcquiredCards);
        continue;
      }
    }
    if (pinnedIds) {
      const pinned = idlePinnedId(s);
      if (pinned) {
        const kind = pinned.slice(0, pinned.indexOf(':'));
        const n = pinnedVisits.get(kind) ?? 0;
        pinnedVisits.set(kind, n + 1);
        pinnedIds.push(n === 0 ? pinned : `${pinned}@${n}`);
      }
    }
    if (!applyIdleStep(engine, s, playAcquiredCards)) {
      return {
        sprintsToLose: null,
        leftDanger,
        loseReason: engine.snapshot().loseReason ?? null,
        status: engine.snapshot().status,
        truncated: true,
      };
    }
  }
  const end = engine.snapshot();
  if (originDangersLeft(originDangers, engine, focusReason)) leftDanger = true;
  return {
    sprintsToLose: end.status === 'lost' ? end.sprintsPlayed - startPlayed : null,
    leftDanger,
    loseReason: end.loseReason ?? null,
    status: end.status,
    truncated: end.status === 'playing',
  };
}

function runIdleBranch(
  frame: CounterfactualFrame,
  originDangers: ReadonlySet<DangerLoseReason>,
  maxSprints: number,
  focusReason?: DangerLoseReason,
): { branch: CounterfactualBranchResult; idlePinnedIds: string[] } {
  const engine = restoreCounterfactualEngine(frame);
  const idlePinnedIds: string[] = [];
  return {
    branch: {
      actionId: null,
      ...drive(
        engine,
        originDangers,
        maxSprints,
        focusReason,
        undefined,
        0,
        undefined,
        idlePinnedIds,
      ),
    },
    idlePinnedIds,
  };
}

function runActionBranch(
  frame: CounterfactualFrame,
  choice: SprintChoice,
  originDangers: ReadonlySet<DangerLoseReason>,
  maxSprints: number,
  focusReason?: DangerLoseReason,
): CounterfactualBranchResult {
  return runActionSequence(frame, [choice], originDangers, maxSprints, focusReason);
}

function runActionSequence(
  frame: CounterfactualFrame,
  choices: readonly SprintChoice[],
  originDangers: ReadonlySet<DangerLoseReason>,
  maxSprints: number,
  focusReason?: DangerLoseReason,
): CounterfactualBranchResult {
  const engine = restoreCounterfactualEngine(frame);
  for (const choice of choices) applySprintChoice(engine, choice);
  return {
    actionId: choices.map((choice) => choice.id).join('+'),
    ...drive(engine, originDangers, maxSprints, focusReason),
  };
}

function remainingSprintChoicesAfter(
  frame: CounterfactualFrame,
  applied: readonly SprintChoice[],
): SprintChoice[] {
  const engine = restoreCounterfactualEngine(frame);
  for (const choice of applied) applySprintChoice(engine, choice);
  const s = engine.snapshot();
  if (s.phase !== 'sprint' || s.status !== 'playing' || !s.sprint || s.sprint.complete) return [];
  return listSprintChoices(engine);
}

function listSameTickFollowups(frame: CounterfactualFrame, first: SprintChoice): SprintChoice[] {
  return remainingSprintChoicesAfter(frame, [first]).filter(
    (choice) => choice.leverId != null || choice.id !== first.id,
  );
}

function runStrategicBranch(
  frame: CounterfactualFrame,
  choice: StrategicChoice,
  originDangers: ReadonlySet<DangerLoseReason>,
  maxSprints: number,
  focusReason?: DangerLoseReason,
): CounterfactualBranchResult {
  const engine = restoreCounterfactualEngine(frame);
  return {
    actionId: choice.id,
    ...drive(
      engine,
      originDangers,
      maxSprints,
      focusReason,
      choice.override,
      choice.visit ?? 0,
      choice.followup,
    ),
  };
}

/** 複数 kind や同種の複数 visit は組合せを評価しないので未評価印の対象。 */
function hasUnevaluatedStrategicSequence(choices: readonly StrategicChoice[]): boolean {
  const runnable = choices.filter((choice) => !choice.id.startsWith('setup:combo'));
  const kinds = new Set(runnable.map((choice) => choice.kind));
  return kinds.size >= 2 || runnable.some((choice) => (choice.visit ?? 0) >= 1);
}

export function evaluateCounterfactual(
  frame: CounterfactualFrame,
  options: CounterfactualEvaluateOptions = {},
): CounterfactualEvaluation {
  const maxSprints = options.maxSprints ?? DEFAULT_MAX_SPRINTS;
  const maxActionBranches = options.maxActionBranches ?? DEFAULT_MAX_ACTION_BRANCHES;
  const maxComboBranches = options.maxComboBranches ?? DEFAULT_MAX_COMBO_BRANCHES;
  const maxStrategicBranches = options.maxStrategicBranches ?? DEFAULT_MAX_STRATEGIC_BRANCHES;
  const includeStrategic = options.includeStrategic ?? options.actions === undefined;
  const probe = restoreCounterfactualEngine(frame);
  const snap = probe.snapshot();
  const origin: CounterfactualOrigin = {
    sprintsPlayed: snap.sprintsPlayed,
    quarter: snap.quarterNumber,
    index: snap.sprintIndexInQuarter,
  };
  const dangers = activeDangerReasons(probe);
  const originDangers = new Set(dangers);
  const applicable = [...(options.actions ?? listApplicableActions(probe))];
  const sprintChoices: SprintChoice[] = options.actions
    ? options.actions.map((id) => ({ id, actionId: id }))
    : listSprintChoices(probe);
  const toEval = sprintChoices.slice(0, maxActionBranches);
  const skippedActions = sprintChoices.slice(maxActionBranches).map((choice) => choice.id);
  const idle = runIdleBranch(frame, originDangers, maxSprints, options.focusReason);
  const baseline = idle.branch;
  const branches = toEval.map((choice) =>
    runActionBranch(frame, choice, originDangers, maxSprints, options.focusReason),
  );
  const sameTickCombos: SprintChoice[][] = [];
  if (options.actions === undefined) {
    let comboBudget = maxComboBranches;
    let comboSkipped = false;
    let longerComboRemains = false;
    for (const first of toEval) {
      const followups = listSameTickFollowups(frame, first);
      for (const second of followups) {
        if (comboBudget <= 0) {
          comboSkipped = true;
          break;
        }
        comboBudget -= 1;
        sameTickCombos.push([first, second]);
        branches.push(
          runActionSequence(frame, [first, second], originDangers, maxSprints, options.focusReason),
        );
        if (!longerComboRemains && remainingSprintChoicesAfter(frame, [first, second]).length > 0) {
          longerComboRemains = true;
        }
      }
      if (comboSkipped) break;
    }
    if (comboSkipped || longerComboRemains) skippedActions.push('sameTickCombo');
  }
  let skippedStrategic: string[] = [];
  if (includeStrategic) {
    const strategic = listStrategicChoices(frame, maxSprints);
    const runnable = strategic.filter((choice) => !choice.id.startsWith('setup:combo'));
    const toStrategic = runnable.slice(0, maxStrategicBranches);
    skippedStrategic = [
      ...runnable.slice(maxStrategicBranches).map((choice) => choice.id),
      ...strategic
        .filter((choice) => choice.id.startsWith('setup:combo'))
        .map((choice) => choice.id),
    ];
    for (const choice of toStrategic) {
      branches.push(
        runStrategicBranch(frame, choice, originDangers, maxSprints, options.focusReason),
      );
    }
    if (hasUnevaluatedStrategicSequence(runnable)) skippedStrategic.push('strategicSequence');
    if (options.actions === undefined && toEval.length > 0 && strategic.length > 0) {
      let crossBudget = maxComboBranches;
      let crossSkipped = false;
      let laterSequenceUnevaluated = false;
      for (const first of toEval) {
        if (crossBudget <= 0) {
          crossSkipped = true;
          break;
        }
        const engine = restoreCounterfactualEngine(frame);
        applySprintChoice(engine, first);
        const after = engine.exportCounterfactualFrame();
        if (!after || engine.snapshot().status !== 'playing') continue;
        const later = listStrategicChoices(after, maxSprints);
        if (later.some((choice) => choice.id.startsWith('setup:combo'))) {
          crossSkipped = true;
        }
        if (hasUnevaluatedStrategicSequence(later)) {
          laterSequenceUnevaluated = true;
        }
        for (const choice of later) {
          if (choice.id.startsWith('setup:combo')) continue;
          if (crossBudget <= 0) {
            crossSkipped = true;
            break;
          }
          crossBudget -= 1;
          const combined: StrategicChoice = {
            ...choice,
            id: `${first.id}+${choice.id}`,
          };
          const crossEngine = restoreCounterfactualEngine(frame);
          applySprintChoice(crossEngine, first);
          branches.push({
            actionId: combined.id,
            ...drive(
              crossEngine,
              originDangers,
              maxSprints,
              options.focusReason,
              choice.override,
              choice.visit ?? 0,
              choice.followup,
            ),
          });
        }
        if (crossSkipped) break;
      }
      if (crossSkipped || laterSequenceUnevaluated) skippedActions.push('actionStrategicCombo');
    }
    if (
      options.actions === undefined &&
      sameTickCombos.length > 0 &&
      !skippedActions.includes('actionStrategicCombo')
    ) {
      const comboOpensStrategic = sameTickCombos.some((combo) => {
        const engine = restoreCounterfactualEngine(frame);
        for (const choice of combo) applySprintChoice(engine, choice);
        const after = engine.exportCounterfactualFrame();
        if (!after || engine.snapshot().status !== 'playing') return false;
        return listStrategicChoices(after, maxSprints).length > 0;
      });
      if (comboOpensStrategic) skippedActions.push('actionStrategicCombo');
    }
  }
  return {
    origin,
    originDangers: dangers,
    applicableActions: applicable,
    skippedActions,
    skippedStrategic,
    baseline,
    branches,
    idlePinnedIds: idle.idlePinnedIds,
  };
}

function loseNotEarlier(
  baseline: CounterfactualBranchResult,
  branch: CounterfactualBranchResult,
): boolean {
  if (branch.sprintsToLose == null) return true;
  if (baseline.sprintsToLose == null) return false;
  return branch.sprintsToLose >= baseline.sprintsToLose;
}

/** ベースラインに対して介入が有効か（F-8 / F-9 共通の集計規則）。 */
export function isEffectiveChoice(
  baseline: CounterfactualBranchResult,
  branch: CounterfactualBranchResult,
): boolean {
  const delayed =
    branch.sprintsToLose != null &&
    baseline.sprintsToLose != null &&
    branch.sprintsToLose > baseline.sprintsToLose;
  const avoided = baseline.status === 'lost' && branch.status !== 'lost';
  const leftDanger = branch.leftDanger && !baseline.leftDanger && loseNotEarlier(baseline, branch);
  const reasonChanged =
    baseline.loseReason != null &&
    branch.loseReason != null &&
    branch.loseReason !== baseline.loseReason &&
    loseNotEarlier(baseline, branch);
  return delayed || avoided || leftDanger || reasonChanged;
}

export interface LatestEffectiveFrame {
  evaluation: CounterfactualEvaluation;
  effective: string[];
  baselineRecovered: boolean;
}

function isBaselineRecovered(evaluation: CounterfactualEvaluation): boolean {
  const baseline = evaluation.baseline;
  return baseline.leftDanger || baseline.status !== 'lost';
}

/**
 * 新しいフレームから遡り、有効手がある最初の評価を返す。
 * 無介入で生存・危険域離脱できる最新フレームでは遡らない。
 * どれも無効なら最新フレームの評価と空の有効手を返す。
 */
function framesOf(sample: CounterfactualFrameSample): CounterfactualFrame[] {
  return sample.frames && sample.frames.length > 0 ? sample.frames : [sample.frame];
}

export function evaluateLatestEffectiveFrame(
  samples: readonly CounterfactualFrameSample[],
  options: CounterfactualEvaluateOptions = {},
): LatestEffectiveFrame | null {
  if (samples.length === 0) return null;
  let newest: LatestEffectiveFrame | null = null;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    const seq = framesOf(samples[i]!);
    for (let j = seq.length - 1; j >= 0; j -= 1) {
      const evaluation = evaluateCounterfactual(seq[j]!, options);
      const effective = effectiveActionsOf(evaluation);
      const baselineRecovered = isBaselineRecovered(evaluation);
      const found = { evaluation, effective, baselineRecovered };
      if (!newest) newest = found;
      if (effective.length > 0) return found;
      const incomplete =
        evaluation.skippedActions.length > 0 || evaluation.skippedStrategic.length > 0;
      if (incomplete || baselineRecovered) return found;
    }
  }
  return newest;
}

function splitVisitSuffix(actionId: string): { base: string; suffix: string } {
  const match = /^(.+)(@\d+)$/.exec(actionId);
  return match ? { base: match[1]!, suffix: match[2]! } : { base: actionId, suffix: '' };
}

function isShopStepPart(part: string): boolean {
  return (
    part.startsWith('card:') ||
    part === 'relic' ||
    part.startsWith('relic:') ||
    part === 'recruit:coding' ||
    part === 'recruit:review' ||
    part === 'recruit:bench'
  );
}

type SeqAtom = { ns: 'shop' | 'evo' | ''; step: string; suffix: string };

function tokenizeActionId(actionId: string): SeqAtom[] {
  const raw = actionId.split('+');
  const atoms: SeqAtom[] = [];
  let i = 0;
  while (i < raw.length) {
    const { base, suffix } = splitVisitSuffix(raw[i]!);
    if (base.startsWith('shop:')) {
      const group: SeqAtom[] = [{ ns: 'shop', step: base.slice('shop:'.length), suffix }];
      i += 1;
      while (i < raw.length) {
        const next = splitVisitSuffix(raw[i]!);
        if (!isShopStepPart(next.base)) break;
        group.push({ ns: 'shop', step: next.base, suffix: next.suffix });
        i += 1;
      }
      const groupSuffix = group.reduce((acc, atom) => atom.suffix || acc, '');
      for (const atom of group) atom.suffix = groupSuffix;
      atoms.push(...group);
      continue;
    }
    if (base.startsWith('evo:')) {
      const group: SeqAtom[] = [{ ns: 'evo', step: base.slice('evo:'.length), suffix }];
      i += 1;
      while (i < raw.length) {
        const next = splitVisitSuffix(raw[i]!);
        if (next.base.includes(':')) break;
        group.push({ ns: 'evo', step: next.base, suffix: next.suffix });
        i += 1;
      }
      const groupSuffix = group.reduce((acc, atom) => atom.suffix || acc, '');
      for (const atom of group) atom.suffix = groupSuffix;
      atoms.push(...group);
      continue;
    }
    atoms.push({ ns: '', step: base, suffix });
    i += 1;
  }
  return atoms;
}

function joinAtoms(atoms: readonly SeqAtom[]): string {
  const chunks: string[] = [];
  let i = 0;
  while (i < atoms.length) {
    const ns = atoms[i]!.ns;
    if (ns === 'shop' || ns === 'evo') {
      const steps = [atoms[i]!.step];
      let suffix = atoms[i]!.suffix;
      i += 1;
      while (i < atoms.length && atoms[i]!.ns === ns) {
        steps.push(atoms[i]!.step);
        suffix = atoms[i]!.suffix || suffix;
        i += 1;
      }
      chunks.push(`${ns}:${steps.join('+')}${suffix}`);
      continue;
    }
    chunks.push(`${atoms[i]!.step}${atoms[i]!.suffix}`);
    i += 1;
  }
  return chunks.join('+');
}

function isMinimalEffectiveAction(actionId: string, effectiveIds: Set<string>): boolean {
  const atoms = tokenizeActionId(actionId);
  if (atoms.length < 2) return true;
  const limit = (1 << atoms.length) - 1;
  for (let mask = 1; mask < limit; mask += 1) {
    const sub = atoms.filter((_, index) => (mask & (1 << index)) !== 0);
    if (effectiveIds.has(joinAtoms(sub))) return false;
  }
  return true;
}

export function effectiveActionsOf(evaluation: CounterfactualEvaluation): string[] {
  const recovered = isBaselineRecovered(evaluation);
  const effective = evaluation.branches
    .filter((branch) => {
      if (!branch.actionId) return false;
      if (isEffectiveChoice(evaluation.baseline, branch)) return true;
      // エンジンは decision / rest / 目標修正 / 採用をスキップできない。無介入が選んだ
      // 実選択肢と同一軌跡の分岐は、ベースライン回復時も F-9 の有効手として残す。
      return recovered && !!evaluation.idlePinnedIds?.includes(branch.actionId);
    })
    .map((branch) => branch.actionId as string);
  const effectiveIds = new Set(effective);
  return effective.filter((id) => isMinimalEffectiveAction(id, effectiveIds));
}

export interface F8RecoveryJudgment {
  lastEffectiveSprints: number | null;
  gap: number | null;
  hasRecovery: boolean;
}

/** F-8: 有効手が残る最後の時点と、敗北までのギャップ。機械的非空手だけでは有効にしない。 */
export function judgeF8Recovery(
  samples: readonly { sprintsPlayed: number; effectiveActions: readonly string[] }[],
  loseSprints: number,
): F8RecoveryJudgment {
  let lastEffectiveSprints: number | null = null;
  for (const sample of samples) {
    if (sample.effectiveActions.length > 0) lastEffectiveSprints = sample.sprintsPlayed;
  }
  return {
    lastEffectiveSprints,
    gap: lastEffectiveSprints == null ? null : Math.max(0, loseSprints - lastEffectiveSprints),
    hasRecovery: lastEffectiveSprints != null,
  };
}

export interface F9EffectiveSetJudgment {
  byReason: Record<string, string[]>;
  distinctEffectiveSetCount: number;
}

/**
 * F-9 集計用の安定キー。デッキ位置やスプリント内 task ID を落とし、
 * カード定義・介入種別・担当など意味的な属性だけを残す。
 */
export function stableEffectiveActionId(id: string): string {
  return id
    .split('+')
    .map((raw) => {
      const part = raw.replace(/@\d+$/, '');
      const card = /^card:([^:]+)(?::\d+)?$/.exec(part);
      if (card) return `card:${card[1]}`;
      const assign = /^assignTask:[^:]+:(ai|senior)$/.exec(part);
      if (assign) return `assignTask:${assign[1]}`;
      const split = /^splitPr:[^:]+$/.exec(part);
      if (split) return 'splitPr';
      const restUp = /^rest:upgrade:(?:([^:]+):)?\d+$/.exec(part);
      if (restUp) return restUp[1] ? `rest:upgrade:${restUp[1]}` : 'rest:upgrade';
      const setupAssign = /^setup:assign:[^:]+:([^:]+)$/.exec(part);
      if (setupAssign) return `setup:assign:${setupAssign[1]}`;
      const setupAi = /^setup:ai:[^:]+:(on|off)$/.exec(part);
      if (setupAi) return `setup:ai:${setupAi[1]}`;
      return part;
    })
    .join('+');
}

/** F-9: 敗因ごとの有効手集合。機械的発動可能集合とは別に数える。 */
export function judgeF9EffectiveSets(
  runs: readonly { loseReason: LoseReason; effectiveActions: readonly string[] }[],
): F9EffectiveSetJudgment {
  const union = new Map<LoseReason, Set<string>>();
  for (const run of runs) {
    let set = union.get(run.loseReason);
    if (!set) {
      set = new Set();
      union.set(run.loseReason, set);
    }
    for (const id of run.effectiveActions) set.add(stableEffectiveActionId(id));
  }
  const byReason: Record<string, string[]> = {};
  const keys: string[] = [];
  for (const [reason, set] of [...union.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const actions = [...set].sort();
    byReason[reason] = actions;
    keys.push(actions.join(','));
  }
  return {
    byReason,
    distinctEffectiveSetCount: new Set(keys).size,
  };
}
