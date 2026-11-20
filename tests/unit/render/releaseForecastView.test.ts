import { describe, expect, it } from 'vitest';
import { releaseForecastView } from '../../../src/render/releaseForecastView';
import { createReleasePrototype, tickReleasePrototype } from '../../../src/prototypes/release';

const CONFIG = { deadline: 12, implementation: 3, review: 3, verification: 1 };

describe('大型リリース予告の表示モデル', () => {
  it('自動凍結の開始tickと公開期限を区別し、凍結後は検証段階になる', () => {
    let state = createReleasePrototype('RI-252', CONFIG);
    expect(releaseForecastView(state)).toMatchObject({
      phase: 'add',
      freezeTick: 10,
      ticksUntilFreeze: 10,
      remaining: 12,
      unverified: 0,
    });

    for (let tick = 0; tick < 10; tick += 1) state = tickReleasePrototype(state);
    expect(releaseForecastView(state)).toMatchObject({
      phase: 'add',
      frozenAt: null,
      ticksUntilFreeze: 0,
      remaining: 2,
    });

    state = tickReleasePrototype(state);
    expect(releaseForecastView(state)).toMatchObject({
      phase: 'verify',
      frozenAt: 10,
      automaticFreeze: true,
      remaining: 1,
    });

    state = tickReleasePrototype(state);
    expect(releaseForecastView(state)).toMatchObject({
      phase: 'release',
      remaining: 0,
      awaitingReview: 0,
      awaitingVerification: 3,
      unverified: 3,
      delivered: 23,
    });
  });

  it('手動凍結を優先し、未検証を2段階のゲートに分ける', () => {
    let state = createReleasePrototype('RI-252', CONFIG);
    for (let tick = 0; tick < 8; tick += 1) state = tickReleasePrototype(state);
    const beforeFreeze = releaseForecastView(state);
    expect(beforeFreeze.unverified).toBeGreaterThan(0);
    expect(beforeFreeze.awaitingReview + beforeFreeze.awaitingVerification).toBe(
      beforeFreeze.unverified,
    );

    state = tickReleasePrototype(state, true);
    expect(releaseForecastView(state)).toMatchObject({
      phase: 'verify',
      frozenAt: 8,
      automaticFreeze: false,
    });

    while (state.tick < CONFIG.deadline) state = tickReleasePrototype(state);
    expect(releaseForecastView(state)).toMatchObject({
      phase: 'release',
      remaining: 0,
      unverified: 0,
      awaitingReview: 0,
      awaitingVerification: 0,
      delivered: 25,
    });
  });
});
