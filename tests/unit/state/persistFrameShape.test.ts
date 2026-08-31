import { describe, expect, it } from 'vitest';
import { createRunEngine } from '../../../src/sim/run/engine';
import { isPersistFrameShape } from '../../../src/state/persistFrameShape';

type MutableRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MutableRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function makeFrame(): MutableRecord {
  const engine = createRunEngine({ seed: 'persist-frame-shape' });
  engine.startRun('easy', [], 'persist-frame-shape');
  const frame = engine.exportReplayFrame();
  if (!frame) throw new Error('failed to export replay frame fixture');
  return structuredClone(frame) as unknown as MutableRecord;
}

function setAtPath(root: MutableRecord, path: string, value: unknown): void {
  const keys = path.split('.');
  const finalKey = keys.pop();
  if (!finalKey) throw new Error(`invalid path: ${path}`);

  let target = root;
  for (const key of keys) {
    const next = target[key];
    if (!isRecord(next)) throw new Error(`fixture path is not an object: ${path}`);
    target = next;
  }
  target[finalKey] = value;
}

function expectPathRejected(path: string, value: unknown): void {
  const frame = makeFrame();
  setAtPath(frame, path, value);
  expect(isPersistFrameShape(frame), path).toBe(false);
}

function makeTeam(): MutableRecord {
  return {
    id: 'team-a',
    deptId: 'engineering',
    name: 'Team A',
    aiEnabled: true,
    headcount: 4,
    engineers: 4,
    aiLiteracy: 10,
    aiDependency: 5,
    morale: 80,
    techDebt: 10,
    shipping: 3,
    reviewQueue: 1,
    incidents: 0,
    reviewCapacity: 2,
    incidentBias: 0,
    seniorHp: 90,
    testCoverage: 70,
    documentation: 60,
    quality: 75,
    securityLevel: 65,
  };
}

function makeResult(): MutableRecord {
  const ignite = { tick: 3, kind: 'ignite', taskId: 1, source: 'review' };
  const autoContain = { tick: 4, kind: 'auto-contain', taskId: 1, hpCost: 2 };
  const spread = { tick: 5, kind: 'spread', taskId: 2, debtGain: 1, moraleCost: 1 };
  const contain = { tick: 6, kind: 'contain', taskId: 2, combo: 3 };
  return {
    done: 3,
    delivered: 3,
    maxCombo: 3,
    aiAssistedPct: 50,
    reviewQueueMax: 2,
    rework: 0,
    incidents: 1,
    contained: 1,
    spread: 1,
    seniorHpDelta: -2,
    actionCounts: {},
    grade: 'B',
    title: '安定運用',
    diagnosis: 'healthyAcceleration',
    timeline: [{ tick: 1, reviewQueue: 0, burningCount: 0, combo: 1, seniorHp: 90 }],
    events: [
      {
        tick: 1,
        kind: 'intervention',
        combo: 1,
        effect: { actionId: 'focus', focusCost: 1, gaugeGain: 2 },
      },
      { tick: 2, kind: 'combo-break', reason: 'rework' },
      ignite,
      autoContain,
      spread,
      contain,
    ],
    fireEvents: [ignite, autoContain, spread, contain],
    focusRemaining: 8,
    focusMax: 10,
    autoContainCount: 1,
    gradeRatio: 0.8,
    stabilizingBonus: 1,
    seniorHpLoss: 2,
    stabilizingGrants: 1,
    gradePenalties: { rework: 0, incident: 1, spread: 1, hp: 2, total: 4 },
  };
}

function makeQuarterReview(): MutableRecord {
  return {
    outcome: 'met',
    goal: {
      deliveryTarget: 10,
      qualityTarget: 60,
      techDebtLimit: 40,
      moraleTarget: 50,
      incidentLimit: 3,
    },
    trust: { management: 5, customers: 5, team: 5 },
    progress: [{ id: 'delivery', label: 'Delivery', target: 10, actual: 12, status: 'met' }],
    missedReasons: [],
    availableAdjustments: [],
    bossCleared: true,
  };
}

function makeTrendSnapshot(): MutableRecord {
  return {
    quarterNumber: 1,
    diagnosis: 'healthyAcceleration',
    kpis: [{ id: 'delivery', label: 'Delivery', target: 10, actual: 12, status: 'exceeded' }],
    company: {
      shipping: 10,
      aiDependency: 20,
      techDebt: 15,
      morale: 80,
      onFire: 0,
      healthRank: 'A',
      selfRank: 1,
      selfRanks: { overall: 1, healthy: 1 },
    },
    departments: [
      {
        deptId: 'engineering',
        aiDependency: 20,
        techDebt: 15,
        morale: 80,
        health: 'healthy',
      },
    ],
  };
}

describe('isPersistFrameShape', () => {
  it('エンジンが出力したフレームと、省略可能な拡張フィールドを受理する', () => {
    const frame = makeFrame();
    const extras = frame.extras;
    if (!isRecord(extras)) throw new Error('extras fixture missing');
    extras.teams = [makeTeam()];
    frame.pendingShopHandIndices = [0];
    frame.lastGrowth = {
      promotions: [{ id: 'm1', name: 'Alice', to: 'middle' }],
      leveledUp: ['m1'],
      wentOnLeave: [{ id: 'm2', name: 'Bob' }],
      docGain: 1,
    };
    frame.lastResult = makeResult();
    frame.shop = {
      cards: [{ defId: 'docs', cost: 4, bought: false }],
      relic: { id: 'postmortem', cost: 12, bought: false },
      recruit: { cost: 8, bought: false },
      introSupportGranted: true,
    };
    frame.quarterReview = makeQuarterReview();
    frame.trendHistory = [makeTrendSnapshot()];

    expect(isPersistFrameShape(frame)).toBe(true);
  });

  it.each([
    ['frame', '', null],
    ['trials', 'trials', null],
    ['deck', 'deck', null],
    ['relics', 'relics', null],
    ['goal adjustments', 'goalAdjustmentsTaken', null],
    ['review history', 'reviewHistory', null],
    ['org', 'org', null],
    ['evolution', 'evolution', null],
    ['evolution points', 'evolution.points', 'bad'],
    ['evolution unlocks', 'evolution.unlocked', null],
    ['roster', 'roster', null],
    ['sprint modifiers', 'pendingSprintModifiers', null],
    ['totals', 'totals', null],
    ['quarter totals', 'quarterTotals', null],
    ['quarter goal', 'quarterGoal', null],
    ['stakeholder trust', 'stakeholderTrust', null],
    ['zoom', 'zoom', null],
    ['extras', 'extras', null],
    ['allowed cards', 'extras.allowedCards', null],
    ['allowed relics', 'extras.allowedRelics', null],
    ['base config', 'extras.baseConfig', null],
    ['org adjustment', 'extras.orgAdjust', null],
  ] as const)('%s の必須構造が壊れたフレームを拒否する', (_label, path, value) => {
    if (path === '') {
      expect(isPersistFrameShape(value)).toBe(false);
      return;
    }
    expectPathRejected(path, value);
  });

  it('チーム、ロスター、カードの壊れた拡張値を拒否する', () => {
    expectPathRejected('extras.teams', null);
    expectPathRejected('extras.teams', [null]);
    expectPathRejected('extras.teams', [{ ...makeTeam(), id: null }]);
    expectPathRejected('extras.teams', [{ ...makeTeam(), name: null }]);
    expectPathRejected('extras.teams', [{ ...makeTeam(), headcount: 'four' }]);
    expectPathRejected('extras.teamRosters', null);
    expectPathRejected('extras.teamRosters', { team: null });
    expectPathRejected('pendingShopHandIndices', '0');
    expectPathRejected('draft', ['docs', 1]);

    const draft = makeFrame();
    draft.phase = 'draft';
    draft.draft = null;
    expect(isPersistFrameShape(draft)).toBe(false);

    expectPathRejected('deck', [{ defId: 'unknown-card', level: 1 }]);
    expectPathRejected('deck', [{ defId: 'docs', level: 1, baselineAppliedLevel: 'one' }]);
    expectPathRejected('deck', [
      { defId: 'docs', level: 1, baselineAppliedByTeam: { team: 'one' } },
    ]);
  });

  it('成長結果とショップの各入れ子構造を検査する', () => {
    for (const growth of [
      [],
      { promotions: [null], leveledUp: [], wentOnLeave: [], docGain: 1 },
      { promotions: [{}], leveledUp: [], wentOnLeave: [], docGain: 1 },
      { promotions: [], leveledUp: [1], wentOnLeave: [], docGain: 1 },
      { promotions: [], leveledUp: [], wentOnLeave: null, docGain: 1 },
      { promotions: [], leveledUp: [], wentOnLeave: [null], docGain: 1 },
      { promotions: [], leveledUp: [], wentOnLeave: [{}], docGain: 1 },
      { promotions: [], leveledUp: [], wentOnLeave: [], docGain: 'one' },
    ]) {
      const frame = makeFrame();
      frame.lastGrowth = growth;
      expect(isPersistFrameShape(frame)).toBe(false);
    }

    for (const shop of [
      [],
      { cards: [null] },
      { cards: [{}] },
      { cards: [], relic: null },
      { cards: [], recruit: null },
      { cards: [], introSupportGranted: 'yes' },
    ]) {
      const frame = makeFrame();
      frame.shop = shop;
      expect(isPersistFrameShape(frame)).toBe(false);
    }
  });

  it('スプリント結果のイベント、有限値、ペナルティを検査する', () => {
    const accepted = makeFrame();
    accepted.phase = 'result';
    accepted.lastResult = makeResult();
    expect(isPersistFrameShape(accepted)).toBe(true);

    const invalidResults = [
      { ...makeResult(), timeline: [null] },
      {
        ...makeResult(),
        timeline: [{ tick: 1, reviewQueue: 0, burningCount: 0, combo: 1 }],
      },
      {
        ...makeResult(),
        events: [{ tick: 1, kind: 'intervention', combo: 1, effect: null }],
      },
      { ...makeResult(), events: [{ tick: 1, kind: 'unknown' }] },
      { ...makeResult(), fireEvents: [{ tick: 1, kind: 'combo-break', reason: 'rework' }] },
      { ...makeResult(), grade: null },
      { ...makeResult(), diagnosis: null },
      { ...makeResult(), gradeRatio: Number.NaN },
      { ...makeResult(), stabilizingBonus: Number.POSITIVE_INFINITY },
      { ...makeResult(), seniorHpLoss: 'two' },
      { ...makeResult(), stabilizingGrants: -1 },
      { ...makeResult(), gradePenalties: null },
      {
        ...makeResult(),
        gradePenalties: { rework: 0, incident: 0, spread: 0, hp: 0, total: Number.NaN },
      },
    ];

    for (const lastResult of invalidResults) {
      const frame = makeFrame();
      frame.lastResult = lastResult;
      expect(isPersistFrameShape(frame)).toBe(false);
    }
  });

  it('四半期レビューとトレンド履歴の表示必須値を検査する', () => {
    const accepted = makeFrame();
    accepted.phase = 'quarterReview';
    accepted.quarterReview = makeQuarterReview();
    accepted.trendHistory = [makeTrendSnapshot()];
    expect(isPersistFrameShape(accepted)).toBe(true);

    const invalidReviews = [
      [],
      { ...makeQuarterReview(), outcome: 'unknown' },
      { ...makeQuarterReview(), goal: null },
      { ...makeQuarterReview(), trust: null },
      { ...makeQuarterReview(), progress: [null] },
      { ...makeQuarterReview(), progress: [{}] },
      { ...makeQuarterReview(), missedReasons: [1] },
      { ...makeQuarterReview(), availableAdjustments: [1] },
      { ...makeQuarterReview(), bossCleared: 'yes' },
    ];
    for (const quarterReview of invalidReviews) {
      const frame = makeFrame();
      frame.quarterReview = quarterReview;
      expect(isPersistFrameShape(frame)).toBe(false);
    }

    const invalidTrends = [
      [null],
      [{ ...makeTrendSnapshot(), quarterNumber: null }],
      [{ ...makeTrendSnapshot(), diagnosis: 'unknown' }],
      [{ ...makeTrendSnapshot(), kpis: [null] }],
      [{ ...makeTrendSnapshot(), company: null }],
      [{ ...makeTrendSnapshot(), company: { ...makeTrendSnapshot().company, shipping: null } }],
      [
        {
          ...makeTrendSnapshot(),
          company: { ...makeTrendSnapshot().company, selfRanks: { overall: 'first' } },
        },
      ],
      [{ ...makeTrendSnapshot(), departments: [null] }],
      [
        {
          ...makeTrendSnapshot(),
          departments: [{ ...makeTeam(), deptId: 'engineering', health: 'unknown' }],
        },
      ],
    ];
    for (const trendHistory of invalidTrends) {
      const frame = makeFrame();
      frame.trendHistory = trendHistory;
      expect(isPersistFrameShape(frame)).toBe(false);
    }
  });
});
