import { describe, expect, it } from 'vitest';
import { createEngine } from '../../../src/sim/engine';
import {
  REVIEW_FREEZE_DANGER_PEAK,
  REVIEW_FREEZE_WATCH_PEAK,
  aiDependencyHudCopy,
  budgetHudCopy,
  deriveHudMetrics,
  deriveStatus,
  deriveHudStatusParts,
  diffRunMetricSnapshots,
  diffHudMetricSnapshots,
  goalCarryoverHudCopy,
  hudMetricSnapshot,
  reviewFreezeHudCopy,
  riskLevel,
  runMetricSnapshot,
  trustHudCopy,
  type HudMetricSnapshot,
  type RunMetricSnapshot,
} from '../../../src/render/status';
import type { OrgScaleState } from '../../../src/sim/orgscale/types';
import type { OrgState, SimState } from '../../../src/sim/types';

/** 既定スナップショットに org を上書きした SimState を作る。 */
function withOrg(org: Partial<OrgState>): SimState {
  const base = createEngine({ seed: 'status', aiEnabled: true }).snapshot();
  return { ...base, aiEnabled: org.aiEnabled ?? base.aiEnabled, org: { ...base.org, ...org } };
}

describe('deriveStatus（状態→ステータス表示）', () => {
  it('AI 導入時は開発速度 S、未導入時は B', () => {
    expect(deriveStatus(withOrg({ aiEnabled: true })).devSpeed).toBe('S');
    expect(deriveStatus(withOrg({ aiEnabled: false })).devSpeed).toBe('B');
  });

  it('シニア体力が高いほどレビュー耐性のグレードが上がる', () => {
    const high = deriveStatus(withOrg({ seniorHp: 95 })).reviewCapacity;
    const low = deriveStatus(withOrg({ seniorHp: 15 })).reviewCapacity;
    expect(high).toBe('S');
    expect(low).toBe('E');
  });

  it('AI依存度・技術的負債・士気をそのまま数値で出す', () => {
    const s = deriveStatus(withOrg({ aiDependency: 72, techDebt: 41, morale: 66 }));
    expect(s.aiDependencyPct).toBe(72);
    expect(s.techDebt).toBe(41);
    expect(s.morale).toBe(66);
  });

  it('全社俯瞰中はHUD数値に組織スケール集約値を使う', () => {
    const state = withOrg({
      deliveryScore: 50,
      aiDependency: 72,
      techDebt: 41,
      morale: 66,
      seniorHp: 80,
    });
    const orgScale: OrgScaleState = {
      seed: 'status',
      departments: [],
      shipping: 180,
      teamCount: 4,
      deptCount: 1,
      engineers: 16,
      aiDependency: 44,
      techDebt: 12,
      morale: 91,
      onFire: 0,
      diagnosis: state.diagnosis,
      infra: { ci: 0, docs: 0, aiGuideline: 0 },
      budget: 20,
      score: 160,
      healthRank: 'A',
      securityLevel: 60,
    };

    expect(
      hudMetricSnapshot(deriveHudStatusParts(state.org, state.sprint.tasks, orgScale)),
    ).toEqual({
      deliveryScore: 180,
      seniorHpPct: 80,
      aiDependencyPct: 44,
      techDebt: 12,
      morale: 91,
      securityLevel: 60,
    });
  });
});

describe('riskLevel（炎上リスク）', () => {
  it('渋滞が大きい/体力が低いほどリスクが上がる', () => {
    expect(riskLevel(0, 100)).toBe('LOW');
    expect(riskLevel(7, 80)).toBe('MED');
    expect(riskLevel(13, 80)).toBe('HIGH');
    expect(riskLevel(0, 20)).toBe('HIGH');
  });
});

describe('deriveHudMetrics（HUD情報設計）', () => {
  it('9指標それぞれにアイコン・方向・説明を付与する', () => {
    const state = withOrg({ aiDependency: 20, techDebt: 10, morale: 80 });
    const metrics = deriveHudMetrics(state.org, state.sprint.tasks);

    expect(metrics).toHaveLength(9);
    expect(metrics.map((m) => m.id)).toEqual([
      'delivery',
      'devSpeed',
      'reviewCapacity',
      'quality',
      'security',
      'seniorHp',
      'aiDependency',
      'techDebt',
      'morale',
    ]);
    for (const metric of metrics) {
      expect(metric.icon.length).toBeGreaterThan(0);
      expect(metric.directionLabel.length).toBeGreaterThan(0);
      expect(metric.help.length).toBeGreaterThan(0);
    }
  });

  it('セキュリティ水準が50未満なら注意チップを出す（RI-87）', () => {
    const metrics = deriveHudMetrics(withOrg({ securityLevel: 20 }).org, []);
    expect(metrics.find((m) => m.id === 'security')).toMatchObject({
      value: 20,
      tone: 'danger',
      warningChip: 'セキュリティ危険',
    });
    expect(
      deriveHudMetrics(withOrg({ securityLevel: 70 }).org, []).find((m) => m.id === 'security')
        ?.warningChip,
    ).toBeUndefined();
  });

  it('低いほど安全な指標は高値で危険域になる', () => {
    const state = withOrg({ aiDependency: 82, techDebt: 90 });
    const metrics = deriveHudMetrics(state.org, state.sprint.tasks);

    expect(metrics.find((m) => m.id === 'aiDependency')).toMatchObject({
      direction: 'lower-better',
      tone: 'danger',
    });
    expect(metrics.find((m) => m.id === 'techDebt')).toMatchObject({
      direction: 'lower-better',
      tone: 'danger',
    });
  });

  it('低リテラシーかつ依存度注意帯では AI依存の予兆チップを出す（RI-74）', () => {
    expect(aiDependencyHudCopy(55, 25).warningChip).toMatch(/依存危険/);
    expect(aiDependencyHudCopy(40, 45).warningChip).toBeUndefined();

    const state = withOrg({ aiDependency: 60, aiLiteracy: 25 });
    const metrics = deriveHudMetrics(state.org, state.sprint.tasks);
    expect(metrics.find((m) => m.id === 'aiDependency')).toMatchObject({
      warningChip: '依存危険・ペアかガイド',
    });
    expect(metrics.find((m) => m.id === 'aiDependency')?.detail).toMatch(/Literacy 25/);
    expect(metrics.find((m) => m.id === 'aiDependency')?.help).toMatch(/95/);

    // 俯瞰では全社集約依存度とチーム Literacy を混ぜない
    const orgScale: OrgScaleState = {
      seed: 'status',
      departments: [],
      shipping: 180,
      teamCount: 4,
      deptCount: 1,
      engineers: 16,
      aiDependency: 60,
      techDebt: 12,
      morale: 91,
      onFire: 0,
      diagnosis: state.diagnosis,
      infra: { ci: 0, docs: 0, aiGuideline: 0 },
      budget: 20,
      score: 160,
      healthRank: 'A',
      securityLevel: 60,
    };
    const scaled = deriveHudMetrics(state.org, state.sprint.tasks, orgScale);
    expect(scaled.find((m) => m.id === 'aiDependency')?.warningChip).toBeUndefined();
    expect(scaled.find((m) => m.id === 'aiDependency')?.detail).not.toMatch(/Literacy/);
  });

  it('シニア体力と士気は低下すると危険域として表示する', () => {
    const state = withOrg({ seniorHp: 20, morale: 30 });
    const burning = state.sprint.tasks.map((task, index) =>
      index === 0 ? { ...task, incident: true, lane: 'rework' as const, burnTicksLeft: 10 } : task,
    );
    const metrics = deriveHudMetrics(state.org, burning);

    expect(metrics.find((m) => m.id === 'seniorHp')).toMatchObject({
      direction: 'higher-better',
      tone: 'danger',
      barPct: 20,
      detail: '燃え尽き寸前・緊急対応で鎮火',
      warningChip: '燃え尽き危険',
    });
    expect(metrics.find((m) => m.id === 'seniorHp')?.help).toContain('緊急対応');
    expect(metrics.find((m) => m.id === 'seniorHp')?.help).toContain('抽象値');
    expect(metrics.find((m) => m.id === 'morale')).toMatchObject({
      direction: 'higher-better',
      tone: 'danger',
      risk: 'HIGH',
    });
  });

  it('RI-67: シニア体力の注意域では燃え尽き向け警告を出す', () => {
    const emptyTasks = withOrg({}).sprint.tasks;
    const urgentBurning = emptyTasks.map((task, index) =>
      index === 0 ? { ...task, incident: true, lane: 'rework' as const, burnTicksLeft: 10 } : task,
    );
    const watchBurning = deriveHudMetrics(withOrg({ seniorHp: 40 }).org, urgentBurning);
    expect(watchBurning.find((m) => m.id === 'seniorHp')).toMatchObject({
      tone: 'watch',
      detail: '低下中・緊急の炎上は緊急対応で',
      warningChip: '体力注意',
    });

    // 猶予のある単発炎上は緊急対応を勧めない（RI-73）。
    const lightBurning = emptyTasks.map((task, index) =>
      index === 0 ? { ...task, incident: true, lane: 'rework' as const, burnTicksLeft: 40 } : task,
    );
    expect(
      deriveHudMetrics(withOrg({ seniorHp: 40 }).org, lightBurning).find(
        (m) => m.id === 'seniorHp',
      ),
    ).toMatchObject({
      detail: '低下中・AIスロットルや休息で守る',
      warningChip: '体力注意',
    });

    const congested = Array.from({ length: 10 }, (_, i) => ({
      ...emptyTasks[0]!,
      id: i,
      lane: 'review' as const,
      incident: false,
    }));
    expect(
      deriveHudMetrics(withOrg({ seniorHp: 40 }).org, congested).find((m) => m.id === 'seniorHp'),
    ).toMatchObject({
      detail: '低下中・アンドンや休息で守る',
      warningChip: '体力注意',
    });

    const dangerNoFire = deriveHudMetrics(withOrg({ seniorHp: 20 }).org, emptyTasks);
    expect(dangerNoFire.find((m) => m.id === 'seniorHp')).toMatchObject({
      tone: 'danger',
      detail: '燃え尽き寸前・AIスロットルや休息で守る',
      warningChip: '燃え尽き危険',
    });

    const good = deriveHudMetrics(withOrg({ seniorHp: 80 }).org, emptyTasks).find(
      (m) => m.id === 'seniorHp',
    );
    expect(good).toMatchObject({
      tone: 'good',
      detail: '25%未満は危険',
    });
    expect(good?.warningChip).toBeUndefined();
  });

  it('予算・信頼の危険域で予兆チップを出す（RI-79）', () => {
    expect(budgetHudCopy(3)).toMatchObject({ tone: 'danger', warningChip: '予算危険' });
    expect(budgetHudCopy(12)).toMatchObject({ tone: 'watch', warningChip: '予算注意' });
    expect(budgetHudCopy(40).warningChip).toBeUndefined();
    // budget<=5 は missed_crisis 以上確定のため追加申請は案内しない（RI-79）。
    expect(budgetHudCopy(3).detail).not.toContain('追加申請');
    expect(budgetHudCopy(3).detail).toContain('支出抑制');

    expect(trustHudCopy({ management: 10, customers: 40, team: 40 })).toMatchObject({
      tone: 'danger',
      warningChip: '信頼危険',
      minTrust: 10,
    });
    expect(trustHudCopy({ management: 22, customers: 40, team: 40 })).toMatchObject({
      tone: 'watch',
      warningChip: '信頼注意',
      minTrust: 22,
    });
    expect(trustHudCopy({ management: 40, customers: 40, team: 40 }).warningChip).toBeUndefined();
  });

  it('目標修正キャリーオーバーの有効四半期だけチップを出す（RI-83）', () => {
    expect(
      goalCarryoverHudCopy({
        goalCarryoverId: 'pause_ai_rollout',
        goalCarryoverQuarter: 2,
        quarterNumber: 1,
      }).warningChip,
    ).toBeUndefined();
    expect(
      goalCarryoverHudCopy({
        goalCarryoverId: 'pause_ai_rollout',
        goalCarryoverQuarter: 2,
        quarterNumber: 2,
      }),
    ).toMatchObject({
      tone: 'watch',
      warningChip: 'AI 導入一時停止',
    });
    expect(
      goalCarryoverHudCopy({
        goalCarryoverId: 'extend_deadline',
        goalCarryoverQuarter: 2,
        quarterNumber: 2,
      }),
    ).toMatchObject({
      tone: 'good',
      warningChip: '期限延長',
    });
    expect(
      goalCarryoverHudCopy({
        goalCarryoverId: 'extend_deadline',
        goalCarryoverQuarter: 2,
        quarterNumber: 2,
      }).detail,
    ).toMatch(/シニア|Rework|レビュー/);
    expect(
      goalCarryoverHudCopy({
        goalCarryoverId: 'quality_pivot',
        goalCarryoverQuarter: 2,
        quarterNumber: 2,
      }).detail,
    ).toMatch(/品質\+4\/S/);
  });

  it('レビュー凍結の危険域で予兆チップを出す（RI-85）', () => {
    expect(reviewFreezeHudCopy(0).warningChip).toBeUndefined();
    expect(reviewFreezeHudCopy(REVIEW_FREEZE_WATCH_PEAK)).toMatchObject({
      tone: 'watch',
      warningChip: '凍結注意',
    });
    expect(reviewFreezeHudCopy(REVIEW_FREEZE_DANGER_PEAK)).toMatchObject({
      tone: 'danger',
      warningChip: 'PR凍結危険',
    });
    // 低HPだけでは凍結チップを出さない（燃え尽き側の警告に任せる）。
    expect(
      deriveHudMetrics(withOrg({ seniorHp: 40 }).org, []).find((m) => m.id === 'reviewCapacity')
        ?.warningChip,
    ).toBeUndefined();
    const metrics = deriveHudMetrics(
      withOrg({ seniorHp: 80 }).org,
      [],
      null,
      REVIEW_FREEZE_WATCH_PEAK,
    );
    expect(metrics.find((m) => m.id === 'reviewCapacity')).toMatchObject({
      warningChip: '凍結注意',
    });
  });
});

describe('HUD 指標差分', () => {
  const baseSnapshot: HudMetricSnapshot = {
    deliveryScore: 100,
    seniorHpPct: 80,
    aiDependencyPct: 30,
    techDebt: 10,
    morale: 60,
    securityLevel: 60,
  };

  it('StatusView から差分検出用スナップショットを作る', () => {
    const status = deriveStatus(withOrg({ aiDependency: 72, techDebt: 41, morale: 66 }));
    expect(hudMetricSnapshot(status)).toEqual({
      deliveryScore: status.deliveryScore,
      seniorHpPct: status.seniorHpPct,
      aiDependencyPct: 72,
      techDebt: 41,
      morale: 66,
      securityLevel: status.securityLevel,
    });
  });

  it('良い指標の増加は positive、減少は negative にする', () => {
    expect(
      diffHudMetricSnapshots(baseSnapshot, {
        ...baseSnapshot,
        deliveryScore: 112,
        seniorHpPct: 75,
        morale: 68,
      }),
    ).toEqual([
      { key: 'deliveryScore', label: '出荷ポイント', delta: 12, tone: 'positive' },
      { key: 'seniorHpPct', label: 'シニア体力', delta: -5, tone: 'negative' },
      { key: 'morale', label: '士気', delta: 8, tone: 'positive' },
    ]);
  });

  it('AI依存度/技術的負債は増加を negative、減少を positive にする', () => {
    expect(
      diffHudMetricSnapshots(baseSnapshot, {
        ...baseSnapshot,
        aiDependencyPct: 38,
        techDebt: 7,
      }),
    ).toEqual([
      { key: 'aiDependencyPct', label: 'AI依存度', delta: 8, tone: 'negative' },
      { key: 'techDebt', label: '技術的負債', delta: -3, tone: 'positive' },
    ]);
  });

  it('変化がない指標は差分に含めない', () => {
    expect(diffHudMetricSnapshots(baseSnapshot, { ...baseSnapshot })).toEqual([]);
  });
});

describe('RunBar 指標差分', () => {
  const baseSnapshot: RunMetricSnapshot = {
    budget: 40,
    trustManagement: 70,
    trustCustomers: 80,
    trustTeam: 90,
  };

  it('RunState から予算・信頼の差分検出用スナップショットを作る', () => {
    const stakeholderTrust = { management: 68, customers: 74, team: 81 };

    expect(runMetricSnapshot({ budget: 25, stakeholderTrust })).toEqual({
      budget: 25,
      trustManagement: stakeholderTrust.management,
      trustCustomers: stakeholderTrust.customers,
      trustTeam: stakeholderTrust.team,
    });
  });

  it('予算・信頼は増加を positive、減少を negative にする', () => {
    expect(
      diffRunMetricSnapshots(baseSnapshot, {
        ...baseSnapshot,
        budget: 32,
        trustManagement: 76,
        trustTeam: 85,
      }),
    ).toEqual([
      { key: 'budget', label: '予算', shortLabel: '予算', delta: -8, tone: 'negative' },
      {
        key: 'trustManagement',
        label: '経営信頼',
        shortLabel: '経営',
        delta: 6,
        tone: 'positive',
      },
      {
        key: 'trustTeam',
        label: 'チーム信頼',
        shortLabel: 'チーム',
        delta: -5,
        tone: 'negative',
      },
    ]);
  });

  it('変化がない予算・信頼は差分に含めない', () => {
    expect(diffRunMetricSnapshots(baseSnapshot, { ...baseSnapshot })).toEqual([]);
  });
});
