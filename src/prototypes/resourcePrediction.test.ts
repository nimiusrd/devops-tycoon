import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunEngine } from '../sim/run/engine';
import { FIXED_STEP_MS } from '../data/balance/pacing';
import {
  ResourcePredictionPractice,
  RESOURCE_PREDICTION_LIMITS,
  summarizeResourceObservations,
  type ResourceCommand,
  type ResourceObservation,
} from './resourcePrediction';
import {
  resourceSend,
  runResourcePractice,
} from '../../tests/unit/helpers/resourcePredictionFixture';

afterEach(() => vi.unstubAllGlobals());

function begun() {
  const session = new ResourcePredictionPractice('g1');
  expect(resourceSend(session, { type: 'predict', choice: 'reviewQueue', source: 'self' })).toBe(
    true,
  );
  expect(resourceSend(session, { type: 'begin' })).toBe(true);
  return session;
}

describe('RI-277 実sim資源予想API', () => {
  it('初期条件と各tickの実測が通常RunEngineと一致し、予想/skipはRNGも資源も変えない', () => {
    const session = new ResourcePredictionPractice('g1');
    const skipped = new ResourcePredictionPractice('g1');
    const engine = new RunEngine({ seed: 'g1', difficulty: 'normal' });
    engine.startRun();
    const frame = JSON.parse(session.save()).checkpoint.frame;
    expect(session.view().state).toEqual(engine.snapshot());
    expect(resourceSend(session, { type: 'predict', choice: 'reviewQueue', source: 'self' })).toBe(
      true,
    );
    expect(resourceSend(skipped, { type: 'skip' })).toBe(true);
    expect(JSON.parse(session.save()).checkpoint.frame).toEqual(frame);
    expect(resourceSend(session, { type: 'begin' })).toBe(true);
    expect(resourceSend(skipped, { type: 'begin' })).toBe(true);
    engine.beginSetupSprint();
    for (let n = 0; n < 80 && session.view().phase === 'running'; n += 1) {
      if (n === 12) {
        const before = JSON.parse(session.save()).checkpoint.frame;
        expect(
          resourceSend(session, { type: 'change', choice: 'none', source: 'system-what-if' }),
        ).toBe(true);
        expect(JSON.parse(session.save()).checkpoint.frame).toEqual(before);
        expect(session.view().changes[0]).toMatchObject({ tick: 12, source: 'system-what-if' });
      }
      resourceSend(session, { type: 'step' });
      resourceSend(skipped, { type: 'step' });
      engine.step(FIXED_STEP_MS);
      expect(session.view().state).toEqual(engine.snapshot());
      expect(skipped.view().state).toEqual(engine.snapshot());
      const saved = JSON.parse(session.save());
      expect(saved.checkpoint.frame).toEqual(
        engine.exportCounterfactualFrame() ?? engine.exportReplayFrame(),
      );
      expect(saved.checkpoint.sprintRngState).toBe(
        engine.exportCounterfactualFrame()!.sprintRngState,
      );
      const observation = session.view().observations[n + 1];
      expect(observation).toMatchObject({
        tick: n + 1,
        delivered: engine.snapshot().sprint!.metrics.delivered,
        seniorHp: engine.snapshot().org.seniorHp,
        focus: engine.snapshot().sprint!.focus,
      });
    }
    expect(session.view().original).toMatchObject({ choice: 'reviewQueue', tick: null });
    expect(session.view().observations.map((s) => s.tick)).toEqual(
      Array.from({ length: session.view().observations.length }, (_, n) => n),
    );
  });

  it('通常の初回空デッキを保ち、手札操作を無消費拒否する', () => {
    const practice = begun();
    const before = practice.save();
    expect(practice.view().state.deck).toEqual([]);
    for (const type of ['play', 'exchange']) {
      expect(
        practice.apply({ revision: practice.view().revision, command: { type, index: 0 } }),
      ).toBe(false);
      expect(practice.save()).toBe(before);
    }
  });

  it.each(['g1', 'g2', 'g3'])('%sで実操作/実終了を再現し、初回回答を保持する', (seed) => {
    const { session } = runResourcePractice(seed, true);
    const result = session.view();
    expect(result.phase).toBe('complete');
    expect(result.state.sprintsPlayed).toBe(1);
    expect(result.state.lastResult).not.toBeNull();
    expect(result.comparison?.learningEvidence).toBe(false);
    expect(result.observations.filter((s) => s.cause === 'intervene').length).toBeGreaterThan(0);
    const saved = session.save();
    expect(ResourcePredictionPractice.restore(saved)?.save()).toBe(saved);
    expect(runResourcePractice(seed, true).session.save()).toBe(saved);
    for (const command of [
      { type: 'predict', choice: 'none', source: 'self' },
      { type: 'change', choice: 'none', source: 'self' },
      { type: 'skip' },
      { type: 'step' },
      { type: 'begin' },
    ]) {
      expect(session.apply({ revision: result.revision, command })).toBe(false);
      expect(session.save()).toBe(saved);
    }
  });

  it('終端exportがRNGを落としても最後の実tickを照合して保存する', () => {
    const original = RunEngine.prototype.exportCounterfactualFrame;
    const spy = vi
      .spyOn(RunEngine.prototype, 'exportCounterfactualFrame')
      .mockImplementation(function (this: RunEngine) {
        // 実結果を変えず、lostと同じexport制約だけを再現する。
        return this.snapshot().sprint?.complete ? null : original.call(this);
      });
    try {
      const { session } = runResourcePractice('g2');
      const saved = JSON.parse(session.save());
      expect(saved.checkpoint.frame.phase).toBe('result');
      expect(saved.checkpoint.lastLiveFrame.sprint.complete).toBe(false);
      expect(saved.checkpoint.sprintRngState).toBeTypeOf('number');
      expect(ResourcePredictionPractice.restore(session.save())?.save()).toBe(session.save());
    } finally {
      spy.mockRestore();
    }
  });

  it('同じ実入力では回答/skip/変更で通常成果や観測値が変わらない', () => {
    const answered = runResourcePractice('g1').session;
    const skipped = runResourcePractice('g1', false, true).session;
    expect(answered.view().state).toEqual(skipped.view().state);
    expect(answered.view().observations).toEqual(skipped.view().observations);
    expect(skipped.view().comparison?.originalCorrect).toBeNull();
    expect(answered.view().definition.rewardEligible).toBe(false);
  });

  it('同時成立・異なる初回tick・同tick別操作・危機なしを観測から区別する', () => {
    // 集計関数だけの境界fixture。実プレイや比較結果として文書へ転記しない。
    const base: ResourceObservation = {
      index: 0,
      revision: 1,
      tick: 0,
      cause: 'begin',
      budget: 45,
      focus: 10,
      seniorHp: 100,
      morale: 80,
      techDebt: 0,
      aiDependency: 0,
      reviewQueue: 0,
      delivered: 120,
      focusSpent: 0,
      complete: false,
    };
    const tie = summarizeResourceObservations([
      base,
      { ...base, index: 1, tick: 60, reviewQueue: 8, seniorHp: 35, delivered: 99 },
    ]);
    expect(tie.earliest).toEqual(['reviewQueue', 'seniorHp', 'deliveryLag']);
    expect(tie.first.deliveryLag).toEqual({ tick: 60, observationIndex: 1 });
    const different = summarizeResourceObservations([
      base,
      { ...base, index: 1, tick: 4, reviewQueue: 8 },
      { ...base, index: 2, tick: 4, seniorHp: 35 },
    ]);
    expect(different.earliest).toEqual(['reviewQueue']);
    expect(different.first.seniorHp).toEqual({ tick: 4, observationIndex: 2 });
    expect(summarizeResourceObservations([base])).toMatchObject({ noCrisis: true, earliest: [] });
  });

  it('JSONを各段階で再開し、後続入力とRNG位置が一致する', () => {
    const session = new ResourcePredictionPractice('g2');
    const commands: ResourceCommand[] = [
      { type: 'skip' },
      { type: 'begin' },
      ...Array.from({ length: 15 }, () => ({ type: 'step' as const })),
      { type: 'change', choice: 'seniorHp', source: 'unknown' },
    ];
    for (const command of commands) {
      const restored = ResourcePredictionPractice.restore(session.save())!;
      expect(restored).not.toBeNull();
      expect(resourceSend(restored, command)).toBe(resourceSend(session, command));
      expect(restored.save()).toBe(session.save());
    }
    const clone = session.view();
    clone.state.org.seniorHp = -99;
    clone.original!.choice = 'none';
    clone.observations[0].delivered = -99;
    expect(ResourcePredictionPractice.restore(session.save())?.save()).toBe(session.save());
    expect(session.view().original!.choice).toBe('skip');
  });

  it('未知/矛盾/重複/phase違い/不可能な実操作を無消費で拒否する', () => {
    const session = new ResourcePredictionPractice('g1');
    const reject = (command: unknown, revision = session.view().revision) => {
      const before = session.save();
      expect(session.apply({ revision, command })).toBe(false);
      expect(session.save()).toBe(before);
    };
    for (const command of [
      null,
      {},
      { type: 'begin' },
      { type: 'step' },
      { type: 'predict', choice: 'none' },
      { type: 'predict', choice: 'unknown', source: 'self' },
      { type: 'predict', choice: 'none', source: 'bad' },
      { type: 'change', choice: 'none', source: 'self' },
      { type: 'skip', extra: true },
    ])
      reject(command);
    expect(resourceSend(session, { type: 'skip' })).toBe(true);
    reject({ type: 'skip' });
    reject({ type: 'begin' }, 0);
    expect(resourceSend(session, { type: 'begin' })).toBe(true);
    for (const command of [
      { type: 'begin' },
      { type: 'skip' },
      { type: 'predict', choice: 'none', source: 'self' },
      { type: 'step', ms: Infinity },
      { type: 'step', ms: 1000 },
      { type: 'intervene', id: 'unknown' },
      { type: 'intervene', id: 'firefight' },
      { type: 'play', index: -1 },
      { type: 'play', index: 999 },
      { type: 'exchange', index: NaN },
    ])
      reject(command);
    const before = session.save();
    expect(session.apply({ revision: 2, command: { type: 'step' }, extra: 1 })).toBe(false);
    expect(session.save()).toBe(before);
  });

  it('schema/ruleset/BALANCE/RNG/入力列/観測改変とサイズ上限を拒否する', () => {
    const saved = begun().save();
    const mutate = (fn: (raw: ReturnType<typeof JSON.parse>) => void) => {
      const raw = JSON.parse(saved);
      fn(raw);
      expect(ResourcePredictionPractice.restore(JSON.stringify(raw))).toBeNull();
    };
    mutate((x) => x.version++);
    mutate((x) => (x.ruleset.prototype = 'another'));
    mutate((x) => x.ruleset.balanceVersion++);
    mutate((x) => (x.ruleset.balanceFingerprint = 'other'));
    mutate((x) => x.checkpoint.sprintRngState++);
    mutate((x) => x.checkpoint.frame.sprintRngState++);
    mutate((x) => x.checkpoint.observations[0].seniorHp--);
    mutate((x) => (x.inputs[1].revision = 0));
    mutate((x) => (x.inputs[0].command.extra = true));
    mutate((x) => (x.inputs = Array(RESOURCE_PREDICTION_LIMITS.inputs + 1).fill(x.inputs[0])));
    mutate(
      (x) =>
        (x.checkpoint.observations = Array(RESOURCE_PREDICTION_LIMITS.observations + 1).fill(null)),
    );
    mutate(
      (x) =>
        (x.checkpoint.frame.sprint.tasks = Array(RESOURCE_PREDICTION_LIMITS.tasks + 1).fill(null)),
    );
    mutate((x) => (x.seed = 'x'.repeat(81)));
    mutate((x) => (x.extra = 'x'.repeat(RESOURCE_PREDICTION_LIMITS.stringCharacters + 1)));
    mutate((x) => {
      let child = x;
      for (let n = 0; n < 60; n++) child = child.extra = {};
    });
    expect(
      ResourcePredictionPractice.restore(' '.repeat(RESOURCE_PREDICTION_LIMITS.jsonCharacters + 1)),
    ).toBeNull();
    expect(ResourcePredictionPractice.restore('{')).toBeNull();
    expect(() => new ResourcePredictionPractice('')).toThrow();
  });

  it('入力上限は無消費で拒否し、storage/通常報酬を参照しない', () => {
    const storage = new Proxy(
      {},
      {
        get: () => {
          throw new Error('storage touched');
        },
      },
    );
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('indexedDB', storage);
    const external = new RunEngine({ seed: 'untouched' });
    external.startRun();
    const externalBefore = external.exportCounterfactualFrame();
    runResourcePractice('g1');
    expect(external.exportCounterfactualFrame()).toEqual(externalBefore);
    const session = new ResourcePredictionPractice('g1');
    expect(resourceSend(session, { type: 'skip' })).toBe(true);
    for (let n = 1; n < RESOURCE_PREDICTION_LIMITS.inputs; n++)
      expect(
        resourceSend(session, {
          type: 'change',
          choice: n % 2 ? 'none' : 'seniorHp',
          source: 'self',
        }),
      ).toBe(true);
    const before = session.save();
    expect(resourceSend(session, { type: 'begin' })).toBe(false);
    expect(session.save()).toBe(before);
    expect(ResourcePredictionPractice.restore(before)?.save()).toBe(before);
  });
});
