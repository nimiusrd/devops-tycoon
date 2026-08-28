import { describe, expect, it } from 'vitest';
import { createEngine, type Engine } from '../../../src/sim/engine';
import type {
  SprintResult,
  SprintMetrics,
  SprintState,
  TimelineSample,
} from '../../../src/sim/types';
import {
  IDENTITY_CARD_EFFECTS,
  REVIEW_HP_COST,
  TASK_BASE_VALUE,
  taskValue,
} from '../../../src/sim/model';
import { createOrgState } from '../../../src/sim/org';
import {
  computeGrade,
  computeTitleAndDiagnosis,
  createSprint,
  forceShipReviewTask,
  igniteTask,
  resolveSprintConfig,
  reviewOne,
  stepSprint,
  summarizeSprint,
} from '../../../src/sim/sprint';
import { makeSprint, makeTask } from '../helpers/sprintFixtures';

/** スプリントを最後まで自動進行させ、リザルトを返す。 */
function runSprint(seed: string, aiEnabled: boolean): { engine: Engine; result: SprintResult } {
  const engine = createEngine({ seed, aiEnabled, scenario: 'default' });
  let guard = 0;
  while (!engine.isComplete() && guard < 100_000) {
    engine.step(1000); // 10 tick ずつ前進
    guard += 1;
  }
  expect(engine.isComplete()).toBe(true);
  return { engine, result: engine.result() };
}

describe('スプリントの終了保証', () => {
  it('AIあり/なしいずれも有限ステップで完了し、全タスクが Done になる', () => {
    for (const aiEnabled of [false, true]) {
      const { engine, result } = runSprint('finish', aiEnabled);
      const snap = engine.snapshot();
      expect(snap.sprint.tasks.every((t) => t.lane === 'done')).toBe(true);
      expect(result.done).toBe(snap.sprint.config.taskCount);
    }
  });
});

describe('seed 再現性（同一 seed なら同一リザルト）', () => {
  it('同一 seed・同一 AI 設定で完全一致する', () => {
    const a = runSprint('repro-seed', true).result;
    const b = runSprint('repro-seed', true).result;
    expect(a).toEqual(b);
  });

  it('異なる seed では結果が変わりうる', () => {
    const a = runSprint('seed-a', true).result;
    const b = runSprint('seed-b', true).result;
    // 主要指標のいずれかは異なるはず。
    const differs =
      a.delivered !== b.delivered ||
      a.rework !== b.rework ||
      a.reviewQueueMax !== b.reviewQueueMax ||
      a.incidents !== b.incidents;
    expect(differs).toBe(true);
  });
});

describe('AIあり/なしの結果差（DoD: コア因果が成立する）', () => {
  it('AIありは Review 渋滞が増え、Rework も増える（第2章）', () => {
    const seeds = ['s1', 's2', 's3', 's4', 's5'];
    let queueWins = 0;
    let reworkWins = 0;
    for (const seed of seeds) {
      const off = runSprint(seed, false).result;
      const on = runSprint(seed, true).result;
      if (on.reviewQueueMax > off.reviewQueueMax) queueWins += 1;
      if (on.rework > off.rework) reworkWins += 1;
    }
    // 多数の seed で一貫して AI あり > AI なし になること。
    expect(queueWins).toBeGreaterThanOrEqual(4);
    expect(reworkWins).toBeGreaterThanOrEqual(4);
  });

  it('AIありは AI 利用率が高く、AIなしは 0%', () => {
    expect(runSprint('pct', false).result.aiAssistedPct).toBe(0);
    expect(runSprint('pct', true).result.aiAssistedPct).toBeGreaterThan(0);
  });
});

describe('リザルトの整合性', () => {
  it('鎮火 + 延焼 = 障害総数、シニア体力は消耗する', () => {
    const { result } = runSprint('coherent', true);
    expect(result.contained + result.spread).toBe(result.incidents);
    expect(result.seniorHpDelta).toBeLessThanOrEqual(0);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(result.grade);
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.diagnosis.length).toBeGreaterThan(0);
  });
});

function patchMetrics(sprint: SprintState, overrides: Partial<SprintMetrics>): void {
  Object.assign(sprint.metrics, overrides);
}

describe('RI-91-B3 sprint survived mutants', () => {
  describe('forceShipReviewTask', () => {
    it('review 以外は何も変えずに早期 return する', () => {
      const org = createOrgState('default', false);
      org.deliveryScore = 10;
      const task = makeTask(0, { lane: 'coding', aiAssisted: true });
      const sprint = makeSprint(org, [task]);
      patchMetrics(sprint, {
        doneCount: 2,
        completedCount: 2,
        delivered: 10,
        aiAssistedCompleted: 0,
      });

      forceShipReviewTask(task, sprint, org);

      expect(task.lane).toBe('coding');
      expect(sprint.metrics.doneCount).toBe(2);
      expect(sprint.metrics.completedCount).toBe(2);
      expect(sprint.metrics.delivered).toBe(10);
      expect(sprint.metrics.aiAssistedCompleted).toBe(0);
      expect(org.deliveryScore).toBe(10);
    });

    it('review を Done にし doneCount/completedCount/delivery を += する', () => {
      const org = createOrgState('default', false);
      org.deliveryScore = 20;
      const task = makeTask(0, { lane: 'review', kind: 'normal', highValue: false });
      const sprint = makeSprint(org, [task]);
      const value = Math.round(taskValue(task));
      expect(value).toBe(TASK_BASE_VALUE.normal);

      forceShipReviewTask(task, sprint, org);

      expect(task.lane).toBe('done');
      expect(task.incident).toBe(false);
      expect(sprint.metrics.doneCount).toBe(1);
      expect(sprint.metrics.completedCount).toBe(1);
      expect(sprint.metrics.delivered).toBe(value);
      expect(org.deliveryScore).toBe(20 + value);
      expect(sprint.metrics.aiAssistedCompleted).toBe(0);
    });

    it('aiAssisted のときだけ aiAssistedCompleted を += する', () => {
      const org = createOrgState('default', true);
      const assisted = makeTask(0, { lane: 'review', aiAssisted: true });
      const plain = makeTask(1, { lane: 'review', aiAssisted: false });
      const sprint = makeSprint(org, [assisted, plain]);

      forceShipReviewTask(assisted, sprint, org);
      expect(sprint.metrics.aiAssistedCompleted).toBe(1);

      forceShipReviewTask(plain, sprint, org);
      expect(sprint.metrics.aiAssistedCompleted).toBe(1);
      expect(sprint.metrics.doneCount).toBe(2);
      expect(sprint.metrics.completedCount).toBe(2);
    });
  });

  describe('abandonInFlight via stepSprint(maxTicks)', () => {
    it('炎上タスクを鎮火計上するが doneCount/delivered は加算しない', () => {
      const org = createOrgState('default', false);
      org.deliveryScore = 0;
      org.seniorHp = 5; // advanceBurning の自動鎮火を避ける（余力不足）
      const task = makeTask(0, {
        lane: 'rework',
        incident: true,
        burnTicksLeft: 8,
        reworkAttempts: 1,
        kind: 'normal',
      });
      const sprint = makeSprint(org, [task]);
      sprint.config.maxTicks = 0;

      stepSprint(sprint, org, () => 0.5, 0);

      expect(sprint.complete).toBe(true);
      expect(task.lane).toBe('done');
      expect(task.incident).toBe(false);
      expect(sprint.metrics.contained).toBe(1);
      expect(sprint.metrics.autoContainCount).toBe(1);
      expect(sprint.metrics.doneCount).toBe(0);
      expect(sprint.metrics.completedCount).toBe(0);
      expect(sprint.metrics.delivered).toBe(0);
      expect(org.deliveryScore).toBe(0);
      expect(sprint.metrics.spread).toBe(0);
    });

    it('非 incident の coding は contained も出荷も計上せず畳む', () => {
      const org = createOrgState('default', false);
      org.deliveryScore = 0;
      const task = makeTask(0, { lane: 'coding', progress: 0, incident: false });
      const sprint = makeSprint(org, [task]);
      sprint.config.maxTicks = 0;
      // coding 進行を止め、intake も空にして abandon だけを見る。
      sprint.config.codingSlots = 0;

      stepSprint(sprint, org, () => 0.5, 0);

      expect(sprint.complete).toBe(true);
      expect(task.lane).toBe('done');
      expect(sprint.metrics.contained).toBe(0);
      expect(sprint.metrics.autoContainCount).toBe(0);
      expect(sprint.metrics.doneCount).toBe(0);
      expect(sprint.metrics.completedCount).toBe(0);
      expect(sprint.metrics.delivered).toBe(0);
      expect(org.deliveryScore).toBe(0);
    });

    it('Backlog のみは lane を畳むが出荷は計上しない', () => {
      const org = createOrgState('default', false);
      org.deliveryScore = 7;
      const task = makeTask(0, { lane: 'backlog' });
      const sprint = makeSprint(org, [task]);
      // コーダー不在 + 稼働タスク無し → isStalled → 即 abandonInFlight
      sprint.config.codingSlots = 0;

      stepSprint(sprint, org, () => 0.5, 0);

      expect(sprint.complete).toBe(true);
      expect(task.lane).toBe('done');
      expect(sprint.metrics.doneCount).toBe(0);
      expect(sprint.metrics.completedCount).toBe(0);
      expect(sprint.metrics.delivered).toBe(0);
      expect(sprint.metrics.contained).toBe(0);
      expect(sprint.metrics.timedOut).toBeFalsy();
      expect(org.deliveryScore).toBe(7);
    });

    it('maxTicks 打ち切りでは timedOut を立て出荷は加算しない', () => {
      const org = createOrgState('default', false);
      org.deliveryScore = 0;
      const task = makeTask(0, { lane: 'coding', progress: 0.5, incident: false });
      const sprint = makeSprint(org, [task]);
      sprint.config.maxTicks = 0;
      sprint.config.codingSlots = 0;
      sprint.metrics.delivered = 80;

      stepSprint(sprint, org, () => 0.5, 0);

      expect(sprint.complete).toBe(true);
      expect(sprint.metrics.timedOut).toBe(true);
      expect(sprint.metrics.delivered).toBe(80);
      expect(summarizeSprint(sprint, org).timedOut).toBe(true);
    });

    it('maxTicks 打ち切りでは aiAssistedCompleted も加算しない', () => {
      const org = createOrgState('default', true);
      const assisted = makeTask(0, {
        lane: 'coding',
        progress: 0,
        aiAssisted: true,
        incident: false,
      });
      const plain = makeTask(1, {
        lane: 'coding',
        progress: 0,
        aiAssisted: false,
        incident: false,
      });
      const sprint = makeSprint(org, [assisted, plain]);
      sprint.config.maxTicks = 0;
      sprint.config.codingSlots = 0;

      stepSprint(sprint, org, () => 0.5, 0);

      expect(sprint.metrics.doneCount).toBe(0);
      expect(sprint.metrics.completedCount).toBe(0);
      expect(sprint.metrics.aiAssistedCompleted).toBe(0);
    });
  });

  it('minCompleteTick 待ち中はシニアHP自然回復しない', () => {
    const org = createOrgState('default', false);
    org.seniorHp = 40;
    const sprint = makeSprint(org, []);
    sprint.config.minCompleteTick = 5;

    stepSprint(sprint, org, () => 0.5, 0);
    expect(sprint.complete).toBe(false);
    expect(org.seniorHp).toBe(40);

    stepSprint(sprint, org, () => 0.5, 5);
    expect(sprint.complete).toBe(true);
    expect(org.seniorHp).toBe(40);
  });

  describe('computeTitleAndDiagnosis 境界', () => {
    it('HP損失が大きくても出荷ゼロ・タイムアウトでは伸びたと診断しない', () => {
      const org = createOrgState('default', false);
      org.seniorHp = 40;
      const sprint = makeSprint(org, []);
      patchMetrics(sprint, {
        seniorHpStart: 100,
        delivered: 0,
        completedCount: 0,
        reworkCount: 0,
        incidentCount: 0,
        spread: 0,
        reviewQueueMax: 0,
        aiAssistedCompleted: 0,
        actionCounts: {},
        timedOut: true,
      });
      expect(computeTitleAndDiagnosis(sprint, org)).toEqual({
        title: 'シニア過労メーカー',
        diagnosis: 'レビュー負荷がシニアに集中し燃え尽き寸前です。体力が尽きる前に分散を。',
      });
    });
    it('reworkRatio 0.35 ちょうどで Rework職人、未満では別称号', () => {
      const org = createOrgState('default', false);
      org.seniorHp = 80;
      const sprint = makeSprint(org, []);
      patchMetrics(sprint, {
        seniorHpStart: 80,
        completedCount: 20,
        reworkCount: 7, // 7/20 = 0.35
        incidentCount: 0,
        spread: 0,
        reviewQueueMax: 0,
        aiAssistedCompleted: 0,
        actionCounts: {},
      });
      expect(computeTitleAndDiagnosis(sprint, org)).toEqual({
        title: 'Rework職人',
        diagnosis: '手戻りが多すぎます。AIの使い方とレビュー品質を見直しましょう。',
      });

      patchMetrics(sprint, { reworkCount: 6 }); // 6/20 = 0.3
      expect(computeTitleAndDiagnosis(sprint, org).title).not.toBe('Rework職人');
    });

    it('火消しの達人は緊急鎮火/incident/spread の境界ちょうどで成立する', () => {
      const org = createOrgState('default', true);
      org.seniorHp = 80;
      const sprint = makeSprint(org, []);
      const urgentContains = [
        { tick: 1, kind: 'contain' as const, taskId: 0, combo: 1 },
        { tick: 2, kind: 'contain' as const, taskId: 1, combo: 2 },
        { tick: 3, kind: 'contain' as const, taskId: 2, combo: 3 },
      ];
      patchMetrics(sprint, {
        seniorHpStart: 80,
        completedCount: 20,
        reworkCount: 0,
        incidentCount: 3,
        spread: 0,
        reviewQueueMax: 0,
        aiAssistedCompleted: 0,
        actionCounts: { firefight: 3 },
      });
      sprint.fireEvents = urgentContains;
      expect(computeTitleAndDiagnosis(sprint, org)).toEqual({
        title: '火消しの達人',
        diagnosis: '連続する炎上を、延焼する前にすべて自らの手で鎮火しました。見事な危機対応です。',
      });

      // incidentCount ちょうど −1
      patchMetrics(sprint, { incidentCount: 2, actionCounts: { firefight: 3 }, spread: 0 });
      expect(computeTitleAndDiagnosis(sprint, org).title).not.toBe('火消しの達人');

      // spread !== 0（静かな崩壊の >=2 未満）
      patchMetrics(sprint, { incidentCount: 3, actionCounts: { firefight: 3 }, spread: 1 });
      expect(computeTitleAndDiagnosis(sprint, org).title).not.toBe('火消しの達人');

      // 緊急鎮火不足（先消しだけの firefight 回数は数えない）
      patchMetrics(sprint, { incidentCount: 3, actionCounts: { firefight: 3 }, spread: 0 });
      sprint.fireEvents = [
        { tick: 1, kind: 'contain', taskId: 0, combo: 0, brokeCombo: true },
        { tick: 2, kind: 'contain', taskId: 1, combo: 0, brokeCombo: true },
        { tick: 3, kind: 'contain', taskId: 2, combo: 0, brokeCombo: true },
      ];
      expect(computeTitleAndDiagnosis(sprint, org).title).not.toBe('火消しの達人');
    });

    it('爆速だが不安定は aiUsed かつ incidentCount>=3（火消し条件外）で成立する', () => {
      const org = createOrgState('default', true);
      org.seniorHp = 80;
      const sprint = makeSprint(org, []);
      patchMetrics(sprint, {
        seniorHpStart: 80,
        completedCount: 10,
        reworkCount: 0,
        incidentCount: 3,
        spread: 0,
        reviewQueueMax: 0,
        aiAssistedCompleted: 5,
        actionCounts: { firefight: 0 },
      });
      expect(computeTitleAndDiagnosis(sprint, org)).toEqual({
        title: '爆速だが不安定',
        diagnosis: '実装は進みましたが、テストが追いつかず障害が頻発しています。',
      });

      patchMetrics(sprint, { incidentCount: 2 });
      expect(computeTitleAndDiagnosis(sprint, org).title).not.toBe('爆速だが不安定');
    });
  });

  describe('reviewOne / computeGrade 補強', () => {
    it('Done 路で doneCount/completedCount/morale を exact に更新する', () => {
      const rng = () => 0.99; // incident / rework 両方外す
      const org = createOrgState('default', false);
      org.morale = 50;
      org.seniorHp = 80;
      const task = makeTask(0, { lane: 'review' });
      const sprint = makeSprint(org, [task]);
      const hpBefore = org.seniorHp;

      reviewOne(task, sprint, org, rng);

      expect(task.lane).toBe('done');
      expect(sprint.metrics.doneCount).toBe(1);
      expect(sprint.metrics.completedCount).toBe(1);
      expect(sprint.metrics.combo).toBe(1);
      expect(org.morale).toBe(50.5);
      expect(org.seniorHp).toBeCloseTo(hpBefore - REVIEW_HP_COST, 5);
    });

    it('RI-73: seniorHpCostMul がレビュー時のシニア体力消費に掛かる', () => {
      const rng = () => 0.99;
      const org = createOrgState('default', false);
      org.seniorHp = 80;
      const task = makeTask(0, { lane: 'review' });
      const sprint = makeSprint(org, [task]);
      sprint.cardEffects = { ...IDENTITY_CARD_EFFECTS, seniorHpCostMul: 0.5 };
      const hpBefore = org.seniorHp;

      reviewOne(task, sprint, org, rng);

      expect(org.seniorHp).toBeCloseTo(hpBefore - REVIEW_HP_COST * 0.5, 5);
    });

    it('RI-73 / F-1: reviewHpCostMul がレビュー時のシニア体力消費に掛かる', () => {
      const rng = () => 0.99;
      const org = createOrgState('default', false);
      org.seniorHp = 80;
      const task = makeTask(0, { lane: 'review' });
      const sprint = makeSprint(org, [task]);
      sprint.cardEffects = { ...IDENTITY_CARD_EFFECTS, reviewHpCostMul: 0.8 };
      const hpBefore = org.seniorHp;

      reviewOne(task, sprint, org, rng);

      expect(org.seniorHp).toBeCloseTo(hpBefore - REVIEW_HP_COST * 0.8, 5);
    });

    it('RI-80: grade しきい値ちょうどとペナルティで S/A/B/C/D を区別する', () => {
      const org = createOrgState('default', false);
      org.seniorHp = 100;
      const sprint = makeSprint(org, []);
      // delivered=100 なら ratio = (100 - penalties) / 100
      // penalties = rework*5 + incident*6 + spread*10 + max(0, hpLoss-20)*0.7
      const setPenalties = (partial: Partial<SprintMetrics> & { hpLoss?: number }) => {
        const { hpLoss = 0, ...metrics } = partial;
        org.seniorHp = 100 - hpLoss;
        patchMetrics(sprint, {
          seniorHpStart: 100,
          delivered: 100,
          reworkCount: 0,
          incidentCount: 0,
          spread: 0,
          ...metrics,
        });
      };

      // 0.955 ちょうど: hp ペナルティのみ 4.5 → (hpLoss-20)*0.7 = 4.5 → hpLoss = 185/7
      setPenalties({ hpLoss: 185 / 7 });
      expect(computeGrade(sprint, org)).toBe('S');
      // S 境界未満: rework=2 → p=10 → 0.90 → A
      setPenalties({ reworkCount: 2 });
      expect(computeGrade(sprint, org)).toBe('A');

      // 0.8 ちょうど: spread=2 → p=20
      setPenalties({ spread: 2 });
      expect(computeGrade(sprint, org)).toBe('A');
      // −1: p=21 → 0.79 → B
      setPenalties({ reworkCount: 1, incidentCount: 1, spread: 1 });
      expect(computeGrade(sprint, org)).toBe('B');

      // 0.62 ちょうど: incident=3 + spread=2 → p=38
      setPenalties({ incidentCount: 3, spread: 2 });
      expect(computeGrade(sprint, org)).toBe('B');
      // −1: p=39 → 0.61 → C
      setPenalties({ reworkCount: 1, incidentCount: 4, spread: 1 });
      expect(computeGrade(sprint, org)).toBe('C');

      // 0.4 ちょうど: spread=6 → p=60
      setPenalties({ spread: 6 });
      expect(computeGrade(sprint, org)).toBe('C');
      // −1: p=61 → 0.39 → D
      setPenalties({ reworkCount: 1, incidentCount: 1, spread: 5 });
      expect(computeGrade(sprint, org)).toBe('D');
    });

    it('RI-80: 実際に安定を付与した介入は加点し、残業号令は加点しない', () => {
      const org = createOrgState('default', false);
      const sprint = makeSprint(org, []);
      patchMetrics(sprint, {
        delivered: 100,
        reworkCount: 1,
        incidentCount: 0,
        spread: 0,
        actionCounts: {},
        stabilizingGrants: 0,
      });

      // outcomeRatio=0.95 は単独では S に届かない。
      expect(computeGrade(sprint, org)).toBe('A');

      // RI-73: actionCounts だけでは加点しない（条件未成立の firefight/andon を除外）。
      patchMetrics(sprint, { actionCounts: { firefight: 2, andon: 2 } });
      expect(computeGrade(sprint, org)).toBe('A');

      patchMetrics(sprint, { stabilizingGrants: 2 });
      expect(computeGrade(sprint, org)).toBe('S');
      const scored = summarizeSprint(sprint, org);
      expect(scored.grade).toBe('S');
      expect(scored.gradeRatio).toBeCloseTo(0.959, 5);
      expect(scored.stabilizingBonus).toBeCloseTo(0.009, 5);
      expect(scored.stabilizingGrants).toBe(2);

      patchMetrics(sprint, { stabilizingGrants: 0, actionCounts: { overtime: 2 } });
      expect(computeGrade(sprint, org)).toBe('A');
    });

    it('summarizeSprint は丸め前の HP 損失を seniorHpLoss に残す', () => {
      const org = createOrgState('default', false);
      org.seniorHp = 1.52;
      const sprint = makeSprint(org, []);
      patchMetrics(sprint, {
        seniorHpStart: 100,
        delivered: 100,
        reworkCount: 0,
        incidentCount: 0,
        spread: 0,
        stabilizingGrants: 0,
      });
      const scored = summarizeSprint(sprint, org);
      expect(scored.seniorHpDelta).toBe(-98);
      expect(scored.seniorHpLoss).toBeCloseTo(98.48, 5);
      expect(scored.gradeRatio).toBeCloseTo((100 - (98.48 - 20) * 0.7) / 100, 5);
    });
  });

  describe('NoCoverage / summarizeSprint', () => {
    it('igniteTask の source 省略は review として記録する', () => {
      const org = createOrgState('default', true);
      const task = makeTask(0, { lane: 'review' });
      const sprint = makeSprint(org, [task]);

      igniteTask(task, sprint, 12);

      expect(task.incident).toBe(true);
      expect(sprint.metrics.incidentCount).toBe(1);
      expect(sprint.events).toContainEqual({
        tick: 12,
        kind: 'ignite',
        taskId: 0,
        source: 'review',
      });
    });

    it('rollKind は重み合計を超える乱数で normal にフォールバックする', () => {
      const org = createOrgState('default', false);
      // KIND_WEIGHTS 合計 1.0 のため r>=1 はどの帯にも入らず 'normal' へ落ちる。
      const sprint = createSprint(resolveSprintConfig('default'), org, () => 1);
      expect(sprint.tasks.length).toBeGreaterThan(0);
      expect(sprint.tasks.every((t) => t.kind === 'normal')).toBe(true);
    });

    it('AI スロットル中の intake は aiAssisted を必ず false にする', () => {
      const org = createOrgState('default', true);
      const task = makeTask(0, { lane: 'backlog', aiAssisted: true });
      const sprint = makeSprint(org, [task]);
      sprint.modifiers.throttleUntilTick = 10;
      // decideAiAssisted が true になり得る乱数でも、スロットル側の false が勝つ。
      stepSprint(sprint, org, () => 0, 0);
      expect(task.lane).toBe('coding');
      expect(task.aiAssisted).toBe(false);
    });

    it('summarizeSprint の timeline は浅いコピーである', () => {
      const org = createOrgState('default', false);
      const sprint = makeSprint(org, []);
      const sample: TimelineSample = {
        tick: 3,
        reviewQueue: 4,
        burningCount: 1,
        combo: 2,
        seniorHp: 70,
      };
      sprint.timeline = [sample];

      const result = summarizeSprint(sprint, org);

      expect(result.timeline).toEqual([sample]);
      expect(result.timeline).not.toBe(sprint.timeline);
      expect(result.timeline[0]).not.toBe(sample);
      result.timeline[0].combo = 99;
      expect(sprint.timeline[0].combo).toBe(2);
    });
  });
});
