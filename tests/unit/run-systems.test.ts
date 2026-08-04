import { describe, expect, it } from 'vitest';
import { applyEventOutcome } from '../../src/sim/run/events';
import { canUnlock, isUnlocked, unlockNode } from '../../src/sim/run/evolution';
import { foldPassives, foldRunEffects } from '../../src/sim/run/effects';
import { createOrgState } from '../../src/sim/org';
import { diagnose } from '../../src/sim/diagnosis';
import {
  AI_DEPENDENCY_CAP,
  AI_LITERACY_UNSAFE_CAP,
  BUDGET_EXHAUSTED_CAP,
  CONSECUTIVE_INCIDENT_SPRINT_CAP,
  evaluateBoss,
  evaluateLose,
  evaluateWinType,
  TECH_DEBT_CAP,
} from '../../src/sim/outcome';
import { getBoss } from '../../src/data/bosses';
import type { EvolutionState, RunTotals } from '../../src/sim/run/types';
import type { OrgState, SprintResult } from '../../src/sim/types';

const org = (o: Partial<OrgState> = {}): OrgState => ({ ...createOrgState('default', true), ...o });

const totals = (t: Partial<RunTotals> = {}): RunTotals => ({
  delivered: 0,
  done: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 0,
  aiAssisted: 0,
  completed: 0,
  reviewQueuePeak: 0,
  maxCombo: 0,
  ...t,
});

describe('進化ツリーの解放（第11章）', () => {
  const fresh: EvolutionState = { points: 3, unlocked: {} };

  it('前提ノードが未解放だと解放できない', () => {
    expect(canUnlock(fresh, 'dev-2')).toBe(false); // dev-1 が前提
    expect(canUnlock(fresh, 'dev-1')).toBe(true);
  });

  it('ポイントを消費して解放し、前提が満たされると次が解放可能になる', () => {
    const afterOne = unlockNode(fresh, 'dev-1');
    expect(isUnlocked(afterOne, 'dev-1')).toBe(true);
    expect(afterOne.points).toBe(2); // dev-1 は cost 1
    expect(canUnlock(afterOne, 'dev-2')).toBe(true);
    expect(fresh.unlocked['dev-1']).toBeUndefined(); // 元状態は不変
  });

  it('ポイント不足なら解放できない', () => {
    const poor: EvolutionState = { points: 0, unlocked: {} };
    expect(unlockNode(poor, 'dev-1')).toBe(poor);
  });
});

describe('効果の畳み込み（第7/8/11/16章）', () => {
  it('進化の集中力ボーナスと実装枠ボーナスが合算される', () => {
    const evo: EvolutionState = { points: 0, unlocked: { 'culture-1': true, 'dev-2': true } };
    const fold = foldRunEffects({
      deck: [],
      relics: [],
      evolution: evo,
      difficulty: 'normal',
      trials: [],
    });
    expect(fold.focusBonus).toBe(2); // culture-1: +2
    expect(fold.codingSlotBonus).toBe(1); // dev-2: +1
  });

  it('試練「集中力 -1」は focusBonus を下げる', () => {
    const fold = foldRunEffects({
      deck: [],
      relics: [],
      evolution: { points: 0, unlocked: {} },
      difficulty: 'normal',
      trials: ['low-focus'],
    });
    expect(fold.focusBonus).toBe(-1);
  });

  it('試練「フロンティアモデル依存」は依存度増加と利用コストを集約する', () => {
    const fold = foldRunEffects({
      deck: [],
      relics: [],
      evolution: { points: 0, unlocked: {} },
      difficulty: 'normal',
      trials: ['frontier-dependency'],
    });
    expect(fold.aiDependencyDriftPerSprint).toBe(5);
    expect(fold.frontierModelCostPerDependency).toBe(0.05);
  });

  it('レリックのパッシブ（心理的安全性）が Morale ダメージ倍率を下げる', () => {
    const passives = foldPassives(['psych-safety']);
    expect(passives.moraleDamageMul).toBeLessThan(1);
  });
});

describe('イベント効果の適用（第9.4）', () => {
  it('Morale マイナスはレリックのパッシブで緩和される', () => {
    const base = org({ morale: 80 });
    applyEventOutcome({ morale: -20 }, base, foldPassives([]));
    expect(base.morale).toBe(60);

    const mitigated = org({ morale: 80 });
    applyEventOutcome({ morale: -20 }, mitigated, foldPassives(['psych-safety']));
    expect(mitigated.morale).toBeGreaterThan(60); // ダメージが軽減される
  });

  it('予算・付与は差分として返る', () => {
    const res = applyEventOutcome(
      { budget: -10, grantRelic: 'small-pr', delivered: 5 },
      org(),
      foldPassives([]),
    );
    expect(res.budgetDelta).toBe(-10);
    expect(res.grantRelic).toBe('small-pr');
  });
});

describe('組織タイプ診断（第13章）', () => {
  it('レビュー渋滞が高くシニアが枯れていれば Senior Sacrifice', () => {
    expect(diagnose(org({ seniorHp: 10 }), totals({ reviewQueuePeak: 18, completed: 20 }))).toBe(
      'seniorSacrifice',
    );
  });

  it('手戻り比率が高ければ Rework Spiral', () => {
    expect(diagnose(org(), totals({ rework: 10, completed: 20 }))).toBe('reworkSpiral');
  });

  it('レビュー待ちのピークが限界なら Review Hell', () => {
    expect(diagnose(org(), totals({ reviewQueuePeak: 16, completed: 20 }))).toBe('reviewHell');
  });

  it('AI 実装が過多で検証が詰まれば AI Overproduction', () => {
    expect(
      diagnose(org(), totals({ aiAssisted: 12, rework: 2, reviewQueuePeak: 12, completed: 20 })),
    ).toBe('aiOverproduction');
  });

  it('テスト/ドキュメントが整い手戻りが少なければ Documentation Kingdom', () => {
    const solid = org({ testCoverage: 80, documentation: 70 });
    expect(diagnose(solid, totals({ rework: 1, completed: 30 }))).toBe('documentationKingdom');
  });

  it('崩壊シグネチャがなければ Healthy Acceleration', () => {
    expect(diagnose(org(), totals({ completed: 20, reviewQueuePeak: 4 }))).toBe(
      'healthyAcceleration',
    );
  });
});

describe('勝敗判定（第14/15章）', () => {
  it('シニア体力 0 で敗北（燃え尽き）', () => {
    expect(evaluateLose(org({ seniorHp: 0 }), totals(), 30)).toBe('seniorBurnout');
  });

  it('技術的負債が上限超過で敗北', () => {
    expect(evaluateLose(org({ techDebt: TECH_DEBT_CAP + 1 }), totals(), 30)).toBe('techDebt');
  });

  it('障害が連続したスプリントではリリース停止になる', () => {
    expect(
      evaluateLose(
        org(),
        totals({ consecutiveIncidentSprints: CONSECUTIVE_INCIDENT_SPRINT_CAP - 1 }),
        30,
      ),
    ).toBeNull();
    expect(
      evaluateLose(
        org(),
        totals({ consecutiveIncidentSprints: CONSECUTIVE_INCIDENT_SPRINT_CAP }),
        30,
      ),
    ).toBe('incidentCascade');
  });

  it('AI 依存度が上限に達すると仕様説明不能で敗北する', () => {
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP - 1, aiLiteracy: AI_LITERACY_UNSAFE_CAP }),
        totals(),
        30,
      ),
    ).toBeNull();
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: AI_LITERACY_UNSAFE_CAP }),
        totals(),
        30,
      ),
    ).toBe('aiDependency');
    // Nightmare 初期リテラシー（25）は到達可能、Hard 初期（35）は対象外。
    expect(
      evaluateLose(org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: 25 }), totals(), 30),
    ).toBe('aiDependency');
    expect(
      evaluateLose(org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: 35 }), totals(), 30),
    ).toBeNull();
  });

  it('予算が尽きると AI ツールを維持できず敗北する', () => {
    expect(evaluateLose(org(), totals(), BUDGET_EXHAUSTED_CAP + 1)).toBeNull();
    expect(evaluateLose(org(), totals(), BUDGET_EXHAUSTED_CAP)).toBe('budgetExhausted');
  });

  it('健全な組織は敗北条件に当たらない', () => {
    expect(evaluateLose(org(), totals({ reviewQueuePeak: 5 }), 30)).toBeNull();
  });

  it('ボスは clear 条件を満たすと突破できる（大型リリース）', () => {
    const boss = getBoss('big-release')!;
    const result = { delivered: 100, spread: 0, aiAssistedPct: 50 } as SprintResult;
    expect(evaluateBoss({ boss, result, org: org(), bossTargetMul: 1 })).toBe(true);
    const weak = { delivered: 50, spread: 0, aiAssistedPct: 50 } as SprintResult;
    expect(evaluateBoss({ boss, result: weak, org: org(), bossTargetMul: 1 })).toBe(false);
  });

  it('ノーダメージ勝利は高水準の健全指標まで要求する（RI-76）', () => {
    const win = evaluateWinType({
      org: org({
        quality: 70,
        morale: 70,
        seniorHp: 60,
        aiLiteracy: 50,
        testCoverage: 40,
        documentation: 40,
      }),
      totals: totals({
        spread: 0,
        completed: 30,
        done: 30,
        aiAssisted: 5,
        rework: 2,
        reviewQueuePeak: 4,
      }),
      budget: 10,
      usedHeavyActions: false,
    });
    expect(win).toBe('noDamage');
  });

  it('カオス勝利の出荷判定は totals.delivered を使う', () => {
    const baseOrg = org({
      deliveryScore: 50,
      quality: 40,
      morale: 40,
      seniorHp: 40,
      aiLiteracy: 50,
    });
    const baseTotals = {
      incidents: 8,
      completed: 40,
      aiAssisted: 5,
      rework: 20,
      reviewQueuePeak: 20,
      spread: 1,
    };
    expect(
      evaluateWinType({
        org: baseOrg,
        totals: totals({ ...baseTotals, delivered: 250 }),
        budget: 10,
        usedHeavyActions: true,
      }),
    ).toBe('chaos');
    // 選択中チームの deliveryScore が高くてもラン累計が足りなければカオスにならない。
    expect(
      evaluateWinType({
        org: org({ deliveryScore: 500, quality: 40, morale: 40, seniorHp: 40, aiLiteracy: 50 }),
        totals: totals({ ...baseTotals, delivered: 100 }),
        budget: 10,
        usedHeavyActions: true,
      }),
    ).not.toBe('chaos');
  });
});
