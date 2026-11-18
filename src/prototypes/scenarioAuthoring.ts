/** RI-273: 作者JSONの読込・開始盤面・無介入の再現だけを扱う隔離API。 */
import { BALANCE_RULESET_FINGERPRINT, BALANCE_RULESET_VERSION } from '../data/balance';
import { DIFFICULTY_DEFS } from '../data/difficulties';
import { RunEngine } from '../sim/run/engine';
import { createSprintFromBaselineInput } from '../sim/run/sprintBaseline';
import { createRngFromState, getRngState } from '../sim/rng';
import { SCENARIOS } from '../sim/scenarios';
import { stepSprint, summarizeSprint } from '../sim/sprint';
import type { DifficultyId } from '../sim/run/types';
import type { OrgState, ScenarioId, SprintState, TaskKind } from '../sim/types';

export const SCENARIO_AUTHORING_LIMITS = {
  jsonCodeUnits: 16_384,
  checkpointCodeUnits: 20_480,
  seedCodeUnits: 128,
  tasks: 120,
  ticks: 1501,
} as const;
const RULESET = {
  prototype: 'ri273-scenario-authoring-v1',
  balanceVersion: BALANCE_RULESET_VERSION,
  balanceFingerprint: BALANCE_RULESET_FINGERPRINT,
} as const;

export interface AuthorScenario {
  kind: 'scenario-authoring-prototype';
  schemaVersion: 1;
  ruleset: typeof RULESET;
  base: { seed: string; difficulty: DifficultyId; scenario: ScenarioId };
  initialOrg: { testCoverage: number; documentation: number };
  taskKinds: TaskKind[];
}

type Reason =
  | 'corrupt'
  | 'too_large'
  | 'unknown_key'
  | 'unsupported_version'
  | 'ruleset_mismatch'
  | 'unknown_id'
  | 'out_of_range'
  | 'not_started'
  | 'already_started'
  | 'complete'
  | 'checkpoint_mismatch';
type Result<T> =
  { ok: true; value: T } | { ok: false; reason: Reason; path: string; message: string };
const fail = (reason: Reason, path: string): Result<never> => ({
  ok: false,
  reason,
  path,
  message: `${path}: ${reason}（RI-273の形式・ID・上限に適合しません）`,
});
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (v: object, key: string) => Object.prototype.hasOwnProperty.call(v, key);
function keys(v: Record<string, unknown>, allowed: readonly string[], path: string) {
  const unknown = Object.keys(v).find((key) => !allowed.includes(key));
  return unknown === undefined ? null : fail('unknown_key', `${path}.${unknown}`);
}
function read(raw: string, limit: number): Result<unknown> {
  if (typeof raw !== 'string') return fail('corrupt', '$');
  if (raw.length > limit) return fail('too_large', '$');
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return fail('corrupt', '$');
  }
}
const finiteIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** 既存StartRecipeや#694のvalidatorを使わず、全階層で未知キーを拒否する。 */
function validate(v: unknown): Result<AuthorScenario> {
  if (!object(v)) return fail('corrupt', '$');
  const extra = keys(
    v,
    ['kind', 'schemaVersion', 'ruleset', 'base', 'initialOrg', 'taskKinds'],
    '$',
  );
  if (extra) return extra;
  if (v.kind !== 'scenario-authoring-prototype') return fail('corrupt', '$.kind');
  if (v.schemaVersion !== 1) return fail('unsupported_version', '$.schemaVersion');
  if (!object(v.ruleset)) return fail('corrupt', '$.ruleset');
  const rules = v.ruleset;
  const extraRule = keys(rules, Object.keys(RULESET), '$.ruleset');
  if (extraRule) return extraRule;
  if (Object.entries(RULESET).some(([key, value]) => rules[key] !== value))
    return fail('ruleset_mismatch', '$.ruleset');
  if (!object(v.base)) return fail('corrupt', '$.base');
  const extraBase = keys(v.base, ['seed', 'difficulty', 'scenario'], '$.base');
  if (extraBase) return extraBase;
  const { seed, difficulty, scenario } = v.base;
  if (
    typeof seed !== 'string' ||
    !seed.trim() ||
    seed.length > SCENARIO_AUTHORING_LIMITS.seedCodeUnits
  )
    return fail('out_of_range', '$.base.seed');
  if (typeof difficulty !== 'string' || !own(DIFFICULTY_DEFS, difficulty))
    return fail('unknown_id', '$.base.difficulty');
  if (typeof scenario !== 'string' || !own(SCENARIOS, scenario))
    return fail('unknown_id', '$.base.scenario');
  if (!object(v.initialOrg)) return fail('corrupt', '$.initialOrg');
  const extraOrg = keys(v.initialOrg, ['testCoverage', 'documentation'], '$.initialOrg');
  if (extraOrg) return extraOrg;
  const { testCoverage, documentation } = v.initialOrg;
  if (!finiteIn(testCoverage, 0, 100)) return fail('out_of_range', '$.initialOrg.testCoverage');
  if (!finiteIn(documentation, 0, 100)) return fail('out_of_range', '$.initialOrg.documentation');
  if (!Array.isArray(v.taskKinds)) return fail('corrupt', '$.taskKinds');
  if (v.taskKinds.length < 1 || v.taskKinds.length > SCENARIO_AUTHORING_LIMITS.tasks)
    return fail('out_of_range', '$.taskKinds');
  const taskKinds: TaskKind[] = [];
  for (const [index, kind] of v.taskKinds.entries()) {
    if (kind !== 'routine' && kind !== 'normal' && kind !== 'complex')
      return fail('unknown_id', `$.taskKinds[${index}]`);
    taskKinds.push(kind);
  }
  return {
    ok: true,
    value: {
      kind: 'scenario-authoring-prototype',
      schemaVersion: 1,
      ruleset: { ...RULESET },
      base: { seed, difficulty: difficulty as DifficultyId, scenario: scenario as ScenarioId },
      initialOrg: { testCoverage, documentation },
      taskKinds,
    },
  };
}

export function parseAuthorScenario(raw: string): Result<AuthorScenario> {
  const parsed = read(raw, SCENARIO_AUTHORING_LIMITS.jsonCodeUnits);
  return parsed.ok ? validate(parsed.value) : parsed;
}

/** コピーを編集してJSON化するための最小例。通常メタの解放を必要としない試作。 */
export function authorScenarioExample(seed = 'RI-273:1'): AuthorScenario {
  return {
    kind: 'scenario-authoring-prototype',
    schemaVersion: 1,
    ruleset: { ...RULESET },
    base: { seed, difficulty: 'normal', scenario: 'default' },
    initialOrg: { testCoverage: 55, documentation: 50 },
    taskKinds: Array.from({ length: 24 }, (_, i) =>
      i < 8 ? 'routine' : i < 16 ? 'normal' : 'complex',
    ),
  };
}

interface Board {
  org: OrgState;
  sprint: SprintState;
  tick: number;
  rngState: number;
  /** 記録用。スプリント検証では課金・精算を行わない。 */
  initialBudget: number;
}

/** 通常GameHandle/storageに渡すRunStateやRunSaveを公開しない。 */
export class ScenarioAuthoring {
  private board: Board | null = null;
  private constructor(private readonly scenario: AuthorScenario) {}

  static fromJSON(raw: string): Result<ScenarioAuthoring> {
    const parsed = parseAuthorScenario(raw);
    return parsed.ok ? { ok: true, value: new ScenarioAuthoring(parsed.value) } : parsed;
  }

  start(): Result<null> {
    if (this.board) return fail('already_started', '$.start');
    const { seed, difficulty, scenario } = this.scenario.base;
    const engine = new RunEngine({ seed, difficulty });
    engine.startRun(difficulty, [], seed, { scenario });
    engine.beginSetupSprint();
    const frame = engine.exportCounterfactualFrame();
    if (!frame?.sprintBaselineInput) throw new Error('RI-273: first sprint baseline unavailable');
    const input = frame.sprintBaselineInput;
    const org = { ...input.org, ...this.scenario.initialOrg };
    const initialized = createSprintFromBaselineInput(
      { ...input, config: { ...input.config, taskCount: this.scenario.taskKinds.length } },
      org,
    );
    // createSprintの2抽選/タスクを維持し、規模だけを作者の順序で上書きする。
    initialized.sprint.tasks.forEach((task, index) => {
      task.kind = this.scenario.taskKinds[index];
    });
    this.board = {
      org,
      sprint: initialized.sprint,
      tick: 0,
      rngState: getRngState(initialized.rng),
      initialBudget: engine.snapshot().budget,
    };
    return { ok: true, value: null };
  }

  /** 成立したtickだけ消費。無効入力・完了後は盤面/RNG/資源を変更しない。 */
  advance(ticks: number): Result<null> {
    if (!finiteIn(ticks, 1, SCENARIO_AUTHORING_LIMITS.ticks) || !Number.isInteger(ticks))
      return fail('out_of_range', '$.ticks');
    if (!this.board) return fail('not_started', '$.advance');
    if (this.board.sprint.complete) return fail('complete', '$.advance');
    const rng = createRngFromState(this.board.rngState);
    for (let i = 0; i < ticks && !this.board.sprint.complete; i += 1) {
      stepSprint(this.board.sprint, this.board.org, rng, this.board.tick);
      this.board.tick += 1;
    }
    this.board.rngState = getRngState(rng);
    return { ok: true, value: null };
  }

  snapshot() {
    return {
      scenario: structuredClone(this.scenario),
      board: structuredClone(this.board),
      rewardsEligible: false as const,
    };
  }

  result() {
    return this.board?.sprint.complete
      ? structuredClone(summarizeSprint(this.board.sprint, this.board.org))
      : null;
  }

  /** 任意状態は保存せず元条件+tickから再計算する。通常セーブとは別形式。 */
  checkpoint(): Result<string> {
    if (!this.board) return fail('not_started', '$.checkpoint');
    return {
      ok: true,
      value: JSON.stringify({
        kind: 'scenario-authoring-checkpoint',
        schemaVersion: 1,
        scenario: this.scenario,
        tick: this.board.tick,
        rngState: this.board.rngState,
      }),
    };
  }

  static resume(raw: string): Result<ScenarioAuthoring> {
    const parsed = read(raw, SCENARIO_AUTHORING_LIMITS.checkpointCodeUnits);
    if (!parsed.ok) return parsed;
    const v = parsed.value;
    if (!object(v)) return fail('corrupt', '$');
    const extra = keys(v, ['kind', 'schemaVersion', 'scenario', 'tick', 'rngState'], '$');
    if (extra) return extra;
    if (v.kind !== 'scenario-authoring-checkpoint') return fail('corrupt', '$.kind');
    if (v.schemaVersion !== 1) return fail('unsupported_version', '$.schemaVersion');
    const scenario = parseAuthorScenario(JSON.stringify(v.scenario));
    if (!scenario.ok) return scenario;
    if (!finiteIn(v.tick, 0, SCENARIO_AUTHORING_LIMITS.ticks) || !Number.isInteger(v.tick))
      return fail('out_of_range', '$.tick');
    if (!finiteIn(v.rngState, 0, 0xffffffff) || !Number.isInteger(v.rngState))
      return fail('out_of_range', '$.rngState');
    const run = new ScenarioAuthoring(scenario.value);
    run.start();
    if (v.tick > 0) run.advance(v.tick);
    if (run.board!.tick !== v.tick || run.board!.rngState !== v.rngState)
      return fail('checkpoint_mismatch', '$');
    return { ok: true, value: run };
  }
}
