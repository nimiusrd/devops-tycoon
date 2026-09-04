import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, type GameHandle } from '../../../src/game';
import { createRunEngine } from '../../../src/sim/run/engine';
import type { RunState } from '../../../src/sim/run/types';
import { defaultMeta } from '../../../src/state/meta';
import {
  REPLAY_SCHEMA_VERSION,
  snapshotReplayContent,
  type ReplayBlob,
} from '../../../src/state/replay';
import { MemoryReplayStorage } from '../../../src/state/replayPersistence';
import {
  CURRENT_RUN_RULESET,
  MemoryRunStorage,
  toRunSave,
} from '../../../src/state/runPersistence';

afterEach(() => {
  vi.restoreAllMocks();
});

interface ReplayOperation {
  name: string;
  run: (game: GameHandle, state: RunState) => unknown;
  rejected?: 'action' | 'resume';
  fixture?: 'result' | 'draft' | 'review-win' | 'review-adjust';
  /** 公開リプレイで到達可能なフェーズなら、同じ入力が通常ランを変更することも確認する。 */
  positiveControl?: boolean;
}

const replayOperations: ReplayOperation[] = [
  {
    name: 'startRun',
    run: (game) => game.startRun('hard', [], 'another-run'),
    positiveControl: true,
  },
  {
    name: 'startDailyRun',
    run: (game) => game.startDailyRun('2026-09-04'),
    positiveControl: true,
  },
  { name: 'beginSetupSprint', run: (game) => game.beginSetupSprint(), positiveControl: true },
  // beat/sprint/evolution/shop/rest/recruit は記録対象外のため、setup 閲覧時の
  // API 契約（revision・保存を変更しない）を確認する。架空のリプレイフェーズは作らない。
  { name: 'resolveBeat', run: (game) => game.resolveBeat(0) },
  { name: 'step', run: (game) => game.step(1_000_000) },
  { name: 'dispatch', run: (game) => game.dispatch('pairReview'), rejected: 'action' },
  { name: 'playCard', run: (game) => game.playCard(0), rejected: 'action' },
  {
    name: 'acknowledgeResult',
    run: (game) => game.acknowledgeResult(),
    fixture: 'result',
    positiveControl: true,
  },
  {
    name: 'chooseCard',
    run: (game, state) => game.chooseCard(state.draft![0]),
    fixture: 'draft',
    positiveControl: true,
  },
  { name: 'skipDraft', run: (game) => game.skipDraft(), fixture: 'draft', positiveControl: true },
  {
    name: 'mulliganDraft',
    run: (game) => game.mulliganDraft(),
    fixture: 'draft',
    positiveControl: true,
  },
  { name: 'unlockEvolution', run: (game) => game.unlockEvolution('review-1') },
  { name: 'finishEvolution', run: (game) => game.finishEvolution() },
  { name: 'buyShopCard', run: (game) => game.buyShopCard('docs') },
  { name: 'buyShopRelic', run: (game) => game.buyShopRelic() },
  { name: 'buyShopRecruit', run: (game) => game.buyShopRecruit() },
  { name: 'leaveShop', run: (game) => game.leaveShop() },
  { name: 'restChoose', run: (game) => game.restChoose('heal') },
  { name: 'recruitChoose', run: (game) => game.recruitChoose('hire') },
  {
    name: 'assignMember',
    run: (game, state) => {
      const member = state.roster.members[0]!;
      return game.assignMember(member.id, member.assignment === 'bench' ? 'coding' : 'bench');
    },
    positiveControl: true,
  },
  {
    name: 'setMemberAi',
    run: (game, state) => {
      const member = state.roster.members[0]!;
      return game.setMemberAi(member.id, !member.aiAssigned);
    },
    positiveControl: true,
  },
  { name: 'zoomTo', run: (game) => game.zoomTo('industry'), positiveControl: true },
  {
    name: 'focusDept',
    run: (game, state) => game.focusDept(state.teams[0]!.deptId),
    positiveControl: true,
  },
  {
    name: 'focusTeam',
    run: (game, state) =>
      game.focusTeam(state.teams.find((team) => team.id !== state.activeTeamId)!.id),
    positiveControl: true,
  },
  {
    name: 'enterTeam',
    run: (game, state) =>
      game.enterTeam(state.teams.find((team) => team.id !== state.activeTeamId)!.id),
    positiveControl: true,
  },
  { name: 'setRankingKind', run: (game) => game.setRankingKind('healthy'), positiveControl: true },
  {
    name: 'applyOrgLever',
    run: (game) => game.applyOrgLever('aiGuideline'),
    positiveControl: true,
  },
  {
    name: 'acknowledgeQuarterReview',
    run: (game) => game.acknowledgeQuarterReview(),
    fixture: 'review-win',
    positiveControl: true,
  },
  {
    name: 'chooseGoalAdjustment',
    run: (game) => game.chooseGoalAdjustment('cut_scope'),
    fixture: 'review-adjust',
    positiveControl: true,
  },
  {
    name: 'resumeRun',
    run: (game) => game.resumeRun(),
    rejected: 'resume',
    positiveControl: true,
  },
];

describe('リプレイ閲覧中のゲーム操作', () => {
  it.each(replayOperations)(
    '$name は閲覧状態・ラン保存・メタ進行を変更しない',
    async (operation) => {
      const engine = createRunEngine({ seed: 'replay-read-only' });
      engine.startRun('easy', [], 'replay-read-only');
      if (operation.fixture === 'result' || operation.fixture === 'draft') {
        engine.beginSetupSprint();
        engine.step(1_000_000);
        expect(engine.currentPhase()).toBe('result');
        if (operation.fixture === 'draft') {
          engine.acknowledgeResult();
          expect(engine.currentPhase()).toBe('draft');
        }
      }
      const fixture = engine.exportPersistState();
      if (!fixture) throw new Error('fixture export failed');
      fixture.budget = 100;
      if (operation.fixture === 'review-win' || operation.fixture === 'review-adjust') {
        fixture.phase = 'quarterReview';
        fixture.quarterReview = {
          goal: { ...fixture.quarterGoal },
          outcome: operation.fixture === 'review-win' ? 'met' : 'missed_adjustable',
          trust: { ...fixture.stakeholderTrust },
          progress: [],
          missedReasons: [],
          availableAdjustments: operation.fixture === 'review-adjust' ? ['cut_scope'] : [],
          bossCleared: true,
        };
      }
      engine.hydratePersistState(fixture);
      const frame = engine.exportReplayFrame();
      const persisted = engine.exportPersistState();
      if (!frame || !persisted) throw new Error('replay fixture export failed');

      const replay: ReplayBlob = {
        schemaVersion: REPLAY_SCHEMA_VERSION,
        id: 'read-only',
        seed: frame.seed,
        difficulty: frame.difficulty,
        trials: frame.trials,
        finishedAt: 1000,
        outcome: { status: 'won', diagnosis: 'healthyAcceleration', score: 10 },
        keyframes: [{ phase: frame.phase, frame }],
        ruleset: { ...CURRENT_RUN_RULESET },
        contentSnapshot: snapshotReplayContent([{ phase: frame.phase, frame }]),
      };
      const runSave = toRunSave(persisted, 1000, replay.keyframes);
      if (operation.positiveControl) {
        const control = createGame({ seed: 'normal-pending-seed', initialRunSave: runSave });
        if (operation.rejected !== 'resume') control.resumeRun();
        const before = control.engine.snapshot();
        operation.run(control, before);
        expect(control.engine.snapshot()).not.toEqual(before);
      }
      const runStorage = new MemoryRunStorage();
      const replayStorage = new MemoryReplayStorage();
      await runStorage.save(runSave);
      await replayStorage.save(replay);
      const metaStorage = {
        load: vi.fn(async () => defaultMeta()),
        save: vi.fn(async () => undefined),
      };
      const game = createGame({
        seed: 'normal-pending-seed',
        runStorage,
        initialRunSave: runSave,
        metaStorage,
      });
      await game.attachReplay(replayStorage);
      expect(game.openReplay(replay.id, 0)?.phase).toBe(frame.phase);

      const runSaveSpy = vi.spyOn(runStorage, 'save');
      const runClearSpy = vi.spyOn(runStorage, 'clear');
      const replaySaveSpy = vi.spyOn(replayStorage, 'save');
      const replayClearSpy = vi.spyOn(replayStorage, 'clear');
      const state = game.getState();
      const meta = structuredClone(game.getMeta());
      const revision = game.revision();
      const epoch = game.getRunEpoch();

      const result = operation.run(game, state);

      if (operation.rejected === 'action') {
        expect(result).toEqual({ ok: false, reason: 'complete' });
      } else if (operation.rejected === 'resume') {
        expect(result).toBeNull();
      } else {
        expect(result).toEqual(state);
      }
      expect(game.getState()).toEqual(state);
      expect(game.revision()).toBe(revision);
      expect(game.getRunEpoch()).toBe(epoch);
      expect(game.isReplayMode()).toBe(true);
      expect(game.isPaused()).toBe(true);
      expect(game.isSprintRunning()).toBe(false);
      expect(game.getMeta()).toEqual(meta);
      expect(game.getLastRunReward()).toBeNull();
      expect(game.getRunSaveSummary()).toEqual(runSave.summary);
      expect(await runStorage.load()).toEqual(runSave);
      expect(await replayStorage.list()).toEqual([replay]);
      for (const write of [
        runSaveSpy,
        runClearSpy,
        replaySaveSpy,
        replayClearSpy,
        metaStorage.save,
      ]) {
        expect(write).not.toHaveBeenCalled();
      }
    },
  );
});
