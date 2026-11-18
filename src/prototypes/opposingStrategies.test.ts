import { describe, expect, it } from 'vitest';
import { getEvent } from '../data/events';
import { RunEngine } from '../sim/run/engine';
import {
  defaultOpposingConfig,
  OpposingStrategies,
  OPPOSING_LIMITS,
  restoreOpposingStrategies,
  type StrategyCommand,
  type StrategySide,
} from './opposingStrategies';

function send(challenge: OpposingStrategies, side: StrategySide, command: StrategyCommand) {
  expect(challenge.command(side, command), JSON.stringify(command)).toEqual({ ok: true });
}

/** 全判断は公開API経由。係数や終端状態を注入しない。 */
function advance(challenge: OpposingStrategies, side: StrategySide, invest = false) {
  const s = challenge.state(side);
  switch (s.phase) {
    case 'title':
      send(challenge, side, { type: 'start' });
      break;
    case 'setup':
      send(challenge, side, { type: 'begin' });
      break;
    case 'sprint':
      for (const index of s.sprint!.cardPiles.hand)
        challenge.command(side, { type: 'play-card', index });
      if (challenge.state(side).phase !== 'sprint') break;
      if (!invest)
        challenge.command(side, {
          type: 'intervene',
          id: side === 'ai' ? 'assignTask' : 'pairReview',
        });
      if (!invest && s.sprint!.tasks.some((t) => t.incident && t.lane === 'rework'))
        challenge.command(side, { type: 'intervene', id: 'firefight' });
      if (
        !invest &&
        side === 'human' &&
        s.sprint!.tasks.filter((t) => t.lane === 'review').length >= 6
      )
        challenge.command(side, { type: 'intervene', id: 'interruptReview' });
      send(challenge, side, { type: 'advance', ticks: 120 });
      break;
    case 'result':
      send(challenge, side, { type: 'result' });
      break;
    case 'draft':
      send(
        challenge,
        side,
        s.draft?.length ? { type: 'choose-card', id: s.draft[0] } : { type: 'skip-draft' },
      );
      break;
    case 'evolution':
      if (invest)
        for (const id of [
          'review-1',
          'quality-1',
          'dev-1',
          'quality-2',
          'review-2',
          'dev-2',
          'quality-3',
        ])
          challenge.command(side, { type: 'evolve', id });
      send(challenge, side, { type: 'finish-evolution' });
      break;
    case 'beat': {
      const choices = getEvent(s.beat!.eventId)!.choices;
      const choice =
        s.beat!.kind === 'judgment'
          ? 0
          : Math.max(
              0,
              choices.findIndex((c) => !c.outcome.forceLose && !c.outcome.grantRecruit),
            );
      send(challenge, side, { type: 'beat', choice });
      break;
    }
    case 'shop':
      send(challenge, side, { type: 'leave-shop' });
      break;
    case 'rest':
      send(challenge, side, { type: 'rest', option: 'heal' });
      break;
    case 'recruit':
      send(challenge, side, { type: 'recruit', option: 'skip' });
      break;
    case 'quarterReview':
      send(
        challenge,
        side,
        s.quarterReview!.outcome === 'missed_adjustable'
          ? { type: 'adjust', id: s.quarterReview!.availableAdjustments[0] }
          : { type: 'review' },
      );
      break;
    default:
      throw new Error('terminal');
  }
}

function until(
  challenge: OpposingStrategies,
  side: StrategySide,
  done: () => boolean,
  invest = false,
) {
  for (let i = 0; i < 1000 && !done(); i++) advance(challenge, side, invest);
  expect(done()).toBe(true);
}

describe('RI-271 対照方針チャレンジ', () => {
  it('開始前は比較を確定せず、開始後はseed以外を含む実際の共通条件と意図的差分を公開する', () => {
    const config = defaultOpposingConfig();
    config.recipe.preferredCardIds = [config.unlockPool.cards[0]];
    const challenge = new OpposingStrategies(config);
    expect(challenge.view().comparable).toBe(false);
    send(challenge, 'ai', { type: 'start' });
    send(challenge, 'human', { type: 'start' });
    const view = challenge.view();
    expect(view.identity?.map((row) => row.field)).toEqual([
      'seed',
      'difficulty',
      'trials',
      'scenario',
      'runKind',
      'unlockPool',
      'preferredCardIds',
      'ruleset',
      'resources',
    ]);
    expect(view.identity?.every((row) => row.status === 'match')).toBe(true);
    expect(view.comparable).toBe(true);
    expect(view.policies.ai.aiAssigned).toBe(true);
    expect(view.policies.human.aiAssigned).toBe(false);
    config.recipe.seed = 'mutated';
    view.config.unlockPool.cards.length = 0;
    view.shared!.resources.org.seniorHp = 0;
    const state = challenge.state('ai');
    state.roster.members.length = 0;
    expect(challenge.view().config.recipe.seed).toBe('RI-271');
    expect(challenge.view().shared!.resources.org.seniorHp).toBeGreaterThan(0);
    expect(challenge.state('ai').roster.members.length).toBeGreaterThan(0);
  });

  it('未知のレシピ/解放ID・重複・未解放研修・過長seedを拒否する', () => {
    const changes = [
      (c: ReturnType<typeof defaultOpposingConfig>) => {
        c.recipe.seed = 'a'.repeat(129);
      },
      (c: ReturnType<typeof defaultOpposingConfig>) => {
        c.recipe.trials = ['unknown'];
      },
      (c: ReturnType<typeof defaultOpposingConfig>) => {
        c.unlockPool.cards = ['unknown'];
      },
      (c: ReturnType<typeof defaultOpposingConfig>) => {
        c.unlockPool.relics.push(c.unlockPool.relics[0]);
      },
      (c: ReturnType<typeof defaultOpposingConfig>) => {
        c.recipe.preferredCardIds = [c.unlockPool.cards[0]];
        c.unlockPool.cards = [];
      },
    ];
    for (const change of changes) {
      const config = defaultOpposingConfig();
      change(config);
      expect(() => new OpposingStrategies(config)).toThrow();
    }
  });

  it('同じ編成・資源からホームチームのAI配属だけを変え、実RunEngineのスプリントを起動する', () => {
    const challenge = new OpposingStrategies();
    for (const side of ['ai', 'human'] as const) {
      send(challenge, side, { type: 'start' });
      const initial = challenge.state(side);
      const e = new RunEngine({ seed: initial.seed, difficulty: initial.difficulty });
      e.startRun();
      for (const member of initial.roster.members) e.setMemberAi(member.id, side === 'ai');
      e.beginSetupSprint();
      send(challenge, side, { type: 'begin' });
      expect(challenge.state(side)).toEqual(e.snapshot());
    }
    expect(challenge.view().comparable).toBe(true);
    expect(
      challenge
        .state('ai')
        .roster.members.filter((m) => m.assignment === 'coding')
        .every((m) => m.aiAssigned),
    ).toBe(true);
    expect(challenge.state('human').roster.members.every((m) => !m.aiAssigned)).toBe(true);
  });

  it('二重開始・誤フェーズ・方針外介入・無効数値/IDは状態・RNG・履歴・費用を変えない', () => {
    const challenge = new OpposingStrategies();
    send(challenge, 'human', { type: 'start' });
    for (const command of [
      { type: 'start' },
      { type: 'begin', extra: true },
      { type: 'advance', ticks: 1 },
      { type: 'rest', option: 'unknown' },
      { type: 'unknown' },
    ]) {
      const raw = challenge.serialize();
      expect(challenge.command('human', command).ok).toBe(false);
      expect(challenge.serialize()).toBe(raw);
    }
    send(challenge, 'human', { type: 'begin' });
    for (const command of [
      { type: 'intervene', id: 'overtime' },
      { type: 'intervene', id: 'unknown' },
      { type: 'begin' },
      { type: 'beat', choice: 0 },
      { type: 'advance', ticks: NaN },
      { type: 'advance', ticks: Infinity },
      { type: 'advance', ticks: 0.5 },
      { type: 'advance', ticks: -1 },
      { type: 'advance', ticks: 121 },
      { type: 'play-card', index: 100000 },
    ]) {
      const raw = challenge.serialize();
      expect(challenge.command('human', command).ok).toBe(false);
      expect(challenge.serialize()).toBe(raw);
    }
  });

  it('スプリント中のJSON再開で両側のRNG位置・手札・費用・その後の乱数結果を保つ', () => {
    const challenge = new OpposingStrategies();
    for (const side of ['ai', 'human'] as const) {
      send(challenge, side, { type: 'start' });
      send(challenge, side, { type: 'begin' });
      send(challenge, side, { type: 'advance', ticks: 37 });
    }
    const raw = challenge.serialize();
    const saved = JSON.parse(raw);
    expect(saved.runs.ai.checkpoint.sprintRngState).toBeTypeOf('number');
    expect(saved.runs.human.checkpoint.sprintTick).toBe(37);
    const restored = restoreOpposingStrategies(raw);
    expect(restored.serialize()).toBe(raw);
    for (const side of ['human', 'ai'] as const)
      for (let i = 0; i < 3; i++) {
        const command: StrategyCommand = { type: 'advance', ticks: 25 };
        expect(restored.command(side, command)).toEqual(challenge.command(side, command));
        expect(restored.serialize()).toBe(challenge.serialize());
      }
  });

  it('保存した結果/共通条件/RNG/入力/版の改変や上限超過を拒否する', () => {
    const challenge = new OpposingStrategies();
    send(challenge, 'ai', { type: 'start' });
    send(challenge, 'ai', { type: 'begin' });
    const raw = challenge.serialize();
    for (const change of [
      (s: ReturnType<typeof JSON.parse>) => {
        s.schema = 99;
      },
      (s: ReturnType<typeof JSON.parse>) => {
        s.ruleset.fingerprint = 'old';
      },
      (s: ReturnType<typeof JSON.parse>) => {
        s.config.recipe.difficulty = 'easy';
      },
      (s: ReturnType<typeof JSON.parse>) => {
        s.runs.ai.checkpoint.sprintRngState++;
      },
      (s: ReturnType<typeof JSON.parse>) => {
        s.runs.ai.checkpoint.persist.winType = 'aiSuccess';
      },
      (s: ReturnType<typeof JSON.parse>) => {
        s.runs.ai.commands.push({ type: 'start' });
      },
      (s: ReturnType<typeof JSON.parse>) => {
        s.runs.ai.commands = Array(OPPOSING_LIMITS.commandsPerSide + 1).fill({ type: 'start' });
      },
    ]) {
      const changed = JSON.parse(raw);
      change(changed);
      expect(() => restoreOpposingStrategies(JSON.stringify(changed))).toThrow();
    }
    expect(() => restoreOpposingStrategies('x'.repeat(OPPOSING_LIMITS.saveCharacters + 1))).toThrow(
      'save-limit',
    );
    expect(challenge.serialize()).toBe(raw);
  });

  it('成功した介入だけ集中力を計上し、クールダウンによる二重操作では課金しない', () => {
    const challenge = new OpposingStrategies();
    send(challenge, 'human', { type: 'start' });
    send(challenge, 'human', { type: 'begin' });
    const before = challenge.state('human').sprint!.focus;
    send(challenge, 'human', { type: 'intervene', id: 'pairReview' });
    expect(challenge.view().human.costs.focusSpent).toBe(
      before - challenge.state('human').sprint!.focus,
    );
    const raw = challenge.serialize();
    expect(challenge.command('human', { type: 'intervene', id: 'pairReview' }).ok).toBe(false);
    expect(challenge.serialize()).toBe(raw);
  });

  it('既存の投資・目標修正から実勝利へ進み、方針名と異なる自動WinTypeを読み、終端を二重確定しない', () => {
    const config = defaultOpposingConfig();
    config.recipe.difficulty = 'easy';
    config.unlockPool.cards = ['auto-test'];
    const challenge = new OpposingStrategies(config);
    until(challenge, 'human', () => challenge.state('human').phase === 'evolution', true);
    const before = challenge.state('human').evolution.points;
    send(challenge, 'human', { type: 'evolve', id: 'review-1' });
    expect(challenge.view().human.costs.evolutionSpent).toBe(1);
    expect(challenge.state('human').evolution.points).toBe(before - 1);
    const once = challenge.serialize();
    expect(challenge.command('human', { type: 'evolve', id: 'review-1' }).ok).toBe(false);
    expect(challenge.serialize()).toBe(once);
    until(challenge, 'human', () => challenge.state('human').status !== 'playing', true);
    expect(challenge.view().human.terminal).toEqual({
      status: 'won',
      winType: 'happiness',
      loseReason: null,
    });
    expect(challenge.state('human').winType).toBe('happiness');
    const terminal = challenge.serialize();
    expect(challenge.command('human', { type: 'review' }).reason).toBe('terminal');
    expect(challenge.command('human', { type: 'start' }).reason).toBe('terminal');
    expect(challenge.serialize()).toBe(terminal);
    expect(restoreOpposingStrategies(terminal).serialize()).toBe(terminal);
  }, 30_000);

  it('計算上限へ達した未決着を敗北にせず、保存・復元後も操作を打ち切る', () => {
    const config = defaultOpposingConfig();
    config.recipe.difficulty = 'easy';
    const challenge = new OpposingStrategies(config);
    until(challenge, 'human', () => challenge.view().human.progress === 'limited');
    expect(challenge.state('human').sprintsPlayed).toBe(OPPOSING_LIMITS.sprintsPerSide);
    expect(challenge.view().human.terminal).toBeNull();
    expect(challenge.view().complete).toBe(false);
    const raw = challenge.serialize();
    const restored = restoreOpposingStrategies(raw);
    expect(restored.command('human', { type: 'begin' }).reason).toBe('limit');
    expect(restored.serialize()).toBe(raw);
  }, 30_000);

  it('スプリント成果・カードを二重付与せず、実敗北を保存してもう片方を後から継続する', () => {
    const challenge = new OpposingStrategies();
    until(challenge, 'ai', () => challenge.state('ai').status !== 'playing');
    const failed = challenge.view().ai;
    expect(failed.terminal).toMatchObject({ status: 'lost', winType: null });
    expect(challenge.view().human.progress).toBe('not-started');
    const raw = challenge.serialize();
    for (const type of ['start', 'begin', 'result', 'review'])
      expect(challenge.command('ai', { type }).reason).toBe('terminal');
    expect(challenge.serialize()).toBe(raw);
    const restored = restoreOpposingStrategies(raw);
    until(restored, 'human', () => restored.state('human').phase === 'draft');
    const draft = restored.state('human');
    send(restored, 'human', { type: 'choose-card', id: draft.draft![0] });
    const once = restored.serialize();
    expect(restored.command('human', { type: 'choose-card', id: draft.draft![0] }).ok).toBe(false);
    expect(restored.command('human', { type: 'result' }).ok).toBe(false);
    expect(restored.serialize()).toBe(once);
    expect(restored.state('human').deck).toHaveLength(draft.deck.length + 1);
    until(restored, 'human', () => restored.state('human').status !== 'playing');
    const view = restored.view();
    expect(view.ai).toEqual(failed);
    expect(view.complete).toBe(true);
    expect(view.human.metrics.sprints).toBeGreaterThan(failed.metrics.sprints);
    expect(view.onlyHuman.length).toBeGreaterThan(0);
    expect(view.ai.terminal!.winType).toBeNull();
    expect(view.human.terminal!.winType).toBe(restored.state('human').winType ?? null);
    expect(restoreOpposingStrategies(restored.serialize()).view()).toEqual(view);
  }, 30_000);
});
