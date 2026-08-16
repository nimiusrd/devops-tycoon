/**
 * 危険状態の反実仮想評価（RI-101 / SPEC 第19.1 F-8・F-9）。
 *
 * 同一乱数状態から無介入と適用可能介入、および無介入ドライブ上で出会う
 * 戦略フェーズの代替肢を分岐し、敗北遅延・回避・危険域離脱・敗因変化だけを
 * 有効手として集計する。what-if の同 seed 再実行とは別系統。
 */
import { getCard } from '../../data/cards';
import { getEvent } from '../../data/events';
import { canApplyAction } from '../actions';
import { assignableTasks, splitPrCandidates } from '../assignTask';
import { playCost } from '../cards';
import { canRecruit, RECRUIT_COST } from '../member';
import { isAwaitingMinCompleteTick } from '../sprint';
import type { ActionId, ActionTarget, SprintState } from '../types';
import { activeDangerReasons, listApplicableActions, type DangerLoseReason } from './dangerZone';
import { RunEngine } from './engine';
import { unlockableNodes } from './evolution';
import type { CounterfactualFrame } from './persist';
import type { GoalAdjustmentId, LoseReason, RunStatus, RunState } from './types';

type RestChoice = 'heal' | 'repay' | 'upgrade' | 'recruit';

/** 無介入 1 + スプリント介入ブランチの上限。超過分は評価せず skipped に残す。 */
export const DEFAULT_MAX_ACTION_BRANCHES = 8;
/** 戦略フェーズの代替肢ブランチ上限。スプリント介入とは別に数える。 */
export const DEFAULT_MAX_STRATEGIC_BRANCHES = 8;
/** フォーク後に進める追加スプリント数の既定。 */
export const DEFAULT_MAX_SPRINTS = 4;

const REST_ALTERNATIVES: readonly RestChoice[] = ['repay', 'recruit'];
const STRATEGIC_KIND_ORDER = [
  'beat',
  'rest',
  'shop',
  'draft',
  'evolution',
  'goal',
  'recruit',
] as const;

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
}

export interface CounterfactualEvaluateOptions {
  maxSprints?: number;
  maxActionBranches?: number;
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
}

type StrategicOverride =
  | { kind: 'draft'; cardId: string }
  | { kind: 'evolution'; nodeId: string }
  | { kind: 'beat'; index: number }
  | { kind: 'rest'; option: RestChoice; deckIndex?: number }
  | { kind: 'shop'; mode: 'card'; defId: string }
  | { kind: 'shop'; mode: 'relic' }
  | { kind: 'shop'; mode: 'recruit' }
  | { kind: 'recruit' }
  | { kind: 'goal'; id: GoalAdjustmentId };

export interface StrategicChoice {
  id: string;
  kind: StrategicOverride['kind'];
  override: StrategicOverride;
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
  for (const id of listApplicableActions(engine)) {
    if (id === 'assignTask') {
      for (const task of assignableTasks(sprint)) {
        const lane = task.lane === 'backlog' ? ('coding' as const) : undefined;
        for (const assignee of ['ai', 'senior'] as const) {
          const target: ActionTarget = lane
            ? { taskId: task.id, lane, assignee }
            : { taskId: task.id, assignee };
          if (canApplyAction('assignTask', sprint, s.org, s.sprintTick, target).ok) {
            out.push({ id: `assignTask:${task.id}:${assignee}`, actionId: 'assignTask', target });
          }
        }
      }
      if (out.some((choice) => choice.actionId === 'assignTask')) continue;
    }
    if (id === 'splitPr') {
      for (const task of splitPrCandidates(sprint)) {
        const target: ActionTarget = { taskId: task.id };
        if (canApplyAction('splitPr', sprint, s.org, s.sprintTick, target).ok) {
          out.push({ id: `splitPr:${task.id}`, actionId: 'splitPr', target });
        }
      }
      if (out.some((choice) => choice.actionId === 'splitPr')) continue;
    }
    out.push({ id, actionId: id });
  }
  for (const deckIndex of sprint.cardPiles.hand) {
    if (!canPlayHandCard(sprint, s.deck, deckIndex)) continue;
    const defId = s.deck[deckIndex]?.defId ?? String(deckIndex);
    out.push({ id: `card:${defId}:${deckIndex}`, actionId: null, cardIndex: deckIndex });
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

function applyIdleStep(engine: RunEngine, snapshot: RunState): boolean {
  switch (snapshot.phase) {
    case 'setup':
      engine.beginSetupSprint();
      return true;
    case 'sprint': {
      let snap = engine.snapshot();
      while (snap.phase === 'sprint' && snap.sprint && snap.status === 'playing') {
        const playable = snap.sprint.cardPiles.hand.find((deckIndex) =>
          canPlayHandCard(snap.sprint!, snap.deck, deckIndex),
        );
        if (playable == null) break;
        if (!engine.playCard(playable).ok) break;
        snap = engine.snapshot();
      }
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
      engine.resolveBeat(0);
      return true;
    case 'shop':
      engine.leaveShop();
      return true;
    case 'rest':
      engine.restChoose('heal');
      return true;
    case 'recruit':
      engine.recruitChoose('skip');
      return true;
    case 'quarterReview': {
      const review = snapshot.quarterReview;
      if (review?.outcome === 'missed_adjustable') {
        const pick = review.availableAdjustments[0] ?? 'cut_scope';
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

function applyStrategicOverride(
  engine: RunEngine,
  snapshot: RunState,
  override: StrategicOverride,
): boolean {
  switch (override.kind) {
    case 'draft':
      if (snapshot.phase !== 'draft') return false;
      engine.chooseCard(override.cardId);
      return true;
    case 'evolution':
      if (snapshot.phase !== 'evolution') return false;
      engine.unlockEvolution(override.nodeId);
      engine.finishEvolution();
      return true;
    case 'beat':
      if (snapshot.phase !== 'beat' || snapshot.beat?.kind !== 'decision') return false;
      engine.resolveBeat(override.index);
      return true;
    case 'rest':
      if (snapshot.phase !== 'rest') return false;
      engine.restChoose(override.option, override.deckIndex);
      return true;
    case 'shop':
      if (snapshot.phase !== 'shop') return false;
      if (override.mode === 'card') engine.buyShopCard(override.defId);
      else if (override.mode === 'relic') engine.buyShopRelic();
      else engine.buyShopRecruit();
      engine.leaveShop();
      return true;
    case 'recruit':
      if (snapshot.phase !== 'recruit') return false;
      engine.recruitChoose('hire');
      return true;
    case 'goal':
      if (snapshot.phase !== 'quarterReview') return false;
      engine.chooseGoalAdjustment(override.id);
      return true;
  }
}

function collectStrategicAt(snapshot: RunState, seen: Set<string>): StrategicChoice[] {
  if (
    snapshot.phase === 'draft' &&
    !seen.has('draft') &&
    snapshot.draft &&
    snapshot.draft.length > 0
  ) {
    seen.add('draft');
    return snapshot.draft.map((cardId) => ({
      id: `draft:${cardId}`,
      kind: 'draft' as const,
      override: { kind: 'draft' as const, cardId },
    }));
  }
  if (snapshot.phase === 'evolution' && !seen.has('evolution')) {
    seen.add('evolution');
    return unlockableNodes(snapshot.evolution).map((nodeId) => ({
      id: `evo:${nodeId}`,
      kind: 'evolution' as const,
      override: { kind: 'evolution' as const, nodeId },
    }));
  }
  if (snapshot.phase === 'beat' && snapshot.beat?.kind === 'decision' && !seen.has('beat')) {
    seen.add('beat');
    const eventId = snapshot.beat.eventId;
    const n = getEvent(eventId)?.choices.length ?? 0;
    const out: StrategicChoice[] = [];
    for (let index = 1; index < n; index += 1) {
      out.push({
        id: `beat:${eventId}:${index}`,
        kind: 'beat',
        override: { kind: 'beat', index },
      });
    }
    return out;
  }
  if (snapshot.phase === 'rest' && !seen.has('rest')) {
    seen.add('rest');
    const out: StrategicChoice[] = REST_ALTERNATIVES.filter((option) => {
      if (option !== 'recruit') return true;
      return canRecruit(snapshot.roster) && snapshot.budget >= RECRUIT_COST;
    }).map((option) => ({
      id: `rest:${option}`,
      kind: 'rest' as const,
      override: { kind: 'rest' as const, option },
    }));
    for (let deckIndex = 0; deckIndex < snapshot.deck.length; deckIndex += 1) {
      out.push({
        id: `rest:upgrade:${deckIndex}`,
        kind: 'rest',
        override: { kind: 'rest', option: 'upgrade', deckIndex },
      });
    }
    return out;
  }
  if (snapshot.phase === 'shop' && !seen.has('shop') && snapshot.shop) {
    seen.add('shop');
    const shop = snapshot.shop;
    const out: StrategicChoice[] = [];
    for (const card of shop.cards) {
      if (card.bought || snapshot.budget < card.cost) continue;
      out.push({
        id: `shop:card:${card.defId}`,
        kind: 'shop',
        override: { kind: 'shop', mode: 'card', defId: card.defId },
      });
    }
    if (shop.relic && !shop.relic.bought && snapshot.budget >= shop.relic.cost) {
      out.push({
        id: `shop:relic:${shop.relic.id}`,
        kind: 'shop',
        override: { kind: 'shop', mode: 'relic' },
      });
    }
    if (
      shop.recruit &&
      !shop.recruit.bought &&
      snapshot.budget >= shop.recruit.cost &&
      canRecruit(snapshot.roster)
    ) {
      out.push({ id: 'shop:recruit', kind: 'shop', override: { kind: 'shop', mode: 'recruit' } });
    }
    return out;
  }
  if (snapshot.phase === 'recruit' && !seen.has('recruit')) {
    seen.add('recruit');
    return [{ id: 'recruit:hire', kind: 'recruit', override: { kind: 'recruit' } }];
  }
  if (snapshot.phase === 'quarterReview' && !seen.has('goal')) {
    seen.add('goal');
    const review = snapshot.quarterReview;
    if (review?.outcome !== 'missed_adjustable') return [];
    return review.availableAdjustments.slice(1).map((id) => ({
      id: `goal:${id}`,
      kind: 'goal' as const,
      override: { kind: 'goal' as const, id },
    }));
  }
  return [];
}

/**
 * 無介入ドライブ上で最初に出会う各戦略フェーズの代替肢。
 * ネストした全組合せは作らず、フェーズ種別ごとに 1 回だけ列挙する。
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
    found.push(...collectStrategicAt(snapshot, seen));
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
): Omit<CounterfactualBranchResult, 'actionId'> {
  const startPlayed = engine.snapshot().sprintsPlayed;
  let leftDanger = originDangersLeft(originDangers, engine, focusReason);
  let applied = override == null;
  let guard = 0;
  while (engine.snapshot().status === 'playing' && guard < 4_000) {
    guard += 1;
    const s = engine.snapshot();
    // 追加スプリントを始める直前だけ打ち切る。最後に許可したスプリントの
    // result / beat / quarterReview など終端遷移は処理する。
    if (s.phase === 'setup' && s.sprintsPlayed - startPlayed >= maxSprints) {
      return {
        sprintsToLose: null,
        leftDanger,
        loseReason: null,
        status: s.status,
        truncated: true,
      };
    }
    if (originDangersLeft(originDangers, engine, focusReason)) leftDanger = true;
    if (!applied && override && applyStrategicOverride(engine, s, override)) {
      applied = true;
      continue;
    }
    if (!applyIdleStep(engine, s)) {
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
): CounterfactualBranchResult {
  const engine = restoreCounterfactualEngine(frame);
  return { actionId: null, ...drive(engine, originDangers, maxSprints, focusReason) };
}

function runActionBranch(
  frame: CounterfactualFrame,
  choice: SprintChoice,
  originDangers: ReadonlySet<DangerLoseReason>,
  maxSprints: number,
  focusReason?: DangerLoseReason,
): CounterfactualBranchResult {
  const engine = restoreCounterfactualEngine(frame);
  applySprintChoice(engine, choice);
  return { actionId: choice.id, ...drive(engine, originDangers, maxSprints, focusReason) };
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
    ...drive(engine, originDangers, maxSprints, focusReason, choice.override),
  };
}

export function evaluateCounterfactual(
  frame: CounterfactualFrame,
  options: CounterfactualEvaluateOptions = {},
): CounterfactualEvaluation {
  const maxSprints = options.maxSprints ?? DEFAULT_MAX_SPRINTS;
  const maxActionBranches = options.maxActionBranches ?? DEFAULT_MAX_ACTION_BRANCHES;
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
  const baseline = runIdleBranch(frame, originDangers, maxSprints, options.focusReason);
  const branches = toEval.map((choice) =>
    runActionBranch(frame, choice, originDangers, maxSprints, options.focusReason),
  );
  let skippedStrategic: string[] = [];
  if (includeStrategic) {
    const strategic = listStrategicChoices(frame, maxSprints);
    const toStrategic = strategic.slice(0, maxStrategicBranches);
    skippedStrategic = strategic.slice(maxStrategicBranches).map((choice) => choice.id);
    for (const choice of toStrategic) {
      branches.push(
        runStrategicBranch(frame, choice, originDangers, maxSprints, options.focusReason),
      );
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
  };
}

function loseNotEarlier(
  baseline: CounterfactualBranchResult,
  branch: CounterfactualBranchResult,
): boolean {
  return (
    branch.sprintsToLose == null ||
    baseline.sprintsToLose == null ||
    branch.sprintsToLose >= baseline.sprintsToLose
  );
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
  const leftDanger = branch.leftDanger && !baseline.leftDanger;
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
}

/**
 * 新しいフレームから遡り、有効手がある最初の評価を返す。
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
      const found = { evaluation, effective };
      if (!newest) newest = found;
      if (effective.length > 0) return found;
      const incomplete =
        evaluation.skippedActions.length > 0 || evaluation.skippedStrategic.length > 0;
      if (incomplete) return found;
    }
  }
  return newest;
}

export function effectiveActionsOf(evaluation: CounterfactualEvaluation): string[] {
  return evaluation.branches
    .filter((branch) => branch.actionId && isEffectiveChoice(evaluation.baseline, branch))
    .map((branch) => branch.actionId as string);
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
    for (const id of run.effectiveActions) set.add(id);
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
