import { describe, expect, it } from 'vitest';
import exampleJSON from '../../docs/prototypes/scenario-authoring-example.json';
import { DIFFICULTY_DEFS } from '../data/difficulties';
import { RunEngine } from '../sim/run/engine';
import { createSprintFromBaselineInput } from '../sim/run/sprintBaseline';
import { getRngState } from '../sim/rng';
import { SCENARIOS } from '../sim/scenarios';
import { parseStartRecipe, serializeStartRecipe } from '../state/startRecipe';
import {
  authorScenarioExample,
  parseAuthorScenario,
  ScenarioAuthoring,
  SCENARIO_AUTHORING_LIMITS,
} from './scenarioAuthoring';

interface InvalidFixture {
  [key: string]: unknown;
  base: Record<string, unknown>;
  initialOrg: Record<string, unknown>;
  ruleset: Record<string, unknown>;
  taskKinds: unknown[];
}
interface CheckpointFixture {
  [key: string]: unknown;
  schemaVersion: number;
  tick: number;
  rngState: number;
  scenario?: unknown;
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false }): T {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result.value;
}
function ready(seed = 'RI-273:1') {
  return unwrap(ScenarioAuthoring.fromJSON(JSON.stringify(authorScenarioExample(seed))));
}

describe('RI-273 scenario authoring', () => {
  it('配布例と最大入力が開始・完了・JSON再開できる', () => {
    expect(unwrap(parseAuthorScenario(JSON.stringify(exampleJSON)))).toEqual(
      authorScenarioExample(),
    );
    const v = authorScenarioExample('s'.repeat(128));
    v.taskKinds = Array(120).fill('complex');
    const run = unwrap(ScenarioAuthoring.fromJSON(JSON.stringify(v)));
    run.start();
    expect(unwrap(ScenarioAuthoring.resume(unwrap(run.checkpoint()))).snapshot()).toEqual(
      run.snapshot(),
    );
    run.advance(1501);
    expect(run.result()).not.toBeNull();
    expect(unwrap(ScenarioAuthoring.resume(unwrap(run.checkpoint()))).snapshot()).toEqual(
      run.snapshot(),
    );
  });
  it('実RunEngineの開始条件と実simのタスク初期化に接続し、3項目だけを変更する', () => {
    const scenario = authorScenarioExample();
    const engine = new RunEngine({ seed: scenario.base.seed });
    engine.startRun('normal', [], scenario.base.seed, { scenario: 'default' });
    engine.beginSetupSprint();
    const baseline = engine.exportCounterfactualFrame()!.sprintBaselineInput!;
    const org = { ...baseline.org, ...scenario.initialOrg };
    const { sprint, rng } = createSprintFromBaselineInput(
      { ...baseline, config: { ...baseline.config, taskCount: scenario.taskKinds.length } },
      org,
    );
    const run = ready();
    expect(run.start().ok).toBe(true);
    const board = run.snapshot().board!;
    expect(board.org).toEqual(org);
    expect(board.rngState).toBe(getRngState(rng));
    expect(board.sprint.tasks).toEqual(
      sprint.tasks.map((task, i) => ({ ...task, kind: scenario.taskKinds[i] })),
    );
    expect(board.sprint.config).toEqual(sprint.config);
    expect(board.initialBudget).toBe(engine.snapshot().budget);
    expect(run.snapshot().rewardsEligible).toBe(false);
  });

  it.each(['RI-273:1', 'RI-273:2', 'RI-273:3'])(
    '%s: 同じJSONで盤面/RNG/結果が一致し途中JSONから同じ続きを再開する',
    (seed) => {
      const a = ready(seed);
      const b = ready(seed);
      a.start();
      b.start();
      expect(a.snapshot()).toEqual(b.snapshot());
      a.advance(13);
      b.advance(13);
      const resumed = unwrap(ScenarioAuthoring.resume(unwrap(a.checkpoint())));
      expect(resumed.snapshot()).toEqual(a.snapshot());
      a.advance(1501);
      b.advance(1501);
      resumed.advance(1501);
      expect(a.snapshot()).toEqual(b.snapshot());
      expect(a.snapshot()).toEqual(resumed.snapshot());
      expect(a.result()).toEqual(resumed.result());
      expect(a.result()).not.toBeNull();
      expect(unwrap(ScenarioAuthoring.resume(unwrap(a.checkpoint()))).snapshot()).toEqual(
        a.snapshot(),
      );
    },
  );

  it('全既存難易度/シナリオIDを厳密に受け付ける', () => {
    for (const difficulty of Object.keys(DIFFICULTY_DEFS)) {
      for (const scenario of Object.keys(SCENARIOS)) {
        const v = authorScenarioExample();
        const raw = JSON.stringify({ ...v, base: { ...v.base, difficulty, scenario } });
        const run = unwrap(ScenarioAuthoring.fromJSON(raw));
        expect(run.start().ok).toBe(true);
        expect(run.snapshot().board!.sprint.tasks).toHaveLength(24);
      }
    }
  });

  it('通常StartRecipe/セーブを混同せず、通常形式へ作者値を渡さない', () => {
    const raw = serializeStartRecipe({
      seed: 'a',
      difficulty: 'normal',
      scenario: 'default',
      trials: [],
      preferredCardIds: [],
    });
    expect(parseAuthorScenario(raw).ok).toBe(false);
    expect(parseStartRecipe(JSON.stringify(authorScenarioExample())).ok).toBe(false);
    const run = ready();
    run.start();
    expect(parseStartRecipe(unwrap(run.checkpoint())).ok).toBe(false);
    expect(ScenarioAuthoring.resume(JSON.stringify(authorScenarioExample())).ok).toBe(false);
    expect(parseAuthorScenario(unwrap(run.checkpoint())).ok).toBe(false);
  });

  it.each([
    [
      '$.base.scenario',
      'unknown_id',
      (v: InvalidFixture) => {
        v.base.scenario = 'missing';
      },
    ],
    [
      '$.base.difficulty',
      'unknown_id',
      (v: InvalidFixture) => {
        v.base.difficulty = '__proto__';
      },
    ],
    [
      '$.taskKinds[0]',
      'unknown_id',
      (v: InvalidFixture) => {
        v.taskKinds[0] = 'arbitrary-code()';
      },
    ],
    [
      '$.extra',
      'unknown_key',
      (v: InvalidFixture) => {
        v.extra = true;
      },
    ],
    [
      '$.base.trials',
      'unknown_key',
      (v: InvalidFixture) => {
        v.base.trials = [];
      },
    ],
    [
      '$.initialOrg.quality',
      'unknown_key',
      (v: InvalidFixture) => {
        v.initialOrg.quality = 50;
      },
    ],
    [
      '$.ruleset.extra',
      'unknown_key',
      (v: InvalidFixture) => {
        v.ruleset.extra = 1;
      },
    ],
    [
      '$.ruleset',
      'ruleset_mismatch',
      (v: InvalidFixture) => {
        v.ruleset.balanceFingerprint = 'old';
      },
    ],
    [
      '$.schemaVersion',
      'unsupported_version',
      (v: InvalidFixture) => {
        v.schemaVersion = 2;
      },
    ],
    [
      '$.initialOrg.testCoverage',
      'out_of_range',
      (v: InvalidFixture) => {
        v.initialOrg.testCoverage = -1;
      },
    ],
    [
      '$.initialOrg.documentation',
      'out_of_range',
      (v: InvalidFixture) => {
        v.initialOrg.documentation = 101;
      },
    ],
    [
      '$.taskKinds',
      'out_of_range',
      (v: InvalidFixture) => {
        v.taskKinds = [];
      },
    ],
    [
      '$.taskKinds',
      'out_of_range',
      (v: InvalidFixture) => {
        v.taskKinds = Array(121).fill('normal');
      },
    ],
    [
      '$.base.seed',
      'out_of_range',
      (v: InvalidFixture) => {
        v.base.seed = 'a'.repeat(129);
      },
    ],
  ])('%s: %sを理由/場所付きで拒否', (path, reason, edit) => {
    const v: InvalidFixture = JSON.parse(JSON.stringify(authorScenarioExample()));
    edit(v);
    expect(parseAuthorScenario(JSON.stringify(v))).toMatchObject({
      ok: false,
      path,
      reason,
      message: expect.any(String),
    });
  });

  it('非有限・欠落・型違い・破損・コード・入力上限を拒否する', () => {
    const raw = JSON.stringify(authorScenarioExample());
    for (const value of ['null', '"55"', 'true', '1e400', '-1e400']) {
      expect(
        parseAuthorScenario(raw.replace('"testCoverage":55', `"testCoverage":${value}`)),
      ).toMatchObject({ ok: false, path: '$.initialOrg.testCoverage' });
    }
    for (const bad of [
      '{}',
      'null',
      '[]',
      '{',
      '(()=>{throw 1})()',
      raw.replace('"documentation":50', '"x":50'),
    ]) {
      expect(parseAuthorScenario(bad).ok).toBe(false);
    }
    expect(
      parseAuthorScenario(' '.repeat(SCENARIO_AUTHORING_LIMITS.jsonCodeUnits + 1)),
    ).toMatchObject({ reason: 'too_large' });
    const boundary = authorScenarioExample();
    boundary.initialOrg = { testCoverage: 0, documentation: 100 };
    boundary.taskKinds = Array(120).fill('complex');
    expect(parseAuthorScenario(JSON.stringify(boundary)).ok).toBe(true);
  });

  it('開始前/二重開始/不正tick/完了後操作を無消費で拒否しsnapshotを外から変更できない', () => {
    const run = ready();
    expect(run.advance(1)).toMatchObject({ reason: 'not_started' });
    expect(run.checkpoint()).toMatchObject({ reason: 'not_started' });
    run.start();
    const before = run.snapshot();
    expect(run.start()).toMatchObject({ reason: 'already_started' });
    for (const ticks of [0, -1, 1.5, NaN, Infinity, 1502])
      expect(run.advance(ticks).ok).toBe(false);
    expect(run.snapshot()).toEqual(before);
    const copy = run.snapshot();
    copy.board!.org.testCoverage = -999;
    copy.scenario.taskKinds.length = 0;
    expect(run.snapshot()).toEqual(before);
    run.advance(1501);
    const after = run.snapshot();
    const result = run.result();
    expect(run.advance(1)).toMatchObject({ reason: 'complete' });
    expect(run.start()).toMatchObject({ reason: 'already_started' });
    expect(run.snapshot()).toEqual(after);
    expect(run.result()).toEqual(result);
  });

  it('チェックポイントの未知キー/RNG改変/終端後tick/版/上限/矛盾を拒否する', () => {
    const run = ready();
    run.start();
    run.advance(1501);
    const raw = unwrap(run.checkpoint());
    for (const edit of [
      (v: CheckpointFixture) => {
        v.extra = true;
      },
      (v: CheckpointFixture) => {
        v.schemaVersion = 2;
      },
      (v: CheckpointFixture) => {
        v.rngState = (v.rngState + 1) >>> 0;
      },
      (v: CheckpointFixture) => {
        v.rngState = 2 ** 32;
      },
      (v: CheckpointFixture) => {
        v.tick = 1501;
      },
      (v: CheckpointFixture) => {
        v.tick = -1;
      },
      (v: CheckpointFixture) => {
        delete v.scenario;
      },
    ]) {
      const v = JSON.parse(raw);
      edit(v);
      expect(ScenarioAuthoring.resume(JSON.stringify(v)).ok).toBe(false);
    }
    expect(ScenarioAuthoring.resume(' '.repeat(20_481))).toMatchObject({ reason: 'too_large' });
    expect(run.snapshot().rewardsEligible).toBe(false);
  });
});
