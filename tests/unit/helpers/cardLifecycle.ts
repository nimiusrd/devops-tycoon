/** カード契約を公開APIで検証するための、編成済みランと有界スプリント進行。 */
import { expect } from 'vitest';
import { CARD_DEFS } from '../../../src/data/cards';
import { RunEngine } from '../../../src/sim/run/engine';
import type { CardInstance } from '../../../src/sim/types';

export function setupWithDeck(seed: string, deck: CardInstance[] = []): RunEngine {
  const engine = new RunEngine({
    seed,
    difficulty: 'easy',
    allowedCards: new Set(CARD_DEFS.map((card) => card.id)),
  });
  engine.startRun();
  const saved = engine.exportPersistState();
  expect(saved).not.toBeNull();
  // 初期デッキ指定のない現行APIでは、setupのセーブ復元で所持カードを用意する。
  saved!.deck = structuredClone(deck);
  engine.hydratePersistState(saved!);
  expect(engine.currentPhase()).toBe('setup');
  return engine;
}

export function startWithDeck(seed: string, deck: CardInstance[] = []): RunEngine {
  const engine = setupWithDeck(seed, deck);
  engine.beginSetupSprint();
  expect(engine.currentPhase()).toBe('sprint');
  return engine;
}

export function finishSprint(engine: RunEngine): void {
  for (let steps = 0; engine.currentPhase() === 'sprint' && steps < 2_000; steps += 1) {
    engine.step(1_000);
  }
  // 途中敗北を完走として扱わず、実際のresultへの遷移を要求する。
  expect(engine.currentPhase()).toBe('result');
  expect(engine.snapshot().sprint?.complete).toBe(true);
  expect(engine.snapshot().lastResult).not.toBeNull();
}
