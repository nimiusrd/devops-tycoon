import { describe, expect, it, vi } from 'vitest';
import {
  effectiveActionsOf,
  evaluateCounterfactual,
  evaluateLatestEffectiveFrame,
  isDangerLeft,
  isEffectiveChoice,
  judgeF8Recovery,
  judgeF9EffectiveSets,
  listStrategicChoices,
  restoreCounterfactualEngine,
  type CounterfactualBranchResult,
} from '../../../src/sim/run/counterfactual';
import { activeDangerReasons, listApplicableActions } from '../../../src/sim/run/dangerZone';
import { RunEngine } from '../../../src/sim/run/engine';
import type { ActionId } from '../../../src/sim/types';
import { runOnce } from '../../playtest/harness';

function startedSprint(seed: string, difficulty: 'easy' | 'normal' | 'nightmare' = 'normal') {
  const engine = new RunEngine({ seed, difficulty });
  engine.startRun(difficulty, [], seed);
  engine.beginSetupSprint();
  return engine;
}

function branch(
  overrides: Partial<CounterfactualBranchResult> & Pick<CounterfactualBranchResult, 'actionId'>,
): CounterfactualBranchResult {
  return {
    sprintsToLose: 3,
    leftDanger: false,
    loseReason: 'seniorBurnout',
    status: 'lost',
    truncated: false,
    ...overrides,
  };
}

describe('RI-101 反実仮想フレーム', () => {
  it('同一フレームから復元した2エンジンは同じ step / dispatch 列で一致する', () => {
    const source = startedSprint('ri-101-clone');
    source.step(800);
    source.dispatch('overtime');
    const frame = source.exportCounterfactualFrame();
    expect(frame).not.toBeNull();
    expect(frame!.allowedCards).toBeNull();
    expect(frame!.allowedRelics).toBeNull();
    expect(source.exportPersistState()).toBeNull();

    const a = restoreCounterfactualEngine(frame!);
    const b = restoreCounterfactualEngine(frame!);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.exportCounterfactualFrame()?.allowedCards).toBeNull();
    expect(a.exportCounterfactualFrame()?.allowedRelics).toBeNull();

    a.step(400);
    b.step(400);
    a.dispatch('andon');
    b.dispatch('andon');
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it('復元後の乱数列は元エンジンの続きと一致する', () => {
    const source = startedSprint('ri-101-rng-fork');
    source.step(400);
    const frame = source.exportCounterfactualFrame()!;
    const restored = restoreCounterfactualEngine(frame);
    source.step(1_200);
    restored.step(1_200);
    expect(restored.snapshot()).toEqual(source.snapshot());
  });
});

describe('RI-101 分岐評価と上限', () => {
  it('無介入と適用可能介入を分岐し、上限超過は skipped に残す', () => {
    const engine = startedSprint('ri-101-cap');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const applicable = listApplicableActions(engine);
    const forced = [
      ...applicable,
      'interruptReview',
      'splitPr',
      'firefight',
      'assignTask',
      'aiThrottle',
      'pairReview',
      'overtime',
      'andon',
      'overtime',
    ] as ActionId[];
    const evaluation = evaluateCounterfactual(frame, {
      actions: forced,
      maxActionBranches: 2,
      maxSprints: 1,
    });
    expect(evaluation.baseline.actionId).toBeNull();
    expect(evaluation.branches).toHaveLength(2);
    expect(evaluation.skippedActions).toEqual(forced.slice(2));
    expect(evaluation.applicableActions).toEqual(forced);
  });

  it('maxSprints 到達後も setup まで終端遷移を進めてから打ち切る', () => {
    const engine = startedSprint('ri-101-horizon');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, { actions: [], maxSprints: 1 });
    if (evaluation.baseline.truncated) {
      expect(evaluation.baseline.status).toBe('playing');
      expect(evaluation.baseline.sprintsToLose).toBeNull();
    }
    const restored = restoreCounterfactualEngine(frame);
    restored.step(1_000_000);
    if (restored.snapshot().status === 'playing') {
      expect([
        'result',
        'draft',
        'evolution',
        'beat',
        'shop',
        'rest',
        'recruit',
        'setup',
      ]).toContain(restored.snapshot().phase);
    }
  });

  it('敗北までのスプリント数は分岐開始からの相対値である', () => {
    const engine = startedSprint('ri-101-relative-lose', 'nightmare');
    engine.step(200);
    const startPlayed = engine.snapshot().sprintsPlayed;
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, { actions: [], maxSprints: 2 });
    if (evaluation.baseline.status === 'lost' && evaluation.baseline.sprintsToLose != null) {
      expect(evaluation.baseline.sprintsToLose).toBeGreaterThanOrEqual(0);
      expect(evaluation.baseline.sprintsToLose).toBeLessThanOrEqual(2);
      expect(evaluation.baseline.sprintsToLose).toBeLessThanOrEqual(
        evaluation.origin.sprintsPlayed + 2 - startPlayed + 2,
      );
    }
  });

  it('危険域と発動可能手をフレーム時点で記録する', () => {
    const engine = startedSprint('ri-101-danger-list', 'nightmare');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, { maxSprints: 1, maxActionBranches: 8 });
    expect(evaluation.origin.sprintsPlayed).toBe(engine.snapshot().sprintsPlayed);
    expect(evaluation.originDangers).toEqual(activeDangerReasons(engine));
    expect(evaluation.applicableActions).toEqual(listApplicableActions(engine));
  });

  it('無介入ドライブ上の戦略フェーズ代替肢をスプリント介入と別に分岐する', () => {
    const engine = startedSprint('ri-101-strategy-fork');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const strategic = listStrategicChoices(frame, 4);
    expect(strategic.length).toBeGreaterThan(0);
    expect(
      strategic.every((choice) =>
        /^(draft:|evo:|beat:|rest:|shop:|recruit:|goal:|setup:)/.test(choice.id),
      ),
    ).toBe(true);
    const restIds = strategic.filter((choice) => choice.id.startsWith('rest:'));
    if (restIds.length > 0) {
      expect(restIds.some((choice) => choice.id === 'rest:heal')).toBe(true);
      expect(
        restIds
          .filter((choice) => choice.id.startsWith('rest:upgrade'))
          .every((choice) => /^rest:upgrade:[^:]+:\d+$/.test(choice.id)),
      ).toBe(true);
    }
    expect(
      strategic
        .filter((choice) => choice.id.startsWith('beat:'))
        .every((choice) =>
          /^beat:[^:]+:\d+(:(?:coding|review|bench))?(?:@\d+)?(?:\+.+)?$/.test(choice.id),
        ),
    ).toBe(true);
    const evaluation = evaluateCounterfactual(frame, {
      actions: [],
      includeStrategic: true,
      maxSprints: 4,
      maxStrategicBranches: 8,
    });
    const runnable = strategic.filter((choice) => !choice.id.startsWith('setup:combo'));
    const ids = evaluation.branches.map((branch) => branch.actionId);
    expect(ids).toEqual(runnable.slice(0, 8).map((choice) => choice.id));
    const kinds = new Set(runnable.map((choice) => choice.kind));
    if (kinds.size >= 2) {
      expect(evaluation.skippedStrategic).toContain('strategicSequence');
    }
    expect(
      evaluateCounterfactual(frame, { actions: ['andon'], maxSprints: 1 }).branches.every(
        (branch) => branch.actionId === 'andon',
      ),
    ).toBe(true);
  });

  it('無介入ベースラインは現在の手札を自動発動しない', () => {
    const engine = new RunEngine({ seed: 'ri-101-play-hand', difficulty: 'normal' });
    engine.startRun();
    const internals = engine as unknown as { phase: string; draft: string[] | null };
    internals.phase = 'draft';
    internals.draft = ['copilot'];
    engine.chooseCard('copilot');
    internals.phase = 'setup';
    engine.beginSetupSprint();
    const snap = engine.snapshot();
    expect(snap.phase).toBe('sprint');
    const copilotIndex = snap.sprint?.cardPiles.hand.find(
      (idx) => snap.deck[idx]?.defId === 'copilot',
    );
    expect(copilotIndex).toBeDefined();
    const frame = engine.exportCounterfactualFrame()!;
    const spy = vi.spyOn(RunEngine.prototype, 'playCard');
    try {
      const evaluation = evaluateCounterfactual(frame, {
        actions: [],
        includeStrategic: false,
        maxSprints: 1,
      });
      expect(evaluation.baseline.actionId).toBeNull();
      expect(['playing', 'lost', 'won']).toContain(evaluation.baseline.status);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('ドラフト取得後の後続スプリントでは手札を発動する', () => {
    const engine = startedSprint('ri-101-strategy-fork');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const draft = listStrategicChoices(frame, 4).filter((choice) => choice.id.startsWith('draft:'));
    expect(draft.length).toBeGreaterThan(0);
    const spy = vi.spyOn(RunEngine.prototype, 'playCard');
    try {
      evaluateCounterfactual(frame, {
        actions: [],
        includeStrategic: true,
        maxSprints: 4,
        maxStrategicBranches: 48,
      });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('setup の編成変更を戦略分岐する', () => {
    const engine = startedSprint('ri-101-setup-fork');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const setup = listStrategicChoices(frame, 4).filter((choice) => choice.id.startsWith('setup:'));
    expect(setup.some((choice) => choice.id.startsWith('setup:assign:'))).toBe(true);
    expect(
      setup.some((choice) => choice.id === 'setup:combo' || choice.id.startsWith('setup:combo@')),
    ).toBe(true);
    const evaluation = evaluateCounterfactual(frame, {
      actions: [],
      includeStrategic: true,
      maxSprints: 4,
      maxStrategicBranches: 192,
    });
    expect(evaluation.branches.some((branch) => (branch.actionId ?? '').startsWith('setup:'))).toBe(
      true,
    );
  });

  it('assignTask / splitPr は対象ごとに分岐する', () => {
    const engine = startedSprint('ri-101-targets');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, {
      includeStrategic: false,
      maxSprints: 1,
      maxActionBranches: 96,
    });
    if (evaluation.applicableActions.includes('assignTask')) {
      expect(
        evaluation.branches.some((branch) => (branch.actionId ?? '').startsWith('assignTask:')),
      ).toBe(true);
    }
    if (evaluation.applicableActions.includes('splitPr')) {
      expect(
        evaluation.branches.some((branch) => (branch.actionId ?? '').startsWith('splitPr:')),
      ).toBe(true);
    }
    const hand = engine.snapshot().sprint?.cardPiles.hand ?? [];
    if (hand.length > 0) {
      expect(
        evaluation.branches.some((branch) => (branch.actionId ?? '').startsWith('card:')),
      ).toBe(true);
    }
    expect(evaluation.branches.some((branch) => (branch.actionId ?? '').startsWith('lever:'))).toBe(
      true,
    );
  });

  it('同一 tick の 2 手組合せも分岐し、未評価列は skipped に残す', () => {
    const engine = startedSprint('ri-101-same-tick-combo');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, {
      includeStrategic: false,
      maxSprints: 1,
      maxActionBranches: 8,
      maxComboBranches: 2,
    });
    expect(evaluation.branches.some((branch) => (branch.actionId ?? '').includes('+'))).toBe(true);
    const singles = evaluation.branches.filter(
      (branch) => branch.actionId && !branch.actionId.includes('+'),
    );
    if (singles.length >= 2) {
      expect(evaluation.skippedActions).toContain('sameTickCombo');
    }
  });

  it('2手列が上限内でも3手目が残るなら sameTickCombo を skipped に残す', () => {
    const engine = startedSprint('ri-101-same-tick-combo-3');
    engine.step(200);
    const internals = engine as unknown as { budget: number };
    internals.budget = 30;
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, {
      includeStrategic: false,
      maxSprints: 1,
      maxActionBranches: 8,
      maxComboBranches: 64,
    });
    expect(evaluation.branches.some((branch) => (branch.actionId ?? '').includes('+'))).toBe(true);
    expect(evaluation.skippedActions).toContain('sameTickCombo');
  });

  it('介入後の later に複数戦略訪問がある場合は actionStrategicCombo を skipped に残す', () => {
    const engine = startedSprint('ri-101-action-later-seq');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, {
      includeStrategic: true,
      maxSprints: 4,
      maxActionBranches: 1,
      maxComboBranches: 32,
      maxStrategicBranches: 32,
    });
    expect(evaluation.skippedActions).toContain('actionStrategicCombo');
  });

  it('2手列の先に戦略肢がある場合は actionStrategicCombo を skipped に残す', () => {
    const engine = startedSprint('ri-101-combo-then-strategic');
    engine.step(200);
    const internals = engine as unknown as { budget: number };
    internals.budget = 30;
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, {
      includeStrategic: true,
      maxSprints: 2,
      maxActionBranches: 4,
      maxComboBranches: 2,
      maxStrategicBranches: 8,
    });
    if (evaluation.branches.some((branch) => (branch.actionId ?? '').includes('+'))) {
      expect(evaluation.skippedActions).toContain('actionStrategicCombo');
    }
  });

  it('入り込み拘束中でなければ非アクティブチームのレバーも分岐する', () => {
    const engine = startedSprint('ri-101-other-team-lever');
    engine.step(200);
    const snap = engine.snapshot();
    expect(snap.sprintsPlayed >= snap.teamLockUntilSprint).toBe(true);
    const other = snap.teams.find((team) => team.id !== snap.activeTeamId);
    expect(other).toBeDefined();
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, {
      includeStrategic: false,
      maxSprints: 1,
      maxActionBranches: 96,
    });
    expect(
      evaluation.branches.some(
        (branch) => (branch.actionId ?? '') === `lever:teamReviewHelp:${other!.id}`,
      ),
    ).toBe(true);
  });

  it('進化フェーズは依存ノードの連続解放列も分岐する', () => {
    const engine = startedSprint('ri-101-evo-chain');
    const internals = engine as unknown as {
      phase: string;
      evolution: { points: number; unlocked: Record<string, boolean> };
    };
    internals.phase = 'evolution';
    internals.evolution = { points: 4, unlocked: {} };
    const frame = engine.exportCounterfactualFrame()!;
    const evo = listStrategicChoices(frame, 1).filter((choice) => choice.id.startsWith('evo:'));
    expect(evo.some((choice) => choice.id === 'evo:dev-1')).toBe(true);
    expect(evo.some((choice) => choice.id === 'evo:dev-1+dev-2')).toBe(true);
    const evaluation = evaluateCounterfactual(frame, {
      actions: [],
      includeStrategic: true,
      maxSprints: 1,
      maxStrategicBranches: 192,
    });
    expect(evaluation.branches.some((branch) => branch.actionId === 'evo:dev-1+dev-2')).toBe(true);
  });

  it('採用後は新メンバーの配置まで分岐する', () => {
    const engine = startedSprint('ri-101-recruit-lane');
    const internals = engine as unknown as { phase: string };
    internals.phase = 'rest';
    const beforeIds = new Set(engine.snapshot().roster.members.map((member) => member.id));
    const frame = engine.exportCounterfactualFrame()!;
    const restRecruit = listStrategicChoices(frame, 1).filter((choice) =>
      choice.id.startsWith('rest:recruit:'),
    );
    expect(restRecruit.map((choice) => choice.id).sort()).toEqual([
      'rest:recruit:bench',
      'rest:recruit:coding',
      'rest:recruit:review',
    ]);
    const spy = vi.spyOn(RunEngine.prototype, 'assignMember');
    try {
      evaluateCounterfactual(frame, {
        actions: [],
        includeStrategic: true,
        maxSprints: 1,
        maxStrategicBranches: 16,
      });
      expect(
        spy.mock.calls.some(
          ([id, assignment]) =>
            !beforeIds.has(id) &&
            (assignment === 'coding' || assignment === 'review' || assignment === 'bench'),
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('採用見送りも強制選択として分岐し idlePinnedIds に残す', () => {
    const engine = startedSprint('ri-101-recruit-skip');
    const internals = engine as unknown as { phase: string };
    internals.phase = 'recruit';
    const frame = engine.exportCounterfactualFrame()!;
    const recruit = listStrategicChoices(frame, 1).filter((choice) =>
      choice.id.startsWith('recruit:'),
    );
    expect(recruit.some((choice) => choice.id === 'recruit:skip')).toBe(true);
    expect(recruit.some((choice) => choice.id === 'recruit:hire:coding')).toBe(true);
    const evaluation = evaluateCounterfactual(frame, {
      actions: [],
      includeStrategic: true,
      maxSprints: 1,
      maxStrategicBranches: 192,
    });
    expect(evaluation.idlePinnedIds).toContain('recruit:skip');
    expect(evaluation.branches.some((branch) => branch.actionId === 'recruit:skip')).toBe(true);
  });

  it('ビートで付与されたカードは後続スプリントで発動する', () => {
    const engine = startedSprint('ri-101-beat-grant');
    const internals = engine as unknown as {
      phase: string;
      beat: { eventId: string; kind: 'decision' };
      deck: { defId: string; level: number }[];
    };
    internals.deck = [];
    internals.phase = 'beat';
    internals.beat = { eventId: 'junior-awaken', kind: 'decision' };
    const frame = engine.exportCounterfactualFrame()!;
    expect(
      listStrategicChoices(frame, 2).some((choice) => choice.id === 'beat:junior-awaken:1'),
    ).toBe(true);
    const spy = vi.spyOn(RunEngine.prototype, 'playCard');
    try {
      evaluateCounterfactual(frame, {
        actions: [],
        includeStrategic: true,
        maxSprints: 2,
        maxStrategicBranches: 8,
      });
      expect(spy).toHaveBeenCalledWith(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('休息のカード強化は未強化カードの自動発動と分離する', () => {
    const engine = startedSprint('ri-101-rest-upgrade-no-autoplay');
    const internals = engine as unknown as {
      phase: string;
      deck: { defId: string; level: number }[];
    };
    internals.phase = 'rest';
    internals.deck = [{ defId: 'copilot', level: 1 }];
    const frame = engine.exportCounterfactualFrame()!;
    expect(
      listStrategicChoices(frame, 1).some((choice) => choice.id === 'rest:upgrade:copilot:0'),
    ).toBe(true);
    const spy = vi.spyOn(RunEngine.prototype, 'playCard');
    try {
      evaluateCounterfactual(frame, {
        actions: [],
        includeStrategic: true,
        maxSprints: 1,
        maxStrategicBranches: 4,
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('即時採用ビートは新メンバーの配置まで分岐する', () => {
    const engine = startedSprint('ri-101-urgent-hire');
    const internals = engine as unknown as {
      phase: string;
      beat: { eventId: string; kind: 'decision' };
    };
    internals.phase = 'beat';
    internals.beat = { eventId: 'urgent-hire', kind: 'decision' };
    const beforeIds = new Set(engine.snapshot().roster.members.map((member) => member.id));
    const frame = engine.exportCounterfactualFrame()!;
    const hire = listStrategicChoices(frame, 1).filter((choice) =>
      choice.id.startsWith('beat:urgent-hire:0:'),
    );
    expect(hire.map((choice) => choice.id).sort()).toEqual([
      'beat:urgent-hire:0:bench',
      'beat:urgent-hire:0:coding',
      'beat:urgent-hire:0:review',
    ]);
    const spy = vi.spyOn(RunEngine.prototype, 'assignMember');
    try {
      evaluateCounterfactual(frame, {
        actions: [],
        includeStrategic: true,
        maxSprints: 1,
        maxStrategicBranches: 8,
      });
      expect(
        spy.mock.calls.some(
          ([id, assignment]) =>
            !beforeIds.has(id) &&
            (assignment === 'coding' || assignment === 'review' || assignment === 'bench'),
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('即時採用が失敗する盤面では配置接尾辞のない単一分岐にする', () => {
    const engine = startedSprint('ri-101-urgent-hire-fail');
    const internals = engine as unknown as {
      phase: string;
      beat: { eventId: string; kind: 'decision' };
      budget: number;
    };
    internals.phase = 'beat';
    internals.beat = { eventId: 'urgent-hire', kind: 'decision' };
    internals.budget = 0;
    const hire = listStrategicChoices(engine.exportCounterfactualFrame()!, 1).filter((choice) =>
      choice.id.startsWith('beat:urgent-hire:0'),
    );
    expect(hire.map((choice) => choice.id)).toEqual(['beat:urgent-hire:0']);
  });

  it('後続スプリントの同種戦略フェーズも独立分岐する', () => {
    const engine = startedSprint('ri-101-later-phase');
    const internals = engine as unknown as {
      phase: string;
      evolution: { points: number; unlocked: Record<string, boolean> };
    };
    internals.phase = 'evolution';
    internals.evolution = { points: 0, unlocked: {} };
    const frame = engine.exportCounterfactualFrame()!;
    const laterEvo = listStrategicChoices(frame, 4).filter((choice) =>
      /^evo:.*@\d+$/.test(choice.id),
    );
    expect(laterEvo.length).toBeGreaterThan(0);
    const evaluation = evaluateCounterfactual(frame, {
      actions: [],
      includeStrategic: true,
      maxSprints: 4,
      maxStrategicBranches: 8,
    });
    expect(evaluation.skippedStrategic).toContain('strategicSequence');
  });

  it('無介入ビートは末尾選択なので先頭肢を有効手として識別できる', () => {
    const engine = startedSprint('ri-101-beat-first');
    const internals = engine as unknown as {
      phase: string;
      beat: { eventId: string; kind: 'decision' };
    };
    internals.phase = 'beat';
    internals.beat = { eventId: 'junior-awaken', kind: 'decision' };
    const frame = engine.exportCounterfactualFrame()!;
    expect(
      listStrategicChoices(frame, 1).some((choice) => choice.id === 'beat:junior-awaken:0'),
    ).toBe(true);
  });

  it('ベースラインと同一軌跡の強制選択も回復時は有効手に残す', () => {
    const engine = startedSprint('ri-101-forced-choice-id');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const recovered = {
      sprintsToLose: null as number | null,
      leftDanger: true,
      loseReason: null as null,
      status: 'playing' as const,
      truncated: true,
    };
    const synthetic = {
      ...evaluateCounterfactual(frame, { actions: [], maxSprints: 1 }),
      baseline: { actionId: null, ...recovered },
      idlePinnedIds: ['beat:shop-offer:1'],
      branches: [
        {
          actionId: 'beat:shop-offer:1',
          ...recovered,
        },
        {
          actionId: 'beat:shop-offer:0',
          sprintsToLose: 1,
          leftDanger: false,
          loseReason: 'seniorBurnout' as const,
          status: 'lost' as const,
          truncated: false,
        },
      ],
    };
    expect(effectiveActionsOf(synthetic)).toEqual(['beat:shop-offer:1']);
  });

  it('イベントが開くショップ・休息・採用の後続選択も分岐する', () => {
    const engine = startedSprint('ri-101-beat-followup');
    const internals = engine as unknown as {
      phase: string;
      beat: { eventId: string; kind: 'decision' };
      budget: number;
    };
    internals.phase = 'beat';
    internals.beat = { eventId: 'shop-offer', kind: 'decision' };
    internals.budget = 20;
    const shopChoices = listStrategicChoices(engine.exportCounterfactualFrame()!, 1);
    expect(shopChoices.some((choice) => choice.id === 'beat:shop-offer:0')).toBe(true);
    expect(shopChoices.some((choice) => choice.id.startsWith('beat:shop-offer:0+shop:'))).toBe(
      true,
    );

    internals.beat = { eventId: 'rest-offer', kind: 'decision' };
    const restChoices = listStrategicChoices(engine.exportCounterfactualFrame()!, 1);
    expect(restChoices.some((choice) => choice.id === 'beat:rest-offer:0+rest:heal')).toBe(true);

    internals.beat = { eventId: 'recruit-offer', kind: 'decision' };
    const recruitChoices = listStrategicChoices(engine.exportCounterfactualFrame()!, 1);
    expect(
      recruitChoices.some((choice) => choice.id === 'beat:recruit-offer:0+recruit:hire:coding'),
    ).toBe(true);

    internals.beat = { eventId: 'shop-offer', kind: 'decision' };
    const spy = vi.spyOn(RunEngine.prototype, 'buyShopCard');
    try {
      evaluateCounterfactual(engine.exportCounterfactualFrame()!, {
        actions: [],
        includeStrategic: true,
        maxSprints: 1,
        maxStrategicBranches: 48,
      });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('setup では操作可能な他チームへの入り込みも分岐する', () => {
    const engine = startedSprint('ri-101-setup-enter');
    const snap = engine.snapshot();
    const internals = engine as unknown as { phase: string };
    internals.phase = 'setup';
    expect(snap.sprintsPlayed >= snap.teamLockUntilSprint).toBe(true);
    const other = snap.teams.find((team) => team.id !== snap.activeTeamId);
    expect(other).toBeDefined();
    const frame = engine.exportCounterfactualFrame()!;
    const setup = listStrategicChoices(frame, 1).filter((choice) => choice.id.startsWith('setup:'));
    expect(setup.some((choice) => choice.id === `setup:enter:${other!.id}`)).toBe(true);
    expect(setup.some((choice) => choice.id.includes('+setup:'))).toBe(true);
    const spy = vi.spyOn(RunEngine.prototype, 'enterTeam');
    try {
      evaluateCounterfactual(frame, {
        actions: [],
        includeStrategic: true,
        maxSprints: 1,
        maxStrategicBranches: 192,
      });
      expect(spy.mock.calls.some(([id]) => id === other!.id)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('ショップは残予算で実行可能な連続購入列も分岐する', () => {
    const engine = startedSprint('ri-101-shop-combo');
    const internals = engine as unknown as {
      phase: string;
      budget: number;
      shop: {
        cards: { defId: string; cost: number; bought: boolean }[];
        relic?: { id: string; cost: number; bought: boolean };
      };
    };
    internals.phase = 'shop';
    internals.budget = 20;
    internals.shop = {
      cards: [
        { defId: 'copilot', cost: 5, bought: false },
        { defId: 'ai-guideline', cost: 5, bought: false },
      ],
    };
    const frame = engine.exportCounterfactualFrame()!;
    const shop = listStrategicChoices(frame, 1).filter((choice) => choice.id.startsWith('shop:'));
    expect(shop.some((choice) => choice.id === 'shop:card:copilot')).toBe(true);
    expect(shop.some((choice) => choice.id === 'shop:card:copilot+card:ai-guideline')).toBe(true);
    expect(shop.some((choice) => choice.id === 'shop:card:ai-guideline+card:copilot')).toBe(true);
  });
});

describe('RI-101 集計規則', () => {
  const baseline = branch({ actionId: null, sprintsToLose: 3, loseReason: 'seniorBurnout' });

  it('遅延・回避・危険域離脱・敗因変化だけを有効とする', () => {
    expect(isEffectiveChoice(baseline, branch({ actionId: 'andon' }))).toBe(false);
    expect(isEffectiveChoice(baseline, branch({ actionId: 'overtime', sprintsToLose: 5 }))).toBe(
      true,
    );
    expect(
      isEffectiveChoice(
        baseline,
        branch({ actionId: 'aiThrottle', status: 'won', sprintsToLose: null, loseReason: null }),
      ),
    ).toBe(true);
    expect(isEffectiveChoice(baseline, branch({ actionId: 'firefight', leftDanger: true }))).toBe(
      true,
    );
    expect(
      isEffectiveChoice(
        baseline,
        branch({ actionId: 'interruptReview', leftDanger: true, sprintsToLose: 1 }),
      ),
    ).toBe(false);
    expect(
      isEffectiveChoice(
        branch({
          actionId: null,
          sprintsToLose: null,
          loseReason: null,
          status: 'playing',
        }),
        branch({
          actionId: 'interruptReview',
          leftDanger: true,
          sprintsToLose: 1,
        }),
      ),
    ).toBe(false);
    expect(
      isEffectiveChoice(
        baseline,
        branch({ actionId: 'interruptReview', loseReason: 'reviewFreeze' }),
      ),
    ).toBe(true);
    expect(
      isEffectiveChoice(
        baseline,
        branch({
          actionId: 'overtime',
          sprintsToLose: 1,
          loseReason: 'moraleCollapse',
        }),
      ),
    ).toBe(false);
    expect(
      isEffectiveChoice(
        { ...baseline, leftDanger: true },
        branch({ actionId: 'andon', leftDanger: true }),
      ),
    ).toBe(false);
  });

  it('F-8 は有効手が残る最後の時点だけを見る', () => {
    const judgment = judgeF8Recovery(
      [
        { sprintsPlayed: 1, effectiveActions: ['andon'] },
        { sprintsPlayed: 2, effectiveActions: [] },
        { sprintsPlayed: 4, effectiveActions: ['overtime'] },
        { sprintsPlayed: 5, effectiveActions: [] },
      ],
      8,
    );
    expect(judgment).toEqual({
      lastEffectiveSprints: 4,
      gap: 4,
      hasRecovery: true,
    });
    expect(judgeF8Recovery([{ sprintsPlayed: 2, effectiveActions: [] }], 6)).toEqual({
      lastEffectiveSprints: null,
      gap: null,
      hasRecovery: false,
    });
  });

  it('危険域離脱は focus した敗因だけを見る', () => {
    const origin = new Set(['aiDependency', 'bossFailed'] as const);
    expect(isDangerLeft(origin, ['bossFailed'], 'aiDependency')).toBe(true);
    expect(isDangerLeft(origin, ['aiDependency', 'bossFailed'], 'aiDependency')).toBe(false);
    expect(isDangerLeft(origin, ['bossFailed'])).toBe(true);
    expect(isDangerLeft(origin, ['aiDependency', 'bossFailed'])).toBe(false);
    expect(isDangerLeft(origin, ['bossFailed'], 'reviewFreeze')).toBe(false);
  });

  it('有効手があるフレームまで新しい順に遡る', () => {
    const engine = startedSprint('ri-101-walkback');
    engine.step(200);
    const older = engine.exportCounterfactualFrame()!;
    engine.step(400);
    const newer = engine.exportCounterfactualFrame()!;
    const empty = evaluateLatestEffectiveFrame(
      [
        { sprintsPlayed: 0, quarter: 1, index: 1, frame: older },
        { sprintsPlayed: 0, quarter: 1, index: 1, frame: newer },
      ],
      { actions: [], maxSprints: 1 },
    );
    expect(empty).not.toBeNull();
    if (empty && empty.effective.length === 0) {
      expect(empty.evaluation.origin).toEqual(
        evaluateCounterfactual(newer, { actions: [], maxSprints: 1 }).origin,
      );
    }
  });

  it('F-9 は敗因別の有効手集合を機械的集合と別に数える', () => {
    const judgment = judgeF9EffectiveSets([
      { loseReason: 'seniorBurnout', effectiveActions: ['overtime'] },
      { loseReason: 'seniorBurnout', effectiveActions: ['andon'] },
      { loseReason: 'reviewFreeze', effectiveActions: ['interruptReview'] },
      { loseReason: 'aiDependency', effectiveActions: [] },
    ]);
    expect(judgment.byReason.seniorBurnout).toEqual(['andon', 'overtime']);
    expect(judgment.byReason.reviewFreeze).toEqual(['interruptReview']);
    expect(judgment.byReason.aiDependency).toEqual([]);
    expect(judgment.distinctEffectiveSetCount).toBe(3);
  });

  it('F-9 はデッキ位置や task ID を落とした安定キーで集合を数える', () => {
    const judgment = judgeF9EffectiveSets([
      {
        loseReason: 'aiDependency',
        effectiveActions: ['card:ai-guideline:0', 'assignTask:t0:ai'],
      },
      {
        loseReason: 'aiDependency',
        effectiveActions: ['card:ai-guideline:2', 'assignTask:t9:ai'],
      },
      { loseReason: 'reviewFreeze', effectiveActions: ['splitPr:t3', 'splitPr:t8'] },
    ]);
    expect(judgment.byReason.aiDependency).toEqual(['assignTask:ai', 'card:ai-guideline']);
    expect(judgment.byReason.reviewFreeze).toEqual(['splitPr']);
    expect(judgment.distinctEffectiveSetCount).toBe(2);
  });

  it('F-9 は戦略肢の位置・連番・訪問番号を落として集合を数える', () => {
    const judgment = judgeF9EffectiveSets([
      {
        loseReason: 'seniorBurnout',
        effectiveActions: ['rest:upgrade:copilot:0', 'setup:assign:m3:coding', 'rest:heal@1'],
      },
      {
        loseReason: 'seniorBurnout',
        effectiveActions: ['rest:upgrade:copilot:2', 'setup:assign:m9:coding', 'rest:heal'],
      },
    ]);
    expect(judgment.byReason.seniorBurnout).toEqual([
      'rest:heal',
      'rest:upgrade:copilot',
      'setup:assign:coding',
    ]);
    expect(judgment.distinctEffectiveSetCount).toBe(1);
  });
});

describe('RI-101 プレイテストオプトイン', () => {
  it('PT_COUNTERFACTUAL=1 の短い敗北ランに有効手フィールドを付ける', () => {
    const prev = process.env.PT_COUNTERFACTUAL;
    process.env.PT_COUNTERFACTUAL = '1';
    try {
      const log = runOnce('pt-1', 'nightmare', 'idle');
      expect(log.status).toBe('lost');
      expect(log.loseReason).toBeTruthy();
      if (log.availableActionsInDangerLastNonEmpty) {
        expect(Array.isArray(log.effectiveActionsInDanger)).toBe(true);
        expect(log.counterfactualBaseline).toMatchObject({
          leftDanger: expect.any(Boolean),
          truncated: expect.any(Boolean),
        });
        if ((log.effectiveActionsInDanger?.length ?? 0) > 0) {
          expect(log.lastEffectiveActionsAt?.actions).toEqual(log.effectiveActionsInDanger);
        } else {
          expect(log.lastEffectiveActionsAt).toBeUndefined();
        }
      }
    } finally {
      if (prev === undefined) delete process.env.PT_COUNTERFACTUAL;
      else process.env.PT_COUNTERFACTUAL = prev;
    }
  });

  it('オプトインなしでは反実仮想フィールドを付けない', () => {
    const prev = process.env.PT_COUNTERFACTUAL;
    delete process.env.PT_COUNTERFACTUAL;
    try {
      const log = runOnce('pt-1', 'nightmare', 'idle');
      expect(log.status).toBe('lost');
      expect(log.effectiveActionsInDanger).toBeUndefined();
      expect(log.counterfactualBaseline).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.PT_COUNTERFACTUAL;
      else process.env.PT_COUNTERFACTUAL = prev;
    }
  });
});

describe('RI-101 合成危険状態', () => {
  it('無介入が負け、指定介入だけが遅延する評価を有効手として拾う', () => {
    const engine = startedSprint('ri-101-effective-fixture');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, {
      actions: ['overtime', 'andon'],
      maxSprints: 2,
    });
    const synthetic = {
      ...evaluation,
      baseline: branch({ actionId: null, sprintsToLose: 2, loseReason: 'moraleCollapse' }),
      branches: [
        branch({ actionId: 'overtime', sprintsToLose: 4, loseReason: 'moraleCollapse' }),
        branch({ actionId: 'andon', sprintsToLose: 2, loseReason: 'moraleCollapse' }),
      ],
    };
    expect(effectiveActionsOf(synthetic)).toEqual(['overtime']);
    expect(
      judgeF8Recovery(
        [{ sprintsPlayed: synthetic.origin.sprintsPlayed, effectiveActions: ['overtime'] }],
        4,
      ).hasRecovery,
    ).toBe(true);
    expect(
      judgeF9EffectiveSets([
        { loseReason: 'moraleCollapse', effectiveActions: effectiveActionsOf(synthetic) },
        { loseReason: 'reviewFreeze', effectiveActions: ['interruptReview'] },
      ]).distinctEffectiveSetCount,
    ).toBe(2);
  });

  it('有効な真部分列がある組合せは最小列だけ残す', () => {
    const engine = startedSprint('ri-101-minimal-combo');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const evaluation = evaluateCounterfactual(frame, {
      actions: ['overtime', 'andon'],
      maxSprints: 2,
    });
    const delayed = branch({
      actionId: 'overtime',
      sprintsToLose: 4,
      loseReason: 'moraleCollapse',
    });
    const synthetic = {
      ...evaluation,
      baseline: branch({ actionId: null, sprintsToLose: 2, loseReason: 'moraleCollapse' }),
      branches: [
        delayed,
        branch({ actionId: 'andon', sprintsToLose: 2, loseReason: 'moraleCollapse' }),
        { ...delayed, actionId: 'overtime+andon' },
        branch({
          actionId: 'interruptReview+aiThrottle',
          sprintsToLose: 4,
          loseReason: 'moraleCollapse',
        }),
      ],
    };
    expect(effectiveActionsOf(synthetic)).toEqual(['overtime', 'interruptReview+aiThrottle']);
  });

  it('ショップ列は部分購入を shop: 付き ID として最小列比較する', () => {
    const engine = startedSprint('ri-101-shop-minimal');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const delayed = branch({
      actionId: 'shop:card:ai-guideline',
      sprintsToLose: 4,
      loseReason: 'moraleCollapse',
    });
    const synthetic = {
      ...evaluateCounterfactual(frame, { actions: [], maxSprints: 1 }),
      baseline: branch({ actionId: null, sprintsToLose: 2, loseReason: 'moraleCollapse' }),
      branches: [
        delayed,
        branch({ actionId: 'shop:card:copilot', sprintsToLose: 2, loseReason: 'moraleCollapse' }),
        { ...delayed, actionId: 'shop:card:copilot+card:ai-guideline' },
        branch({
          actionId: 'shop:card:copilot+card:pair-review',
          sprintsToLose: 4,
          loseReason: 'moraleCollapse',
        }),
      ],
    };
    expect(effectiveActionsOf(synthetic)).toEqual([
      'shop:card:ai-guideline',
      'shop:card:copilot+card:pair-review',
    ]);
  });

  it('訪問サフィックスは戦略 atom にだけ付けて最小列比較する', () => {
    const engine = startedSprint('ri-101-visit-suffix');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const delayed = branch({
      actionId: 'interruptReview',
      sprintsToLose: 4,
      loseReason: 'moraleCollapse',
    });
    const synthetic = {
      ...evaluateCounterfactual(frame, { actions: [], maxSprints: 1 }),
      baseline: branch({ actionId: null, sprintsToLose: 2, loseReason: 'moraleCollapse' }),
      branches: [
        delayed,
        { ...delayed, actionId: 'interruptReview+rest:heal@1' },
        branch({
          actionId: 'overtime+rest:heal@1',
          sprintsToLose: 4,
          loseReason: 'moraleCollapse',
        }),
      ],
    };
    expect(effectiveActionsOf(synthetic)).toEqual(['interruptReview', 'overtime+rest:heal@1']);
  });

  it('ベースライン回復時は採用見送りも有効手に残す', () => {
    const engine = startedSprint('ri-101-recruit-skip-effective');
    engine.step(200);
    const frame = engine.exportCounterfactualFrame()!;
    const recovered = {
      sprintsToLose: null as number | null,
      leftDanger: true,
      loseReason: null as null,
      status: 'playing' as const,
      truncated: true,
    };
    const synthetic = {
      ...evaluateCounterfactual(frame, { actions: [], maxSprints: 1 }),
      baseline: { actionId: null, ...recovered },
      idlePinnedIds: ['recruit:skip'],
      branches: [
        { actionId: 'recruit:skip', ...recovered },
        {
          actionId: 'recruit:hire:coding',
          sprintsToLose: 1,
          leftDanger: false,
          loseReason: 'budgetExhausted' as const,
          status: 'lost' as const,
          truncated: false,
        },
      ],
    };
    expect(effectiveActionsOf(synthetic)).toEqual(['recruit:skip']);
  });
});
