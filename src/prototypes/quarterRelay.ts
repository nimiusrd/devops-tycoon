/** RI-300: 四半期境界一回・固定二期。通常GameHandle/保存先/報酬へ接続しない。 */
import { ACTION_IDS } from '../data/actionIds';
import { BALANCE_RULESET_FINGERPRINT, BALANCE_RULESET_VERSION } from '../data/balance';
import { canonicalizeJson, sha256Hex } from '../data/balance/canonical';
import { CARD_DEFS } from '../data/cards';
import { getEvent } from '../data/events';
import { getTrial } from '../data/difficulties';
import { allGoalAdjustmentIds } from '../data/goalAdjustments';
import { SPRINTS_PER_QUARTER } from '../sim/run/constants';
import { RunEngine } from '../sim/run/engine';
import type { RunPersistState } from '../sim/run/persist';
import type { GoalAdjustmentId, RunState } from '../sim/run/types';
import type { ActionId } from '../sim/types';
import { toRunSave, type RunSave } from '../state/runPersistence';
import { parseRunSaveShare } from '../state/runSaveShare';

export const RELAY_RULESET = 'ri300-one-boundary-two-quarters-v1';
export const RELAY_LIMITS = Object.freeze({
  fileChars: 1_048_576,
  saveChars: 2_097_152,
  inputChars: 256,
  memoChars: 1000,
  participantChars: 80,
  stringChars: 4096,
  seedChars: 128,
  arrayItems: 2048,
  nodes: 100_000,
  nesting: 24,
  // 親fileに保存envelope・receipt・最大入力列を加えても再開上限へ収まる余白。
  fileNodes: 80_000,
  fileNesting: 23,
  inputs: 2048,
  tasks: 512,
  teams: 16,
  members: 64,
  sprintTicks: 3600,
  tickMs: 1000,
});

type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
export type RelayRuleset = {
  prototype: string;
  balanceVersion: number;
  balanceFingerprint: string;
};
type Assignment = { order: number; quarter: number; participant: string };
export type RelayBoundary = {
  phase: RunState['phase'];
  quarter: number;
  sprintIndex: number;
  sprintsPlayed: number;
  reviewHistory: RunState['reviewHistory'];
  adjustments: GoalAdjustmentId[];
  resources: Pick<RunState, 'budget' | 'org' | 'roster' | 'deck' | 'relics' | 'evolution'> & {
    teams: RunState['teams'];
  };
  goal: RunState['quarterGoal'];
  trust: RunState['stakeholderTrust'];
  carryover: { quarter: number | null; id: GoalAdjustmentId | null };
};
export interface QuarterRelayFile {
  format: 'devops-tycoon-quarter-relay';
  version: 1;
  ruleset: RelayRuleset;
  assignments: [Assignment];
  memo: string;
  adjustment: GoalAdjustmentId;
  /** 修正直前と直後の実セーブ。担当履歴をreviewHistoryから推定しない。 */
  before: RunSave;
  boundary: RunSave;
  manifest: { before: RelayBoundary; after: RelayBoundary };
  fingerprint: string;
}
export interface RelayReceipt {
  branchId: string;
  parentFingerprint: string;
  assignments: [Assignment, Assignment];
}
export type RelayInput = { sequence: number } & (
  | { type: 'begin' | 'tick' | 'result' | 'skipDraft' | 'finishEvolution' | 'leaveShop' }
  | { type: 'playCard'; deckIndex: number }
  | { type: 'dispatch'; actionId: ActionId }
  | { type: 'chooseCard' | 'buyCard'; cardId: string }
  | { type: 'beat'; choiceIndex: number }
  | { type: 'rest'; option: 'heal' | 'repay' }
  | { type: 'recruit'; option: 'hire' | 'skip' }
);
export interface RelayView {
  mode: 'quarter-relay-prototype';
  ruleset: RelayRuleset;
  receipt: RelayReceipt;
  memo: string;
  manifest: QuarterRelayFile['manifest'];
  state: Omit<RunState, 'runKind' | 'dailyDate'>;
  acceptedInputs: number;
  costs: { interventionFocusNetSpent: number; cardFocusNetSpent: number };
  complete: boolean;
  /** Q2未達ならplayingのレビューで止まる。独自の勝利やQ3を作らない。 */
  result: null | {
    status: RunState['status'];
    winType: RunState['winType'] | null;
    review: RunState['quarterReview'];
  };
  rewardEligible: false;
  metaReward: 0;
  dailyReward: 0;
}
export interface RelaySession {
  act(rawInput: string): Result<null>;
  view(): RelayView;
  save(): string;
}

const fail = (reason: string): Result<never> => ({ ok: false, reason });
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).length === names.length &&
  names.every((name) => Object.prototype.hasOwnProperty.call(v, name));
const integer = (v: unknown, max: number) =>
  Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const participant = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= RELAY_LIMITS.participantChars;
const equal = (a: unknown, b: unknown) => canonicalizeJson(a) === canonicalizeJson(b);
const hash = (v: unknown) => sha256Hex(canonicalizeJson(v));

export function relayRuleset(): RelayRuleset {
  return {
    prototype: RELAY_RULESET,
    balanceVersion: BALANCE_RULESET_VERSION,
    balanceFingerprint: BALANCE_RULESET_FINGERPRINT,
  };
}

function json(
  raw: string,
  max: number,
  maxNodes: number = RELAY_LIMITS.nodes,
  maxDepth: number = RELAY_LIMITS.nesting,
): Result<unknown> {
  if (typeof raw !== 'string' || raw.length > max) return fail('input-limit');
  try {
    const value: unknown = JSON.parse(raw);
    const pending = [{ value, depth: 0 }];
    let nodes = 0;
    while (pending.length) {
      const item = pending.pop()!;
      if (++nodes > maxNodes || item.depth > maxDepth) return fail('structure-limit');
      if (typeof item.value === 'string' && item.value.length > RELAY_LIMITS.stringChars)
        return fail('string-limit');
      if (typeof item.value === 'number' && !Number.isFinite(item.value))
        return fail('nonfinite-number');
      if (item.value === null || typeof item.value !== 'object') continue;
      if (Array.isArray(item.value) && item.value.length > RELAY_LIMITS.arrayItems)
        return fail('array-limit');
      for (const [key, child] of Object.entries(item.value)) {
        if (key.length > RELAY_LIMITS.stringChars) return fail('string-limit');
        pending.push({ value: child, depth: item.depth + 1 });
      }
    }
    return { ok: true, value };
  } catch {
    return fail('invalid-json');
  }
}

/** 既存parserの版・ruleset・構造・hydrate検査を必ず通す。バックアップ形式は不可。 */
function readSave(v: unknown): Result<RunSave> {
  if (!object(v) || !Object.prototype.hasOwnProperty.call(v, 'schemaVersion'))
    return fail('invalid-run-save');
  const parsed = parseRunSaveShare(JSON.stringify(v));
  if (!parsed.ok) return fail(`run-save:${parsed.reason}`);
  const s = parsed.save.state;
  if (
    s.runKind !== 'normal' ||
    s.trials.some((id) => !getTrial(id)) ||
    new Set(s.trials).size !== s.trials.length ||
    s.dailyDate !== undefined ||
    s.seed.length > RELAY_LIMITS.seedChars ||
    s.sprintsPerQuarter !== SPRINTS_PER_QUARTER ||
    !integer(s.extras.baseConfig.taskCount, RELAY_LIMITS.tasks) ||
    !integer(s.extras.baseConfig.maxTicks, RELAY_LIMITS.sprintTicks) ||
    !integer(s.extras.baseConfig.codingSlots, RELAY_LIMITS.members) ||
    !integer(s.extras.baseConfig.focusMax, RELAY_LIMITS.members) ||
    s.roster.members.length > RELAY_LIMITS.members ||
    Object.values(s.extras.teamRosters ?? {}).some(
      (roster) => roster.members.length > RELAY_LIMITS.members,
    ) ||
    (s.extras.teams?.length ?? 0) > RELAY_LIMITS.teams ||
    s.extras.teams?.some(
      (team) =>
        !integer(team.reviewQueue, RELAY_LIMITS.tasks) ||
        !integer(team.incidents, RELAY_LIMITS.tasks),
    ) ||
    !integer(s.budget, 1_000_000) ||
    s.sprint !== null ||
    s.sprintTick !== 0 ||
    s.winType !== undefined ||
    s.loseReason !== undefined
  )
    return fail('invalid-relay-run');
  return { ok: true, value: parsed.save };
}

function cloneEngine(save: RunSave): RunEngine {
  const engine = new RunEngine({
    seed: save.state.seed,
    difficulty: save.state.difficulty,
    trials: save.state.trials,
  });
  engine.hydratePersistState(structuredClone(save.state));
  return engine;
}

function boundary(s: RunPersistState): RelayBoundary {
  return structuredClone({
    phase: s.phase,
    quarter: s.quarterNumber,
    sprintIndex: s.sprintIndexInQuarter,
    sprintsPlayed: s.sprintsPlayed,
    reviewHistory: s.reviewHistory,
    adjustments: s.goalAdjustmentsTaken,
    resources: {
      budget: s.budget,
      org: s.org,
      roster: s.roster,
      deck: s.deck,
      relics: s.relics,
      evolution: s.evolution,
      teams: s.extras.teams ?? [],
    },
    goal: s.quarterGoal,
    trust: s.stakeholderTrust,
    carryover: { quarter: s.goalCarryoverQuarter, id: s.goalCarryoverId },
  });
}

function isBefore(s: RunPersistState): boolean {
  return (
    s.phase === 'quarterReview' &&
    s.quarterNumber === 1 &&
    s.sprintIndexInQuarter === SPRINTS_PER_QUARTER &&
    s.sprintsPlayed === SPRINTS_PER_QUARTER &&
    s.currentSprintId === `q1-s${SPRINTS_PER_QUARTER}` &&
    s.currentSprintKind === 'boss' &&
    s.lastResult !== null &&
    s.quarterReview?.outcome === 'missed_adjustable' &&
    equal(s.quarterReview.goal, s.quarterGoal) &&
    equal(s.quarterReview.trust, s.stakeholderTrust) &&
    equal(s.reviewHistory, ['missed_adjustable']) &&
    s.goalAdjustmentsTaken.length === 0 &&
    s.goalCarryoverQuarter === null &&
    s.goalCarryoverId === null &&
    s.extras.goalCarryoverQuarter === null &&
    s.extras.goalCarryoverId === null &&
    s.trendHistory?.length === 1 &&
    s.trendHistory[0].quarterNumber === 1 &&
    equal(s.trendHistory[0].kpis, s.quarterReview.progress)
  );
}

function isBoundary(s: RunPersistState): boolean {
  return (
    s.phase === 'setup' &&
    s.quarterNumber === 2 &&
    s.sprintIndexInQuarter === 0 &&
    s.sprintsPlayed === SPRINTS_PER_QUARTER &&
    s.quarterReview === null &&
    s.currentSprintId === null &&
    s.lastResult === null &&
    s.beat === null &&
    s.draft === null &&
    s.shop === null &&
    s.pendingSprintKind === 'normal' &&
    s.currentSprintKind === 'normal' &&
    equal(s.reviewHistory, ['missed_adjustable']) &&
    s.goalAdjustmentsTaken.length === 1
  );
}

/** Q1レビューを複製し、実chooseGoalAdjustmentで境界を作る。元セーブは更新しない。 */
export function exportQuarterRelay(
  rawReviewSave: string,
  options: { participant: string; memo: string; adjustment: GoalAdjustmentId },
): Result<string> {
  if (
    !object(options) ||
    !keys(options, ['participant', 'memo', 'adjustment']) ||
    !participant(options.participant) ||
    typeof options.memo !== 'string' ||
    options.memo.length > RELAY_LIMITS.memoChars ||
    !allGoalAdjustmentIds().includes(options.adjustment)
  )
    return fail('invalid-handoff-options');
  const parsed = json(rawReviewSave, RELAY_LIMITS.fileChars);
  if (!parsed.ok) return parsed;
  const source = readSave(parsed.value);
  if (!source.ok) return source;
  const before = source.value;
  if (!isBefore(before.state)) return fail('not-q1-adjustable-review');
  if (!before.state.quarterReview!.availableAdjustments.includes(options.adjustment))
    return fail('unavailable-adjustment');
  const engine = cloneEngine(before);
  engine.chooseGoalAdjustment(options.adjustment);
  const state = engine.exportPersistState();
  if (!state || !isBoundary(state)) return fail('not-handoff-boundary');
  const payload = {
    format: 'devops-tycoon-quarter-relay' as const,
    version: 1 as const,
    ruleset: relayRuleset(),
    assignments: [{ order: 1, quarter: 1, participant: options.participant }] as [Assignment],
    memo: options.memo,
    adjustment: options.adjustment,
    before,
    boundary: toRunSave(state, before.savedAt),
    manifest: { before: boundary(before.state), after: boundary(state) },
  };
  const raw = JSON.stringify({ ...payload, fingerprint: hash(payload) });
  const checked = parseQuarterRelay(raw);
  return checked.ok ? { ok: true, value: raw } : checked;
}

/** 境界は実際の修正前から再実行して全永続状態と照合。指紋は署名ではない。 */
export function parseQuarterRelay(raw: string): Result<QuarterRelayFile> {
  const parsed = json(
    raw,
    RELAY_LIMITS.fileChars,
    RELAY_LIMITS.fileNodes,
    RELAY_LIMITS.fileNesting,
  );
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  // 1e20等の短い入力も保存時には長い十進表記になる。再直列化後の大きさも制限する。
  if (JSON.stringify(v).length > RELAY_LIMITS.fileChars) return fail('input-limit');
  if (
    !object(v) ||
    !keys(v, [
      'format',
      'version',
      'ruleset',
      'assignments',
      'memo',
      'adjustment',
      'before',
      'boundary',
      'manifest',
      'fingerprint',
    ])
  )
    return fail('invalid-relay-shape');
  if (v.format !== 'devops-tycoon-quarter-relay' || v.version !== 1)
    return fail('unsupported-format');
  if (!equal(v.ruleset, relayRuleset())) return fail('ruleset-mismatch');
  if (!Array.isArray(v.assignments) || v.assignments.length !== 1)
    return fail('invalid-assignments');
  const owner: unknown = v.assignments[0];
  if (
    !object(owner) ||
    !keys(owner, ['order', 'quarter', 'participant']) ||
    owner.order !== 1 ||
    owner.quarter !== 1 ||
    !participant(owner.participant)
  )
    return fail('invalid-assignments');
  if (
    typeof v.memo !== 'string' ||
    v.memo.length > RELAY_LIMITS.memoChars ||
    !allGoalAdjustmentIds().includes(v.adjustment as GoalAdjustmentId)
  )
    return fail('invalid-handoff');
  const before = readSave(v.before);
  if (!before.ok) return before;
  const after = readSave(v.boundary);
  if (!after.ok) return after;
  if (!isBefore(before.value.state) || !isBoundary(after.value.state))
    return fail('not-handoff-boundary');
  if (
    !before.value.state.quarterReview!.availableAdjustments.includes(
      v.adjustment as GoalAdjustmentId,
    )
  )
    return fail('unavailable-adjustment');
  const engine = cloneEngine(before.value);
  engine.chooseGoalAdjustment(v.adjustment as GoalAdjustmentId);
  if (!equal(engine.exportPersistState(), after.value.state)) return fail('boundary-mismatch');
  if (
    !equal(v.manifest, { before: boundary(before.value.state), after: boundary(after.value.state) })
  )
    return fail('manifest-mismatch');
  const { fingerprint, ...payload } = v;
  if (typeof fingerprint !== 'string' || fingerprint !== hash(payload))
    return fail('fingerprint-mismatch');
  return { ok: true, value: structuredClone(v) as unknown as QuarterRelayFile };
}

const CARD_IDS = new Set(CARD_DEFS.map(({ id }) => id));
function parseInput(raw: string): Result<RelayInput> {
  const parsed = json(raw, RELAY_LIMITS.inputChars);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!object(v) || !integer(v.sequence, RELAY_LIMITS.inputs) || typeof v.type !== 'string')
    return fail('invalid-command');
  if (
    ['begin', 'tick', 'result', 'skipDraft', 'finishEvolution', 'leaveShop'].includes(v.type) &&
    keys(v, ['sequence', 'type'])
  )
    return { ok: true, value: v as RelayInput };
  if (
    v.type === 'playCard' &&
    keys(v, ['sequence', 'type', 'deckIndex']) &&
    integer(v.deckIndex, RELAY_LIMITS.arrayItems)
  )
    return { ok: true, value: v as RelayInput };
  if (
    v.type === 'dispatch' &&
    keys(v, ['sequence', 'type', 'actionId']) &&
    ACTION_IDS.includes(v.actionId as ActionId)
  )
    return { ok: true, value: v as RelayInput };
  if (
    ['chooseCard', 'buyCard'].includes(v.type) &&
    keys(v, ['sequence', 'type', 'cardId']) &&
    CARD_IDS.has(v.cardId as string)
  )
    return { ok: true, value: v as RelayInput };
  if (
    v.type === 'beat' &&
    keys(v, ['sequence', 'type', 'choiceIndex']) &&
    integer(v.choiceIndex, 16)
  )
    return { ok: true, value: v as RelayInput };
  if (
    v.type === 'rest' &&
    keys(v, ['sequence', 'type', 'option']) &&
    ['heal', 'repay'].includes(v.option as string)
  )
    return { ok: true, value: v as RelayInput };
  if (
    v.type === 'recruit' &&
    keys(v, ['sequence', 'type', 'option']) &&
    ['hire', 'skip'].includes(v.option as string)
  )
    return { ok: true, value: v as RelayInput };
  return fail('unknown-or-invalid-command');
}

function session(file: QuarterRelayFile, receipt: RelayReceipt): RelaySession {
  const engine = cloneEngine(file.boundary);
  const inputs: RelayInput[] = [];
  const costs = { interventionFocusNetSpent: 0, cardFocusNetSpent: 0 };
  const complete = () => {
    const s = engine.snapshot();
    return s.status !== 'playing' || s.phase === 'quarterReview';
  };
  function view(): RelayView {
    const { runKind: _kind, dailyDate: _date, ...state } = engine.snapshot();
    return structuredClone({
      mode: 'quarter-relay-prototype',
      ruleset: file.ruleset,
      receipt,
      memo: file.memo,
      manifest: file.manifest,
      state,
      acceptedInputs: inputs.length,
      costs,
      complete: complete(),
      result: complete()
        ? { status: state.status, winType: state.winType ?? null, review: state.quarterReview }
        : null,
      rewardEligible: false,
      metaReward: 0,
      dailyReward: 0,
    });
  }
  function act(raw: string): Result<null> {
    const parsed = parseInput(raw);
    if (!parsed.ok) return parsed;
    if (complete()) return fail('complete');
    if (inputs.length >= RELAY_LIMITS.inputs) return fail('input-limit');
    const input = parsed.value;
    if (input.sequence !== inputs.length) return fail('out-of-order-or-duplicate');
    const before = engine.snapshot();
    switch (input.type) {
      case 'begin':
        engine.beginSetupSprint();
        break;
      case 'tick':
        if (before.phase !== 'sprint') return fail('wrong-phase');
        engine.step(RELAY_LIMITS.tickMs);
        break;
      case 'result':
        engine.acknowledgeResult();
        break;
      case 'skipDraft':
        engine.skipDraft();
        break;
      case 'finishEvolution':
        engine.finishEvolution();
        break;
      case 'leaveShop':
        engine.leaveShop();
        break;
      case 'chooseCard':
        engine.chooseCard(input.cardId);
        break;
      case 'buyCard':
        engine.buyShopCard(input.cardId);
        break;
      case 'rest':
        engine.restChoose(input.option);
        break;
      case 'recruit':
        engine.recruitChoose(input.option);
        break;
      case 'playCard': {
        const outcome = engine.playCard(input.deckIndex);
        if (!outcome.ok) return fail(`play:${outcome.reason}`);
        break;
      }
      case 'dispatch': {
        const outcome = engine.dispatch(input.actionId);
        if (!outcome.ok) return fail(`dispatch:${outcome.reason}`);
        break;
      }
      case 'beat': {
        const event = before.beat && getEvent(before.beat.eventId);
        if (
          !event ||
          !event.choices[input.choiceIndex] ||
          (before.beat?.kind === 'judgment' && input.choiceIndex !== 0)
        )
          return fail('invalid-beat-choice');
        engine.resolveBeat(input.choiceIndex);
        break;
      }
    }
    const after = engine.snapshot();
    if (equal(before, after)) return fail('no-change-or-wrong-phase');
    const spent = (before.sprint?.focus ?? 0) - (after.sprint?.focus ?? 0);
    if (input.type === 'dispatch') costs.interventionFocusNetSpent += spent;
    if (input.type === 'playCard') costs.cardFocusNetSpent += spent;
    // 達成/継続不能は通常の自動WinType/敗北判定。未達はQ3へ進めず固定二期で停止。
    if (engine.currentPhase() === 'quarterReview') engine.acknowledgeQuarterReview();
    inputs.push(input);
    return { ok: true, value: null };
  }
  function checkpoint() {
    const frame = engine.exportCounterfactualFrame() ?? engine.exportReplayFrame();
    return {
      stateHash: hash(view()),
      engineHash: hash(frame),
      rngState: engine.exportCounterfactualFrame()?.sprintRngState ?? null,
    };
  }
  return Object.freeze({
    act,
    view,
    save: () =>
      JSON.stringify({
        format: 'devops-tycoon-quarter-relay-save',
        version: 1,
        file,
        receipt,
        inputs,
        checkpoint: checkpoint(),
      }),
  });
}

/** 同じfileの受領ごとに新branch IDを発行。名前・指紋は本人性や一意な受領を証明しない。 */
export function importQuarterRelay(raw: string, recipient: string): Result<RelaySession> {
  if (!participant(recipient)) return fail('invalid-recipient');
  const parsed = parseQuarterRelay(raw);
  if (!parsed.ok) return parsed;
  const file = parsed.value;
  const receipt: RelayReceipt = {
    branchId: crypto.randomUUID(),
    parentFingerprint: file.fingerprint,
    assignments: [
      structuredClone(file.assignments[0]),
      { order: 2, quarter: 2, participant: recipient },
    ],
  };
  return { ok: true, value: session(file, receipt) };
}

/** 受領branchは維持。実入力を新RunEngineで再生し、内部状態・RNG位置まで照合する。 */
export function resumeQuarterRelay(raw: string): Result<RelaySession> {
  const parsed = json(raw, RELAY_LIMITS.saveChars);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (
    !object(v) ||
    !keys(v, ['format', 'version', 'file', 'receipt', 'inputs', 'checkpoint']) ||
    v.format !== 'devops-tycoon-quarter-relay-save' ||
    v.version !== 1
  )
    return fail('invalid-save-format');
  const file = parseQuarterRelay(JSON.stringify(v.file));
  if (!file.ok) return file;
  const receipt = v.receipt;
  if (
    !object(receipt) ||
    !keys(receipt, ['branchId', 'parentFingerprint', 'assignments']) ||
    typeof receipt.branchId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      receipt.branchId,
    ) ||
    receipt.parentFingerprint !== file.value.fingerprint ||
    !Array.isArray(receipt.assignments) ||
    receipt.assignments.length !== 2 ||
    !equal(receipt.assignments[0], file.value.assignments[0])
  )
    return fail('invalid-receipt');
  const receiver: unknown = receipt.assignments[1];
  if (
    !object(receiver) ||
    !keys(receiver, ['order', 'quarter', 'participant']) ||
    receiver.order !== 2 ||
    receiver.quarter !== 2 ||
    !participant(receiver.participant)
  )
    return fail('invalid-receipt');
  if (!Array.isArray(v.inputs) || v.inputs.length > RELAY_LIMITS.inputs) return fail('input-limit');
  const opened = session(file.value, structuredClone(receipt) as unknown as RelayReceipt);
  for (const input of v.inputs) {
    const applied = opened.act(JSON.stringify(input));
    if (!applied.ok) return fail(`invalid-history:${applied.reason}`);
  }
  const replayed = JSON.parse(opened.save()) as { checkpoint: unknown };
  if (!equal(v.checkpoint, replayed.checkpoint)) return fail('checkpoint-mismatch');
  return { ok: true, value: opened };
}
