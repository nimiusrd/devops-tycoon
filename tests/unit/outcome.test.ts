import { describe, expect, it } from 'vitest';
import type { BossDef } from '../../src/data/bosses';
import {
  AI_DEPENDENCY_CAP,
  AI_LITERACY_UNSAFE_CAP,
  BUDGET_EXHAUSTED_CAP,
  CONSECUTIVE_INCIDENT_SPRINT_CAP,
  REVIEW_FREEZE_PEAK,
  TECH_DEBT_CAP,
  evaluateBoss,
  evaluateLose,
  evaluateWinType,
  winView,
} from '../../src/sim/outcome';
import type { RunTotals, WinType } from '../../src/sim/run/types';
import type { OrgState, SprintResult } from '../../src/sim/types';

const org = (overrides: Partial<OrgState> = {}): OrgState => ({
  aiEnabled: true,
  aiDependency: AI_DEPENDENCY_CAP - 1,
  aiLiteracy: AI_LITERACY_UNSAFE_CAP,
  testCoverage: 50,
  documentation: 50,
  quality: 50,
  morale: 2,
  seniorHp: 2,
  techDebt: TECH_DEBT_CAP - 1,
  deliveryScore: 0,
  ...overrides,
});

const totals = (overrides: Partial<RunTotals> = {}): RunTotals => ({
  delivered: 0,
  done: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 0,
  aiAssisted: 0,
  completed: 0,
  reviewQueuePeak: REVIEW_FREEZE_PEAK - 1,
  maxCombo: 0,
  consecutiveIncidentSprints: CONSECUTIVE_INCIDENT_SPRINT_CAP - 1,
  ...overrides,
});

const sprintResult = (overrides: Partial<SprintResult> = {}): SprintResult => ({
  done: 0,
  delivered: 120,
  maxCombo: 0,
  aiAssistedPct: 50,
  reviewQueueMax: 0,
  rework: 0,
  incidents: 0,
  contained: 0,
  spread: 2,
  seniorHpDelta: 0,
  actionCounts: {},
  grade: 'A',
  title: 'ok',
  diagnosis: 'ok',
  timeline: [],
  events: [],
  fireEvents: [],
  focusRemaining: 0,
  focusMax: 0,
  autoContainCount: 0,
  ...overrides,
});

describe('evaluateLose', () => {
  it('全敗北条件の直前値はラン継続として扱う', () => {
    expect(evaluateLose(org(), totals(), BUDGET_EXHAUSTED_CAP + 1)).toBeNull();
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: AI_LITERACY_UNSAFE_CAP + 1 }),
        totals({ consecutiveIncidentSprints: undefined }),
        BUDGET_EXHAUSTED_CAP + 1,
      ),
    ).toBeNull();
  });

  it.each([
    ['seniorBurnout', org({ seniorHp: 1 }), totals(), BUDGET_EXHAUSTED_CAP + 1],
    ['moraleCollapse', org({ morale: 1 }), totals(), BUDGET_EXHAUSTED_CAP + 1],
    ['techDebt', org({ techDebt: TECH_DEBT_CAP }), totals(), BUDGET_EXHAUSTED_CAP + 1],
    [
      'reviewFreeze',
      org(),
      totals({ reviewQueuePeak: REVIEW_FREEZE_PEAK }),
      BUDGET_EXHAUSTED_CAP + 1,
    ],
    [
      'incidentCascade',
      org(),
      totals({ consecutiveIncidentSprints: CONSECUTIVE_INCIDENT_SPRINT_CAP }),
      BUDGET_EXHAUSTED_CAP + 1,
    ],
    [
      'aiDependency',
      org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: AI_LITERACY_UNSAFE_CAP }),
      totals(),
      BUDGET_EXHAUSTED_CAP + 1,
    ],
    ['budgetExhausted', org(), totals(), BUDGET_EXHAUSTED_CAP],
  ] as const)('%s は境界値ちょうどで敗北する', (reason, state, runTotals, budget) => {
    expect(evaluateLose(state, runTotals, budget)).toBe(reason);
  });

  it('AI 依存敗北は依存度上限以上かつリテラシー危険域以下の場合だけ成立する', () => {
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP - 1, aiLiteracy: AI_LITERACY_UNSAFE_CAP }),
        totals(),
        BUDGET_EXHAUSTED_CAP + 1,
      ),
    ).toBeNull();
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: AI_LITERACY_UNSAFE_CAP + 1 }),
        totals(),
        BUDGET_EXHAUSTED_CAP + 1,
      ),
    ).toBeNull();
    expect(
      evaluateLose(
        org({ aiDependency: AI_DEPENDENCY_CAP, aiLiteracy: AI_LITERACY_UNSAFE_CAP }),
        totals(),
        BUDGET_EXHAUSTED_CAP + 1,
      ),
    ).toBe('aiDependency');
  });
});

describe('evaluateBoss', () => {
  const boss: BossDef = {
    id: 'boundary-boss',
    name: '境界ボス',
    description: 'threshold test',
    taskCountMul: 1,
    incidentMul: 1,
    clear: {
      minSprintDelivered: 60,
      maxSpread: 2,
      maxTechDebt: 40,
      minAiPct: 50,
      minMorale: 45,
      minQuality: 55,
    },
  };

  it('全 clear 条件は閾値ちょうどなら突破できる', () => {
    expect(
      evaluateBoss({
        boss,
        result: sprintResult({ delivered: 90, spread: 2, aiAssistedPct: 50 }),
        org: org({ techDebt: 40, morale: 45, quality: 55 }),
        bossTargetMul: 1.5,
      }),
    ).toBe(true);
  });

  it.each([
    ['delivered', sprintResult({ delivered: 89 }), org({ techDebt: 40, morale: 45, quality: 55 })],
    ['spread', sprintResult({ spread: 3 }), org({ techDebt: 40, morale: 45, quality: 55 })],
    ['techDebt', sprintResult(), org({ techDebt: 41, morale: 45, quality: 55 })],
    [
      'aiAssistedPct',
      sprintResult({ aiAssistedPct: 49 }),
      org({ techDebt: 40, morale: 45, quality: 55 }),
    ],
    ['morale', sprintResult(), org({ techDebt: 40, morale: 44, quality: 55 })],
    ['quality', sprintResult(), org({ techDebt: 40, morale: 45, quality: 54 })],
  ] as const)('%s が閾値を1だけ外れると突破失敗になる', (_field, result, state) => {
    expect(evaluateBoss({ boss, result, org: state, bossTargetMul: 1.5 })).toBe(false);
  });

  it('clear 条件が空のボスは常に突破できる', () => {
    expect(
      evaluateBoss({
        boss: { ...boss, clear: {} },
        result: sprintResult({ delivered: 0, spread: 99, aiAssistedPct: 0 }),
        org: org({ techDebt: 99, morale: 0, quality: 0 }),
        bossTargetMul: 10,
      }),
    ).toBe(true);
  });

  it.each([
    [
      'minSprintDelivered',
      { clear: { minSprintDelivered: 60 }, bossTargetMul: 1.5 },
      sprintResult({ delivered: 89 }),
      org(),
    ],
    [
      'maxSpread',
      { clear: { maxSpread: 2 }, bossTargetMul: 1 },
      sprintResult({ spread: 3 }),
      org(),
    ],
    [
      'maxTechDebt',
      { clear: { maxTechDebt: 40 }, bossTargetMul: 1 },
      sprintResult(),
      org({ techDebt: 41 }),
    ],
    [
      'minAiPct',
      { clear: { minAiPct: 50 }, bossTargetMul: 1 },
      sprintResult({ aiAssistedPct: 49 }),
      org(),
    ],
    [
      'minMorale',
      { clear: { minMorale: 45 }, bossTargetMul: 1 },
      sprintResult(),
      org({ morale: 44 }),
    ],
    [
      'minQuality',
      { clear: { minQuality: 55 }, bossTargetMul: 1 },
      sprintResult(),
      org({ quality: 54 }),
    ],
  ] as const)('%s 単独条件でも閾値未満なら突破失敗になる', (_field, config, result, state) => {
    expect(
      evaluateBoss({
        boss: { ...boss, clear: config.clear },
        result,
        org: state,
        bossTargetMul: config.bossTargetMul,
      }),
    ).toBe(false);
  });
});

describe('winView', () => {
  it.each([
    ['normal', '通常勝利', 'ボスを突破し、四半期を完遂した。'],
    ['healthy', '健全勝利', '出荷・品質・士気をすべて高く保って突破した。'],
    ['aiSuccess', 'AI 導入成功勝利', '高い AI 利用率を、手戻りとレビュー渋滞を抑えて両立した。'],
    ['management', '経営勝利', '予算に余裕を残しながら成果を最大化した。'],
    ['happiness', '現場幸福勝利', 'Morale とシニア体力を高く保ち続けた。'],
    ['chaos', 'カオス勝利', '障害を連発しながら、なぜか出荷だけは最大化した。'],
    [
      'noDamage',
      'ノーダメージ勝利',
      '残業・アンドンを使わず延焼も許さず、品質・士気・シニア体力まで高水準で守り切った。',
    ],
  ] as const)('%s の表示情報を返す', (type, label, description) => {
    expect(winView(type)).toEqual({ type, label, description });
  });
});

describe('evaluateWinType', () => {
  const runTotals = (overrides: Partial<RunTotals> = {}): RunTotals =>
    totals({
      delivered: 100,
      rework: 3,
      spread: 1,
      aiAssisted: 0,
      completed: 10,
      reviewQueuePeak: 20,
      consecutiveIncidentSprints: 0,
      ...overrides,
    });

  const win = (
    expected: WinType,
    options: {
      org?: Partial<OrgState>;
      totals?: Partial<RunTotals>;
      budget?: number;
      usedHeavyActions?: boolean;
    },
  ) => {
    expect(
      evaluateWinType({
        org: org({ seniorHp: 30, morale: 50, quality: 50, ...(options.org ?? {}) }),
        totals: runTotals(options.totals),
        budget: options.budget ?? 10,
        usedHeavyActions: options.usedHeavyActions ?? true,
      }),
    ).toBe(expected);
  };

  it('ノーダメージは高水準の健全指標と健全診断を要求し、受動だけでは取れない（RI-76）', () => {
    win('noDamage', {
      org: {
        quality: 70,
        morale: 70,
        seniorHp: 60,
        testCoverage: 40,
        documentation: 40,
        aiLiteracy: 50,
      },
      totals: { spread: 0, completed: 20, rework: 2, aiAssisted: 0, reviewQueuePeak: 4 },
      usedHeavyActions: false,
      budget: 10,
    });
    // 重介入なし・延焼0だけでは足りない（旧ラダーの受動ノーダメ）。
    win('normal', {
      org: { quality: 50, morale: 50, seniorHp: 30, aiLiteracy: 50 },
      totals: { spread: 0, completed: 20, rework: 2, aiAssisted: 0, reviewQueuePeak: 4 },
      usedHeavyActions: false,
      budget: 10,
    });
    // 重介入ありだとノーダメにはならず、幸福など別種別へ落ちる。
    win('happiness', {
      org: {
        quality: 70,
        morale: 70,
        seniorHp: 60,
        testCoverage: 40,
        documentation: 40,
        aiLiteracy: 50,
      },
      totals: { spread: 0, completed: 20, rework: 2, aiAssisted: 0, reviewQueuePeak: 4 },
      usedHeavyActions: true,
      budget: 10,
    });
  });

  it('AI導入成功は利用率・検証・Literacy で成立し、健全より先に評価される（RI-76）', () => {
    win('aiSuccess', {
      org: { quality: 80, morale: 80, seniorHp: 40, aiLiteracy: 40 },
      totals: { completed: 20, aiAssisted: 12, rework: 3, reviewQueuePeak: 10, spread: 1 },
      budget: 10,
    });
    win('normal', {
      org: { quality: 50, morale: 50, seniorHp: 30, aiLiteracy: 39 },
      totals: { completed: 20, aiAssisted: 12, rework: 3, reviewQueuePeak: 10, spread: 1 },
      budget: 10,
    });
    // reviewHell（ピーク16〜19）と重なる場合は aiSuccess にしない。
    win('normal', {
      org: { quality: 50, morale: 50, seniorHp: 40, aiLiteracy: 40 },
      totals: { completed: 20, aiAssisted: 12, rework: 3, reviewQueuePeak: 18, spread: 1 },
      budget: 10,
    });
    // aiOverproduction（高AI率かつキュー詰まり）と重なる場合も aiSuccess にしない。
    win('normal', {
      org: { quality: 50, morale: 50, seniorHp: 40, aiLiteracy: 55 },
      totals: { completed: 20, aiAssisted: 12, rework: 3, reviewQueuePeak: 12, spread: 1 },
      budget: 10,
    });
  });

  it('幸福・経営・カオス・健全はビルド指標で分岐する（RI-76）', () => {
    win('happiness', {
      org: { morale: 70, seniorHp: 55, quality: 50, aiLiteracy: 50 },
      totals: { completed: 20, aiAssisted: 0, rework: 2, reviewQueuePeak: 4, spread: 1 },
      budget: 10,
    });
    win('management', {
      org: { morale: 50, seniorHp: 30, quality: 50, aiLiteracy: 50 },
      totals: { completed: 20, aiAssisted: 0, rework: 2, reviewQueuePeak: 4, spread: 1 },
      budget: 35,
    });
    win('chaos', {
      org: { morale: 50, seniorHp: 30, quality: 50, aiLiteracy: 50 },
      totals: {
        completed: 20,
        aiAssisted: 0,
        rework: 2,
        reviewQueuePeak: 4,
        spread: 1,
        incidents: 6,
        delivered: 250,
      },
      budget: 10,
    });
    win('healthy', {
      org: {
        quality: 65,
        morale: 65,
        seniorHp: 30,
        aiLiteracy: 50,
        testCoverage: 40,
        documentation: 40,
      },
      totals: { completed: 20, aiAssisted: 0, rework: 2, reviewQueuePeak: 4, spread: 1 },
      budget: 10,
    });
    win('healthy', {
      org: {
        quality: 55,
        morale: 60,
        seniorHp: 40,
        aiLiteracy: 50,
        testCoverage: 70,
        documentation: 60,
      },
      totals: { completed: 20, aiAssisted: 0, rework: 2, reviewQueuePeak: 4, spread: 1 },
      budget: 10,
    });
    // documentationKingdom 経路でも士気下限未満なら健全にしない。
    win('normal', {
      org: {
        quality: 55,
        morale: 59,
        seniorHp: 40,
        aiLiteracy: 50,
        testCoverage: 70,
        documentation: 60,
      },
      totals: { completed: 20, aiAssisted: 0, rework: 2, reviewQueuePeak: 4, spread: 1 },
      budget: 10,
    });
  });

  it('代表ビルド入力で勝利種別が3種以上に分かれる（RI-76）', () => {
    const types = new Set<WinType>([
      evaluateWinType({
        org: org({
          quality: 72,
          morale: 72,
          seniorHp: 65,
          aiLiteracy: 55,
          testCoverage: 40,
          documentation: 40,
        }),
        totals: runTotals({
          spread: 0,
          completed: 40,
          rework: 4,
          aiAssisted: 0,
          reviewQueuePeak: 6,
        }),
        budget: 12,
        usedHeavyActions: false,
      }),
      evaluateWinType({
        org: org({ quality: 60, morale: 55, seniorHp: 40, aiLiteracy: 55 }),
        totals: runTotals({
          completed: 40,
          aiAssisted: 28,
          rework: 6,
          reviewQueuePeak: 8,
          spread: 1,
        }),
        budget: 12,
        usedHeavyActions: true,
      }),
      evaluateWinType({
        org: org({ quality: 50, morale: 75, seniorHp: 60, aiLiteracy: 50 }),
        totals: runTotals({
          completed: 40,
          aiAssisted: 5,
          rework: 4,
          reviewQueuePeak: 8,
          spread: 1,
        }),
        budget: 12,
        usedHeavyActions: true,
      }),
      evaluateWinType({
        org: org({ quality: 50, morale: 45, seniorHp: 35, aiLiteracy: 50 }),
        totals: runTotals({
          completed: 40,
          aiAssisted: 5,
          rework: 4,
          reviewQueuePeak: 8,
          spread: 2,
          incidents: 8,
          delivered: 320,
        }),
        budget: 12,
        usedHeavyActions: true,
      }),
      evaluateWinType({
        org: org({
          quality: 66,
          morale: 66,
          seniorHp: 35,
          aiLiteracy: 50,
          testCoverage: 40,
          documentation: 40,
        }),
        totals: runTotals({
          completed: 40,
          aiAssisted: 5,
          rework: 4,
          reviewQueuePeak: 8,
          spread: 1,
        }),
        budget: 12,
        usedHeavyActions: true,
      }),
    ]);
    expect(types.size).toBeGreaterThanOrEqual(3);
    expect(types.has('noDamage')).toBe(true);
    expect(types.has('aiSuccess')).toBe(true);
    expect(types.has('happiness')).toBe(true);
  });
});
