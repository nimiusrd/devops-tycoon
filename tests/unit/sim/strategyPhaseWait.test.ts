/**
 * RI-102 / SPEC F-3: スプリント間の戦略層は入力を待ち続ける。
 * カウントダウン・自動遷移・リアルタイム層と同じ進行圧は無い。
 */
import { describe, expect, it } from 'vitest';
import { createGame } from '../../../src/game';
import { RunEngine } from '../../../src/sim/run/engine';
import { E2E_MISSED_ADJUSTABLE_SEED } from '../../../src/sim/run/quarterReviewSeeds';
import type { BeatState, RunPhase, RunState } from '../../../src/sim/run/types';
import { playUntil } from '../helpers/runFlow';

const STRATEGIC_PHASES = [
  'setup',
  'result',
  'draft',
  'evolution',
  'beat',
  'shop',
  'rest',
  'recruit',
  'quarterReview',
] as const satisfies readonly RunPhase[];

type StrategicPhase = (typeof STRATEGIC_PHASES)[number];

const OFFER_EVENT: Record<'shop' | 'rest' | 'recruit', string> = {
  shop: 'shop-offer',
  rest: 'rest-offer',
  recruit: 'recruit-offer',
};

type BeatInternals = {
  phase: RunPhase;
  beat: BeatState | null;
  sprintIndexInQuarter: number;
};

const asInternals = (engine: RunEngine): BeatInternals => engine as unknown as BeatInternals;

/** runEngineShop.test.ts の enterDecisionBeat と同じ経路。 */
function enterDecisionBeat(engine: RunEngine, eventId: string): void {
  const i = asInternals(engine);
  i.phase = 'beat';
  i.beat = { eventId, kind: 'decision' };
  i.sprintIndexInQuarter = 2;
}

function enterJudgmentBeat(engine: RunEngine, eventId: string): void {
  const i = asInternals(engine);
  i.phase = 'beat';
  i.beat = { eventId, kind: 'judgment' };
  i.sprintIndexInQuarter = 2;
}

function reachStrategicPhase(phase: StrategicPhase): RunEngine {
  if (phase === 'setup') {
    const engine = new RunEngine({ seed: 'ri102-setup', difficulty: 'easy' });
    engine.startRun();
    return engine;
  }
  if (phase === 'beat') {
    const engine = new RunEngine({ seed: 'ri102-beat', difficulty: 'easy' });
    engine.startRun();
    enterDecisionBeat(engine, 'shop-offer');
    return engine;
  }
  if (phase === 'shop' || phase === 'rest' || phase === 'recruit') {
    const engine = new RunEngine({ seed: `ri102-${phase}`, difficulty: 'easy' });
    engine.startRun();
    enterDecisionBeat(engine, OFFER_EVENT[phase]);
    engine.resolveBeat(0);
    return engine;
  }
  if (phase === 'quarterReview') {
    const engine = new RunEngine({ seed: E2E_MISSED_ADJUSTABLE_SEED, difficulty: 'easy' });
    engine.startRun();
    playUntil(engine, 'quarterReview');
    return engine;
  }
  const engine = new RunEngine({ seed: `ri102-${phase}`, difficulty: 'easy' });
  engine.startRun();
  playUntil(engine, phase);
  return engine;
}

function assertIdleFreeze(engine: RunEngine): RunState {
  expect(engine.sprintRunning()).toBe(false);
  const before = engine.snapshot();
  engine.step(1_000_000);
  engine.step(1_000_000);
  engine.step(16);
  expect(engine.snapshot()).toEqual(before);
  expect(engine.sprintRunning()).toBe(false);
  return before;
}

function continueStrategicPhase(engine: RunEngine, phase: StrategicPhase): void {
  switch (phase) {
    case 'setup':
      engine.beginSetupSprint();
      return;
    case 'result':
      engine.acknowledgeResult();
      return;
    case 'draft':
      engine.skipDraft();
      return;
    case 'evolution':
      engine.finishEvolution();
      return;
    case 'beat':
      engine.resolveBeat(0);
      return;
    case 'shop':
      engine.leaveShop();
      return;
    case 'rest':
      engine.restChoose('heal');
      return;
    case 'recruit':
      engine.recruitChoose('skip');
      return;
    case 'quarterReview': {
      const review = engine.snapshot().quarterReview;
      if (review?.outcome === 'missed_adjustable') {
        engine.chooseGoalAdjustment(review.availableAdjustments[0] ?? 'cut_scope');
        return;
      }
      engine.acknowledgeQuarterReview();
    }
  }
}

describe('RI-102 F-3 戦略フェーズの入力待ち', () => {
  it.each(STRATEGIC_PHASES)(
    '%s は入力なしにフェーズ・選択・資源が変わらず、明示操作で進む',
    (phase) => {
      const engine = reachStrategicPhase(phase);
      expect(engine.snapshot().phase).toBe(phase);
      expect(engine.snapshot().status).toBe('playing');

      const frozen = assertIdleFreeze(engine);
      expect(frozen.phase).toBe(phase);

      continueStrategicPhase(engine, phase);
      const after = engine.snapshot();
      expect(after.phase).not.toBe(phase);
    },
  );

  it('judgment ビートは step だけでは解決せず、resolveBeat 後に進む', () => {
    const engine = new RunEngine({ seed: 'ri102-judgment', difficulty: 'easy' });
    engine.startRun();
    enterJudgmentBeat(engine, 'readme-haiku');

    expect(engine.snapshot().phase).toBe('beat');
    expect(engine.snapshot().beat).toEqual({ eventId: 'readme-haiku', kind: 'judgment' });
    assertIdleFreeze(engine);
    expect(engine.snapshot().beat?.eventId).toBe('readme-haiku');

    engine.resolveBeat();
    expect(engine.snapshot().phase).not.toBe('beat');
    expect(engine.snapshot().beat).toBeNull();
  });

  it('GameHandle の自動進行ゲートは戦略フェーズで閉じる', () => {
    const game = createGame({ seed: 'ri102-game', difficulty: 'easy' });
    const started = game.startRun('easy');
    expect(started.phase).toBe('setup');
    expect(game.isSprintRunning()).toBe(false);

    const after = game.step(1_000_000);
    expect(after).toEqual(started);
    expect(game.phase()).toBe('setup');
    expect(game.isSprintRunning()).toBe(false);
  });

  it('evolution では step しても tick・出来事・出荷が動かない（#386）', () => {
    const engine = reachStrategicPhase('evolution');
    expect(engine.snapshot().phase).toBe('evolution');
    expect(engine.sprintRunning()).toBe(false);
    const before = engine.snapshot();
    engine.step(1_000_000);
    engine.step(16);
    const after = engine.snapshot();
    expect(after.sprintTick).toBe(before.sprintTick);
    expect(after.sprint?.events).toEqual(before.sprint?.events);
    expect(after.org.deliveryScore).toBe(before.org.deliveryScore);
    expect(after.sprint?.metrics.delivered).toBe(before.sprint?.metrics.delivered);
    expect(after.sprint?.tasks.map((task) => task.lane)).toEqual(
      before.sprint?.tasks.map((task) => task.lane),
    );
  });
});
