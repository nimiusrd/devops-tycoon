import { describe, expect, it } from 'vitest';
import { RunEngine } from '../../src/sim/run/engine';
import {
  normalizeReplay,
  normalizeReplayKeyframes,
  REPLAY_SCHEMA_VERSION,
  type ReplayBlob,
  type ReplayKeyframe,
} from '../../src/state/replay';

function makeFrame(seed = 'normalize-frame'): ReplayKeyframe['frame'] {
  const engine = new RunEngine({ seed, difficulty: 'easy' });
  engine.startRun('easy', [], seed);
  const frame = engine.exportReplayFrame();
  if (!frame) throw new Error('export failed');
  return frame;
}

function makeBlob(overrides: Partial<ReplayBlob> = {}): ReplayBlob {
  const base: ReplayBlob = {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    id: 'replay-normalize',
    seed: 'normalize-seed',
    difficulty: 'easy',
    trials: [],
    finishedAt: 1234,
    outcome: {
      status: 'won',
      diagnosis: 'healthyAcceleration',
      score: 42,
    },
    keyframes: [{ phase: 'setup', label: '編成', frame: makeFrame('normalize-seed') }],
  };

  return {
    ...base,
    ...overrides,
    outcome: {
      ...base.outcome,
      ...overrides.outcome,
    },
    keyframes: overrides.keyframes ?? base.keyframes,
    trials: overrides.trials ?? base.trials,
  };
}

describe('リプレイ正規化（RI-72-B3）', () => {
  it('id / seed / difficulty / trials の壊れた値を拒否し、trials を clone する', () => {
    const valid = makeBlob({ trials: ['trial-a', 'trial-b'] });

    expect(normalizeReplay({ ...valid, id: 123 })).toBeNull();
    expect(normalizeReplay({ ...valid, seed: null })).toBeNull();
    expect(normalizeReplay({ ...valid, difficulty: 7 })).toBeNull();
    expect(normalizeReplay({ ...valid, trials: 'trial-a' })).toBeNull();
    expect(normalizeReplay({ ...valid, trials: ['trial-a', 2] })).toBeNull();

    const normalized = normalizeReplay(valid);
    expect(normalized?.trials).toEqual(['trial-a', 'trial-b']);
    expect(normalized?.trials).not.toBe(valid.trials);

    valid.trials.push('after-normalize');
    expect(normalized?.trials).toEqual(['trial-a', 'trial-b']);
  });

  it('finishedAt / outcome の壊れた値を拒否し、有効な敗北 outcome を保持する', () => {
    const validLost = makeBlob({
      outcome: {
        status: 'lost',
        diagnosis: 'reviewHell',
        score: 7,
        loseReason: 'reviewFreeze',
      },
    });

    expect(normalizeReplay({ ...validLost, finishedAt: '1234' })).toBeNull();
    expect(normalizeReplay({ ...validLost, finishedAt: Number.NaN })).toBeNull();
    expect(normalizeReplay({ ...validLost, outcome: null })).toBeNull();
    expect(
      normalizeReplay({ ...validLost, outcome: { ...validLost.outcome, status: 'playing' } }),
    ).toBeNull();
    expect(
      normalizeReplay({ ...validLost, outcome: { ...validLost.outcome, diagnosis: 1 } }),
    ).toBeNull();
    expect(
      normalizeReplay({ ...validLost, outcome: { ...validLost.outcome, score: '7' } }),
    ).toBeNull();
    expect(
      normalizeReplay({ ...validLost, outcome: { ...validLost.outcome, score: Infinity } }),
    ).toBeNull();

    expect(normalizeReplay(validLost)?.outcome).toEqual({
      status: 'lost',
      winType: undefined,
      loseReason: 'reviewFreeze',
      diagnosis: 'reviewHell',
      score: 7,
    });
  });

  it('normalizeReplayKeyframes は壊れた要素だけ捨て、label の有無を正規化する', () => {
    const frame = makeFrame('keyframes-valid');
    const resultFrame = structuredClone(frame);
    resultFrame.phase = 'result';

    const normalized = normalizeReplayKeyframes([
      null,
      { phase: 1, frame },
      { phase: 'sprint', frame: { ...frame, phase: 'sprint' } },
      { phase: 'setup', frame: null },
      { phase: 'setup', frame: { ...frame, seed: 1 } },
      { phase: 'setup', frame: { ...frame, extras: null } },
      { phase: 'setup', frame: { ...frame, extras: { ...frame.extras, allowedCards: 'bad' } } },
      { phase: 'setup', frame: { ...frame, extras: { ...frame.extras, allowedRelics: 'bad' } } },
      { phase: 'setup', label: '編成', frame },
      { phase: 'result', label: 123, frame: resultFrame },
    ]);

    expect(normalized).toHaveLength(2);
    expect(normalized.map((keyframe) => keyframe.phase)).toEqual(['setup', 'result']);
    expect(normalized[0]?.label).toBe('編成');
    expect(normalized[1]?.label).toBeUndefined();
  });

  it('normalizeReplayKeyframes は frame を deep clone して入力と独立させる', () => {
    const frame = makeFrame('keyframes-clone');
    const normalized = normalizeReplayKeyframes([{ phase: 'setup', label: '編成', frame }]);
    const normalizedFrame = normalized[0]?.frame;

    expect(normalizedFrame).toBeTruthy();
    expect(normalizedFrame).not.toBe(frame);
    expect(normalizedFrame?.extras.allowedCards).not.toBe(frame.extras.allowedCards);
    expect(normalizedFrame?.extras.allowedRelics).not.toBe(frame.extras.allowedRelics);

    frame.extras.allowedCards.push('mutated-input-card');
    normalizedFrame?.extras.allowedRelics.push('mutated-normalized-relic');

    expect(normalizedFrame?.extras.allowedCards).not.toContain('mutated-input-card');
    expect(frame.extras.allowedRelics).not.toContain('mutated-normalized-relic');
  });

  it('完全な ReplayBlob では部分的に壊れた keyframes と全破棄 keyframes を拒否する', () => {
    const frame = makeFrame('blob-keyframes');
    const validKeyframe: ReplayKeyframe = { phase: 'setup', label: '編成', frame };

    expect(normalizeReplay({ ...makeBlob(), keyframes: 'setup' })).toBeNull();
    expect(normalizeReplay({ ...makeBlob(), keyframes: [] })).toBeNull();
    expect(
      normalizeReplay({
        ...makeBlob(),
        keyframes: [validKeyframe, { phase: 'setup', frame: { ...frame, seed: 1 } }],
      }),
    ).toBeNull();
    expect(
      normalizeReplay({
        ...makeBlob(),
        keyframes: [{ phase: 'setup', frame: { ...frame, extras: null } }],
      }),
    ).toBeNull();

    const normalized = normalizeReplay(makeBlob({ keyframes: [validKeyframe] }));
    expect(normalized?.keyframes).toHaveLength(1);
    expect(normalized?.keyframes[0]?.frame).not.toBe(frame);
  });
});
