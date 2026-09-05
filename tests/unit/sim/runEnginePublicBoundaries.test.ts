import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../../src/sim/run/engine';
import type { RunPersistState } from '../../../src/sim/run/persist';
import { availableAdjustments } from '../../../src/sim/run/quarterReview';
import {
  E2E_MISSED_ADJUSTABLE_SEED,
  E2E_TERMINAL_SHUTDOWN,
} from '../../../src/sim/run/quarterReviewSeeds';
import { playUntil } from '../helpers/runFlow';

function save(engine: RunEngine): RunPersistState {
  const state = engine.exportPersistState();
  if (!state) throw new Error('保存可能なフェーズに到達していません');
  return state;
}

function restore(state: RunPersistState): RunEngine {
  const engine = new RunEngine();
  engine.hydratePersistState(state);
  return engine;
}

function startDraft(): RunEngine {
  const engine = new RunEngine({ seed: 'ri81-mulligan', difficulty: 'easy' });
  engine.startRun();
  engine.beginSetupSprint();
  engine.step(1_000_000);
  engine.acknowledgeResult();
  expect(engine.currentPhase()).toBe('draft');
  return engine;
}

describe('RunEngine 公開 API の拒否・復元境界', () => {
  it('継続不能な四半期レビューでは目標修正を拒否し、承認後の反実仮想保存も拒否する', () => {
    const engine = new RunEngine(E2E_TERMINAL_SHUTDOWN);
    engine.startRun();
    const review = playUntil(engine, 'quarterReview');
    expect(review.quarterReview?.outcome).toBe('shutdown');
    const before = save(engine);

    engine.chooseGoalAdjustment('request_budget');
    expect(save(engine)).toEqual(before);

    engine.acknowledgeQuarterReview();
    expect(engine.snapshot()).toMatchObject({ phase: 'lost', status: 'lost' });
    expect(engine.exportCounterfactualFrame()).toBeNull();
  });

  it('未達レビューで提示されていない目標修正は拒否し、提示された修正でのみ次期へ進む', () => {
    const source = new RunEngine({ seed: E2E_MISSED_ADJUSTABLE_SEED, difficulty: 'easy' });
    source.startRun();
    const review = playUntil(source, 'quarterReview');
    expect(review.quarterReview?.outcome).toBe('missed_adjustable');
    // 予算 6 のレビューでは期限延長の費用を払えない。公開の提示条件で
    // 予算と選択肢が整合するセーブを作り、復元後の操作境界を検証する。
    const state = save(source);
    state.budget = 6;
    state.quarterReview!.availableAdjustments = availableAdjustments(
      'missed_adjustable',
      state.stakeholderTrust,
      state.budget,
      state.org,
      state.totals,
    );
    expect(state.quarterReview!.availableAdjustments).not.toContain('extend_deadline');
    expect(state.quarterReview!.availableAdjustments).toContain('cut_scope');
    const engine = restore(state);
    const before = save(engine);

    engine.chooseGoalAdjustment('extend_deadline');
    expect(save(engine)).toEqual(before);

    engine.chooseGoalAdjustment('cut_scope');
    expect(engine.snapshot()).toMatchObject({
      phase: 'setup',
      quarterNumber: review.quarterNumber + 1,
      quarterReview: null,
      goalAdjustmentsTaken: [...review.goalAdjustmentsTaken, 'cut_scope'],
    });
  });

  it.each(['choose', 'skip'] as const)(
    'ドラフトを %s で終えた後のマリガンはデッキ・予算・進化状態を変えない',
    (action) => {
      const engine = startDraft();
      engine.mulliganDraft();
      const draft = engine.snapshot();
      expect(draft.draftMulliganUsed).toBe(true);

      if (action === 'choose') engine.chooseCard(draft.draft![0]!);
      else engine.skipDraft();

      const before = save(engine);
      expect(before).toMatchObject({ phase: 'evolution', draft: null, draftMulliganUsed: false });
      expect(before.deck.length).toBe(draft.deck.length + (action === 'choose' ? 1 : 0));
      engine.mulliganDraft();
      expect(save(engine)).toEqual(before);
    },
  );

  it('復元した選択ビートで範囲外・整数でない選択は無作用となり、有効な選択だけを適用する', () => {
    const source = startDraft();
    source.skipDraft();
    source.finishEvolution();
    const state = save(source);
    expect(state.phase).toBe('beat');
    // 既存イベントの正規の永続入力。進行状態は実スプリントから生成する。
    state.beat = { eventId: 'urgent-demo', kind: 'decision' };
    const engine = restore(state);
    const before = save(engine);

    for (const choice of [-1, 3, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      engine.resolveBeat(choice);
      expect(save(engine)).toEqual(before);
    }

    engine.resolveBeat(2);
    expect(engine.snapshot()).toMatchObject({
      phase: 'setup',
      beat: null,
      budget: before.budget,
      stakeholderTrust: {
        management: before.stakeholderTrust.management - 8,
        customers: before.stakeholderTrust.customers,
        team: before.stakeholderTrust.team,
      },
      relics: [...before.relics, 'expectation-mgmt'],
    });
  });

  it('選択ビートの引数省略は先頭の選択肢と同じ結果を一度だけ適用する', () => {
    const source = startDraft();
    source.skipDraft();
    source.finishEvolution();
    const state = save(source);
    state.beat = { eventId: 'urgent-demo', kind: 'decision' };
    const implicit = restore(state);
    const explicit = restore(state);
    const before = implicit.snapshot();

    implicit.resolveBeat();
    explicit.resolveBeat(0);
    const after = save(implicit);
    expect(after).toEqual(save(explicit));
    expect(after).toMatchObject({
      phase: 'setup',
      beat: null,
      totals: { delivered: before.totals.delivered + 30 },
      quarterTotals: { delivered: before.quarterTotals.delivered + 30 },
      org: { morale: before.org.morale - 15, seniorHp: before.org.seniorHp - 10 },
    });
    implicit.resolveBeat();
    expect(save(implicit)).toEqual(after);
  });

  it('1 スプリント進めた旧 Nightmare セーブでは初期依存度への移行を再適用しない', () => {
    const source = new RunEngine({ seed: 'coverage-nightmare-progress', difficulty: 'nightmare' });
    source.startRun();
    const result = playUntil(source, 'result');
    expect(result.phase).toBe('result');
    expect(result.sprintsPlayed).toBe(1);
    const state = save(source);
    // 旧セーブではこの係数が存在しなかった。プレイ済みの組織指標はそのまま復元する。
    delete state.extras.baseConfig.aiDependencyPerTask;

    const restored = restore(state).snapshot();
    expect(restored.org.aiDependency).toBe(result.org.aiDependency);
    expect(restored.teams.map(({ id, aiDependency }) => ({ id, aiDependency }))).toEqual(
      result.teams.map(({ id, aiDependency }) => ({ id, aiDependency })),
    );
    expect(restored).toMatchObject({ phase: 'result', sprintsPlayed: 1 });
  });
});
