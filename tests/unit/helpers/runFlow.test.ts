import { describe, expect, it } from 'vitest';
import { AI_DEPENDENCY_CAP, AI_LITERACY_UNSAFE_CAP } from '../../../src/sim/outcome';
import { RunEngine } from '../../../src/sim/run/engine';
import { advance } from './runFlow';

describe('runFlow のスプリント終端計測', () => {
  it('途中敗北でも終端 tick と completed=false を通知する', () => {
    const e = new RunEngine({ seed: 'ri78-terminal-sprint', difficulty: 'nightmare' });
    e.startRun();

    // カード発動で即時敗北する境界状態を作る（RI-30 の既存経路と同じ）。
    const internal = e as unknown as {
      phase: string;
      draft: string[] | null;
      org: { aiDependency: number; aiLiteracy: number };
      sprint: {
        cardPiles: { hand: number[] };
      } | null;
    };
    internal.phase = 'draft';
    internal.draft = ['copilot'];
    e.chooseCard('copilot');
    internal.phase = 'setup';
    e.beginSetupSprint();

    const started = e.snapshot();
    const copilotIndex = started.deck.findIndex((card) => card.defId === 'copilot');
    expect(copilotIndex).toBeGreaterThanOrEqual(0);
    internal.sprint!.cardPiles.hand = [copilotIndex];

    // 1 tick 進めてからカードを発動し、0 tick の即時敗北と区別する。
    e.step(100);
    const terminalTick = e.snapshot().sprintTick;
    expect(terminalTick).toBeGreaterThan(0);
    internal.org.aiDependency = AI_DEPENDENCY_CAP - 5;
    internal.org.aiLiteracy = AI_LITERACY_UNSAFE_CAP;

    const ends: Array<{ completed: boolean; ticks: number }> = [];
    advance(e, {
      onSprintEnd: (metrics) => ends.push(metrics),
    });

    expect(e.snapshot().phase).toBe('lost');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ completed: false, ticks: terminalTick });
  });
});
