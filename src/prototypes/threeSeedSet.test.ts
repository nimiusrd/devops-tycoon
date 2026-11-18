import { describe, expect, it } from 'vitest';
import { CARD_DEFS } from '../data/cards';
import { RELIC_DEFS } from '../data/relics';
import { RunEngine } from '../sim/run/engine';
import { evaluateWinType } from '../sim/outcome';
import {
  nextSetPolicyCommand,
  runSetPolicy,
  SET_INPUT_LIMIT,
  SET_SAVE_LIMIT,
  ThreeSeedSet,
  threeSeedSetDefinition,
  type SetCommand,
} from './threeSeedSet';

const create = () => new ThreeSeedSet('balanced', 'local-prototype-opt-in');
function apply(session: ThreeSeedSet, command: SetCommand) {
  return session.apply({ revision: session.view().revision, command });
}
function advance(session: ThreeSeedSet, active = true) {
  const v = session.view();
  const commands = v.current
    ? nextSetPolicyCommand(v.current, v.build, active)
    : [{ type: 'start' as const }];
  for (const command of commands) apply(session, command);
}

// 一つの実走を共有し、任意の終端/結果をfixtureとして注入しない。
const complete = runSetPolicy(create());

describe('RI-275 三seedセットAPI', () => {
  it('開始前に3条件/初期資源/固定トラック/ルールセット/解放契約を公開する', () => {
    const d = threeSeedSetDefinition();
    expect(d.conditions).toHaveLength(3);
    expect(new Set(d.conditions.map((c) => c.seed)).size).toBe(3);
    expect(new Set(d.conditions.map((c) => c.scenario)).size).toBe(3);
    expect(d.ruleset.balanceFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(d.unlock).toEqual({
      requiredAccess: 'local-prototype-opt-in',
      allBuildsAvailable: true,
      readsMeta: false,
    });
    expect(d.carry).toEqual(['preferredCardIds']);
    for (const c of d.conditions) {
      expect(c.initialBudget).toBeGreaterThan(0);
      expect(c.initialOrg.seniorHp).toBeGreaterThan(0);
      expect(c.sprintsPerQuarter).toBeGreaterThan(1);
    }
    expect(() => new ThreeSeedSet('balanced', 'locked')).toThrow();
    expect(() => new ThreeSeedSet('constructor' as 'balanced', d.unlock.requiredAccess)).toThrow();
    d.conditions[0].initialOrg.seniorHp = 0;
    expect(threeSeedSetDefinition().conditions[0].initialOrg.seniorHp).toBeGreaterThan(0);
  });

  it('各ランで選択以外の資源をリセットし、終端の敗北も独立に3件保存する', () => {
    const session = create();
    const definition = threeSeedSetDefinition();
    for (let index = 0; index < 3; index += 1) {
      expect(apply(session, { type: 'start' })).toBe(true);
      const s = session.view().current!;
      expect(s).toMatchObject({
        seed: definition.conditions[index].seed,
        org: definition.conditions[index].initialOrg,
        budget: definition.conditions[index].initialBudget,
        deck: [],
        relics: [],
        sprintsPlayed: 0,
        totals: { delivered: 0 },
        runKind: 'normal',
      });
      expect(s.evolution).toEqual({ points: 0, unlocked: {} });
      expect(s.roster).toEqual(definition.conditions[index].initialRoster);
      expect(JSON.parse(session.save()).current.persist.extras.preferredCardIds).toEqual(
        definition.builds.balanced,
      );
      while (session.view().phase === 'running') advance(session, false);
      expect(session.view().results).toHaveLength(index + 1);
      expect(session.view().phase).toBe(index === 2 ? 'complete' : 'between');
      expect(ThreeSeedSet.restore(session.save())?.save()).toBe(session.save());
    }
  });

  it('実RunEngineの入力、集中力、乱数消費と保存途中からの直接継続が一致する', () => {
    const session = create();
    apply(session, { type: 'start' });
    apply(session, { type: 'beginSprint' });
    const start = JSON.parse(session.save()).current;
    const engine = new RunEngine();
    engine.hydrateCounterfactualFrame(start);
    for (const command of [
      { type: 'dispatch', id: 'pairReview' },
      { type: 'step', ms: 1000 },
    ] as const) {
      apply(session, command);
      if (command.type === 'dispatch') engine.dispatch(command.id);
      else engine.step(command.ms);
    }
    expect(JSON.parse(session.save()).current).toEqual(
      JSON.parse(JSON.stringify(engine.exportCounterfactualFrame())),
    );
    expect(JSON.parse(session.save()).current.sprintRngState).not.toBe(start.sprintRngState);
    expect(session.view().consumption.focusSpent).toBeGreaterThan(0);
    const restored = ThreeSeedSet.restore(session.save())!;
    expect(restored.save()).toBe(session.save());
    apply(restored, { type: 'step', ms: 1000 });
    apply(session, { type: 'step', ms: 1000 });
    expect(restored.save()).toBe(session.save());
  });

  it('無効入力、重複開始、古いrevision、休止中操作で全状態/RNG/費用を変えない', () => {
    const session = create();
    apply(session, { type: 'start' });
    const unchanged = (command: unknown) => {
      const before = session.save();
      expect(apply(session, command as SetCommand)).toBe(false);
      expect(session.save()).toBe(before);
    };
    unchanged({ type: 'start' });
    unchanged({ type: 'playCard', index: 0 });
    unchanged({ type: 'step', ms: Infinity });
    unchanged({ type: 'step', ms: -100 });
    unchanged({ type: 'step', ms: 1_000_000 });
    unchanged({ type: 'step', ms: 1000, result: { delivered: 999 } });
    unchanged({ type: 'dispatch', id: 'unknown' });
    unchanged({ type: 'settle', winType: 'healthy' });
    const before = session.save();
    expect(
      session.apply({
        revision: session.view().revision,
        command: { type: 'beginSprint' },
        extra: () => 1,
      } as never),
    ).toBe(false);
    expect(session.save()).toBe(before);
    expect(session.apply({ revision: 0, command: { type: 'beginSprint' } })).toBe(false);
    expect(session.save()).toBe(before);
    apply(session, { type: 'beginSprint' });
    unchanged({ type: 'playCard', index: 99 });
    unchanged({ type: 'dispatch', id: 'firefight' });
    apply(session, { type: 'pause' });
    unchanged({ type: 'step', ms: 1000 });
    unchanged({ type: 'pause' });
    expect(ThreeSeedSet.restore(session.save())?.save()).toBe(session.save());
    apply(session, { type: 'resume' });
    unchanged({ type: 'resume' });
  });

  it('実終端結果/自動WinType/消耗を保持し、3件目の確定後に二重集計や再開をしない', () => {
    const v = complete.view();
    expect(v.phase).toBe('complete');
    expect(v.results).toHaveLength(3);
    for (const [index, result] of v.results.entries()) {
      expect(result.index).toBe(index);
      expect(['won', 'lost']).toContain(result.terminal.status);
      expect(result.terminal.totals.delivered).toBeGreaterThan(0);
      expect(result.consumption.budgetDecreases).toBeGreaterThanOrEqual(0);
      expect(
        result.initialBudget -
          result.consumption.budgetDecreases +
          result.consumption.budgetIncreases,
      ).toBeCloseTo(result.terminal.budget);
      if (result.terminal.status === 'won')
        expect(result.terminal.winType).toBe(
          evaluateWinType({
            org: result.terminal.extras.winEvalOrg ?? result.terminal.org,
            totals: result.terminal.totals,
            budget: result.terminal.budget,
            usedHeavyActions: result.terminal.usedHeavyActions,
            diagnosis: result.terminal.diagnosis,
          }),
        );
      else expect(result.terminal.winType).toBeUndefined();
    }
    const restored = ThreeSeedSet.restore(complete.save())!;
    for (const command of [
      { type: 'start' },
      { type: 'ackQuarter' },
      { type: 'resume' },
      { type: 'abandon' },
      { type: 'step', ms: 1000 },
    ] as const) {
      expect(apply(restored, command)).toBe(false);
      expect(restored.save()).toBe(complete.save());
    }
    expect(v).toMatchObject({ rewardEligible: false, metaReward: 0, dailyReward: 0 });
    expect(v.results.map((r) => r.terminal.dailyDate)).toEqual([undefined, undefined, undefined]);
  });

  it('放棄した部分ランを架空の終端にせず、以後の操作/再精算を拒否する', () => {
    const session = create();
    apply(session, { type: 'start' });
    apply(session, { type: 'beginSprint' });
    apply(session, { type: 'step', ms: 1000 });
    apply(session, { type: 'abandon' });
    expect(session.view()).toMatchObject({
      phase: 'abandoned',
      results: [],
      current: { status: 'playing' },
    });
    const saved = session.save();
    expect(apply(session, { type: 'start' })).toBe(false);
    expect(apply(session, { type: 'resume' })).toBe(false);
    expect(session.save()).toBe(saved);
    expect(ThreeSeedSet.restore(saved)?.save()).toBe(saved);
  });

  it('全入力再生で同じ実走結果を得て、改ざん/異版/別mode/上限超過を拒否する', () => {
    const saved = JSON.parse(complete.save());
    for (const mutate of [
      (s: typeof saved) => {
        s.results[0].terminal.totals.delivered += 1;
      },
      (s: typeof saved) => {
        s.results.push(s.results[0]);
      },
      (s: typeof saved) => {
        s.phase = 'between';
      },
      (s: typeof saved) => {
        s.revision += 1;
      },
      (s: typeof saved) => {
        s.ruleset.balanceVersion += 1;
      },
      (s: typeof saved) => {
        s.kind = 'daily';
      },
      (s: typeof saved) => {
        s.inputs.push(s.inputs[0]);
      },
    ]) {
      const changed = structuredClone(saved);
      mutate(changed);
      expect(ThreeSeedSet.restore(JSON.stringify(changed))).toBeNull();
    }
    const session = create();
    apply(session, { type: 'start' });
    apply(session, { type: 'beginSprint' });
    const rng = JSON.parse(session.save());
    rng.current.sprintRngState += 1;
    expect(ThreeSeedSet.restore(JSON.stringify(rng))).toBeNull();
    for (const json of ['null', '{}', 'bad json', ' '.repeat(SET_SAVE_LIMIT + 1)])
      expect(ThreeSeedSet.restore(json)).toBeNull();
    expect(
      ThreeSeedSet.restore(
        JSON.stringify({ ...saved, inputs: Array(SET_INPUT_LIMIT + 1).fill(saved.inputs[0]) }),
      ),
    ).toBeNull();
  });

  it('同じ入力列を独立したRunEngineで再実行し、3件の終端を一致させる', () => {
    const definition = threeSeedSetDefinition();
    const log = JSON.parse(complete.save()).inputs as { command: SetCommand }[];
    let engine = new RunEngine();
    let index = 0;
    const terminals = [];
    for (const { command: c } of log) {
      switch (c.type) {
        case 'start': {
          const condition = definition.conditions[index++];
          engine = new RunEngine({
            allowedCards: new Set(CARD_DEFS.map((c) => c.id)),
            allowedRelics: new Set(RELIC_DEFS.map((r) => r.id)),
          });
          engine.setPreferredCards(definition.builds.balanced);
          engine.startRun('normal', [], condition.seed, { scenario: condition.scenario });
          break;
        }
        case 'beginSprint':
          engine.beginSetupSprint();
          break;
        case 'step':
          engine.step(c.ms);
          break;
        case 'dispatch':
          engine.dispatch(c.id);
          break;
        case 'playCard':
          engine.playCard(c.index);
          break;
        case 'ackResult':
          engine.acknowledgeResult();
          break;
        case 'chooseCard':
          engine.chooseCard(c.id);
          break;
        case 'skipDraft':
          engine.skipDraft();
          break;
        case 'unlockEvolution':
          engine.unlockEvolution(c.id);
          break;
        case 'finishEvolution':
          engine.finishEvolution();
          break;
        case 'beat':
          engine.resolveBeat(c.choice);
          break;
        case 'leaveShop':
          engine.leaveShop();
          break;
        case 'rest':
          engine.restChoose(c.option);
          break;
        case 'recruit':
          engine.recruitChoose(c.option);
          break;
        case 'adjust':
          engine.chooseGoalAdjustment(c.id);
          break;
        case 'ackQuarter':
          engine.acknowledgeQuarterReview();
          break;
        default:
          throw new Error('unexpected policy command');
      }
      if (engine.snapshot().status !== 'playing') terminals.push(engine.exportReplayFrame());
    }
    expect(JSON.parse(JSON.stringify(terminals))).toEqual(
      JSON.parse(JSON.stringify(complete.view().results.map((r) => r.terminal))),
    );
  });

  it('入力数を制限し、上限でも最後の1入力で放棄・保存・復元できる', () => {
    const session = create();
    apply(session, { type: 'start' });
    for (let revision = 1; revision < SET_INPUT_LIMIT - 1; revision += 1)
      expect(
        session.apply({ revision, command: { type: revision % 2 ? 'pause' : 'resume' } }),
      ).toBe(true);
    const before = session.save();
    expect(session.apply({ revision: SET_INPUT_LIMIT - 1, command: { type: 'beginSprint' } })).toBe(
      false,
    );
    expect(session.save()).toBe(before);
    expect(session.apply({ revision: SET_INPUT_LIMIT - 1, command: { type: 'abandon' } })).toBe(
      true,
    );
    expect(session.view()).toMatchObject({ phase: 'abandoned', revision: SET_INPUT_LIMIT });
    expect(ThreeSeedSet.restore(session.save())?.save()).toBe(session.save());
  });

  it('返したviewの変更では正本や結果を変更できない', () => {
    const saved = complete.save();
    complete.view().results[0].terminal.budget = 999999;
    expect(complete.save()).toBe(saved);
  });
});
