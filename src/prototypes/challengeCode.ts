/** RI-298: 通常UI・保存・報酬から隔離した、カード「発動禁止」の実エンジン試作。 */
import { ACTION_IDS } from '../data/actionIds';
import { BALANCE_RULESET_FINGERPRINT, BALANCE_RULESET_VERSION } from '../data/balance';
import { sha256Hex } from '../data/balance/canonical';
import { CARD_DEFS } from '../data/cards';
import { getEvent } from '../data/events';
import { allGoalAdjustmentIds } from '../data/goalAdjustments';
import { RunEngine } from '../sim/run/engine';
import type { GoalAdjustmentId, RunState } from '../sim/run/types';
import type { ActionId } from '../sim/types';
import { parseStartRecipe, type StartRecipe } from '../state/startRecipe';

export const CHALLENGE_RULESET = 'ri298-activation-ban-v1';
export const CHALLENGE_LIMITS = Object.freeze({
  codeChars: 16_384,
  saveChars: 524_288,
  inputChars: 256,
  seedChars: 128,
  inputs: 4096,
  interventions: 1000,
  tickMs: 1000,
  nesting: 16,
});

export interface ChallengeCode {
  format: 'devops-tycoon-challenge';
  version: 1;
  ruleset: { prototype: string; balanceVersion: number; balanceFingerprint: string };
  recipe: StartRecipe;
  restrictions: [{ kind: 'forbid-activation'; cardIds: string[] }];
  objective: { kind: 'successful-interventions'; minimum: number };
}

export type ChallengeFailure = { ok: false; reason: string };
type Result<T> = { ok: true; value: T } | ChallengeFailure;

export type ChallengeInput =
  | { type: 'begin' | 'tick' | 'result' | 'skipDraft' | 'finishEvolution' | 'leaveShop' | 'review' }
  | { type: 'playCard' | 'exchangeCard'; deckIndex: number }
  | { type: 'dispatch'; actionId: ActionId }
  | { type: 'chooseCard' | 'buyCard'; cardId: string }
  | { type: 'beat'; choiceIndex: number }
  | { type: 'rest'; option: 'heal' | 'repay' }
  | { type: 'recruit'; option: 'hire' | 'skip' }
  | { type: 'adjust'; adjustmentId: GoalAdjustmentId };

/** エンジンと通常RunStateを外へ渡さない。viewは呼出しごとに独立した値。 */
export interface ChallengeSession {
  act(rawInput: string): Result<null>;
  view(): ChallengeView;
  save(): string;
}

export interface ChallengeView {
  mode: 'challenge-prototype';
  ruleset: ChallengeCode['ruleset'];
  state: Omit<RunState, 'runKind' | 'dailyDate'>;
  objective: {
    kind: 'successful-interventions';
    minimum: number;
    measured: number;
    achieved: boolean;
  };
  /** 課題達成は勝利を上書きしない。達成済み敗北もあり得る。 */
  result: null | {
    status: RunState['status'];
    winType: RunState['winType'] | null;
    objectiveAchieved: boolean;
    rewardEligible: false;
    metaReward: 0;
    dailyReward: 0;
  };
  acceptedInputs: number;
  costs: {
    interventionFocusNetSpent: number;
    cardFocusNetSpent: number;
    exchangeFocusNetSpent: number;
  };
}

const fail = (reason: string): ChallengeFailure => ({ ok: false, reason });
const CARD_IDS = new Set(CARD_DEFS.map(({ id }) => id));
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).length === names.length &&
  names.every((name) => Object.prototype.hasOwnProperty.call(v, name));
const integer = (v: unknown, max: number) =>
  Number.isInteger(v) && Number(v) >= 0 && Number(v) <= max;

function json(raw: string, max: number): Result<unknown> {
  if (typeof raw !== 'string' || raw.length > max) return fail('input-too-large-or-not-string');
  try {
    const value: unknown = JSON.parse(raw);
    const pending = [{ value, depth: 0 }];
    while (pending.length) {
      const item = pending.pop()!;
      if (item.value === null || typeof item.value !== 'object') continue;
      if (item.depth >= CHALLENGE_LIMITS.nesting) return fail('json-too-deep');
      for (const child of Object.values(item.value))
        pending.push({ value: child, depth: item.depth + 1 });
    }
    return { ok: true, value };
  } catch {
    return fail('invalid-json');
  }
}

export function challengeRuleset(): ChallengeCode['ruleset'] {
  return {
    prototype: CHALLENGE_RULESET,
    balanceVersion: BALANCE_RULESET_VERSION,
    balanceFingerprint: BALANCE_RULESET_FINGERPRINT,
  };
}

/** #669へ依存せず、既存のStartRecipe parserをそのまま読む。 */
export function parseChallengeCode(raw: string): Result<ChallengeCode> {
  const parsed = json(raw, CHALLENGE_LIMITS.codeChars);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (
    !object(v) ||
    !keys(v, ['format', 'version', 'ruleset', 'recipe', 'restrictions', 'objective'])
  )
    return fail('invalid-challenge-shape');
  if (v.format !== 'devops-tycoon-challenge' || v.version !== 1) return fail('unsupported-format');
  const rules = v.ruleset;
  const current = challengeRuleset();
  if (
    !object(rules) ||
    !keys(rules, ['prototype', 'balanceVersion', 'balanceFingerprint']) ||
    rules.prototype !== current.prototype ||
    rules.balanceVersion !== current.balanceVersion ||
    rules.balanceFingerprint !== current.balanceFingerprint
  )
    return fail('ruleset-mismatch');
  if (
    !object(v.recipe) ||
    !keys(v.recipe, [
      'schemaVersion',
      'seed',
      'difficulty',
      'trials',
      'scenario',
      'preferredCardIds',
    ])
  )
    return fail('invalid-recipe-shape');
  const recipe = parseStartRecipe(JSON.stringify(v.recipe));
  if (!recipe.ok) return fail(`recipe:${recipe.reason}`);
  if (recipe.recipe.seed.length > CHALLENGE_LIMITS.seedChars) return fail('seed-too-long');
  // 複数のallow/denyや重複指示を合成せず、一種類一件の契約として理由付き拒否。
  if (!Array.isArray(v.restrictions) || v.restrictions.length !== 1)
    return fail('conflicting-restrictions:exactly-one-required');
  const restriction: unknown = v.restrictions[0];
  if (
    !object(restriction) ||
    !keys(restriction, ['kind', 'cardIds']) ||
    restriction.kind !== 'forbid-activation'
  )
    return fail('unsupported-restriction');
  const ids = restriction.cardIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > CARD_IDS.size)
    return fail('invalid-card-list');
  if (!ids.every((id) => typeof id === 'string' && CARD_IDS.has(id))) return fail('unknown-card');
  if (new Set(ids).size !== ids.length) return fail('duplicate-card-rule');
  const objective = v.objective;
  if (
    !object(objective) ||
    !keys(objective, ['kind', 'minimum']) ||
    objective.kind !== 'successful-interventions'
  )
    return fail('unsupported-objective');
  if (!integer(objective.minimum, CHALLENGE_LIMITS.interventions) || Number(objective.minimum) < 1)
    return fail('invalid-objective-minimum');
  return {
    ok: true,
    value: {
      format: 'devops-tycoon-challenge',
      version: 1,
      ruleset: current,
      recipe: recipe.recipe,
      restrictions: [{ kind: 'forbid-activation', cardIds: [...ids].sort() }],
      objective: { kind: 'successful-interventions', minimum: Number(objective.minimum) },
    },
  };
}

function parseInput(raw: string): Result<ChallengeInput> {
  const parsed = json(raw, CHALLENGE_LIMITS.inputChars);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!object(v) || typeof v.type !== 'string') return fail('invalid-command');
  if (
    ['begin', 'tick', 'result', 'skipDraft', 'finishEvolution', 'leaveShop', 'review'].includes(
      v.type,
    ) &&
    keys(v, ['type'])
  )
    return { ok: true, value: v as ChallengeInput };
  if (
    ['playCard', 'exchangeCard'].includes(v.type) &&
    keys(v, ['type', 'deckIndex']) &&
    integer(v.deckIndex, CHALLENGE_LIMITS.inputs)
  )
    return { ok: true, value: v as ChallengeInput };
  if (
    v.type === 'dispatch' &&
    keys(v, ['type', 'actionId']) &&
    typeof v.actionId === 'string' &&
    ACTION_IDS.some((id) => id === v.actionId)
  )
    return { ok: true, value: { type: 'dispatch', actionId: v.actionId as ActionId } };
  if (
    ['chooseCard', 'buyCard'].includes(v.type) &&
    keys(v, ['type', 'cardId']) &&
    typeof v.cardId === 'string' &&
    CARD_IDS.has(v.cardId)
  )
    return { ok: true, value: v as ChallengeInput };
  if (v.type === 'beat' && keys(v, ['type', 'choiceIndex']) && integer(v.choiceIndex, 16))
    return { ok: true, value: v as ChallengeInput };
  if (
    v.type === 'rest' &&
    keys(v, ['type', 'option']) &&
    typeof v.option === 'string' &&
    ['heal', 'repay'].includes(v.option)
  )
    return { ok: true, value: v as ChallengeInput };
  if (
    v.type === 'recruit' &&
    keys(v, ['type', 'option']) &&
    typeof v.option === 'string' &&
    ['hire', 'skip'].includes(v.option)
  )
    return { ok: true, value: v as ChallengeInput };
  if (
    v.type === 'adjust' &&
    keys(v, ['type', 'adjustmentId']) &&
    allGoalAdjustmentIds().includes(v.adjustmentId as GoalAdjustmentId)
  )
    return { ok: true, value: v as ChallengeInput };
  return fail('unknown-or-invalid-command');
}

function session(code: ChallengeCode): ChallengeSession {
  const engine = new RunEngine({
    seed: code.recipe.seed,
    difficulty: code.recipe.difficulty,
    trials: code.recipe.trials,
  });
  engine.setPreferredCards(code.recipe.preferredCardIds);
  engine.startRun(code.recipe.difficulty, code.recipe.trials, code.recipe.seed, {
    scenario: code.recipe.scenario,
  });
  const forbidden = new Set(code.restrictions[0].cardIds);
  const inputs: ChallengeInput[] = [];
  let interventions = 0;
  const costs = { interventionFocusNetSpent: 0, cardFocusNetSpent: 0, exchangeFocusNetSpent: 0 };

  function view(): ChallengeView {
    const { runKind: _kind, dailyDate: _date, ...state } = engine.snapshot();
    const achieved = interventions >= code.objective.minimum;
    return {
      mode: 'challenge-prototype',
      ruleset: { ...code.ruleset },
      state,
      objective: { ...code.objective, measured: interventions, achieved },
      result:
        state.status === 'playing'
          ? null
          : {
              status: state.status,
              winType: state.winType ?? null,
              objectiveAchieved: achieved,
              rewardEligible: false,
              metaReward: 0,
              dailyReward: 0,
            },
      acceptedInputs: inputs.length,
      costs: { ...costs },
    };
  }

  function act(raw: string): Result<null> {
    const parsed = parseInput(raw);
    if (!parsed.ok) return parsed;
    if (engine.snapshot().status !== 'playing') return fail('complete');
    if (inputs.length >= CHALLENGE_LIMITS.inputs) return fail('input-limit');
    const input = parsed.value;
    const before = engine.snapshot();
    // indexは呼出し時の実deckで照合。由来（event/draft/shop）や手札交換に依存しない。
    if (input.type === 'playCard' && forbidden.has(before.deck[input.deckIndex]?.defId))
      return fail('forbidden-card-activation');
    switch (input.type) {
      case 'begin':
        engine.beginSetupSprint();
        break;
      case 'tick':
        if (before.phase !== 'sprint') return fail('wrong-phase');
        engine.step(CHALLENGE_LIMITS.tickMs);
        break;
      case 'playCard': {
        const outcome = engine.playCard(input.deckIndex);
        if (!outcome.ok) return fail(`play:${outcome.reason}`);
        break;
      }
      case 'exchangeCard': {
        const outcome = engine.exchangeCard(input.deckIndex);
        if (!outcome.ok) return fail(`exchange:${outcome.reason}`);
        break;
      }
      case 'dispatch': {
        const outcome = engine.dispatch(input.actionId);
        if (!outcome.ok) return fail(`dispatch:${outcome.reason}`);
        interventions += 1;
        break;
      }
      case 'result':
        engine.acknowledgeResult();
        break;
      case 'skipDraft':
        engine.skipDraft();
        break;
      case 'chooseCard':
        engine.chooseCard(input.cardId);
        break;
      case 'finishEvolution':
        engine.finishEvolution();
        break;
      case 'buyCard':
        engine.buyShopCard(input.cardId);
        break;
      case 'leaveShop':
        engine.leaveShop();
        break;
      case 'rest':
        engine.restChoose(input.option);
        break;
      case 'recruit':
        engine.recruitChoose(input.option);
        break;
      case 'review':
        engine.acknowledgeQuarterReview();
        break;
      case 'adjust':
        engine.chooseGoalAdjustment(input.adjustmentId);
        break;
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
    if (JSON.stringify(before) === JSON.stringify(after)) return fail('no-change-or-wrong-phase');
    const focusNetSpent = (before.sprint?.focus ?? 0) - (after.sprint?.focus ?? 0);
    if (input.type === 'dispatch') costs.interventionFocusNetSpent += focusNetSpent;
    if (input.type === 'playCard') costs.cardFocusNetSpent += focusNetSpent;
    if (input.type === 'exchangeCard') costs.exchangeFocusNetSpent += focusNetSpent;
    inputs.push(input);
    return { ok: true, value: null };
  }

  function checkpoint() {
    // 全内部状態（累算ms・乱数位置・課金台帳も含む）を再生結果と照合。外部値をhydrateしない。
    const frame = engine.exportCounterfactualFrame() ?? engine.exportReplayFrame();
    return {
      stateHash: sha256Hex(JSON.stringify(view())),
      engineHash: sha256Hex(JSON.stringify(frame)),
      rngState: engine.exportCounterfactualFrame()?.sprintRngState ?? null,
    };
  }

  return Object.freeze({
    act,
    view,
    save: () =>
      JSON.stringify({
        format: 'devops-tycoon-challenge-save',
        version: 1,
        code,
        inputs,
        checkpoint: checkpoint(),
      }),
  });
}

export function openChallenge(raw: string): Result<ChallengeSession> {
  const parsed = parseChallengeCode(raw);
  return parsed.ok ? { ok: true, value: session(parsed.value) } : parsed;
}

/** 初期条件＋受理入力を実RunEngineで再生し、実測値とRNGを照合して再開する。 */
export function resumeChallenge(raw: string): Result<ChallengeSession> {
  const parsed = json(raw, CHALLENGE_LIMITS.saveChars);
  if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (
    !object(v) ||
    !keys(v, ['format', 'version', 'code', 'inputs', 'checkpoint']) ||
    v.format !== 'devops-tycoon-challenge-save' ||
    v.version !== 1
  )
    return fail('invalid-save-format');
  if (!Array.isArray(v.inputs) || v.inputs.length > CHALLENGE_LIMITS.inputs)
    return fail('input-limit');
  const opened = openChallenge(JSON.stringify(v.code));
  if (!opened.ok) return opened;
  for (const input of v.inputs) {
    const applied = opened.value.act(JSON.stringify(input));
    if (!applied.ok) return fail(`invalid-history:${applied.reason}`);
  }
  const replayed = JSON.parse(opened.value.save()) as { checkpoint: unknown };
  if (JSON.stringify(replayed.checkpoint) !== JSON.stringify(v.checkpoint))
    return fail('checkpoint-mismatch');
  return opened;
}
