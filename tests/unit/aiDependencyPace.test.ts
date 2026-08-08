/**
 * RI-74: Nightmare の AI 依存が第1スプリントで即死しないこと、
 * および回避経路（リテラシー上昇・依存度低下）の効果量を固定する。
 */
import { describe, expect, it } from 'vitest';
import { CARD_DEFS } from '../../src/data/cards';
import { DIFFICULTY_DEFS, getDifficulty } from '../../src/data/difficulties';
import { COMPANY_LEVERS, DEPARTMENT_LEVERS, TEAM_LEVERS } from '../../src/data/levers';
import { PAIR_LITERACY_GAIN, applyAction } from '../../src/sim/actions';
import { applyDeckBaseline, deckEffects } from '../../src/sim/cards';
import { AI_DEP_PER_TASK } from '../../src/sim/model/process';
import { applyLever, emptyAdjustState } from '../../src/sim/orgscale/levers';
import { AI_DEPENDENCY_CAP, AI_LITERACY_UNSAFE_CAP, evaluateLose } from '../../src/sim/outcome';
import { RunEngine } from '../../src/sim/run/engine';
import { createSprint, resolveSprintConfig } from '../../src/sim/sprint';
import type { DifficultyId, RunTotals } from '../../src/sim/run/types';
import type { OrgState } from '../../src/sim/types';
import { aiDependencyHudCopy } from '../../src/render/status';
import { loseNextActionView } from '../../src/render/loseNextActionView';
import { TUTORIAL_STEPS } from '../../src/ui/tutorial';
import { advance } from './helpers/runFlow';

const EMPTY_TOTALS: RunTotals = {
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
  consecutiveIncidentSprints: 0,
};

function orgFromDifficulty(id: DifficultyId): OrgState {
  const def = getDifficulty(id);
  return {
    aiEnabled: true,
    aiDependency: def.org.aiDependencyBase,
    aiLiteracy: def.org.aiLiteracy,
    testCoverage: def.org.testCoverage,
    documentation: def.org.documentation,
    quality: def.org.quality,
    morale: def.org.morale,
    seniorHp: def.org.seniorHp,
    techDebt: 0,
    deliveryScore: 0,
  };
}

/** naive 相当: S1 の全タスクが AI 割当された場合の依存度上限。 */
function depAfterAllAiTasks(id: DifficultyId, base: number, taskCount: number): number {
  const perTask = getDifficulty(id).aiDependencyPerTask ?? AI_DEP_PER_TASK;
  return Math.min(100, base + taskCount * perTask);
}

describe('RI-74 AI依存ペースと回避経路', () => {
  it('Nightmare 初期値は Hard より低く、リテラシーは unsafe 帯に入る', () => {
    const nm = DIFFICULTY_DEFS.nightmare.org;
    const hard = DIFFICULTY_DEFS.hard.org;
    expect(nm.aiDependencyBase).toBe(42);
    expect(nm.aiDependencyBase).toBeLessThan(hard.aiDependencyBase);
    expect(nm.aiLiteracy).toBeLessThanOrEqual(AI_LITERACY_UNSAFE_CAP);
    expect(hard.aiLiteracy).toBeGreaterThan(AI_LITERACY_UNSAFE_CAP);
  });

  it('S1 全タスクを AI 割当しても Nightmare は依存敗北に届かない', () => {
    const baseTasks = 28;
    const frontierDrift = 5;
    expect(DIFFICULTY_DEFS.nightmare.aiDependencyPerTask).toBe(0.8);
    expect(DIFFICULTY_DEFS.normal.aiDependencyPerTask).toBeUndefined();
    for (const id of ['easy', 'normal', 'hard', 'nightmare'] as const) {
      const def = getDifficulty(id);
      const taskCount = Math.round(baseTasks * def.taskCountMul);
      const org = orgFromDifficulty(id);
      // Nightmare は試練ドリフト込みの最悪値でも cap 未満であること
      const start = id === 'nightmare' ? org.aiDependency + frontierDrift : org.aiDependency;
      org.aiDependency = depAfterAllAiTasks(id, start, taskCount);
      const reason = evaluateLose(org, EMPTY_TOTALS, 100);
      if (id === 'nightmare') {
        expect(org.aiDependency).toBeLessThan(AI_DEPENDENCY_CAP);
        expect(reason).not.toBe('aiDependency');
      } else {
        // Hard 以下は初期リテラシーが unsafe を超えるため、依存上限でも即死しない
        expect(org.aiLiteracy).toBeGreaterThan(AI_LITERACY_UNSAFE_CAP);
        expect(reason).not.toBe('aiDependency');
      }
    }
  });

  it('Nightmare の無介入 S1 は aiDependency で敗北しない', () => {
    const seeds = ['ri74-nm-1', 'ri74-nm-2', 'ri74-nm-3', 'ri74-nm-4', 'ri74-nm-5'];
    for (const seed of seeds) {
      const e = new RunEngine({ seed, difficulty: 'nightmare' });
      e.startRun();
      e.beginSetupSprint();
      let guard = 0;
      while (e.snapshot().phase === 'sprint' && guard < 5000) {
        guard += 1;
        e.step(1_000_000);
      }
      const s = e.snapshot();
      expect(guard).toBeLessThan(5000);
      if (s.status === 'lost') {
        expect(s.loseReason).not.toBe('aiDependency');
      } else {
        expect(['result', 'draft', 'sprint']).toContain(s.phase);
        expect(s.org.aiDependency).toBeLessThan(AI_DEPENDENCY_CAP);
      }
    }
  });

  it('frontier-dependency 試練付き Nightmare でも無介入 S1 は aiDependency で敗北しない', () => {
    const seeds = ['ri74-trial-14', 'ri74-trial-1', 'ri74-trial-2'];
    for (const seed of seeds) {
      const e = new RunEngine({ seed, difficulty: 'nightmare' });
      e.startRun('nightmare', ['frontier-dependency'], seed);
      e.beginSetupSprint();
      let guard = 0;
      while (e.snapshot().phase === 'sprint' && guard < 5000) {
        guard += 1;
        e.step(1_000_000);
      }
      const s = e.snapshot();
      expect(guard).toBeLessThan(5000);
      if (s.status === 'lost') {
        expect(s.loseReason).not.toBe('aiDependency');
      } else {
        expect(s.org.aiDependency).toBeLessThan(AI_DEPENDENCY_CAP);
      }
    }
  });

  it('frontier-dependency 付きでも S2 開始ドリフト後に介入余地が残る', () => {
    const e = new RunEngine({ seed: 'ri74-trial-14', difficulty: 'nightmare' });
    e.startRun('nightmare', ['frontier-dependency'], 'ri74-trial-14');
    // S1 完了後、次スプリント開始（ドリフト適用）まで進める
    let guard = 0;
    let sawSecondSprint = false;
    while (e.snapshot().status === 'playing' && guard < 20_000) {
      guard += 1;
      const before = e.snapshot();
      if (before.phase === 'sprint' && before.sprintsPlayed >= 1) {
        sawSecondSprint = true;
        expect(before.loseReason ?? null).not.toBe('aiDependency');
        expect(before.status).toBe('playing');
        expect(before.org.aiDependency).toBeLessThan(AI_DEPENDENCY_CAP);
        break;
      }
      if (!advance(e)) break;
    }
    expect(sawSecondSprint).toBe(true);
  });

  it('旧 Nightmare セーブは復元時に係数と未プレイ初期依存度を補完する', () => {
    const e = new RunEngine({ seed: 'ri74-hydrate', difficulty: 'nightmare' });
    e.startRun();
    const persist = e.exportPersistState();
    expect(persist).not.toBeNull();
    // 旧セーブ相当: 係数欠落 + 旧初期依存 55（ライバルは揺らぎ付き）
    delete persist!.extras.baseConfig.aiDependencyPerTask;
    persist!.org.aiDependency = 55;
    persist!.extras.teams = persist!.extras.teams?.map((t, i) => ({
      ...t,
      aiDependency: i === 0 ? 55 : 55 + (i % 2 === 0 ? 12 : -8),
    }));
    const homeId = persist!.extras.homeTeamId ?? persist!.extras.activeTeamId!;
    const rivalBefore = persist!.extras.teams!.find((t) => t.id !== homeId)!;
    const rivalDeltaExpected = rivalBefore.aiDependency - 55;

    const restored = new RunEngine({ seed: 'ri74-hydrate-2', difficulty: 'normal' });
    restored.hydratePersistState(persist!);
    const s = restored.snapshot();
    expect(s.difficulty).toBe('nightmare');
    expect(s.org.aiDependency).toBe(42);
    expect(restored.exportPersistState()?.extras.baseConfig.aiDependencyPerTask).toBe(0.8);
    const rivalAfter = restored
      .exportPersistState()!
      .extras.teams!.find((t) => t.id === rivalBefore.id)!;
    expect(rivalAfter.aiDependency).toBe(42 + rivalDeltaExpected);
  });

  it('setup 中にライバルへ入った旧 Nightmare セーブも差分移行する', () => {
    const e = new RunEngine({ seed: 'ri74-hydrate-rival', difficulty: 'nightmare' });
    e.startRun();
    const persist = e.exportPersistState();
    expect(persist).not.toBeNull();
    delete persist!.extras.baseConfig.aiDependencyPerTask;
    const homeId = persist!.extras.homeTeamId!;
    const rival = persist!.extras.teams!.find((t) => t.id !== homeId)!;
    // 旧セーブ: ホームは 55、アクティブはライバル（揺らぎ値）で保存されている
    persist!.extras.teams = persist!.extras.teams!.map((t) =>
      t.id === homeId
        ? { ...t, aiDependency: 55 }
        : t.id === rival.id
          ? { ...t, aiDependency: 67 }
          : { ...t, aiDependency: 55 + 9 },
    );
    persist!.extras.activeTeamId = rival.id;
    persist!.org = { ...persist!.org, aiDependency: 67, aiLiteracy: 18 };

    const restored = new RunEngine({ seed: 'ri74-hydrate-rival-2', difficulty: 'normal' });
    restored.hydratePersistState(persist!);
    const saved = restored.exportPersistState()!;
    expect(saved.extras.teams!.find((t) => t.id === homeId)!.aiDependency).toBe(42);
    // 67-13=54 は現行 ±10（42..52）を超えるため 52 へクランプ
    expect(saved.extras.teams!.find((t) => t.id === rival.id)!.aiDependency).toBe(52);
    expect(saved.org.aiDependency).toBe(52);
    expect(saved.extras.activeTeamId).toBe(rival.id);
  });

  it('setup 中にホームへレバーを焼いた旧 Nightmare セーブも差分移行する', () => {
    const e = new RunEngine({ seed: 'ri74-hydrate-lever', difficulty: 'nightmare' });
    e.startRun();
    const persist = e.exportPersistState();
    expect(persist).not.toBeNull();
    delete persist!.extras.baseConfig.aiDependencyPerTask;
    const homeId = persist!.extras.homeTeamId!;
    // teamAiThrottle(-16) 適用後の旧ホーム 55→39。等値 55 では検知できない
    persist!.extras.teams = persist!.extras.teams!.map((t) =>
      t.id === homeId
        ? { ...t, aiDependency: 39 }
        : { ...t, aiDependency: Math.min(100, t.aiDependency + 8) },
    );
    persist!.org = { ...persist!.org, aiDependency: 39 };
    const rivalBefore = persist!.extras.teams!.find((t) => t.id !== homeId)!;
    const rivalBeforeDep = rivalBefore.aiDependency;

    const restored = new RunEngine({ seed: 'ri74-hydrate-lever-2', difficulty: 'normal' });
    restored.hydratePersistState(persist!);
    const saved = restored.exportPersistState()!;
    expect(saved.extras.teams!.find((t) => t.id === homeId)!.aiDependency).toBe(26); // 39-13
    const rivalAfter = saved.extras.teams!.find((t) => t.id === rivalBefore.id)!.aiDependency;
    // 高依存側のみ上限クランプ。レバー済み低依存は下限へ引き上げない
    expect(rivalAfter).toBe(Math.min(52, rivalBeforeDep - 13));
    expect(saved.org.aiDependency).toBe(26);
  });

  it('移行時に施策済み rival の低依存を下限へ引き上げない', () => {
    const e = new RunEngine({ seed: 'ri74-hydrate-rival-lever', difficulty: 'nightmare' });
    e.startRun();
    const persist = e.exportPersistState();
    expect(persist).not.toBeNull();
    delete persist!.extras.baseConfig.aiDependencyPerTask;
    const homeId = persist!.extras.homeTeamId!;
    const rival = persist!.extras.teams!.find((t) => t.id !== homeId)!;
    // 旧生成最小 30 + 全社ガイドライン -10 → 20。差分 -13 後は 7（下限 32 へ上げない）
    persist!.extras.teams = persist!.extras.teams!.map((t) =>
      t.id === homeId
        ? { ...t, aiDependency: 55 }
        : t.id === rival.id
          ? { ...t, aiDependency: 20, aiLiteracy: 20 }
          : { ...t, aiDependency: 55 },
    );
    persist!.org = { ...persist!.org, aiDependency: 55 };

    const restored = new RunEngine({ seed: 'ri74-hydrate-rival-lever-2', difficulty: 'normal' });
    restored.hydratePersistState(persist!);
    const saved = restored.exportPersistState()!;
    expect(saved.extras.teams!.find((t) => t.id === homeId)!.aiDependency).toBe(42);
    expect(saved.extras.teams!.find((t) => t.id === rival.id)!.aiDependency).toBe(7);
  });

  it('旧 ±25 の高依存 rival は移行時に現行 ±10 上限へ抑える', () => {
    const e = new RunEngine({ seed: 'old-20', difficulty: 'nightmare' });
    e.startRun('nightmare', ['frontier-dependency'], 'old-20');
    const persist = e.exportPersistState();
    expect(persist).not.toBeNull();
    delete persist!.extras.baseConfig.aiDependencyPerTask;
    const homeId = persist!.extras.homeTeamId!;
    persist!.extras.teams = persist!.extras.teams!.map((t) =>
      t.id === homeId
        ? { ...t, aiDependency: 55 }
        : t.id === 'platform-t1'
          ? { ...t, aiDependency: 80, aiLiteracy: 20 }
          : { ...t, aiDependency: 60 },
    );
    persist!.org.aiDependency = 55;

    const restored = new RunEngine({ seed: 'old-20-restored', difficulty: 'normal' });
    restored.hydratePersistState(persist!);
    const saved = restored.exportPersistState()!;
    expect(saved.trials).toContain('frontier-dependency');
    expect(saved.extras.teams!.find((t) => t.id === homeId)!.aiDependency).toBe(42);
    expect(saved.extras.teams!.find((t) => t.id === 'platform-t1')!.aiDependency).toBe(52);
    // クランプ後の rival でも frontier 付き無介入 S1 で依存敗北しない
    expect(restored.enterTeam('platform-t1')).toBe(true);
    restored.beginSetupSprint();
    let guard = 0;
    while (restored.snapshot().phase === 'sprint' && guard < 5000) {
      guard += 1;
      restored.step(1_000_000);
    }
    const s = restored.snapshot();
    if (s.status === 'lost') {
      expect(s.loseReason).not.toBe('aiDependency');
    } else {
      expect(s.org.aiDependency).toBeLessThan(AI_DEPENDENCY_CAP);
    }
  });

  it('Nightmare のライバル依存度は低リテラシー時に振れ幅が抑えられる', () => {
    const e = new RunEngine({ seed: 'scratch-135', difficulty: 'nightmare' });
    e.startRun('nightmare', ['frontier-dependency'], 'scratch-135');
    const teams = e.exportPersistState()!.extras.teams!;
    const home = teams.find((t) => t.id === (e.exportPersistState()!.extras.homeTeamId ?? ''))!;
    const rivals = teams.filter((t) => t.id !== home.id);
    expect(home.aiDependency).toBe(42);
    for (const rival of rivals) {
      expect(rival.aiDependency).toBeGreaterThanOrEqual(32);
      expect(rival.aiDependency).toBeLessThanOrEqual(52);
    }
    // 最悪 rival でも無介入 S1 で依存敗北しない
    const rivalId = 'newbiz-t1';
    expect(e.enterTeam(rivalId)).toBe(true);
    e.beginSetupSprint();
    let guard = 0;
    while (e.snapshot().phase === 'sprint' && guard < 5000) {
      guard += 1;
      e.step(1_000_000);
    }
    const s = e.snapshot();
    if (s.status === 'lost') {
      expect(s.loseReason).not.toBe('aiDependency');
    } else {
      expect(s.org.aiDependency).toBeLessThan(AI_DEPENDENCY_CAP);
    }
  });

  it('リプレイ復元では旧 Nightmare の記録依存度を改変しない', () => {
    const e = new RunEngine({ seed: 'ri74-replay', difficulty: 'nightmare' });
    e.startRun();
    const frame = e.exportReplayFrame();
    expect(frame).not.toBeNull();
    delete frame!.extras.baseConfig.aiDependencyPerTask;
    frame!.org.aiDependency = 55;
    frame!.extras.teams = frame!.extras.teams?.map((t) => ({ ...t, aiDependency: 55 }));

    const viewer = new RunEngine({ seed: 'ri74-replay-2', difficulty: 'normal' });
    viewer.hydrateReplayFrame(frame!);
    expect(viewer.snapshot().org.aiDependency).toBe(55);
  });

  it('pairReview 1回で Nightmare 初期リテラシーが unsafe cap を超える', () => {
    const org = orgFromDifficulty('nightmare');
    expect(org.aiLiteracy).toBe(25);
    const sprint = createSprint(resolveSprintConfig('default'), org, () => 0.5);
    const before = org.aiLiteracy;
    applyAction('pairReview', sprint, org, () => 0.5, 0);
    expect(org.aiLiteracy).toBe(before + PAIR_LITERACY_GAIN);
    expect(org.aiLiteracy).toBeGreaterThan(AI_LITERACY_UNSAFE_CAP);
    org.aiDependency = AI_DEPENDENCY_CAP;
    expect(evaluateLose(org, EMPTY_TOTALS, 100)).toBeNull();
  });

  it('ai-guideline の効果量が上昇量と釣り合う', () => {
    const def = CARD_DEFS.find((c) => c.id === 'ai-guideline');
    expect(def?.rarity).toBe('rare');
    expect(def?.base.aiDependencyAdd).toBe(-18);
    expect(def?.base.aiLiteracyAdd).toBe(20);

    const o = orgFromDifficulty('nightmare');
    applyDeckBaseline(o, deckEffects([{ defId: 'ai-guideline', level: 1 }]));
    expect(o.aiDependency).toBe(42 - 18);
    expect(o.aiLiteracy).toBe(25 + 20);
    expect(o.aiLiteracy).toBeGreaterThan(AI_LITERACY_UNSAFE_CAP);
  });

  it('AI系レバーの依存度低下量が強化されている', () => {
    expect(COMPANY_LEVERS.find((l) => l.id === 'aiGuideline')?.effect.aiDependencyDelta).toBe(-16);
    expect(DEPARTMENT_LEVERS.find((l) => l.id === 'aiThrottleDept')?.effect.aiDependencyDelta).toBe(
      -12,
    );
    expect(TEAM_LEVERS.find((l) => l.id === 'teamAiThrottle')?.effect.aiDependencyDelta).toBe(-16);

    const res = applyLever(emptyAdjustState(), 100, 'aiGuideline');
    expect(res.changed).toBe(true);
    expect(res.adjust.company.aiDependencyDelta).toBe(-16);
  });

  it('HUD と敗北提示・チュートリアルに回避経路の手掛かりがある', () => {
    const warn = aiDependencyHudCopy(55, 25);
    expect(warn.warningChip).toMatch(/依存危険/);
    expect(warn.detail).toMatch(/Literacy/);

    const safe = aiDependencyHudCopy(40, 45);
    expect(safe.warningChip).toBeUndefined();

    // 俯瞰（スコープ不一致）では敗北条件チップを出さない
    const aggregated = aiDependencyHudCopy(60, 25, { suppressLoseWarning: true });
    expect(aggregated.warningChip).toBeUndefined();
    expect(aggregated.detail).not.toMatch(/Literacy/);

    const lose = loseNextActionView('aiDependency');
    expect(lose.nextAction).toMatch(/95/);
    expect(lose.nextAction).toMatch(/ペアレビュー/);
    expect(lose.nextAction).toMatch(/ガイドライン|レバー/);

    const actionBar = TUTORIAL_STEPS.find((s) => s.id === 'action-bar');
    expect(actionBar?.body).toMatch(/ペアレビュー/);
    expect(actionBar?.body).toMatch(/Literacy|リテラシー/);
  });

  it('難易度別の依存度推移: Nightmare は早めに注意帯へ入り、なお S1 相当では cap 未満', () => {
    const s1TaskCount = Math.round(28 * DIFFICULTY_DEFS.nightmare.taskCountMul);
    const aiTaskCounts = [0, 10, 24, s1TaskCount];
    const rows = (['easy', 'normal', 'hard', 'nightmare'] as const).map((id) => {
      const def = getDifficulty(id);
      const perTask = def.aiDependencyPerTask ?? AI_DEP_PER_TASK;
      const base = def.org.aiDependencyBase;
      return {
        id,
        deps: aiTaskCounts.map((n) => Math.min(100, base + n * perTask)),
      };
    });
    const nightmare = rows.find((r) => r.id === 'nightmare')!;
    const easy = rows.find((r) => r.id === 'easy')!;
    // 10件時点で nightmare は watch(50) 以上、easy はまだ下
    expect(nightmare.deps[1]).toBeGreaterThanOrEqual(50);
    expect(easy.deps[1]).toBeLessThan(50);
    // 序盤（0・10件）は nightmare が easy より高い。後半は Nightmare の低い上昇量が効く
    expect(nightmare.deps[0]).toBeGreaterThan(easy.deps[0]);
    expect(nightmare.deps[1]).toBeGreaterThan(easy.deps[1]);
    // S1 全タスク AI 割当でも nightmare は cap 未満（taskCountMul 由来）
    expect(s1TaskCount).toBe(Math.round(28 * DIFFICULTY_DEFS.nightmare.taskCountMul));
    expect(nightmare.deps[3]).toBeLessThan(AI_DEPENDENCY_CAP);
  });
});
